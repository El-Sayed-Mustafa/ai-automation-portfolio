import type { CrmStore, IdPrefix } from "../engine/scenarios/crm/store";
import { seedWorld, type Appointment, type Customer, type FollowUp, type Lead, type OutboxRow, type Technician, type World } from "../engine/scenarios/crm/world";
import type { Json } from "../engine/types";
import type { DatabaseSync, SQLInputValue, SqliteModule, StatementSync } from "./sqlite";

/**
 * The CRM tables this workflow touches, as a SQLite database.
 *
 * It is a reduced copy of the project's Postgres schema
 * (supabase/migrations/001_crm_schema.sql and 014_remaining_operational_reads.sql
 * in the project's repository): the same table names, the columns the workflow
 * reads and writes, and the constraints those columns carry there: primary
 * keys, NOT NULL, the foreign keys, the unique event key of the outbox, and
 * the stored digits-only copies of each phone number.
 *
 * Two things differ, because SQLite is not Postgres. The digits columns strip
 * the usual separators with nested replace() where Postgres uses
 * regexp_replace, and a boolean is stored as 0 or 1.
 */
const DIGITS = (column: string) => `replace(replace(replace(replace(replace(coalesce(${column}, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')`;

export const CRM_SANDBOX_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE crm_customers (
  customer_id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_digits TEXT GENERATED ALWAYS AS (${DIGITS("phone")}) STORED,
  secondary_phone TEXT,
  secondary_phone_digits TEXT GENERATED ALWAYS AS (${DIGITS("secondary_phone")}) STORED,
  address TEXT,
  secondary_address TEXT,
  address_3 TEXT,
  address_4 TEXT,
  address_5 TEXT,
  customer_type TEXT,
  contact_status TEXT,
  lead_source TEXT
);
CREATE INDEX crm_customers_phone_digits_idx ON crm_customers(phone_digits);
CREATE INDEX crm_customers_secondary_phone_digits_idx ON crm_customers(secondary_phone_digits);

CREATE TABLE crm_technicians (
  technician_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  status TEXT
);

CREATE TABLE crm_appointments (
  appointment_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES crm_customers(customer_id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_name TEXT,
  phone TEXT,
  service_type TEXT,
  appointment_date TEXT,
  start_time TEXT,
  end_time TEXT,
  technician_vehicle TEXT,
  price REAL NOT NULL DEFAULT 0,
  payment_status TEXT,
  appointment_status TEXT,
  visit_address TEXT,
  report_status TEXT,
  notification_status TEXT,
  day_order INTEGER,
  created_by TEXT
);

CREATE TABLE crm_leads (
  lead_id TEXT PRIMARY KEY,
  lead_no INTEGER,
  whatsapp_number TEXT NOT NULL,
  whatsapp_digits TEXT GENERATED ALWAYS AS (${DIGITS("whatsapp_number")}) STORED,
  customer_name TEXT,
  display_name TEXT,
  last_message TEXT,
  message_type TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_id TEXT,
  direction TEXT,
  status TEXT,
  lead_type TEXT,
  lead_result TEXT,
  call_done INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  existing_customer_id TEXT,
  converted_customer_id TEXT,
  next_follow_up_date TEXT,
  last_action_by TEXT
);

CREATE TABLE crm_follow_ups (
  follow_up_id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES crm_leads(lead_id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_name TEXT,
  phone TEXT,
  follow_up_date TEXT,
  follow_up_status TEXT,
  reason TEXT
);

CREATE TABLE crm_sync_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  processed_at TEXT
);

CREATE TABLE crm_id_counters (
  prefix TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
`;

/** The tables of the sandbox, in the order a reader would look for them. */
export const CRM_SANDBOX_TABLES = ["crm_leads", "crm_customers", "crm_appointments", "crm_follow_ups", "crm_sync_outbox", "crm_id_counters", "crm_technicians"] as const;

type Row = Record<string, unknown>;

const text = (value: unknown): string => (value == null ? "" : String(value));
const nullable = (value: unknown): string | null => (value == null ? null : String(value));
const int = (value: unknown): number => Number(value);

function toCustomer(row: Row): Customer {
  return {
    customer_id: text(row.customer_id),
    customer_name: text(row.customer_name),
    phone: text(row.phone),
    secondary_phone: text(row.secondary_phone),
    address: text(row.address),
    secondary_address: text(row.secondary_address),
    address_3: text(row.address_3),
    address_4: text(row.address_4),
    address_5: text(row.address_5),
    customer_type: text(row.customer_type),
    contact_status: text(row.contact_status),
    lead_source: text(row.lead_source),
  };
}

function toLead(row: Row): Lead {
  return {
    lead_id: text(row.lead_id),
    lead_no: int(row.lead_no),
    whatsapp_number: text(row.whatsapp_number),
    customer_name: text(row.customer_name),
    display_name: text(row.display_name),
    last_message: text(row.last_message),
    message_type: text(row.message_type),
    message_count: int(row.message_count),
    last_message_id: text(row.last_message_id),
    direction: text(row.direction),
    status: text(row.status),
    lead_type: text(row.lead_type),
    lead_result: text(row.lead_result),
    call_done: int(row.call_done) === 1,
    notes: text(row.notes),
    existing_customer_id: text(row.existing_customer_id),
    converted_customer_id: text(row.converted_customer_id),
    next_follow_up_date: nullable(row.next_follow_up_date),
    last_action_by: text(row.last_action_by),
  };
}

function toAppointment(row: Row): Appointment {
  return {
    appointment_id: text(row.appointment_id),
    customer_id: text(row.customer_id),
    customer_name: text(row.customer_name),
    phone: text(row.phone),
    service_type: text(row.service_type),
    appointment_date: text(row.appointment_date),
    start_time: text(row.start_time),
    end_time: text(row.end_time),
    technician_vehicle: text(row.technician_vehicle),
    price: Number(row.price),
    payment_status: text(row.payment_status),
    appointment_status: text(row.appointment_status),
    visit_address: text(row.visit_address),
    report_status: text(row.report_status),
    notification_status: text(row.notification_status),
    day_order: int(row.day_order),
    created_by: text(row.created_by),
  };
}

function toFollowUp(row: Row): FollowUp {
  return {
    follow_up_id: text(row.follow_up_id),
    lead_id: text(row.lead_id),
    customer_name: text(row.customer_name),
    phone: text(row.phone),
    follow_up_date: text(row.follow_up_date),
    follow_up_status: row.follow_up_status === "Completed" ? "Completed" : "Pending",
    reason: text(row.reason),
  };
}

function toOutbox(row: Row): OutboxRow {
  const status = row.status === "processed" || row.status === "failed" ? row.status : "pending";
  return {
    outbox_id: int(row.outbox_id),
    event_key: text(row.event_key),
    event_type: text(row.event_type),
    entity_type: text(row.entity_type),
    entity_id: text(row.entity_id),
    payload: JSON.parse(text(row.payload)) as OutboxRow["payload"],
    status,
    attempts: int(row.attempts),
    next_attempt_at: text(row.next_attempt_at),
    last_error: nullable(row.last_error),
    processed_at: nullable(row.processed_at),
  };
}

function toTechnician(row: Row): Technician {
  return { technician_id: text(row.technician_id), name: text(row.name), email: text(row.email), status: text(row.status) };
}

const CUSTOMER_COLUMNS = ["customer_id", "customer_name", "phone", "secondary_phone", "address", "secondary_address", "address_3", "address_4", "address_5", "customer_type", "contact_status", "lead_source"] as const;
const LEAD_COLUMNS = [
  "lead_id",
  "lead_no",
  "whatsapp_number",
  "customer_name",
  "display_name",
  "last_message",
  "message_type",
  "message_count",
  "last_message_id",
  "direction",
  "status",
  "lead_type",
  "lead_result",
  "call_done",
  "notes",
  "existing_customer_id",
  "converted_customer_id",
  "next_follow_up_date",
  "last_action_by",
] as const;
const APPOINTMENT_COLUMNS = [
  "appointment_id",
  "customer_id",
  "customer_name",
  "phone",
  "service_type",
  "appointment_date",
  "start_time",
  "end_time",
  "technician_vehicle",
  "price",
  "payment_status",
  "appointment_status",
  "visit_address",
  "report_status",
  "notification_status",
  "day_order",
  "created_by",
] as const;
const FOLLOW_UP_COLUMNS = ["follow_up_id", "lead_id", "customer_name", "phone", "follow_up_date", "follow_up_status", "reason"] as const;
const OUTBOX_COLUMNS = ["event_key", "event_type", "entity_type", "entity_id", "payload", "status", "attempts", "next_attempt_at", "last_error", "processed_at"] as const;

function param(value: unknown): SQLInputValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`;
}

function updateSql(table: string, columns: readonly string[], key: string): string {
  return `UPDATE ${table} SET ${columns
    .filter((column) => column !== key)
    .map((column) => `${column} = ?`)
    .join(", ")} WHERE ${key} = ? RETURNING *`;
}

export interface CrmSandbox {
  store: CrmStore;
  /** Every table of the sandbox with the rows it holds now, read back from the database. */
  dump(): { name: string; rows: Json[] }[];
  /** Statements the run has executed, not counting the seed. */
  readonly statements: number;
  /** Rows the seed inserted before the run started. */
  readonly seededRows: number;
  close(): void;
}

/**
 * Opens a database for one run: in memory, created from the schema, seeded
 * with the same invented rows the browser simulation starts from, and gone
 * when it is closed. Nothing is shared between runs.
 *
 * @param onStatement Called before every statement of the run. The executor
 *   passes its budget here, so a run cannot keep the database busy.
 */
export function openCrmSandbox(sqlite: SqliteModule, onStatement: () => void = () => {}, world: World = seedWorld()): CrmSandbox {
  const db: DatabaseSync = new sqlite.DatabaseSync(":memory:");
  db.exec(CRM_SANDBOX_SCHEMA);

  const prepared = new Map<string, StatementSync>();
  let statements = 0;
  let counting = false;

  function statement(sql: string): StatementSync {
    let found = prepared.get(sql);
    if (!found) {
      found = db.prepare(sql);
      prepared.set(sql, found);
    }
    if (counting) {
      onStatement();
      statements += 1;
    }
    return found;
  }
  const one = (sql: string, ...params: SQLInputValue[]) => statement(sql).get(...params) as Row | undefined;
  const all = (sql: string, ...params: SQLInputValue[]) => statement(sql).all(...params) as Row[];

  function insert<T extends object>(table: string, columns: readonly string[], row: T): Row {
    const stored = one(insertSql(table, columns), ...columns.map((column) => param((row as Record<string, unknown>)[column])));
    if (!stored) throw new Error(`Insert into ${table} returned no row.`);
    return stored;
  }
  function update<T extends object>(table: string, columns: readonly string[], key: string, row: T): Row {
    const values = row as Record<string, unknown>;
    const stored = one(updateSql(table, columns, key), ...columns.filter((column) => column !== key).map((column) => param(values[column])), param(values[key]));
    if (!stored) throw new Error(`No row in ${table} with ${key} = ${String(values[key])}.`);
    return stored;
  }

  // Seed: the same invented rows as the browser simulation, written with the same statements a run uses.
  let seededRows = 0;
  for (const customer of world.customers) seededRows += insert("crm_customers", CUSTOMER_COLUMNS, customer) ? 1 : 0;
  for (const technician of world.technicians) seededRows += insert("crm_technicians", ["technician_id", "name", "email", "status"], technician) ? 1 : 0;
  for (const lead of world.leads) seededRows += insert("crm_leads", LEAD_COLUMNS, lead) ? 1 : 0;
  for (const appointment of world.appointments) seededRows += insert("crm_appointments", APPOINTMENT_COLUMNS, appointment) ? 1 : 0;
  for (const followUp of world.followUps) seededRows += insert("crm_follow_ups", FOLLOW_UP_COLUMNS, followUp) ? 1 : 0;
  for (const row of world.outbox) seededRows += insert("crm_sync_outbox", OUTBOX_COLUMNS, row) ? 1 : 0;
  for (const [prefix, last] of Object.entries(world.counters)) seededRows += insert("crm_id_counters", ["prefix", "last_number"], { prefix, last_number: last }) ? 1 : 0;
  counting = true;

  const store: CrmStore = {
    reserveNumber(prefix: IdPrefix) {
      const row = one("UPDATE crm_id_counters SET last_number = last_number + 1 WHERE prefix = ? RETURNING last_number", prefix);
      if (!row) throw new Error(`No counter for ${prefix}.`);
      return int(row.last_number) - 1;
    },

    findCustomerByPhone(digitVariants) {
      const list = JSON.stringify(digitVariants);
      const row = one(
        `SELECT * FROM crm_customers
         WHERE phone_digits IN (SELECT value FROM json_each(?))
            OR (secondary_phone_digits <> '' AND secondary_phone_digits IN (SELECT value FROM json_each(?)))
         ORDER BY rowid LIMIT 1`,
        list,
        list,
      );
      return row && toCustomer(row);
    },
    insertCustomer: (row) => toCustomer(insert("crm_customers", CUSTOMER_COLUMNS, row)),
    saveCustomer: (row) => toCustomer(update("crm_customers", CUSTOMER_COLUMNS, "customer_id", row)),

    findLeadByPhone(digitVariants) {
      const row = one("SELECT * FROM crm_leads WHERE whatsapp_digits IN (SELECT value FROM json_each(?)) ORDER BY rowid LIMIT 1", JSON.stringify(digitVariants));
      return row && toLead(row);
    },
    insertLead: (row) => toLead(insert("crm_leads", LEAD_COLUMNS, row)),
    saveLead: (row) => toLead(update("crm_leads", LEAD_COLUMNS, "lead_id", row)),

    findOpenFollowUp(leadId) {
      const row = one("SELECT * FROM crm_follow_ups WHERE lead_id = ? AND follow_up_status = 'Pending' ORDER BY rowid LIMIT 1", leadId);
      return row && toFollowUp(row);
    },
    insertFollowUp: (row) => toFollowUp(insert("crm_follow_ups", FOLLOW_UP_COLUMNS, row)),
    saveFollowUp: (row) => toFollowUp(update("crm_follow_ups", FOLLOW_UP_COLUMNS, "follow_up_id", row)),

    findVisitOnDay(customerId, date) {
      const row = one("SELECT * FROM crm_appointments WHERE customer_id = ? AND appointment_date = ? AND appointment_status <> 'Cancelled' ORDER BY rowid LIMIT 1", customerId, date);
      return row && toAppointment(row);
    },
    findCrewClash(crew, date, startTime, endTime) {
      // Two visits overlap when each starts before the other ends. Times are HH:MM, so text compares as time.
      const row = one(
        `SELECT * FROM crm_appointments
         WHERE technician_vehicle = ? AND appointment_date = ? AND appointment_status <> 'Cancelled'
           AND start_time < ? AND end_time > ?
         ORDER BY rowid LIMIT 1`,
        crew,
        date,
        endTime,
        startTime,
      );
      return row && toAppointment(row);
    },
    countAppointmentsOn(date) {
      return int(one("SELECT count(*) AS n FROM crm_appointments WHERE appointment_date = ?", date)?.n ?? 0);
    },
    insertAppointment: (row) => toAppointment(insert("crm_appointments", APPOINTMENT_COLUMNS, row)),
    saveAppointment: (row) => toAppointment(update("crm_appointments", APPOINTMENT_COLUMNS, "appointment_id", row)),

    insertOutbox: (row) => toOutbox(insert("crm_sync_outbox", OUTBOX_COLUMNS, row)),
    saveOutbox: (row) => toOutbox(update("crm_sync_outbox", ["outbox_id", ...OUTBOX_COLUMNS], "outbox_id", row)),

    findTechnician(name) {
      const row = one("SELECT * FROM crm_technicians WHERE name = ? ORDER BY rowid LIMIT 1", name);
      return row && toTechnician(row);
    },
  };

  return {
    store,
    dump() {
      counting = false;
      const tables = CRM_SANDBOX_TABLES.map((name) => ({
        name,
        // A plain copy: the driver's rows have no prototype and cannot be sent as they are.
        rows: all(`SELECT * FROM ${name} ORDER BY rowid`).map((row) => JSON.parse(JSON.stringify(row)) as Json),
      }));
      counting = true;
      return tables;
    },
    get statements() {
      return statements;
    },
    get seededRows() {
      return seededRows;
    },
    close() {
      db.close();
    },
  };
}
