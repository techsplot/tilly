import {
  RATE_LIMITS,
  RateLimiter,
  checkLimits,
} from "@/src/infrastructure/rate-limit";
import { modelCallBudget } from "@/src/infrastructure/nebius/nebius-client";

export const BUSY_REPLY =
  "Tilly is busy right now. Please try again in a minute.";
// The daily cap lasts until midnight UTC, so "a minute" would be wrong.
export const DAILY_CAP_REPLY =
  "Tilly is busy right now. Please try again later.";

// Per process; see src/infrastructure/rate-limit.ts.
const sessionLimiter = new RateLimiter(RATE_LIMITS.session);
const ipLimiter = new RateLimiter(RATE_LIMITS.ip);

// Requests with no session cookie share one bucket, so dropping the cookie
// does not reset the limit.
function sessionKey(request: Request): string {
  const match = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)fieldledger_session=([^;]+)/);
  return match?.[1] ?? "no-session";
}

// The first x-forwarded-for value is the client as the proxy saw it.
function ipKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return forwarded?.trim() || "unknown";
}

export function tooManyRequests(
  retryAfterSeconds: number,
  message: string = BUSY_REPLY,
): Response {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Returns a 429 response when this request is over its session or IP
 * limit, or null when it may go ahead (and is then counted).
 */
export function limitModelRequest(
  request: Request,
  now: number = Date.now(),
): Response | null {
  const result = checkLimits(
    [
      [sessionLimiter, sessionKey(request)],
      [ipLimiter, ipKey(request)],
    ],
    now,
  );
  return result.allowed ? null : tooManyRequests(result.retryAfterSeconds);
}

// For tests: a fresh set of limits.
export function resetRequestLimits(): void {
  sessionLimiter.clear();
  ipLimiter.clear();
  modelCallBudget.reset();
}
