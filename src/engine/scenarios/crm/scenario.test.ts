import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import {
  CRM_DEFAULT_INPUT,
  CRM_FAULTS,
  CRM_PRESETS,
  CRM_STEPS,
  crmScenario,
  pseudoUuid,
  validateCrmInput,
  type CrmFaultId,
  type CrmInput,
} from "./scenario";

type Choice = "book" | "follow-up" | "lost";

function execute(options: { input?: Partial<CrmInput>; faults?: CrmFaultId[]; choice?: Choice } = {}) {
  const session = new RunSession(crmScenario, {
    runId: "test-run",
    input: { ...CRM_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  if (session.isWaiting) session.resume(options.choice ?? "book");
  const state = reduceRun(CRM_STEPS, session.events);
  return { session, state, events: session.events };
}

function statuses(state: RunState) {
  return Object.fromEntries(CRM_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((e) => e.type === "state.changed" && e.table === table) as Extract<RunEvent, { type: "state.changed" }>[];
}

describe("happy path: new enquiry to notified technician", () => {
  const { state, events, session } = execute();

  it("completes every step", () => {
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    expect(Object.values(statuses(state)).every((s) => s === "success")).toBe(true);
  });

  it("creates one lead, one customer and one appointment with sequential ids", () => {
    expect(state.summary).toMatchObject({
      leadId: "LEAD-121",
      customerId: "CUST-43",
      appointmentId: "APPT-311",
      outboxAttempts: 1,
      notificationStatus: "Details emailed",
    });
    expect(changesTo(events, "crm_leads").filter((c) => c.op === "insert")).toHaveLength(1);
    expect(changesTo(events, "crm_customers").filter((c) => c.op === "insert")).toHaveLength(1);
    expect(changesTo(events, "crm_appointments").filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("books with the documented defaults", () => {
    const [insert] = changesTo(events, "crm_appointments");
    expect(insert.after).toMatchObject({
      appointment_id: "APPT-311",
      technician_vehicle: "Crew A",
      start_time: "13:00",
      end_time: "14:00",
      report_status: "Required",
      notification_status: "Pending",
      day_order: 2,
    });
  });

  it("files the new customer's address into the first empty slot", () => {
    const update = changesTo(events, "crm_customers").find((c) => c.op === "update");
    expect(update?.before).toMatchObject({ address: "" });
    expect(update?.after).toMatchObject({ address: "Villa 7, Road 15, Block 520 (sample)" });
  });

  it("returns the booking response before the worker runs", () => {
    const enqueued = events.find((e) => e.type === "step.succeeded" && e.stepId === "outbox.enqueue");
    const drainStarted = events.find((e) => e.type === "step.started" && e.stepId === "outbox.drain");
    expect(drainStarted!.at - enqueued!.at).toBe(1_200);
  });

  it("notifies the technician on the worker run after the outbox drain", () => {
    const drained = events.find((e) => e.type === "step.succeeded" && e.stepId === "outbox.drain");
    const notifyStarted = events.find((e) => e.type === "step.started" && e.stepId === "notify.technician");
    expect(notifyStarted!.at - drained!.at).toBe(60_000);
    const [email] = changesTo(events, "outbound_email (stub)");
    expect(email.after).toMatchObject({ to: "crew-a@example.test" });
  });

  it("queues the job under the appointment id and removes it when done", () => {
    const jobs = changesTo(events, "script_properties");
    expect(jobs.map((j) => [j.op, j.key])).toEqual([
      ["insert", "CRM_APPOINTMENT_JOB_APPT-311"],
      ["delete", "CRM_APPOINTMENT_JOB_APPT-311"],
    ]);
  });

  it("masks credentials in recorded payloads", () => {
    const serialised = JSON.stringify(events);
    expect(serialised).toContain("••••••••");
    expect(serialised).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(serialised).not.toMatch(/supabase\.co/);
  });
});

describe("determinism", () => {
  it("produces an identical log for identical input and faults", () => {
    const a = execute({ faults: ["worker-transient"] });
    const b = execute({ faults: ["worker-transient"] });
    expect(b.events).toEqual(a.events);
  });

  it("derives stable pseudo UUIDs in v4 shape", () => {
    expect(pseudoUuid("seed")).toBe(pseudoUuid("seed"));
    expect(pseudoUuid("seed")).not.toBe(pseudoUuid("other"));
    expect(pseudoUuid("seed")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("intake rules", () => {
  it("links an existing customer instead of creating a new one", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "existing-customer")!;
    const { state, events } = execute({ input: preset.input });
    expect(state.status).toBe("success");
    expect(state.steps["customer.match"].output).toMatchObject({ matched: true, customerId: "CUST-41" });
    expect(state.summary).toMatchObject({ customerId: "CUST-41" });
    expect(changesTo(events, "crm_customers").filter((c) => c.op === "insert")).toHaveLength(0);
    const [lead] = changesTo(events, "crm_leads");
    expect(lead.after).toMatchObject({ status: "Existing Customer", notes: "Matched existing customer automatically." });
  });

  it("uses the saved address of an existing customer without rewriting it", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "existing-customer")!;
    const { events } = execute({ input: preset.input });
    expect(changesTo(events, "crm_customers")).toHaveLength(0);
    const [appointment] = changesTo(events, "crm_appointments");
    expect(appointment.after).toMatchObject({ visit_address: "Villa 12, Road 10, Block 300 (sample)" });
  });

  it("updates a returning lead rather than inserting a second one", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "returning-lead")!;
    const { state, events } = execute({ input: preset.input });
    expect(state.steps["lead.upsert"].output).toMatchObject({ leadId: "LEAD-118", action: "updated", messageCount: 3 });
    expect(changesTo(events, "crm_leads").filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("completes the open follow-up when a returning lead is booked", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "returning-lead")!;
    const { events } = execute({ input: preset.input, choice: "book" });
    const [followUp] = changesTo(events, "crm_follow_ups");
    expect(followUp).toMatchObject({ op: "update", key: "FU-12" });
    expect(followUp.after).toMatchObject({ follow_up_status: "Completed" });
  });

  it("ignores a group chat and writes nothing", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "group-chat")!;
    const { state, events } = execute({ input: preset.input });
    expect(state.status).toBe("success");
    expect(state.summary).toMatchObject({ ignored: true });
    expect(state.steps["payload.parse"].output).toMatchObject({ isGroup: true });
    expect(state.steps["lead.filter"].output).toMatchObject({ ignored: true });
    expect(state.steps["customer.match"].status).toBe("skipped");
    expect(events.filter((e) => e.type === "state.changed")).toHaveLength(0);
  });

  it("ignores a group chat whose id happens to look like a phone number", () => {
    const { state } = execute({ input: { chatType: "group", senderNumber: "97305550142" } });
    expect(state.steps["lead.filter"].output).toEqual({ ignored: true, reason: "Ignored group chat webhook." });
  });

  it("ignores an unusable sender number", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "invalid-number")!;
    const { state, events } = execute({ input: preset.input });
    expect(state.steps["lead.filter"].output).toEqual({ ignored: true, reason: "Ignored webhook with invalid customer phone." });
    expect(events.filter((e) => e.type === "state.changed")).toHaveLength(0);
  });
});

describe("human decision", () => {
  it("waits for the coordinator before touching the booking steps", () => {
    const session = new RunSession(crmScenario, { runId: "r", input: CRM_DEFAULT_INPUT });
    const state = reduceRun(CRM_STEPS, session.events);
    expect(session.isWaiting).toBe(true);
    expect(state.status).toBe("waiting");
    expect(state.steps["lead.evaluate"].status).toBe("waiting");
    expect(state.steps["lead.convert"].status).toBe("pending");
  });

  it("creates exactly one follow-up when there is no answer", () => {
    const { state, events } = execute({ choice: "follow-up" });
    expect(state.status).toBe("success");
    expect(state.steps["lead.evaluate"].output).toMatchObject({ leadResult: "No Answer", status: "Follow Up", followUpId: "FU-16" });
    expect(changesTo(events, "crm_follow_ups")).toHaveLength(1);
    expect(state.steps["booking.insert"].status).toBe("skipped");
    expect(changesTo(events, "crm_appointments")).toHaveLength(0);
  });

  it("moves the existing follow-up instead of adding a second one", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "returning-lead")!;
    const { events } = execute({ input: preset.input, choice: "follow-up" });
    const followUps = changesTo(events, "crm_follow_ups");
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ op: "update", key: "FU-12" });
    expect(followUps[0].after).toMatchObject({ follow_up_date: "2026-03-16", follow_up_status: "Pending" });
  });

  it("closes the lead as lost without creating a customer", () => {
    const { state, events } = execute({ choice: "lost" });
    expect(state.steps["lead.evaluate"].output).toMatchObject({ status: "Lost" });
    expect(changesTo(events, "crm_customers")).toHaveLength(0);
    expect(state.steps["lead.convert"].status).toBe("skipped");
  });

  it("appends the call note instead of replacing earlier notes", () => {
    const preset = CRM_PRESETS.find((p) => p.id === "returning-lead")!;
    const { events } = execute({ input: preset.input, choice: "lost" });
    const evaluated = changesTo(events, "crm_leads").at(-1)!;
    const notes = String((evaluated.after as { notes: string }).notes).split("\n");
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("No answer, try again tomorrow.");
    expect(notes[1]).toMatch(/^\[2026-03-15 \d{2}:\d{2} · Demo Coordinator\] Not interested\.$/);
  });

  it("can be cancelled while waiting", () => {
    const session = new RunSession(crmScenario, { runId: "r", input: CRM_DEFAULT_INPUT });
    session.cancel();
    const state = reduceRun(CRM_STEPS, session.events);
    expect(state.status).toBe("cancelled");
    expect(state.steps["lead.upsert"].status).toBe("success");
    expect(state.steps["lead.evaluate"].status).toBe("cancelled");
    expect(state.steps["notify.technician"].status).toBe("cancelled");
  });
});

describe("failure injection", () => {
  it("rejects a webhook with the wrong key before reading anything", () => {
    const { state, events, session } = execute({ faults: ["invalid-webhook-key"] });
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("failed");
    expect(state.steps["webhook.receive"].error).toEqual({ code: "INVALID_WEBHOOK_KEY", message: "Invalid Green API webhook key." });
    expect(state.steps["payload.parse"].status).toBe("skipped");
    expect(events.filter((e) => e.type === "state.changed")).toHaveLength(0);
  });

  it("counts a redelivered message twice but never duplicates the lead", () => {
    const { state, events } = execute({ faults: ["duplicate-delivery"] });
    expect(state.status).toBe("success");
    expect(state.steps["lead.upsert"].output).toMatchObject({ messageCount: 2 });
    expect(state.steps["lead.upsert"].warning).toMatch(/counted twice/);
    expect(changesTo(events, "crm_leads").filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("does not replay a booking when the fast path is down", () => {
    const { state, events } = execute({ faults: ["fast-path-down"] });
    expect(state.status).toBe("failed");
    expect(state.steps["booking.request"].error?.code).toBe("FAST_API_UNAVAILABLE");
    expect(state.steps["booking.request"].durationMs).toBe(12_000);
    expect(state.steps["booking.request"].attempts).toHaveLength(1);
    expect(changesTo(events, "crm_appointments")).toHaveLength(0);
    expect(state.summary).toMatchObject({ leadId: "LEAD-121", customerId: "CUST-43", appointmentId: null });
  });

  it("rejects a booking that overlaps the crew's existing visit", () => {
    const { state, events } = execute({ faults: ["crew-conflict"] });
    expect(state.status).toBe("failed");
    expect(state.steps["booking.validate"].error).toEqual({ code: "CONFLICT", message: "Crew A already has APPT-307 at this time." });
    expect(changesTo(events, "crm_appointments")).toHaveLength(0);
    expect(changesTo(events, "crm_sync_outbox")).toHaveLength(0);
  });

  it("allows the same slot on a different crew", () => {
    const { state } = execute({ input: { crew: "Crew B", startTime: "10:30" } });
    expect(state.status).toBe("success");
  });

  it("rejects the overlap when it comes from the input rather than the fault", () => {
    const { state } = execute({ input: { crew: "Crew A", startTime: "10:30" } });
    expect(state.steps["booking.validate"].error?.code).toBe("CONFLICT");
  });

  it("rejects a second visit for the same customer on the same day", () => {
    const { state } = execute({ input: { senderNumber: "97305550102", crew: "Crew B", startTime: "15:00" } });
    expect(state.steps["booking.validate"].error?.message).toBe(
      "This customer already has an appointment on the same day (APPT-307).",
    );
  });

  it("retries the outbox event with linear backoff and then recovers", () => {
    const { state, events } = execute({ faults: ["worker-transient"] });
    expect(state.status).toBe("success");
    const drain = state.steps["outbox.drain"];
    expect(drain.attempts.map((a) => a.status)).toEqual(["failed", "failed", "success"]);
    const waits = drain.attempts.filter((a) => a.retryAt !== undefined).map((a) => a.retryAt! - a.endedAt!);
    expect(waits).toEqual([60_000, 120_000]);
    const outbox = changesTo(events, "crm_sync_outbox");
    expect(outbox.map((c) => (c.after as { status: string }).status)).toEqual(["pending", "pending", "pending", "processed"]);
    expect(outbox.at(-1)!.after).toMatchObject({ attempts: 3, last_error: null });
    expect(state.summary).toMatchObject({ outboxAttempts: 3, notificationStatus: "Details emailed" });
  });

  it("shows the step as retrying between attempts", () => {
    const { events } = execute({ faults: ["worker-transient"] });
    const firstFailure = events.findIndex((e) => e.type === "step.failed" && e.stepId === "outbox.drain");
    const between = reduceRun(CRM_STEPS, events.slice(0, firstFailure + 1));
    expect(between.steps["outbox.drain"].status).toBe("retrying");
    expect(between.status).toBe("running");
  });

  it("marks the outbox event failed after eight attempts and keeps the booking", () => {
    const { state, events } = execute({ faults: ["worker-permanent"] });
    expect(state.status).toBe("failed");
    const drain = state.steps["outbox.drain"];
    expect(drain.attempts).toHaveLength(8);
    expect(drain.error?.code).toBe("OUTBOX_FAILED");
    expect(changesTo(events, "crm_sync_outbox").at(-1)!.after).toMatchObject({ status: "failed", attempts: 8 });
    expect(state.steps["notify.technician"].status).toBe("skipped");
    expect(changesTo(events, "crm_appointments").filter((c) => c.op === "insert")).toHaveLength(1);
    expect(state.summary).toMatchObject({ appointmentId: "APPT-311", notificationStatus: "Pending" });
    // 60 + 120 + ... + 420 seconds of backoff between the eight attempts.
    const first = drain.attempts[0].startedAt;
    const last = drain.attempts[7].startedAt;
    expect(last - first).toBe(1_680_000 + 7 * 900);
  });

  it("prefers the permanent failure when both worker faults are set", () => {
    const { state } = execute({ faults: ["worker-transient", "worker-permanent"] });
    expect(state.steps["outbox.drain"].attempts).toHaveLength(8);
  });

  it("records a missing technician email without sending anything", () => {
    const { state, events } = execute({ faults: ["technician-no-email"] });
    expect(state.status).toBe("success");
    expect(state.steps["notify.technician"].warning).toMatch(/nobody was notified/);
    expect(state.summary).toMatchObject({ notificationStatus: "Technician email missing" });
    expect(changesTo(events, "outbound_email (stub)")).toHaveLength(0);
  });

  it("records a mail failure on the appointment and does not retry it", () => {
    const { state, events } = execute({ faults: ["mail-failure"] });
    expect(state.status).toBe("success");
    expect(state.steps["notify.technician"].attempts).toHaveLength(1);
    expect(state.steps["notify.technician"].warning).toMatch(/not retried/);
    expect(String((state.summary as { notificationStatus: string }).notificationStatus)).toMatch(/^Email failed:/);
    expect(changesTo(events, "outbound_email (stub)")).toHaveLength(0);
  });

  it("finishes cleanly for every single fault", () => {
    for (const fault of CRM_FAULTS) {
      const { session, state } = execute({ faults: [fault] });
      expect(session.isFinished, fault).toBe(true);
      expect(["success", "failed"], fault).toContain(state.status);
      expect(Object.values(statuses(state)).includes("pending"), fault).toBe(false);
      expect(Object.values(statuses(state)).includes("running"), fault).toBe(false);
    }
  });

  it("finishes cleanly with every fault enabled at once", () => {
    const { session, state } = execute({ faults: [...CRM_FAULTS] });
    expect(session.isFinished).toBe(true);
    expect(state.steps["webhook.receive"].status).toBe("failed");
  });
});

describe("presets and input validation", () => {
  it("ships presets that pass validation", () => {
    for (const preset of CRM_PRESETS) {
      expect(validateCrmInput(preset.input).ok, preset.id).toBe(true);
    }
  });

  it("finishes cleanly for every preset and decision", () => {
    for (const preset of CRM_PRESETS) {
      for (const choice of ["book", "follow-up", "lost"] as const) {
        const { session } = execute({ input: preset.input, choice });
        expect(session.isFinished, `${preset.id}/${choice}`).toBe(true);
      }
    }
  });

  it("normalises formatting characters in the sender number", () => {
    const result = validateCrmInput({ ...CRM_DEFAULT_INPUT, senderNumber: "+973 0555-0142" });
    expect(result.ok).toBe(true);
    expect(result.value.senderNumber).toBe("97305550142");
  });

  it("rejects out-of-range and malformed values", () => {
    const result = validateCrmInput({
      senderNumber: "abc",
      contactName: "x".repeat(41),
      message: "   ",
      crew: "Crew Z",
      startTime: "03:00",
      serviceType: "Demolition",
      price: -5,
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      ["contactName", "crew", "message", "price", "senderNumber", "serviceType", "startTime"].sort(),
    );
  });

  it("strips control characters and never returns out-of-range values", () => {
    const result = validateCrmInput({ ...CRM_DEFAULT_INPUT, contactName: "Sam\u0000ple\u0007", message: "line\none", price: 5000 });
    expect(result.value.contactName).toBe("Sample");
    expect(result.value.message).toBe("line one");
    expect(result.value.price).toBe(1000);
    expect(result.ok).toBe(false);
  });

  it("treats markup in the message as plain text", () => {
    const message = '<img src=x onerror="alert(1)">';
    const { state } = execute({ input: { message } });
    expect(state.steps["payload.parse"].output).toMatchObject({ message });
  });
});
