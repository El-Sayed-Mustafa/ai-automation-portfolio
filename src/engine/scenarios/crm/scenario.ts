import type { Scenario, ScenarioContext } from "../../session";
import type { Tracer } from "../../tracer";
import type { Json } from "../../types";
import {
  LEAD_RESULT_STATUS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  addMinutes,
  firstEmptyAddressSlot,
  isGenericName,
  isValidLeadPhone,
  outboxBackoffMs,
  outboxStatusAfterFailure,
  parseWebhookPayload,
  phoneDigitVariants,
  validateBookingForm,
  type GreenApiPayload,
} from "./rules";
import { createMemoryStore, type CrmStore, type IdPrefix } from "./store";
import {
  CREWS,
  DEMO_DATE,
  SEEDED_APPOINTMENT_ID,
  SERVICE_TYPES,
  START_TIMES,
  newCustomer,
  type Appointment,
  type Crew,
  type Customer,
  type FollowUp,
  type Lead,
  type OutboxRow,
  type ServiceType,
  type StartTime,
} from "./world";

export const CRM_SCENARIO_ID = "crm.whatsapp-to-booked-visit";

export const CRM_STEPS = [
  "webhook.receive",
  "payload.parse",
  "lead.filter",
  "customer.match",
  "lead.upsert",
  "lead.evaluate",
  "lead.convert",
  "booking.request",
  "booking.validate",
  "booking.insert",
  "outbox.enqueue",
  "outbox.drain",
  "notify.technician",
] as const;

export type CrmStepId = (typeof CRM_STEPS)[number];

export const CRM_FAULTS = [
  "invalid-webhook-key",
  "duplicate-delivery",
  "fast-path-down",
  "crew-conflict",
  "worker-transient",
  "worker-permanent",
  "technician-no-email",
  "mail-failure",
] as const;

export type CrmFaultId = (typeof CRM_FAULTS)[number];

export interface CrmInput {
  senderNumber: string;
  chatType: "individual" | "group";
  contactName: string;
  message: string;
  crew: Crew;
  startTime: StartTime;
  serviceType: ServiceType;
  price: number;
}

export const CRM_DEFAULT_INPUT: CrmInput = {
  senderNumber: "97305550142",
  chatType: "individual",
  contactName: "Sample Contact",
  message: "Hello, I have ants in the kitchen. Can you come this week?",
  crew: "Crew A",
  startTime: "13:00",
  serviceType: "General pest control",
  price: 25,
};

export interface CrmPreset {
  id: string;
  label: string;
  description: string;
  input: CrmInput;
}

export const CRM_PRESETS: CrmPreset[] = [
  {
    id: "new-enquiry",
    label: "New enquiry",
    description: "A number the CRM has never seen.",
    input: CRM_DEFAULT_INPUT,
  },
  {
    id: "existing-customer",
    label: "Existing customer",
    description: "The number already belongs to a customer record.",
    input: { ...CRM_DEFAULT_INPUT, senderNumber: "97305550101", contactName: "Demo Customer A", startTime: "15:00" },
  },
  {
    id: "returning-lead",
    label: "Returning lead",
    description: "A lead with an open follow-up writes again.",
    input: {
      ...CRM_DEFAULT_INPUT,
      senderNumber: "97305550177",
      contactName: "Returning Enquirer",
      message: "Hi, are you available on Sunday?",
    },
  },
  {
    id: "group-chat",
    label: "Group chat",
    description: "A message from a WhatsApp group, which must not become a lead.",
    input: { ...CRM_DEFAULT_INPUT, chatType: "group", senderNumber: "120363040000000001", contactName: "Building residents" },
  },
  {
    id: "invalid-number",
    label: "Invalid number",
    description: "A sender id that is not a usable phone number.",
    input: { ...CRM_DEFAULT_INPUT, senderNumber: "000000000", contactName: "" },
  },
];

export interface InputValidation {
  ok: boolean;
  value: CrmInput;
  errors: Partial<Record<keyof CrmInput, string>>;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Validates and normalises visitor-edited sample input. The simulator never
 * sends this anywhere; the limits exist so the demo behaves predictably and so
 * the same checks can guard a server-side sandbox later.
 */
export function validateCrmInput(raw: Partial<Record<keyof CrmInput, unknown>>): InputValidation {
  const errors: InputValidation["errors"] = {};

  const senderNumber = String(raw.senderNumber ?? "").replace(/[\s+()-]/g, "");
  if (!/^\d{7,18}$/.test(senderNumber)) errors.senderNumber = "Use 7 to 18 digits.";

  const chatType = raw.chatType === "group" ? "group" : "individual";

  const contactName = String(raw.contactName ?? "").replace(CONTROL_CHARS, "").trim();
  if (contactName.length > 40) errors.contactName = "Keep the name under 40 characters.";

  const message = String(raw.message ?? "").replace(CONTROL_CHARS, " ").trim();
  if (!message) errors.message = "Enter a message.";
  else if (message.length > 280) errors.message = "Keep the message under 280 characters.";

  const crew = CREWS.find((c) => c === raw.crew);
  if (!crew) errors.crew = "Choose a crew.";

  const startTime = START_TIMES.find((s) => s === raw.startTime);
  if (!startTime) errors.startTime = "Choose a start time.";

  const serviceType = SERVICE_TYPES.find((s) => s === raw.serviceType);
  if (!serviceType) errors.serviceType = "Choose a service.";

  const price = typeof raw.price === "number" ? raw.price : Number(raw.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000) errors.price = "Enter a price between 0 and 1000.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      senderNumber,
      chatType,
      contactName: contactName.slice(0, 40),
      message: message.slice(0, 280),
      crew: crew ?? CRM_DEFAULT_INPUT.crew,
      startTime: startTime ?? CRM_DEFAULT_INPUT.startTime,
      serviceType: serviceType ?? CRM_DEFAULT_INPUT.serviceType,
      price: Number.isFinite(price) ? Math.min(Math.max(price, 0), 1000) : CRM_DEFAULT_INPUT.price,
    },
  };
}

/**
 * Simulated latencies in virtual milliseconds. They only pace the playback and
 * are NOT measurements of the production system.
 */
const LATENCY = {
  appsScriptRequest: 180,
  parse: 2,
  filter: 1,
  dbRead: 140,
  dbWrite: 190,
  edgeRequest: 320,
  edgeTimeout: 12_000,
  workerRun: 900,
  mailSend: 650,
  clientWorkerDelay: 1_200,
  triggerInterval: 60_000,
} as const;

/** 09:00 in Bahrain (UTC+3) on the demo day. */
const BASE_EPOCH_MS = Date.UTC(2026, 2, 15, 6, 0, 0);
const COORDINATOR = "Demo Coordinator";
const SAMPLE_NEW_ADDRESS = "Villa 7, Road 15, Block 520 (sample)";

function iso(virtualMs: number): string {
  return new Date(BASE_EPOCH_MS + virtualMs).toISOString();
}

function bahrainStamp(virtualMs: number): string {
  const local = new Date(BASE_EPOCH_MS + virtualMs + 3 * 3_600_000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}

function snap(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic stand-in for `crypto.randomUUID()`, so runs are reproducible. */
export function pseudoUuid(seed: string): string {
  const hex = [0, 1, 2, 3].map((i) => fnv1a(`${seed}:${i}`).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildPayload(input: CrmInput): GreenApiPayload {
  const chatId = input.chatType === "group" ? `${input.senderNumber}@g.us` : `${input.senderNumber}@c.us`;
  return {
    typeWebhook: "incomingMessageReceived",
    idMessage: "DEMO-MSG-" + fnv1a(input.senderNumber + input.message).toString(16).toUpperCase().padStart(8, "0"),
    senderData: { chatId, senderName: input.contactName },
    messageData: { typeMessage: "textMessage", textMessageData: { textMessage: input.message } },
  };
}

function reserveId(store: CrmStore, t: Tracer, prefix: IdPrefix): string {
  const before = store.reserveNumber(prefix);
  t.change("crm_id_counters", "update", prefix, { prefix, last_number: before }, { prefix, last_number: before + 1 });
  return `${prefix}-${before + 1}`;
}

/**
 * The workflow, written against a store. Every write records the row the
 * store returned, so in a server run the "after" of a change is what the
 * database holds, not what the program meant to write.
 */
function* run({ input, faults, t }: ScenarioContext<CrmInput>, store: CrmStore): Generator<void, void, string> {
  const payload = buildPayload(input);

  // -- 1. Webhook --------------------------------------------------------
  t.start("webhook.receive", {
    method: "POST",
    query: { greenApiWebhook: "1", key: "••••••••" },
    body: snap(payload),
  });
  t.advance(LATENCY.appsScriptRequest);
  t.log("info", "Script lock acquired; the whole handler runs inside it.");
  if (faults.has("invalid-webhook-key")) {
    t.log("error", "Query key does not match the configured webhook key.");
    t.fail("INVALID_WEBHOOK_KEY", "Invalid Green API webhook key.");
    t.skipRemaining("The request was rejected before any data was read.");
    t.finish("failed", "Webhook rejected: invalid key. Nothing was written.", { written: 0 });
    return;
  }
  t.log("info", "Webhook key accepted.");
  t.ok({ accepted: true });

  // -- 2. Parse ----------------------------------------------------------
  t.start("payload.parse", { chatId: payload.senderData?.chatId ?? "", typeWebhook: payload.typeWebhook ?? "" });
  t.advance(LATENCY.parse);
  const parsed = parseWebhookPayload(payload);
  t.log("info", parsed.phone ? `Chat id normalised to ${parsed.phone}.` : "No usable phone number in the chat id.");
  t.ok(snap(parsed));

  // -- 3. Filter ---------------------------------------------------------
  t.start("lead.filter", { phone: parsed.phone, isGroup: parsed.isGroup });
  t.advance(LATENCY.filter);
  let ignoreReason = "";
  if (!parsed.phone) ignoreReason = "Ignored webhook without customer phone.";
  else if (!isValidLeadPhone(parsed.phone)) ignoreReason = "Ignored webhook with invalid customer phone.";
  else if (parsed.isGroup) ignoreReason = "Ignored group chat webhook.";
  if (ignoreReason) {
    t.log("warn", ignoreReason, { isGroup: parsed.isGroup, digits: parsed.phoneDigits.length });
    t.ok({ ignored: true, reason: ignoreReason });
    t.skipRemaining("The message was ignored, so no lead exists to work on.");
    t.finish("success", "Message ignored. No lead was created.", { ignored: true, reason: ignoreReason });
    return;
  }
  t.log("info", "Sender is an individual with a usable phone number.");
  t.ok({ ignored: false });

  // -- 4. Match customer -------------------------------------------------
  const variants = phoneDigitVariants(parsed.phone);
  t.start("customer.match", { phoneDigitVariants: variants, columns: ["phone_digits", "secondary_phone_digits"] });
  t.advance(LATENCY.dbRead);
  const existingCustomer = store.findCustomerByPhone(variants);
  t.log(
    "info",
    existingCustomer
      ? `Matched ${existingCustomer.customer_id} (${existingCustomer.customer_name}).`
      : "No customer has this number.",
  );
  t.ok({
    matched: Boolean(existingCustomer),
    customerId: existingCustomer?.customer_id ?? null,
    customerName: existingCustomer?.customer_name ?? null,
  });

  // -- 5. Upsert lead ----------------------------------------------------
  t.start("lead.upsert", { whatsappDigits: parsed.phoneDigits, messageId: parsed.messageId });
  t.advance(LATENCY.dbRead);
  const knownLead = store.findLeadByPhone(variants);
  let lead: Lead;
  const leadStatus = existingCustomer ? "Existing Customer" : "New";
  const customerName = existingCustomer ? existingCustomer.customer_name : parsed.displayName;

  const applyDelivery = (current: Lead): Lead => {
    const before = snap(current);
    const target = { ...current };
    target.message_count += 1;
    target.customer_name = existingCustomer
      ? customerName
      : !target.customer_name || isGenericName(target.customer_name)
        ? customerName || target.customer_name
        : target.customer_name;
    target.display_name =
      !target.display_name || isGenericName(target.display_name) ? parsed.displayName || target.display_name : target.display_name;
    target.last_message = parsed.message;
    target.message_type = parsed.messageType;
    target.status = target.status || leadStatus;
    target.existing_customer_id = existingCustomer ? existingCustomer.customer_id : target.existing_customer_id;
    target.last_message_id = parsed.messageId;
    target.direction = parsed.direction;
    const saved = store.saveLead(target);
    t.change("crm_leads", "update", saved.lead_id, before, snap(saved));
    return saved;
  };

  let leadAction: "created" | "updated";
  if (knownLead) {
    leadAction = "updated";
    lead = applyDelivery(knownLead);
    t.log("info", `Existing lead ${lead.lead_id} updated; message count is now ${lead.message_count}.`);
  } else {
    leadAction = "created";
    const leadId = reserveId(store, t, "LEAD");
    lead = store.insertLead({
      lead_id: leadId,
      lead_no: Number(leadId.split("-")[1]),
      whatsapp_number: parsed.phone,
      customer_name: customerName,
      display_name: parsed.displayName,
      last_message: parsed.message,
      message_type: parsed.messageType,
      message_count: 1,
      last_message_id: parsed.messageId,
      direction: parsed.direction,
      status: leadStatus,
      lead_type: "Inbound WhatsApp",
      lead_result: existingCustomer ? "Existing Customer" : "New",
      call_done: false,
      notes: existingCustomer ? "Matched existing customer automatically." : "",
      existing_customer_id: existingCustomer?.customer_id ?? "",
      converted_customer_id: "",
      next_follow_up_date: null,
      last_action_by: "",
    });
    t.change("crm_leads", "insert", leadId, null, snap(lead));
    t.log("info", `Lead ${leadId} created with status "${leadStatus}".`);
  }
  t.advance(LATENCY.dbWrite);

  let duplicateWarning: string | undefined;
  if (faults.has("duplicate-delivery")) {
    t.advance(LATENCY.appsScriptRequest);
    t.log("warn", `Green API delivered ${parsed.messageId} a second time.`);
    t.log("warn", "The handler stores the last message id but does not compare it, so the delivery is processed again.");
    lead = applyDelivery(lead);
    t.advance(LATENCY.dbWrite);
    duplicateWarning = `One message was counted twice (message count ${lead.message_count}). No second lead was created.`;
  }
  t.ok({ leadId: lead.lead_id, action: leadAction, messageCount: lead.message_count, status: lead.status }, duplicateWarning);

  // -- 6. Human evaluation -----------------------------------------------
  t.start("lead.evaluate", { leadId: lead.lead_id, phone: lead.whatsapp_number, lastMessage: lead.last_message });
  t.wait("The office coordinator calls the lead and records the result. What happened on the call?", [
    { id: "book", label: "Interested, book a visit", description: "Continue to the booking form." },
    { id: "follow-up", label: "No answer, follow up tomorrow", description: "Keep exactly one open follow-up for this lead." },
    { id: "lost", label: "Not interested", description: "Close the lead as lost." },
  ]);
  const choice = yield;
  t.resumed(choice);
  t.log("info", "Human step: the time the coordinator spends on the call is not simulated.");

  const leadResult = choice === "book" ? "Interested" : choice === "follow-up" ? "No Answer" : "Not Interested";
  const followDate = choice === "follow-up" ? "2026-03-16" : null;
  const noteText =
    choice === "book" ? "Wants a visit this week." : choice === "follow-up" ? "No answer, call again tomorrow." : "Not interested.";
  {
    const before = snap(lead);
    const stamped = `[${bahrainStamp(t.time)} · ${COORDINATOR}] ${noteText}`;
    lead = store.saveLead({
      ...lead,
      notes: lead.notes ? `${lead.notes}\n${stamped}` : stamped,
      call_done: true,
      lead_result: leadResult,
      status: LEAD_RESULT_STATUS[leadResult] ?? leadResult,
      next_follow_up_date: followDate,
      last_action_by: COORDINATOR,
    });
    t.change("crm_leads", "update", lead.lead_id, before, snap(lead));
    t.log("info", `Call result "${leadResult}" sets the lead status to "${lead.status}". The note is appended, never overwritten.`);
  }

  let followUpId: string | null = null;
  const openFollowUp = store.findOpenFollowUp(lead.lead_id);
  if (followDate) {
    if (openFollowUp) {
      const moved = store.saveFollowUp({ ...openFollowUp, follow_up_date: followDate });
      followUpId = moved.follow_up_id;
      t.change("crm_follow_ups", "update", moved.follow_up_id, snap(openFollowUp), snap(moved));
      t.log("info", `Open follow-up ${moved.follow_up_id} moved to ${followDate}; a second one is never created.`);
    } else {
      followUpId = reserveId(store, t, "FU");
      const row: FollowUp = store.insertFollowUp({
        follow_up_id: followUpId,
        lead_id: lead.lead_id,
        customer_name: lead.customer_name || lead.display_name,
        phone: lead.whatsapp_number,
        follow_up_date: followDate,
        follow_up_status: "Pending",
        reason: "Lead call follow-up",
      });
      t.change("crm_follow_ups", "insert", followUpId, null, snap(row));
      t.log("info", `Follow-up ${followUpId} created for ${followDate}.`);
    }
  } else if (openFollowUp) {
    const closed = store.saveFollowUp({ ...openFollowUp, follow_up_status: "Completed" });
    t.change("crm_follow_ups", "update", closed.follow_up_id, snap(openFollowUp), snap(closed));
    t.log("info", `Follow-up date cleared, so ${closed.follow_up_id} is marked Completed.`);
  }
  t.advance(LATENCY.dbWrite);
  t.ok({ leadId: lead.lead_id, leadResult, status: lead.status, followUpId });

  if (choice !== "book") {
    t.skipRemaining(choice === "follow-up" ? "No booking yet: the lead is waiting for a follow-up call." : "The lead was closed as lost.");
    t.finish(
      "success",
      choice === "follow-up"
        ? `Lead ${lead.lead_id} is in "Follow Up" with one open follow-up for ${followDate}.`
        : `Lead ${lead.lead_id} closed as "Lost". No customer or booking was created.`,
      { leadId: lead.lead_id, status: lead.status, followUpId },
    );
    return;
  }

  // -- 7. Convert lead ---------------------------------------------------
  t.start("lead.convert", { leadId: lead.lead_id, phone: lead.whatsapp_number });
  t.advance(LATENCY.dbRead);
  const knownCustomer = store.findCustomerByPhone(phoneDigitVariants(lead.whatsapp_number));
  const customerCreated = !knownCustomer;
  let customer: Customer;
  if (!knownCustomer) {
    const customerId = reserveId(store, t, "CUST");
    customer = store.insertCustomer(
      newCustomer({
        customer_id: customerId,
        customer_name: lead.customer_name || lead.display_name || lead.whatsapp_number,
        phone: lead.whatsapp_number,
      }),
    );
    t.change("crm_customers", "insert", customerId, null, snap(customer));
    t.log("info", `No customer owns this number, so ${customerId} was created.`);
  } else {
    customer = knownCustomer;
    t.log("info", `${customer.customer_id} already owns this number; no duplicate customer is created.`);
  }
  {
    const before = snap(lead);
    lead = store.saveLead({
      ...lead,
      customer_name: customer.customer_name,
      status: "Existing Customer",
      lead_type: "Existing Customer",
      existing_customer_id: customer.customer_id,
      converted_customer_id: customer.customer_id,
    });
    t.change("crm_leads", "update", lead.lead_id, before, snap(lead));
  }
  t.advance(LATENCY.dbWrite);
  t.ok({ leadId: lead.lead_id, customerId: customer.customer_id, customerCreated });

  // -- 8. Booking request (browser to Edge Function) ---------------------
  const conflictFault = faults.has("crew-conflict");
  const crew: Crew = conflictFault ? "Crew A" : input.crew;
  const startTime = conflictFault ? "10:30" : input.startTime;
  const endTime = addMinutes(startTime, 60);
  const form = {
    customerId: customer.customer_id,
    appointmentDate: DEMO_DATE,
    startTime,
    endTime,
    technician: crew,
    serviceType: input.serviceType,
    price: input.price,
    bookingEmployee: COORDINATOR,
  };
  t.start("booking.request", {
    request: "POST /functions/v1/crm-api",
    headers: { "content-type": "application/json", apikey: "••••••••", "x-crm-token": "<payload>.<hmac-sha256 signature>" },
    body: { fn: "createAppointment", args: [snap(form)] },
    timeoutMs: LATENCY.edgeTimeout,
  });
  if (faults.has("fast-path-down")) {
    t.advance(LATENCY.edgeTimeout);
    t.log("error", "No response within 12 s; the browser aborted the request.");
    t.log("warn", "Writes are never replayed through the fallback path: a lost response after a successful insert must not create a second booking.");
    t.fail("FAST_API_UNAVAILABLE", "Fast API unavailable. The booking was not saved and the coordinator sees the error.");
    t.skipRemaining("The booking request never reached the database.");
    t.finish("failed", `Booking not saved. Lead ${lead.lead_id} and customer ${customer.customer_id} were kept.`, {
      leadId: lead.lead_id,
      customerId: customer.customer_id,
      appointmentId: null,
    });
    return;
  }
  t.advance(LATENCY.edgeRequest);
  t.log("info", "Token signature verified with HMAC-SHA256; scope is office and the token has not expired.");
  t.log("info", "createAppointment is on the office allow-list.");
  t.ok({ status: 200, scope: "office", operation: "createAppointment" });

  // -- 9. Validate booking -----------------------------------------------
  t.start("booking.validate", snap(form));
  if (conflictFault) t.log("warn", `Injected: the requested slot overlaps ${SEEDED_APPOINTMENT_ID} on ${crew}.`);
  const formError = validateBookingForm(form);
  let bookingError = formError ? { code: "VALIDATION", message: formError } : null;
  if (!bookingError) {
    t.advance(LATENCY.dbRead);
    const sameDay = store.findVisitOnDay(customer.customer_id, DEMO_DATE);
    if (sameDay) {
      bookingError = {
        code: "CONFLICT",
        message: `This customer already has an appointment on the same day (${sameDay.appointment_id}).`,
      };
    } else {
      t.log("info", "The customer has no other visit on this day.");
    }
  }
  if (!bookingError) {
    t.advance(LATENCY.dbRead);
    const clash = store.findCrewClash(crew, DEMO_DATE, startTime, endTime);
    if (clash) {
      bookingError = { code: "CONFLICT", message: `${crew} already has ${clash.appointment_id} at this time.` };
    } else {
      t.log("info", `${crew} is free from ${startTime} to ${endTime}.`);
    }
  }
  if (bookingError) {
    t.log("error", bookingError.message);
    t.fail(bookingError.code, bookingError.message);
    t.skipRemaining("The booking was rejected by validation.");
    t.finish("failed", `Booking rejected: ${bookingError.message} No appointment was written.`, {
      leadId: lead.lead_id,
      customerId: customer.customer_id,
      appointmentId: null,
    });
    return;
  }
  t.ok({ checks: ["required fields", "start and end time", "price", "one visit per customer per day", "crew availability"] });

  // -- 10. Insert booking ------------------------------------------------
  t.start("booking.insert", { customerId: customer.customer_id, crew, date: DEMO_DATE, startTime, endTime });
  const appointmentId = reserveId(store, t, "APPT");
  let visitAddress = customer.address;
  if (!visitAddress) {
    const slot = firstEmptyAddressSlot(customer);
    visitAddress = SAMPLE_NEW_ADDRESS;
    if (slot) {
      const before = snap(customer);
      customer = store.saveCustomer({ ...customer, [slot]: SAMPLE_NEW_ADDRESS });
      t.change("crm_customers", "update", customer.customer_id, before, snap(customer));
      t.log("info", `New address filed into the first empty slot ("${slot}"). Saved addresses are never overwritten.`);
    }
  } else {
    t.log("info", "The customer's saved address is used as it stands.");
  }
  const dayOrder = store.countAppointmentsOn(DEMO_DATE) + 1;
  let appointment: Appointment = store.insertAppointment({
    appointment_id: appointmentId,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    phone: customer.phone,
    service_type: input.serviceType,
    appointment_date: DEMO_DATE,
    start_time: startTime,
    end_time: endTime,
    technician_vehicle: crew,
    price: input.price,
    payment_status: "Unpaid",
    appointment_status: "Scheduled",
    visit_address: visitAddress,
    report_status: "Required",
    notification_status: "Pending",
    day_order: dayOrder,
    created_by: COORDINATOR,
  });
  t.change("crm_appointments", "insert", appointmentId, null, snap(appointment));
  t.advance(LATENCY.dbWrite);
  t.ok({ appointmentId, dayOrder, reportStatus: "Required", notificationStatus: "Pending" });

  // -- 11. Enqueue side effect -------------------------------------------
  t.start("outbox.enqueue", { eventType: "appointment_created", entityType: "appointment", entityId: appointmentId });
  let outboxRow: OutboxRow = store.insertOutbox({
    event_key: `google:appointment_created:${appointmentId}:${pseudoUuid(appointmentId + parsed.messageId)}`,
    event_type: "appointment_created",
    entity_type: "appointment",
    entity_id: appointmentId,
    payload: { appointmentId },
    status: "pending",
    attempts: 0,
    next_attempt_at: iso(t.time),
    last_error: null,
    processed_at: null,
  });
  t.change("crm_sync_outbox", "insert", String(outboxRow.outbox_id), null, snap(outboxRow));
  t.advance(90);
  t.log("info", "The Save response returns now, before any Google service is called.");
  t.ok({ notification: { queued: true, email: false, calendar: false, message: "Google sync queued." } });

  // -- 12. Drain outbox --------------------------------------------------
  const plannedFailures = faults.has("worker-permanent") ? OUTBOX_MAX_ATTEMPTS : faults.has("worker-transient") ? 2 : 0;
  const jobKey = `CRM_APPOINTMENT_JOB_${appointmentId}`;
  t.advance(LATENCY.clientWorkerDelay);
  for (;;) {
    t.start("outbox.drain", {
      query: { status: "pending", next_attempt_at: `lte.${iso(t.time)}`, limit: OUTBOX_BATCH_SIZE },
      event: outboxRow.event_key,
      attemptsSoFar: outboxRow.attempts,
    });
    t.advance(LATENCY.workerRun);
    const before = snap(outboxRow);
    const attempts = outboxRow.attempts + 1;
    if (attempts <= plannedFailures) {
      const backoff = outboxBackoffMs(attempts);
      const workerError = "Service error while queueing the notification job (injected).";
      outboxRow = store.saveOutbox({
        ...outboxRow,
        attempts,
        status: outboxStatusAfterFailure(attempts),
        last_error: workerError,
        next_attempt_at: iso(t.time + backoff),
      });
      t.change("crm_sync_outbox", "update", String(outboxRow.outbox_id), before, snap(outboxRow));
      if (outboxRow.status === "failed") {
        t.log("error", `Attempt ${attempts} failed. The event is marked "failed" and will not be selected again.`);
        t.fail("OUTBOX_FAILED", `Outbox event failed after ${OUTBOX_MAX_ATTEMPTS} attempts.`);
        t.skipRemaining("The notification job was never queued.");
        t.finish(
          "failed",
          `Appointment ${appointmentId} is booked, but the technician was not notified: the outbox event failed after ${OUTBOX_MAX_ATTEMPTS} attempts and needs manual attention.`,
          { leadId: lead.lead_id, customerId: customer.customer_id, appointmentId, outboxAttempts: attempts, notificationStatus: "Pending" },
        );
        return;
      }
      t.log("warn", `Attempt ${attempts} failed. Next attempt in ${backoff / 1000} s (attempts x 60 s, capped at 15 min).`);
      t.fail("WORKER_ERROR", workerError, backoff);
      t.advance(backoff);
      continue;
    }
    const job = { appointmentId, notify: true, resync: false, status: "", attempts: 0, queuedAt: iso(t.time) };
    t.change("script_properties", "insert", jobKey, null, job);
    outboxRow = store.saveOutbox({ ...outboxRow, attempts, status: "processed", last_error: null, processed_at: iso(t.time) });
    t.change("crm_sync_outbox", "update", String(outboxRow.outbox_id), before, snap(outboxRow));
    t.log("info", `Notification job queued under ${jobKey}. The key is the appointment id, so re-queueing cannot duplicate it.`);
    t.ok({ selected: 1, processed: 1, failed: 0, jobKey, attempts });
    break;
  }

  // -- 13. Notify technician ---------------------------------------------
  t.advance(LATENCY.triggerInterval);
  t.start("notify.technician", { jobKey, appointmentId });
  t.log("info", "The worker reads its job list before draining the outbox, so this job runs on the following worker run.");
  const technician = store.findTechnician(crew);
  const technicianEmail = faults.has("technician-no-email") ? "" : (technician?.email ?? "");
  const statuses: string[] = [];
  let emailSent = false;
  let notifyWarning: string | undefined;

  if (!technicianEmail) {
    statuses.push("Technician email missing");
    notifyWarning = "The crew has no email on file, so nobody was notified. The appointment records why.";
    t.log("warn", `${crew} has no email address; the notification is skipped.`);
  } else {
    t.log("info", "Calendar event skipped: CREATE_CALENDAR_EVENTS is false in the committed configuration.");
    t.advance(LATENCY.mailSend);
    if (faults.has("mail-failure")) {
      statuses.push("Email failed: Service invoked too many times for one day: email. (injected)");
      notifyWarning = "The email failure is recorded on the appointment but is not retried (known limitation).";
      t.log("error", "MailApp.sendEmail threw; the error is caught and written to the appointment.");
    } else {
      const email = {
        to: technicianEmail,
        subject: `موعد جديد ${appointmentId} - ${DEMO_DATE} ${startTime}`,
        body: {
          customer: appointment.customer_name,
          phone: appointment.phone,
          address: appointment.visit_address,
          service: appointment.service_type,
        },
      };
      t.change("outbound_email (stub)", "insert", appointmentId, null, snap(email));
      statuses.push("Details emailed");
      emailSent = true;
      t.log("info", `Appointment details emailed to ${technicianEmail}. No real email is sent by this simulation.`);
    }
  }
  {
    const before = snap(appointment);
    appointment = store.saveAppointment({ ...appointment, notification_status: statuses.join(" | ") });
    t.change("crm_appointments", "update", appointmentId, before, snap(appointment));
  }
  t.change("script_properties", "delete", jobKey, { appointmentId, notify: true }, null);
  t.advance(LATENCY.dbWrite);
  t.ok(
    { email: emailSent, calendar: false, recipient: technicianEmail || null, message: appointment.notification_status },
    notifyWarning,
  );

  t.finish(
    "success",
    emailSent
      ? `${appointmentId} booked for ${customer.customer_name} with ${crew} at ${startTime}. The technician was notified by email.`
      : `${appointmentId} booked for ${customer.customer_name} with ${crew} at ${startTime}, but the technician was not notified: ${appointment.notification_status}.`,
    {
      leadId: lead.lead_id,
      customerId: customer.customer_id,
      appointmentId,
      outboxAttempts: outboxRow.attempts,
      notificationStatus: appointment.notification_status,
    },
  );
}

/**
 * Builds the scenario around a store. `openStore` is called once at the start
 * of every run, so each run gets a database of its own.
 */
export function createCrmScenario(openStore: () => CrmStore): Scenario<CrmInput> {
  return {
    id: CRM_SCENARIO_ID,
    stepIds: CRM_STEPS,
    run: (context) => run(context, openStore()),
  };
}

/** The scenario as the browser runs it: against arrays in memory. */
export const crmScenario: Scenario<CrmInput> = createCrmScenario(() => createMemoryStore());
