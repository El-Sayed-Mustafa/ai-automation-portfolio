import { timesOverlap } from "./rules";
import { seedWorld, type Appointment, type Customer, type FollowUp, type Lead, type OutboxRow, type Technician, type World } from "./world";

export type IdPrefix = "LEAD" | "CUST" | "APPT" | "FU";

/**
 * Everything the workflow asks of the CRM database.
 *
 * The scenario does not know what answers: in the browser it is a few arrays
 * (`createMemoryStore`), on the server it is SQL against a database created
 * for the run. Both must behave the same, and a test runs every preset and
 * fault through each and compares the two event logs.
 *
 * Every method returns the row as the store now holds it, never the object it
 * was given, so the "after" recorded for a write is what the store returned.
 */
export interface CrmStore {
  /** Adds one to a counter and returns the number it held before. */
  reserveNumber(prefix: IdPrefix): number;

  /** The first customer whose phone or second phone is one of these digit strings. */
  findCustomerByPhone(digitVariants: readonly string[]): Customer | undefined;
  insertCustomer(row: Customer): Customer;
  saveCustomer(row: Customer): Customer;

  /** The first lead whose WhatsApp number is one of these digit strings. */
  findLeadByPhone(digitVariants: readonly string[]): Lead | undefined;
  insertLead(row: Lead): Lead;
  saveLead(row: Lead): Lead;

  findOpenFollowUp(leadId: string): FollowUp | undefined;
  insertFollowUp(row: FollowUp): FollowUp;
  saveFollowUp(row: FollowUp): FollowUp;

  /** A visit this customer already has on the day, cancelled ones aside. */
  findVisitOnDay(customerId: string, date: string): Appointment | undefined;
  /** A visit of this crew on the day that overlaps the given times, cancelled ones aside. */
  findCrewClash(crew: string, date: string, startTime: string, endTime: string): Appointment | undefined;
  countAppointmentsOn(date: string): number;
  insertAppointment(row: Appointment): Appointment;
  saveAppointment(row: Appointment): Appointment;

  /** The store assigns the id, as an identity column does. */
  insertOutbox(row: Omit<OutboxRow, "outbox_id">): OutboxRow;
  saveOutbox(row: OutboxRow): OutboxRow;

  findTechnician(name: string): Technician | undefined;
}

const digits = (value: string) => value.replace(/\D/g, "");

function copy<T>(row: T): T {
  return structuredClone(row);
}

function replace<T>(rows: T[], matches: (row: T) => boolean, next: T, what: string): T {
  const index = rows.findIndex(matches);
  if (index < 0) throw new Error(`No ${what} to update.`);
  rows[index] = copy(next);
  return copy(rows[index]);
}

/** The in-browser stand-in: a fresh set of arrays for every run. */
export function createMemoryStore(world: World = seedWorld()): CrmStore {
  return {
    reserveNumber(prefix) {
      const before = world.counters[prefix];
      world.counters[prefix] = before + 1;
      return before;
    },

    findCustomerByPhone(digitVariants) {
      const variants = new Set(digitVariants);
      const found = world.customers.find((c) => variants.has(digits(c.phone)) || (c.secondary_phone !== "" && variants.has(digits(c.secondary_phone))));
      return found && copy(found);
    },
    insertCustomer(row) {
      world.customers.push(copy(row));
      return copy(row);
    },
    saveCustomer(row) {
      return replace(world.customers, (c) => c.customer_id === row.customer_id, row, `customer ${row.customer_id}`);
    },

    findLeadByPhone(digitVariants) {
      const variants = new Set(digitVariants);
      const found = world.leads.find((l) => variants.has(digits(l.whatsapp_number)));
      return found && copy(found);
    },
    insertLead(row) {
      world.leads.push(copy(row));
      return copy(row);
    },
    saveLead(row) {
      return replace(world.leads, (l) => l.lead_id === row.lead_id, row, `lead ${row.lead_id}`);
    },

    findOpenFollowUp(leadId) {
      const found = world.followUps.find((f) => f.lead_id === leadId && f.follow_up_status === "Pending");
      return found && copy(found);
    },
    insertFollowUp(row) {
      world.followUps.push(copy(row));
      return copy(row);
    },
    saveFollowUp(row) {
      return replace(world.followUps, (f) => f.follow_up_id === row.follow_up_id, row, `follow-up ${row.follow_up_id}`);
    },

    findVisitOnDay(customerId, date) {
      const found = world.appointments.find((a) => a.customer_id === customerId && a.appointment_date === date && a.appointment_status !== "Cancelled");
      return found && copy(found);
    },
    findCrewClash(crew, date, startTime, endTime) {
      const found = world.appointments.find(
        (a) =>
          a.technician_vehicle === crew &&
          a.appointment_date === date &&
          a.appointment_status !== "Cancelled" &&
          timesOverlap(startTime, endTime, a.start_time, a.end_time),
      );
      return found && copy(found);
    },
    countAppointmentsOn(date) {
      return world.appointments.filter((a) => a.appointment_date === date).length;
    },
    insertAppointment(row) {
      world.appointments.push(copy(row));
      return copy(row);
    },
    saveAppointment(row) {
      return replace(world.appointments, (a) => a.appointment_id === row.appointment_id, row, `appointment ${row.appointment_id}`);
    },

    insertOutbox(row) {
      if (world.outbox.some((o) => o.event_key === row.event_key)) throw new Error(`Outbox event ${row.event_key} already exists.`);
      const stored: OutboxRow = { outbox_id: world.outbox.reduce((max, o) => Math.max(max, o.outbox_id), 0) + 1, ...row };
      world.outbox.push(copy(stored));
      return copy(stored);
    },
    saveOutbox(row) {
      return replace(world.outbox, (o) => o.outbox_id === row.outbox_id, row, `outbox event ${row.outbox_id}`);
    },

    findTechnician(name) {
      const found = world.technicians.find((tech) => tech.name === name);
      return found && copy(found);
    },
  };
}
