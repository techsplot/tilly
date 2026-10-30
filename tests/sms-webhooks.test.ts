/**
 * Request-level tests for the Twilio SMS webhook endpoints:
 *   POST /api/sms/status/[reminderId]   — delivery status callback
 *   POST /api/sms/inbound               — inbound "DONE" reply handler
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoist mock db and repository functions ───────────────────────────────────

const mockDb = {};
const mockUpdateCarrierStatus = vi.hoisted(() => vi.fn());
const mockAcknowledgeReminderBySmsFrom = vi.hoisted(() => vi.fn());

vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("../src/infrastructure/db/reminder-repository", () => ({
  updateCarrierStatus: mockUpdateCarrierStatus,
  acknowledgeReminderBySmsFrom: mockAcknowledgeReminderBySmsFrom,
}));

// ── Import route handlers after mocks are set up ─────────────────────────────

import { POST as statusPOST } from "../app/api/sms/status/[reminderId]/route";
import { POST as inboundPOST } from "../app/api/sms/inbound/route";
import type { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a form-encoded NextRequest (mirrors what Twilio sends).
 */
function makeTwilioRequest(
  url: string,
  fields: Record<string, string>,
): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }) as unknown as NextRequest;
}

// ── POST /api/sms/status/[reminderId] ─────────────────────────────────────────

describe("POST /api/sms/status/[reminderId]", () => {
  const reminderId = "reminder-uuid-123";
  const params = Promise.resolve({ reminderId });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls updateCarrierStatus with correct args and returns 200 for 'delivered'", async () => {
    mockUpdateCarrierStatus.mockResolvedValue(undefined);

    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageStatus: "delivered", MessageSid: "SM123" },
    );

    const res = await statusPOST(req, { params });

    expect(res.status).toBe(200);
    expect(mockUpdateCarrierStatus).toHaveBeenCalledOnce();
    expect(mockUpdateCarrierStatus).toHaveBeenCalledWith(
      mockDb,
      reminderId,
      "delivered",
    );
  });

  it("calls updateCarrierStatus for 'failed' status", async () => {
    mockUpdateCarrierStatus.mockResolvedValue(undefined);

    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageStatus: "failed" },
    );

    const res = await statusPOST(req, { params });

    expect(res.status).toBe(200);
    expect(mockUpdateCarrierStatus).toHaveBeenCalledWith(
      mockDb,
      reminderId,
      "failed",
    );
  });

  it("calls updateCarrierStatus for 'undelivered' status", async () => {
    mockUpdateCarrierStatus.mockResolvedValue(undefined);

    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageStatus: "undelivered" },
    );

    const res = await statusPOST(req, { params });

    expect(res.status).toBe(200);
    expect(mockUpdateCarrierStatus).toHaveBeenCalledWith(
      mockDb,
      reminderId,
      "undelivered",
    );
  });

  it("returns 200 empty when MessageStatus is missing (graceful handling)", async () => {
    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageSid: "SM456" }, // no MessageStatus
    );

    const res = await statusPOST(req, { params });

    expect(res.status).toBe(200);
    expect(mockUpdateCarrierStatus).not.toHaveBeenCalled();
  });

  it("returns 200 even when updateCarrierStatus throws", async () => {
    mockUpdateCarrierStatus.mockRejectedValue(new Error("DB connection lost"));

    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageStatus: "delivered" },
    );

    const res = await statusPOST(req, { params });

    // Twilio must always get 200
    expect(res.status).toBe(200);
  });

  it("returns an empty body (Twilio expects no body on status callback)", async () => {
    mockUpdateCarrierStatus.mockResolvedValue(undefined);

    const req = makeTwilioRequest(
      `http://localhost/api/sms/status/${reminderId}`,
      { MessageStatus: "sent" },
    );

    const res = await statusPOST(req, { params });

    const text = await res.text();
    expect(text).toBe("");
  });
});

// ── POST /api/sms/inbound ─────────────────────────────────────────────────────

describe("POST /api/sms/inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("acknowledges reminder when farmer replies 'DONE' (uppercase)", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "DONE",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledOnce();
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledWith(
      mockDb,
      "+2348012345678",
    );
  });

  it("acknowledges reminder when farmer replies 'done' (lowercase)", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "done",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledOnce();
  });

  it("acknowledges reminder when farmer replies 'completed'", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "completed",
      From: "+2348099999999",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledWith(
      mockDb,
      "+2348099999999",
    );
  });

  it("handles mixed-case 'Done' correctly", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "Done",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledOnce();
  });

  it("does NOT call acknowledge for unrecognised replies", async () => {
    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "Thanks",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).not.toHaveBeenCalled();
  });

  it("returns TwiML response with correct Content-Type", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "DONE",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.headers.get("Content-Type")).toContain("text/xml");
    const text = await res.text();
    expect(text).toBe(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    );
  });

  it("returns 200 TwiML even when acknowledge throws (no matching reminder)", async () => {
    mockAcknowledgeReminderBySmsFrom.mockRejectedValue(
      new Error("Farm not found"),
    );

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "DONE",
      From: "+2348000000000",
    });

    const res = await inboundPOST(req);

    // Never error to Twilio
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");
  });

  it("returns 200 TwiML when Body or From is missing", async () => {
    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      MessageSid: "SM789", // no Body or From
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/xml");
    expect(mockAcknowledgeReminderBySmsFrom).not.toHaveBeenCalled();
  });

  it("handles body with surrounding whitespace (e.g. 'DONE  ')", async () => {
    mockAcknowledgeReminderBySmsFrom.mockResolvedValue(undefined);

    const req = makeTwilioRequest("http://localhost/api/sms/inbound", {
      Body: "  DONE  ",
      From: "+2348012345678",
    });

    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockAcknowledgeReminderBySmsFrom).toHaveBeenCalledOnce();
  });
});
