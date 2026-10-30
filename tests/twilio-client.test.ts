import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Credentials are read when an SMS is sent
process.env.TWILIO_ACCOUNT_SID = "ACtest1234567890";
process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
process.env.TWILIO_PHONE_NUMBER = "+15551234567";
process.env.APP_URL = "https://example.com";

const { formatReminderSMS, sendSMS } =
  await import("../src/infrastructure/sms/twilio-client");

// ---------------------------------------------------------------------------
// formatReminderSMS
// ---------------------------------------------------------------------------

describe("formatReminderSMS", () => {
  // Pin "today" so overdue logic is deterministic
  const FIXED_TODAY = "2026-10-20";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${FIXED_TODAY}T12:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a reminder with field name (due today)", () => {
    const result = formatReminderSMS({
      activity: "weed",
      fieldName: "North Field",
      crop: null,
      reminderDate: FIXED_TODAY,
    });
    expect(result).toBe(
      "🌾 Tilly: weed - North Field. Reply DONE when complete.",
    );
  });

  it("formats a reminder without field name (due today)", () => {
    const result = formatReminderSMS({
      activity: "fertilize",
      fieldName: null,
      crop: "maize",
      reminderDate: FIXED_TODAY,
    });
    expect(result).toBe("🌾 Tilly: fertilize. Reply DONE when complete.");
  });

  it("formats a reminder with crop but no field (due today)", () => {
    const result = formatReminderSMS({
      activity: "irrigate",
      fieldName: null,
      crop: "tomatoes",
      reminderDate: FIXED_TODAY,
    });
    expect(result).toBe("🌾 Tilly: irrigate. Reply DONE when complete.");
  });

  it("prepends overdue prefix when reminder_date is in the past", () => {
    const result = formatReminderSMS({
      activity: "spray",
      fieldName: "South Plot",
      crop: null,
      reminderDate: "2026-10-15", // 5 days ago
    });
    expect(result).toBe(
      "(overdue since Oct 15) 🌾 Tilly: spray - South Plot. Reply DONE when complete.",
    );
  });

  it("formats overdue reminder without field name", () => {
    const result = formatReminderSMS({
      activity: "harvest",
      fieldName: null,
      crop: "yam",
      reminderDate: "2026-10-01",
    });
    expect(result).toBe(
      "(overdue since Oct 1) 🌾 Tilly: harvest. Reply DONE when complete.",
    );
  });

  it("does NOT prepend overdue for a future reminder", () => {
    const result = formatReminderSMS({
      activity: "inspect",
      fieldName: "East Field",
      crop: null,
      reminderDate: "2026-10-25",
    });
    // Future dates should not be marked overdue
    expect(result).not.toContain("overdue");
    expect(result).toBe(
      "🌾 Tilly: inspect - East Field. Reply DONE when complete.",
    );
  });

  it("includes field name but ignores crop in the message body", () => {
    const result = formatReminderSMS({
      activity: "plant",
      fieldName: "West Block",
      crop: "cassava",
      reminderDate: FIXED_TODAY,
    });
    // Crop is NOT included in the SMS format per spec
    expect(result).toBe(
      "🌾 Tilly: plant - West Block. Reply DONE when complete.",
    );
    expect(result).not.toContain("cassava");
  });
});

// ---------------------------------------------------------------------------
// sendSMS
// ---------------------------------------------------------------------------

describe("sendSMS", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails without calling Twilio when credentials are missing", async () => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      const result = await sendSMS("+2348012345678", "hi", "reminder-1");
      expect(result).toEqual({
        success: false,
        error: "SMS is not configured",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      process.env.TWILIO_AUTH_TOKEN = authToken;
    }
  });

  it("calls Twilio REST API with correct params on success", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_test_123" }), { status: 201 }),
    );

    const result = await sendSMS(
      "+2348012345678",
      "Test message",
      "reminder-uuid-1",
    );

    expect(result).toEqual({ success: true, messageId: "SM_test_123" });

    // Verify fetch was called once
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    // Correct Twilio endpoint
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/ACtest1234567890/Messages.json`,
    );

    // POST method
    expect(options.method).toBe("POST");

    // Authorization header uses Basic auth
    expect(
      (options.headers as Record<string, string>)["Authorization"],
    ).toMatch(/^Basic /);

    // Body contains required Twilio params
    const bodyStr = options.body as string;
    expect(bodyStr).toContain("To=%2B2348012345678");
    expect(bodyStr).toContain("From=");
    expect(bodyStr).toContain("Body=Test+message");

    // StatusCallback should include reminderId
    expect(bodyStr).toContain("StatusCallback=");
    expect(bodyStr).toContain("reminder-uuid-1");
  });

  it("includes statusCallback URL pointing to /api/sms/status/[reminderId]", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_abc" }), { status: 201 }),
    );

    await sendSMS("+2348012345678", "msg", "reminder-xyz");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const bodyStr = options.body as string;
    const decoded = decodeURIComponent(bodyStr);

    expect(decoded).toContain(
      "StatusCallback=https://example.com/api/sms/status/reminder-xyz",
    );
  });

  it("returns success=false and error message when Twilio returns an error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "Invalid phone number", code: 21211 }),
        { status: 400 },
      ),
    );

    const result = await sendSMS("+invalid", "msg", "reminder-abc");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid phone number");
    expect(result.messageId).toBeUndefined();
  });

  it("returns success=false when fetch throws a network error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await sendSMS("+2348012345678", "msg", "reminder-net");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network failure");
  });

  it("uses Basic auth with correct credentials", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM_auth_test" }), { status: 201 }),
    );

    await sendSMS("+2348012345678", "msg", "reminder-auth");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (options.headers as Record<string, string>)[
      "Authorization"
    ];

    // Decode and verify it contains accountSid:authToken
    const base64 = (authHeader ?? "").replace("Basic ", "");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    expect(decoded).toBe("ACtest1234567890:test_auth_token");
  });
});
