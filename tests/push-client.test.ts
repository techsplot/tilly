import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ─── Env vars must be set BEFORE the module is imported ───────────────────────
// web-push is mocked, so these are placeholders. Never paste real keys here.
const MOCK_PUBLIC_KEY = "test-vapid-public-key";
const MOCK_PRIVATE_KEY = "test-vapid-private-key";
const MOCK_CONTACT = "mailto:test@example.com";

// Set env vars before any imports
process.env.VAPID_PUBLIC_KEY = MOCK_PUBLIC_KEY;
process.env.VAPID_PRIVATE_KEY = MOCK_PRIVATE_KEY;
process.env.VAPID_CONTACT = MOCK_CONTACT;

// ─── Mock the web-push library ────────────────────────────────────────────────
const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
}));

// ─── Mock getDb to avoid real DB connection in unit tests
const mockWhereFn = vi.fn().mockResolvedValue(undefined);
const mockSetFn = vi.fn().mockReturnValue({ where: mockWhereFn });
const mockUpdateFn = vi.fn().mockReturnValue({ set: mockSetFn });

vi.mock("@/src/infrastructure/db/client", () => ({
  getDb: () => ({
    update: mockUpdateFn,
  }),
}));

vi.mock("@/src/infrastructure/db/schema", () => ({
  pushSubscriptions: { id: "id" },
}));

// ─── Now import the module under test ────────────────────────────────────────
// Note: dynamic import is used so that mocks are applied first
let sendPushNotification: typeof import("../src/infrastructure/push/push-client").sendPushNotification;

beforeAll(async () => {
  const mod = await import("../src/infrastructure/push/push-client");
  sendPushNotification = mod.sendPushNotification;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─── Sample subscription (mimics a row from push_subscriptions table) ─────────
const sampleSubscription = {
  id: "sub-uuid-1234",
  endpoint: "https://fcm.googleapis.com/fcm/send/some-token",
  keys: {
    p256dh: "test-p256dh-key",
    auth: "test-auth-secret",
  },
};

const samplePayload = {
  title: "🌾 Tilly Reminder",
  body: "Time to weed the North Field",
  reminderId: "reminder-uuid-5678",
};

describe("sendPushNotification", () => {
  it("sets VAPID details from env vars on the first send", async () => {
    // Importing the module must not need VAPID keys; they are read on send.
    expect(mockSetVapidDetails).not.toHaveBeenCalled();
    mockSendNotification.mockResolvedValueOnce(undefined);

    await sendPushNotification(sampleSubscription, samplePayload);

    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      MOCK_CONTACT,
      MOCK_PUBLIC_KEY,
      MOCK_PRIVATE_KEY,
    );
    mockSendNotification.mockClear();
  });

  it("sends a notification with correctly shaped JSON payload", async () => {
    mockSendNotification.mockResolvedValueOnce(undefined);

    await sendPushNotification(sampleSubscription, samplePayload);

    expect(mockSendNotification).toHaveBeenCalledOnce();

    const [subscription, payloadStr] = mockSendNotification.mock.calls[0] as [
      unknown,
      string,
    ];

    // Verify subscription shape
    expect(subscription).toEqual({
      endpoint: sampleSubscription.endpoint,
      keys: {
        p256dh: sampleSubscription.keys.p256dh,
        auth: sampleSubscription.keys.auth,
      },
    });

    // Verify payload is valid JSON with the expected fields
    const payload = JSON.parse(payloadStr) as unknown;
    expect(payload).toEqual({
      title: samplePayload.title,
      body: samplePayload.body,
      reminderId: samplePayload.reminderId,
    });
  });

  it("returns { success: true } on a successful send", async () => {
    mockSendNotification.mockResolvedValueOnce(undefined);

    const result = await sendPushNotification(
      sampleSubscription,
      samplePayload,
    );

    expect(result).toEqual({ success: true });
  });

  it("returns { success: false, error } when push service returns a non-410 error", async () => {
    mockSendNotification.mockRejectedValueOnce({
      statusCode: 500,
      message: "Internal Server Error",
    });

    const result = await sendPushNotification(
      sampleSubscription,
      samplePayload,
    );

    expect(result.success).toBe(false);
    expect(result.expired).toBeUndefined();
    expect(result.error).toBe("Internal Server Error");
  });

  it("marks subscription inactive and returns { success: false, expired: true } on 410 Gone", async () => {
    mockSendNotification.mockRejectedValueOnce({
      statusCode: 410,
      message: "Gone",
    });

    // Reset the mock call counts so we can assert cleanly
    mockUpdateFn.mockClear();
    mockSetFn.mockClear();
    mockWhereFn.mockClear();

    const result = await sendPushNotification(
      sampleSubscription,
      samplePayload,
    );

    expect(result).toEqual({ success: false, expired: true });
    // Verify DB update was called to mark subscription inactive
    expect(mockUpdateFn).toHaveBeenCalled();
    expect(mockSetFn).toHaveBeenCalledWith({ active: false });
  });

  it("includes reminderId in the JSON payload", async () => {
    mockSendNotification.mockResolvedValueOnce(undefined);

    const customPayload = {
      title: "Test title",
      body: "Test body",
      reminderId: "specific-reminder-id",
    };

    await sendPushNotification(sampleSubscription, customPayload);

    const payloadStr = mockSendNotification.mock.calls[
      mockSendNotification.mock.calls.length - 1
    ]?.[1] as string;
    const parsed = JSON.parse(payloadStr) as { reminderId: string };
    expect(parsed.reminderId).toBe("specific-reminder-id");
  });
});
