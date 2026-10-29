import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetFarmContext = vi.hoisted(() => vi.fn());
const mockHandleFarmerMessage = vi.hoisted(() => vi.fn());
vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));
vi.mock("../src/application/farm-context", () => ({
  getFarmContext: mockGetFarmContext,
  farmCookieHeader: vi.fn(() => "farm=x"),
  sessionCookieHeader: vi.fn(() => "session=x"),
}));
vi.mock("../src/application/farm-agent", () => ({
  handleFarmerMessage: mockHandleFarmerMessage,
}));

import { POST } from "../app/api/agent/route";
import { resetRequestLimits } from "../app/api/rate-limit";
import {
  logError,
  noteModelCall,
  withRequestLog,
} from "../src/infrastructure/request-log";

const FARMER_TEXT = "I sprayed Mama Ada's Riverside plot";
const SESSION = "c".repeat(64);
const IP = "203.0.113.42";

function loggedLines(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" "));
}

describe("request log", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRequestLimits();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetFarmContext.mockResolvedValue({
      farmId: "farm-id",
      sessionId: SESSION,
      isNewFarm: false,
      isNewSession: false,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes one line per agent request with no personal content", async () => {
    mockHandleFarmerMessage.mockImplementation(async () => {
      noteModelCall("extraction", false);
      noteModelCall("extraction", true);
      noteModelCall("answer", true);
      return [{ type: "answer", text: "You sprayed Riverside plot today." }];
    });
    const response = await POST(
      new Request("http://localhost/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `fieldledger_session=${SESSION}`,
          "x-forwarded-for": IP,
        },
        body: JSON.stringify({
          message: FARMER_TEXT,
          currentDate: new Date().toISOString().slice(0, 10),
          recentEventIds: [],
        }),
      }),
    );
    expect(response.status).toBe(200);

    expect(info).toHaveBeenCalledTimes(1);
    const line = loggedLines(info)[0]!;
    expect(JSON.parse(line)).toEqual({
      event: "request",
      route: "/api/agent",
      status: 200,
      durationMs: expect.any(Number),
      models: ["extraction", "answer"],
      modelCalls: 3,
      thinkingRetry: true,
    });
    for (const secret of [FARMER_TEXT, "Riverside", SESSION, IP]) {
      expect(line).not.toContain(secret);
    }
  });

  it("logs refused and failed requests too, without their content", async () => {
    mockHandleFarmerMessage.mockRejectedValue(
      new Error(`Key (name)=(${FARMER_TEXT}) already exists`),
    );
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(
      new Request("http://localhost/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: FARMER_TEXT,
          currentDate: new Date().toISOString().slice(0, 10),
        }),
      }),
    );
    expect(response.status).toBe(502);
    expect(JSON.parse(loggedLines(info)[0]!)).toMatchObject({
      route: "/api/agent",
      status: 502,
      models: [],
      thinkingRetry: false,
    });
    const errorLines = loggedLines(error).join("\n");
    expect(errorLines).toContain("Tilly agent request failed");
    expect(errorLines).not.toContain(FARMER_TEXT);
  });

  it("does not count a thinking call from the start as a retry", async () => {
    await withRequestLog("/test", async () => {
      noteModelCall("extraction", true);
      return new Response(null, { status: 204 });
    });
    expect(JSON.parse(loggedLines(info)[0]!)).toMatchObject({
      status: 204,
      modelCalls: 1,
      thinkingRetry: false,
    });
  });

  it("keeps only the error type and status in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const failure = Object.assign(new Error(`bad reply: ${FARMER_TEXT}`), {
      status: 500,
      code: "E_MODEL",
    });
    logError("Tilly model call failed", failure);
    expect(JSON.parse(loggedLines(error)[0]!)).toEqual({
      event: "error",
      context: "Tilly model call failed",
      error: "Error",
      status: 500,
      code: "E_MODEL",
    });
  });
});
