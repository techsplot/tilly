import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DailyCap,
  RATE_LIMITS,
  RateLimiter,
  checkLimits,
  modelDailyLimit,
} from "../src/infrastructure/rate-limit";
import {
  ModelBudgetExceededError,
  createNebiusClient,
  modelCallBudget,
} from "../src/infrastructure/nebius/nebius-client";
import { handleFarmerMessage } from "../src/application/farm-agent";

const START = Date.parse("2026-10-19T09:00:00.000Z");
const MINUTE = 60_000;

function allowN(limiter: RateLimiter, key: string, n: number, now: number) {
  for (let index = 0; index < n; index += 1) {
    expect(checkLimits([[limiter, key]], now).allowed).toBe(true);
  }
}

describe("RateLimiter", () => {
  it("allows the per-minute limit, then refuses until the minute ends", () => {
    const limiter = new RateLimiter({ perMinute: 3, perHour: 100 });
    allowN(limiter, "a", 3, START);
    expect(checkLimits([[limiter, "a"]], START + 20_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
    expect(checkLimits([[limiter, "a"]], START + MINUTE).allowed).toBe(true);
  });

  it("enforces the hourly limit across minutes", () => {
    const limiter = new RateLimiter({ perMinute: 2, perHour: 4 });
    allowN(limiter, "a", 2, START);
    allowN(limiter, "a", 2, START + MINUTE);
    const refused = checkLimits([[limiter, "a"]], START + 2 * MINUTE);
    expect(refused).toEqual({
      allowed: false,
      retryAfterSeconds: 58 * 60,
    });
    expect(checkLimits([[limiter, "a"]], START + 60 * MINUTE).allowed).toBe(
      true,
    );
  });

  it("counts only allowed requests", () => {
    const limiter = new RateLimiter({ perMinute: 2, perHour: 3 });
    allowN(limiter, "a", 2, START);
    // Refused by the minute limit: must not use up the hour.
    for (let index = 0; index < 5; index += 1) {
      expect(checkLimits([[limiter, "a"]], START + 1000).allowed).toBe(false);
    }
    expect(checkLimits([[limiter, "a"]], START + MINUTE).allowed).toBe(true);
  });

  it("keeps keys apart", () => {
    const limiter = new RateLimiter({ perMinute: 1, perHour: 10 });
    allowN(limiter, "a", 1, START);
    expect(checkLimits([[limiter, "b"]], START).allowed).toBe(true);
    expect(checkLimits([[limiter, "a"]], START).allowed).toBe(false);
  });

  it("drops expired keys so the map cannot grow without bound", () => {
    const limiter = new RateLimiter({ perMinute: 10, perHour: 10 });
    for (let index = 0; index < 50; index += 1) {
      checkLimits([[limiter, `key-${index}`]], START);
    }
    expect(limiter.size).toBe(50);
    checkLimits([[limiter, "late"]], START + 61 * MINUTE);
    expect(limiter.size).toBe(1);
  });
});

describe("checkLimits with two limiters", () => {
  it("needs both to pass, and counts neither when one refuses", () => {
    const session = new RateLimiter({ perMinute: 10, perHour: 100 });
    const ip = new RateLimiter({ perMinute: 2, perHour: 100 });
    allowN(ip, "1.2.3.4", 2, START);
    expect(
      checkLimits(
        [
          [session, "s1"],
          [ip, "1.2.3.4"],
        ],
        START,
      ).allowed,
    ).toBe(false);
    // The refused request did not count against the session.
    expect(session.waitSeconds("s1", START)).toBe(0);
    expect(session.size).toBe(0);
  });
});

describe("DailyCap", () => {
  it("allows the limit per UTC day and resets at midnight", () => {
    const cap = new DailyCap(() => 2);
    expect(cap.take(START).allowed).toBe(true);
    expect(cap.take(START).allowed).toBe(true);
    expect(cap.take(START)).toEqual({
      allowed: false,
      retryAfterSeconds: 15 * 60 * 60,
    });
    expect(cap.take(Date.parse("2026-10-20T00:00:00.000Z")).allowed).toBe(true);
  });
});

describe("modelDailyLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the documented limit", () => {
    vi.stubEnv("MODEL_DAILY_LIMIT", "");
    expect(modelDailyLimit()).toBe(RATE_LIMITS.modelCallsPerDay);
    expect(RATE_LIMITS.modelCallsPerDay).toBe(3000);
  });

  it("reads MODEL_DAILY_LIMIT and ignores invalid values", () => {
    vi.stubEnv("MODEL_DAILY_LIMIT", "25");
    expect(modelDailyLimit()).toBe(25);
    vi.stubEnv("MODEL_DAILY_LIMIT", "lots");
    expect(modelDailyLimit()).toBe(RATE_LIMITS.modelCallsPerDay);
  });
});

describe("global model call budget", () => {
  beforeEach(() => {
    modelCallBudget.reset();
    vi.stubEnv("NEBIUS_API_KEY", "test-key");
    vi.stubEnv("NEBIUS_MODEL_EXTRACTION", "test-model");
  });
  afterEach(() => {
    modelCallBudget.reset();
    vi.unstubAllEnvs();
  });

  it("refuses a Nebius call once the day's calls are used", async () => {
    vi.stubEnv("MODEL_DAILY_LIMIT", "0");
    const client = createNebiusClient();
    await expect(
      client.chat.completions.create({ model: "test-model", messages: [] }),
    ).rejects.toBeInstanceOf(ModelBudgetExceededError);
  });

  it("does not spend the budget on greetings answered in code", async () => {
    vi.stubEnv("MODEL_DAILY_LIMIT", "1");
    const actions = await handleFarmerMessage({} as never, "farm-id", {
      message: "hi Tilly",
      currentDate: "2026-10-19",
      sessionId: "session",
      recentEventIds: [],
    });
    expect(actions[0]?.type).toBe("reply");
    // The one allowed call is still there.
    expect(modelCallBudget.take().allowed).toBe(true);
    expect(modelCallBudget.take().allowed).toBe(false);
  });
});
