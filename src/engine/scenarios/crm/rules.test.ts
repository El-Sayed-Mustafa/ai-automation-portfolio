import { describe, expect, it } from "vitest";
import {
  LEAD_RESULT_STATUS,
  OUTBOX_MAX_ATTEMPTS,
  addMinutes,
  firstEmptyAddressSlot,
  isGenericName,
  isValidLeadPhone,
  normalizeChatPhone,
  normalizePhone,
  outboxBackoffMs,
  outboxStatusAfterFailure,
  parseWebhookPayload,
  phoneDigitVariants,
  timesOverlap,
  validateBookingForm,
} from "./rules";

describe("phone normalisation", () => {
  it("adds the country code to a bare 8-digit local number", () => {
    expect(normalizePhone("0555 0142")).toBe("+97305550142");
  });

  it("keeps numbers that already carry a country code", () => {
    expect(normalizePhone("+973 0555 0142")).toBe("+97305550142");
    expect(normalizePhone("0097305550142")).toBe("+97305550142");
    expect(normalizePhone("+966 50 000 0000")).toBe("+966500000000");
  });

  it("rejects empty, too short and too long numbers", () => {
    expect(() => normalizePhone("")).toThrow(/Enter a phone number/);
    expect(() => normalizePhone("12345")).toThrow(/7 to 15 digits/);
    expect(() => normalizePhone("+1234567890123456")).toThrow(/7 to 15 digits/);
  });

  it("produces every stored form of one number", () => {
    expect(phoneDigitVariants("+97305550142").sort()).toEqual(["05550142", "97305550142"].sort());
    expect(phoneDigitVariants("05550142").sort()).toEqual(["05550142", "97305550142"].sort());
    expect(phoneDigitVariants("")).toEqual([]);
  });

  it("turns a WhatsApp chat id into a phone number", () => {
    expect(normalizeChatPhone("97305550142@c.us")).toBe("+97305550142");
    expect(normalizeChatPhone("123@c.us")).toBe("");
    // Too long to be a phone: kept as digits so the validity check can reject it.
    expect(normalizeChatPhone("120363040000000001@g.us")).toBe("+120363040000000001");
  });

  it("accepts 7 to 15 digits that are not all zeros", () => {
    expect(isValidLeadPhone("+97305550142")).toBe(true);
    expect(isValidLeadPhone("+0000000")).toBe(false);
    expect(isValidLeadPhone("+120363040000000001")).toBe(false);
    expect(isValidLeadPhone("+123456")).toBe(false);
  });
});

describe("contact names", () => {
  it("treats blanks, the business name and bare numbers as generic", () => {
    expect(isGenericName("")).toBe(true);
    expect(isGenericName("Pest Control")).toBe(true);
    expect(isGenericName("+973 0555 0142")).toBe(true);
    expect(isGenericName("Sample Contact")).toBe(false);
  });
});

describe("parseWebhookPayload", () => {
  it("extracts the fields the lead handler needs", () => {
    const parsed = parseWebhookPayload({
      typeWebhook: "incomingMessageReceived",
      idMessage: "M1",
      senderData: { chatId: "97305550142@c.us", senderName: "Sample Contact" },
      messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "hello" } },
    });
    expect(parsed).toEqual({
      phone: "+97305550142",
      phoneDigits: "97305550142",
      isGroup: false,
      direction: "Incoming",
      messageType: "textMessage",
      message: "hello",
      messageId: "M1",
      displayName: "Sample Contact",
    });
  });

  it("flags group chats and outgoing messages", () => {
    const parsed = parseWebhookPayload({
      typeWebhook: "outgoingMessageReceived",
      senderData: { chatId: "120363040000000001@g.us", senderName: "Pest Control" },
    });
    expect(parsed.isGroup).toBe(true);
    expect(parsed.direction).toBe("Outgoing");
    expect(parsed.displayName).toBe("");
  });

  it("survives an empty payload", () => {
    const parsed = parseWebhookPayload({});
    expect(parsed.phone).toBe("");
    expect(parsed.message).toBe("message");
  });
});

describe("lead evaluation", () => {
  it("maps call results to lead statuses", () => {
    expect(LEAD_RESULT_STATUS["Interested"]).toBe("Potential");
    expect(LEAD_RESULT_STATUS["No Answer"]).toBe("Follow Up");
    expect(LEAD_RESULT_STATUS["Not Interested"]).toBe("Lost");
    expect(LEAD_RESULT_STATUS["Booked"]).toBe("Booked");
  });
});

describe("booking rules", () => {
  it("detects overlapping time ranges and allows back-to-back visits", () => {
    expect(timesOverlap("10:30", "11:30", "10:00", "11:00")).toBe(true);
    expect(timesOverlap("09:00", "12:00", "10:00", "11:00")).toBe(true);
    expect(timesOverlap("11:00", "12:00", "10:00", "11:00")).toBe(false);
    expect(timesOverlap("09:00", "10:00", "10:00", "11:00")).toBe(false);
  });

  it("validates the booking form in the same order as the server", () => {
    const form = { appointmentDate: "2026-03-15", serviceType: "Inspection", startTime: "10:00", endTime: "11:00", price: 0 };
    expect(validateBookingForm(form)).toBeNull();
    expect(validateBookingForm({ ...form, serviceType: "" })).toMatch(/required/);
    expect(validateBookingForm({ ...form, endTime: "" })).toMatch(/both start and end/);
    expect(validateBookingForm({ ...form, endTime: "10:00" })).toMatch(/after start/);
    expect(validateBookingForm({ ...form, price: -1 })).toMatch(/zero or more/);
    expect(validateBookingForm({ ...form, startTime: "", endTime: "" })).toBeNull();
  });

  it("files a new address into the first empty slot only", () => {
    expect(firstEmptyAddressSlot({})).toBe("address");
    expect(firstEmptyAddressSlot({ address: "x" })).toBe("secondary_address");
    expect(firstEmptyAddressSlot({ address: "x", secondary_address: " ", address_3: "y" })).toBe("secondary_address");
    expect(
      firstEmptyAddressSlot({ address: "a", secondary_address: "b", address_3: "c", address_4: "d", address_5: "e" }),
    ).toBeNull();
  });

  it("adds minutes to a clock time", () => {
    expect(addMinutes("13:00", 60)).toBe("14:00");
    expect(addMinutes("10:30", 45)).toBe("11:15");
  });
});

describe("outbox retry policy", () => {
  it("backs off linearly and caps at fifteen minutes", () => {
    expect(outboxBackoffMs(1)).toBe(60_000);
    expect(outboxBackoffMs(2)).toBe(120_000);
    expect(outboxBackoffMs(7)).toBe(420_000);
    expect(outboxBackoffMs(15)).toBe(900_000);
    expect(outboxBackoffMs(40)).toBe(900_000);
  });

  it("gives up on the eighth failed attempt", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(outboxStatusAfterFailure(7)).toBe("pending");
    expect(outboxStatusAfterFailure(8)).toBe("failed");
  });
});
