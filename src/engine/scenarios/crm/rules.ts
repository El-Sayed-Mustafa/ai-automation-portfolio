/**
 * Business rules of the pest-control CRM, re-implemented in TypeScript.
 *
 * Each function mirrors one piece of the production code and names the file it
 * was read from. The originals are Google Apps Script and Deno; nothing here
 * is imported from them, and these functions only ever run on synthetic data.
 */

export const DEFAULT_COUNTRY_CODE = "973";

/** Utils.js `normalizePhone_`: one canonical +<digits> form, +973 for bare 8-digit numbers. */
export function normalizePhone(value: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  const raw = String(value ?? "").trim();
  let hadPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!hadPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    hadPlus = true;
  }
  if (!digits) throw new Error("Enter a phone number.");
  if (!hadPlus && digits.length === 8) digits = countryCode + digits;
  if (digits.length < 7 || digits.length > 15) {
    throw new Error("Enter a valid phone number with its country code (7 to 15 digits).");
  }
  return "+" + digits;
}

/** Utils.js `phoneDigitsOnly_`. */
export function phoneDigitsOnly(value: string): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

/** Utils.js `phoneDigitVariants_`: the forms one number may have been stored in. */
export function phoneDigitVariants(value: string, countryCode = DEFAULT_COUNTRY_CODE): string[] {
  const digits = phoneDigitsOnly(value);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.length === 8) variants.add(countryCode + digits);
  if (digits.startsWith(countryCode) && digits.length > countryCode.length) {
    variants.add(digits.slice(countryCode.length));
  }
  if (digits.startsWith("0") && digits.length > 8) {
    const stripped = digits.replace(/^0+/, "");
    if (stripped) variants.add(stripped);
  }
  return [...variants];
}

/** GreenApiLeads.js `normalizeGreenApiChatPhone_`: "<digits>@c.us" to a phone, or "". */
export function normalizeChatPhone(chatId: string): string {
  const local = String(chatId ?? "").split("@")[0];
  let digits = local.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7) return "";
  try {
    return normalizePhone("+" + digits);
  } catch {
    return "+" + digits;
  }
}

/** GreenApiLeads.js `isValidLeadPhone_`: 7 to 15 digits and not all zeros. */
export function isValidLeadPhone(value: string): boolean {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && !/^0+$/.test(digits);
}

/** GreenApiLeads.js `isGenericGreenApiName_`: names that carry no information. */
export function isGenericName(value: string): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return true;
  if (s === "pest control" || s === "pest controller" || s === "pestcontrol") return true;
  return /^\+?\d{7,15}$/.test(s.replace(/\s+/g, ""));
}

export interface GreenApiPayload {
  typeWebhook?: string;
  idMessage?: string;
  senderData?: { chatId?: string; senderName?: string };
  messageData?: { typeMessage?: string; textMessageData?: { textMessage?: string } };
}

export interface ParsedLeadMessage {
  phone: string;
  phoneDigits: string;
  isGroup: boolean;
  direction: "Incoming" | "Outgoing";
  messageType: string;
  message: string;
  messageId: string;
  displayName: string;
}

/**
 * GreenApiLeads.js `parseGreenApiLeadPayload_`, text messages only. The
 * original also reads media, captions and several alternative name fields.
 */
export function parseWebhookPayload(payload: GreenApiPayload): ParsedLeadMessage {
  const senderData = payload.senderData ?? {};
  const messageData = payload.messageData ?? {};
  const typeWebhook = String(payload.typeWebhook ?? "");
  const chatId = String(senderData.chatId ?? "");
  const phone = normalizeChatPhone(chatId);
  const messageType = String(messageData.typeMessage ?? (typeWebhook || "message"));
  const text = String(messageData.textMessageData?.textMessage ?? "") || messageType;
  const name = String(senderData.senderName ?? "").trim();
  return {
    phone,
    phoneDigits: phone.replace(/\D/g, ""),
    isGroup: /@g\.us$/i.test(chatId),
    direction: /^outgoing/i.test(typeWebhook) ? "Outgoing" : "Incoming",
    messageType,
    message: text,
    messageId: String(payload.idMessage ?? ""),
    displayName: name && !isGenericName(name) ? name : "",
  };
}

/** index.ts `updateLeadCheck`: the call result decides the lead status. */
export const LEAD_RESULT_STATUS: Readonly<Record<string, string>> = {
  Potential: "Potential",
  Interested: "Potential",
  "Follow Up Later": "Follow Up",
  "No Answer": "Follow Up",
  Refused: "Lost",
  "Too Expensive": "Lost",
  "Chose Another Company": "Lost",
  "Not Interested": "Lost",
  Booked: "Booked",
  "Existing Customer": "Existing Customer",
  "Call Done": "Contacted",
};

/** index.ts `createAppointment`: `start_time < end AND end_time > start` on "HH:MM" strings. */
export function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startB < endA && endB > startA;
}

export interface BookingForm {
  appointmentDate: string;
  serviceType: string;
  startTime: string;
  endTime: string;
  price: number;
}

/** index.ts `createAppointment`: field checks made before any conflict query. */
export function validateBookingForm(form: BookingForm): string | null {
  if (!form.appointmentDate || !form.serviceType) return "Customer, service and date are required.";
  if (Boolean(form.startTime) !== Boolean(form.endTime)) {
    return "Enter both start and end time, or leave both empty.";
  }
  if (form.startTime && form.endTime && form.endTime <= form.startTime) {
    return "End time must be after start time.";
  }
  if (form.price < 0) return "Price must be zero or more.";
  return null;
}

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_BATCH_SIZE = 15;

/** DeferredMaintenance.js `processSupabaseGoogleJobs_`: linear backoff, capped at 15 minutes. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(attempts * 60_000, 900_000);
}

/** DeferredMaintenance.js: the status an outbox row takes after a failed attempt. */
export function outboxStatusAfterFailure(attempts: number): "pending" | "failed" {
  return attempts >= OUTBOX_MAX_ATTEMPTS ? "failed" : "pending";
}

export const ADDRESS_SLOTS = ["address", "secondary_address", "address_3", "address_4", "address_5"] as const;
export type AddressSlot = (typeof ADDRESS_SLOTS)[number];

/**
 * index.ts `createAppointment`: a newly typed address goes into the first
 * empty slot; a slot that already holds an address is never overwritten.
 */
export function firstEmptyAddressSlot(customer: Partial<Record<AddressSlot, string>>): AddressSlot | null {
  return ADDRESS_SLOTS.find((slot) => !String(customer[slot] ?? "").trim()) ?? null;
}

/** Adds minutes to an "HH:MM" time. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
