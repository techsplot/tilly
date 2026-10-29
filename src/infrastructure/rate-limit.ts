// In-memory request limits for the model-backed routes. Counts live in this
// process only: they reset when the container restarts and are not shared
// between containers. That is enough for the single demo instance; more
// than one instance would need a shared store such as Redis.

export const RATE_LIMITS = {
  session: { perMinute: 10, perHour: 100 },
  ip: { perMinute: 30, perHour: 300 },
  // Nebius calls across all users per UTC day; MODEL_DAILY_LIMIT overrides.
  modelCallsPerDay: 3000,
} as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
// Long cookie or header values must not become long map keys.
const MAX_KEY_LENGTH = 128;

type Window = { count: number; resetAt: number };
type Entry = { minute: Window; hour: Window };
export type WindowLimits = { perMinute: number; perHour: number };

export type LimitResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly store = new Map<string, Entry>();
  private nextSweepAt = 0;

  constructor(private readonly limits: WindowLimits) {}

  // How long until `key` may make another request, or 0 if it may now.
  // Does not count anything.
  waitSeconds(key: string, now: number): number {
    const entry = this.store.get(normalizeKey(key));
    if (!entry) return 0;
    let wait = 0;
    for (const [window, limit] of [
      [entry.minute, this.limits.perMinute],
      [entry.hour, this.limits.perHour],
    ] as const) {
      if (now < window.resetAt && window.count >= limit) {
        wait = Math.max(wait, Math.ceil((window.resetAt - now) / 1000));
      }
    }
    return wait;
  }

  // Counts one allowed request for `key`.
  record(key: string, now: number): void {
    this.sweep(now);
    const normalized = normalizeKey(key);
    const entry = this.store.get(normalized) ?? {
      minute: { count: 0, resetAt: now + MINUTE_MS },
      hour: { count: 0, resetAt: now + HOUR_MS },
    };
    for (const [window, length] of [
      [entry.minute, MINUTE_MS],
      [entry.hour, HOUR_MS],
    ] as const) {
      if (now >= window.resetAt) {
        window.count = 0;
        window.resetAt = now + length;
      }
      window.count += 1;
    }
    this.store.set(normalized, entry);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
    this.nextSweepAt = 0;
  }

  // Drops keys whose hourly window has ended, at most once a minute, so
  // the map cannot grow without bound.
  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + MINUTE_MS;
    for (const [key, entry] of this.store) {
      if (now >= entry.hour.resetAt) this.store.delete(key);
    }
  }
}

function normalizeKey(key: string): string {
  return key.slice(0, MAX_KEY_LENGTH);
}

/**
 * Lets a request through only if every limiter allows its key, and counts
 * it against all of them only then, so a request turned away by one limit
 * does not use up another.
 */
export function checkLimits(
  checks: Array<[RateLimiter, string]>,
  now: number = Date.now(),
): LimitResult {
  const wait = Math.max(
    0,
    ...checks.map(([limiter, key]) => limiter.waitSeconds(key, now)),
  );
  if (wait > 0) return { allowed: false, retryAfterSeconds: wait };
  for (const [limiter, key] of checks) limiter.record(key, now);
  return { allowed: true };
}

/**
 * A fixed cap per UTC day, used for the total number of model calls.
 */
export class DailyCap {
  private day = "";
  private count = 0;

  constructor(private readonly limit: () => number) {}

  // Counts one use if the cap allows it.
  take(now: number = Date.now()): LimitResult {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.limit()) {
      const midnight = Date.parse(`${today}T00:00:00.000Z`) + 24 * HOUR_MS;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((midnight - now) / 1000)),
      };
    }
    this.count += 1;
    return { allowed: true };
  }

  reset(): void {
    this.day = "";
    this.count = 0;
  }
}

export function modelDailyLimit(): number {
  // A blank value means unset, not zero.
  const raw = process.env.MODEL_DAILY_LIMIT?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : RATE_LIMITS.modelCallsPerDay;
}
