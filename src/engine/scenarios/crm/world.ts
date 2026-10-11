/**
 * In-memory stand-in for the CRM database.
 *
 * Every record here is invented. Phone numbers use a subscriber range that is
 * not assignable in Bahrain (they start with 0), names are placeholders, and
 * the email domain is reserved for testing (RFC 6761).
 */

export const DEMO_DATE = "2026-03-15";
export const DEMO_TIME_ZONE = "Asia/Bahrain";

export interface Customer {
  customer_id: string;
  customer_name: string;
  phone: string;
  secondary_phone: string;
  address: string;
  secondary_address: string;
  address_3: string;
  address_4: string;
  address_5: string;
  customer_type: string;
  contact_status: string;
  lead_source: string;
}

export interface Lead {
  lead_id: string;
  lead_no: number;
  whatsapp_number: string;
  customer_name: string;
  display_name: string;
  last_message: string;
  message_type: string;
  message_count: number;
  last_message_id: string;
  direction: string;
  status: string;
  lead_type: string;
  lead_result: string;
  call_done: boolean;
  notes: string;
  existing_customer_id: string;
  converted_customer_id: string;
  next_follow_up_date: string | null;
  last_action_by: string;
}

export interface Appointment {
  appointment_id: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  service_type: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  technician_vehicle: string;
  price: number;
  payment_status: string;
  appointment_status: string;
  visit_address: string;
  report_status: string;
  notification_status: string;
  day_order: number;
  created_by: string;
}

export interface FollowUp {
  follow_up_id: string;
  lead_id: string;
  customer_name: string;
  phone: string;
  follow_up_date: string;
  follow_up_status: "Pending" | "Completed";
  reason: string;
}

export interface OutboxRow {
  outbox_id: number;
  event_key: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: { appointmentId: string };
  status: "pending" | "processed" | "failed";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  processed_at: string | null;
}

export interface Technician {
  technician_id: string;
  name: string;
  email: string;
  status: string;
}

export interface World {
  customers: Customer[];
  leads: Lead[];
  appointments: Appointment[];
  followUps: FollowUp[];
  outbox: OutboxRow[];
  technicians: Technician[];
  counters: Record<string, number>;
}

export const CREWS = ["Crew A", "Crew B"] as const;
export type Crew = (typeof CREWS)[number];

export const SERVICE_TYPES = ["General pest control", "Termite treatment", "Rodent control", "Inspection"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const START_TIMES = ["09:00", "10:30", "13:00", "15:00"] as const;
export type StartTime = (typeof START_TIMES)[number];

/** The appointment the "double-book the crew" fault collides with. */
export const SEEDED_APPOINTMENT_ID = "APPT-307";

function blankCustomer(): Omit<Customer, "customer_id" | "customer_name" | "phone"> {
  return {
    secondary_phone: "",
    address: "",
    secondary_address: "",
    address_3: "",
    address_4: "",
    address_5: "",
    customer_type: "Potential",
    contact_status: "Contacted",
    lead_source: "WhatsApp - Green API",
  };
}

export function newCustomer(fields: Pick<Customer, "customer_id" | "customer_name" | "phone">): Customer {
  return { ...blankCustomer(), ...fields };
}

/** A fresh database for every run, so runs can never affect each other. */
export function seedWorld(): World {
  return {
    customers: [
      {
        ...newCustomer({ customer_id: "CUST-41", customer_name: "Demo Customer A", phone: "+97305550101" }),
        address: "Villa 12, Road 10, Block 300 (sample)",
        customer_type: "Residential",
      },
      {
        ...newCustomer({ customer_id: "CUST-42", customer_name: "Demo Customer B", phone: "+97305550102" }),
        address: "Flat 4, Building 80, Road 22, Block 410 (sample)",
        customer_type: "Residential",
      },
    ],
    leads: [
      {
        lead_id: "LEAD-118",
        lead_no: 118,
        whatsapp_number: "+97305550177",
        customer_name: "Returning Enquirer",
        display_name: "Returning Enquirer",
        last_message: "Do you treat termites?",
        message_type: "textMessage",
        message_count: 2,
        last_message_id: "DEMO-MSG-0100",
        direction: "Incoming",
        status: "Follow Up",
        lead_type: "Inbound WhatsApp",
        lead_result: "No Answer",
        call_done: true,
        notes: "[2026-03-14 11:20 · Demo Coordinator] No answer, try again tomorrow.",
        existing_customer_id: "",
        converted_customer_id: "",
        next_follow_up_date: DEMO_DATE,
        last_action_by: "Demo Coordinator",
      },
    ],
    appointments: [
      {
        appointment_id: SEEDED_APPOINTMENT_ID,
        customer_id: "CUST-42",
        customer_name: "Demo Customer B",
        phone: "+97305550102",
        service_type: "General pest control",
        appointment_date: DEMO_DATE,
        start_time: "10:00",
        end_time: "11:00",
        technician_vehicle: "Crew A",
        price: 25,
        payment_status: "Unpaid",
        appointment_status: "Scheduled",
        visit_address: "Flat 4, Building 80, Road 22, Block 410 (sample)",
        report_status: "Required",
        notification_status: "Details emailed",
        day_order: 1,
        created_by: "Demo Coordinator",
      },
    ],
    followUps: [
      {
        follow_up_id: "FU-12",
        lead_id: "LEAD-118",
        customer_name: "Returning Enquirer",
        phone: "+97305550177",
        follow_up_date: DEMO_DATE,
        follow_up_status: "Pending",
        reason: "Lead call follow-up",
      },
    ],
    outbox: [],
    technicians: [
      { technician_id: "TECH-1", name: "Crew A", email: "crew-a@example.test", status: "Active" },
      { technician_id: "TECH-2", name: "Crew B", email: "crew-b@example.test", status: "Active" },
    ],
    counters: { LEAD: 120, CUST: 42, APPT: 310, FU: 15 },
  };
}
