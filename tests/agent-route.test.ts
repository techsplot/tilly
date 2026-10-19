import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = {};
const mockGetFarmContext = vi.hoisted(() => vi.fn());
const mockHandleFarmerMessage = vi.hoisted(() => vi.fn());

vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => mockDb),
}));
vi.mock("../src/application/farm-context", () => ({
  getFarmContext: mockGetFarmContext,
  farmCookieHeader: vi.fn((farmId: string) => `farm=${farmId}`),
  sessionCookieHeader: vi.fn((sessionId: string) => `session=${sessionId}`),
}));
vi.mock("../src/application/farm-agent", () => ({
  handleFarmerMessage: mockHandleFarmerMessage,
}));

import { APIConnectionTimeoutError } from "openai";
import { ModelConfigurationError } from "../src/infrastructure/nebius/nebius-client";
import { POST } from "../app/api/agent/route";

const request = (body: BodyInit) =>
  new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

describe("agent route", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    mockGetFarmContext.mockResolvedValue({
      farmId: "farm-id",
      sessionId: "session-id",
      isNewFarm: false,
      isNewSession: false,
    });
    mockHandleFarmerMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 200 with actions on success", async () => {
    mockHandleFarmerMessage.mockResolvedValue([{ type: "reply", text: "OK" }]);
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      actions: [{ type: "reply", text: "OK" }],
    });
  });

  it("returns the actual validation message", async () => {
    const response = await POST(
      request(JSON.stringify({ message: "", currentDate: "2026-10-12" })),
    );
    expect(response.status).toBe(400);
  });

  it("rejects dates more than one day away", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2020-01-01",
          recentEventIds: [],
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects more than 3 clarifications", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: [],
          pending: {
            kind: "clarification",
            originalMessage: "hi",
            clarifications: [
              { question: "a?", answer: "a" },
              { question: "b?", answer: "b" },
              { question: "c?", answer: "c" },
              { question: "d?", answer: "d" },
            ],
          },
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects more than 20 recent event ids", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: Array.from({ length: 21 }, (_, i) => `id-${i}`),
        }),
      ),
    );
    expect(response.status).toBe(400);
  });

  it("rejects malformed event ids before calling the agent", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          message: "river field",
          currentDate: "2026-10-12",
          pending: { kind: "correction", eventId: "not-a-uuid" },
          recentEventIds: ["also-not-a-uuid"],
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(mockHandleFarmerMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(request("{bad"));
    expect(response.status).toBe(400);
  });

  it("creates a farm cookie on first use", async () => {
    mockGetFarmContext.mockResolvedValue({
      farmId: "farm-id",
      sessionId: "session-id",
      isNewFarm: true,
      isNewSession: true,
    });
    mockHandleFarmerMessage.mockResolvedValue([]);
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );
    expect(response.headers.get("set-cookie")).toBe(
      "session=session-id, farm=farm-id",
    );
  });

  it("passes the session to the agent and keeps cookies on a farm reply", async () => {
    mockGetFarmContext.mockResolvedValue({
      farmId: "farm-id",
      sessionId: "session-id",
      isNewFarm: true,
      isNewSession: true,
    });
    mockHandleFarmerMessage.mockResolvedValue([
      { type: "reply", text: 'I couldn\'t find a farm named "Hill Farm".' },
    ]);
    const response = await POST(
      request(
        JSON.stringify({
          message: "I weeded at Hill Farm",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );
    expect(mockHandleFarmerMessage).toHaveBeenCalledWith(
      mockDb,
      "farm-id",
      expect.objectContaining({ sessionId: "session-id" }),
    );
    expect(response.headers.get("set-cookie")).toBe(
      "session=session-id, farm=farm-id",
    );
  });

  it("returns 504 for SDK timeouts", async () => {
    mockHandleFarmerMessage.mockImplementation(async () => {
      await Promise.resolve();
      return Promise.reject(
        new APIConnectionTimeoutError({ message: "timed out" }),
      );
    });
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );
    expect(response.status).toBe(504);
  });

  it("returns a clear setup error when the answer model is not configured", async () => {
    mockHandleFarmerMessage.mockRejectedValue(
      new ModelConfigurationError("NEBIUS_MODEL_ANSWER is required."),
    );

    const response = await POST(
      request(
        JSON.stringify({
          message: "what record do i have today",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "Tilly can't answer questions or give reports yet: the server has no answer model set (NEBIUS_MODEL_ANSWER).",
    });
  });

  it("names the extraction model when that is the one missing", async () => {
    mockHandleFarmerMessage.mockRejectedValue(
      new ModelConfigurationError(
        "NEBIUS_MODEL_EXTRACTION is required.",
        "extraction",
      ),
    );

    const response = await POST(
      request(
        JSON.stringify({
          message: "I weeded today",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error:
        "Tilly can't read messages yet: the server has no extraction model set (NEBIUS_MODEL_EXTRACTION).",
    });
  });

  it("returns 502 without exposing internal errors", async () => {
    mockHandleFarmerMessage.mockImplementation(async () => {
      await Promise.resolve();
      return Promise.reject(new Error("secret configuration"));
    });
    const response = await POST(
      request(
        JSON.stringify({
          message: "hello",
          currentDate: "2026-10-12",
          recentEventIds: [],
        }),
      ),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Tilly could not process that message. Please try again.",
    });
  });
});
