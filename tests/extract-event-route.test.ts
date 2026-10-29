import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExtractFarmEvent = vi.hoisted(() => vi.fn());
vi.mock("../src/application/extract-farm-event", () => ({
  extractFarmEvent: mockExtractFarmEvent,
}));

import { APIConnectionTimeoutError } from "openai";
import { POST } from "../app/api/extract-event/route";
import { resetRequestLimits } from "../app/api/rate-limit";

const request = (body: BodyInit) =>
  new Request("http://localhost/api/extract-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

const validResult = {
  events: [
    {
      activity: "planting",
      crop: "maize",
      field: "Back Field",
      eventDate: "2026-10-06",
      quantity: 5,
      unit: "bags",
      status: "proposed",
      missingFields: [],
      sourceText: "test",
    },
  ],
  clarificationRequired: false,
  clarificationQuestion: null,
};

describe("extract event route", () => {
  beforeEach(() => {
    resetRequestLimits();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    mockExtractFarmEvent.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 200 on success", async () => {
    mockExtractFarmEvent.mockResolvedValue(validResult);
    const response = await POST(
      request(JSON.stringify({ message: "test", currentDate: "2026-10-11" })),
    );
    expect(response.status).toBe(200);
  });

  it("returns the actual validation message", async () => {
    const response = await POST(
      request(JSON.stringify({ message: "", currentDate: "2026-10-11" })),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Message cannot be empty",
    });
  });

  it("rejects dates more than one day away", async () => {
    const response = await POST(
      request(JSON.stringify({ message: "test", currentDate: "2020-01-01" })),
    );
    expect(response.status).toBe(400);
  });

  it("accepts a date exactly one day away", async () => {
    mockExtractFarmEvent.mockResolvedValue(validResult);
    const response = await POST(
      request(JSON.stringify({ message: "test", currentDate: "2026-10-12" })),
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(request("{bad"));
    expect(response.status).toBe(400);
  });

  it("returns 502 without exposing model errors", async () => {
    mockExtractFarmEvent.mockImplementation(async () => {
      await Promise.resolve();
      return Promise.reject(new Error("secret configuration"));
    });
    const response = await POST(
      request(JSON.stringify({ message: "test", currentDate: "2026-10-11" })),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Tilly could not process that message. Please try again.",
    });
  });

  it("returns 504 for SDK timeouts", async () => {
    mockExtractFarmEvent.mockImplementation(async () => {
      await Promise.resolve();
      return Promise.reject(
        new APIConnectionTimeoutError({ message: "timed out" }),
      );
    });
    const response = await POST(
      request(JSON.stringify({ message: "test", currentDate: "2026-10-11" })),
    );
    expect(response.status).toBe(504);
  });
});

describe("extract event route rate limit", () => {
  beforeEach(() => {
    resetRequestLimits();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    mockExtractFarmEvent.mockReset().mockResolvedValue(validResult);
    // No database in this test, so the memory load logs and falls back.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 429 past the session limit", async () => {
    const limited = () =>
      new Request("http://localhost/api/extract-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: "fieldledger_session=extract-session",
        },
        body: JSON.stringify({ message: "test", currentDate: "2026-10-11" }),
      });
    for (let index = 0; index < 10; index += 1) {
      expect((await POST(limited())).status).toBe(200);
    }
    const response = await POST(limited());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mockExtractFarmEvent).toHaveBeenCalledTimes(10);
  });
});
