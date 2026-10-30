import { describe, it, expect } from "vitest";
import {
  isInQuietHours,
  nextDeliveryWindow,
} from "../src/infrastructure/sms/quiet-hours";

// Helper: build a Date at a specific UTC hour (and optional minute)
function utc(hour: number, minute = 0): Date {
  const d = new Date(0);
  d.setUTCFullYear(2026, 9, 20); // 2026-10-20 — arbitrary stable date
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

describe("isInQuietHours", () => {
  // Boundary: last minute of quiet time
  it("06:59 UTC is quiet", () => {
    expect(isInQuietHours(utc(6, 59))).toBe(true);
  });

  // Boundary: first minute of active time
  it("07:00 UTC is not quiet", () => {
    expect(isInQuietHours(utc(7, 0))).toBe(false);
  });

  // Middle of active hours
  it("12:00 UTC is not quiet", () => {
    expect(isInQuietHours(utc(12, 0))).toBe(false);
  });

  // Last minute of active time
  it("21:59 UTC is not quiet", () => {
    expect(isInQuietHours(utc(21, 59))).toBe(false);
  });

  // Boundary: first minute of evening quiet time
  it("22:00 UTC is quiet", () => {
    expect(isInQuietHours(utc(22, 0))).toBe(true);
  });

  it("23:00 UTC is quiet", () => {
    expect(isInQuietHours(utc(23, 0))).toBe(true);
  });

  it("00:00 UTC is quiet", () => {
    expect(isInQuietHours(utc(0, 0))).toBe(true);
  });

  it("03:00 UTC is quiet", () => {
    expect(isInQuietHours(utc(3, 0))).toBe(true);
  });
});

describe("nextDeliveryWindow", () => {
  it("23:00 UTC returns 07:00 next day", () => {
    const from = utc(23, 0); // 2026-10-20 23:00 UTC
    const result = nextDeliveryWindow(from);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(9); // October (0-indexed)
    expect(result.getUTCDate()).toBe(21); // next day
    expect(result.getUTCHours()).toBe(7);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });

  it("03:00 UTC returns 07:00 same day", () => {
    const from = utc(3, 0); // 2026-10-20 03:00 UTC
    const result = nextDeliveryWindow(from);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(9);
    expect(result.getUTCDate()).toBe(20); // same day
    expect(result.getUTCHours()).toBe(7);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it("09:00 UTC returns current time (deliver now)", () => {
    const from = utc(9, 0); // well within active hours
    const result = nextDeliveryWindow(from);

    // Should return the same moment (not advance it)
    expect(result.getTime()).toBe(from.getTime());
  });

  it("07:00 UTC exactly returns current time", () => {
    const from = utc(7, 0);
    const result = nextDeliveryWindow(from);
    expect(result.getTime()).toBe(from.getTime());
  });

  it("21:59 UTC returns current time", () => {
    const from = utc(21, 59);
    const result = nextDeliveryWindow(from);
    expect(result.getTime()).toBe(from.getTime());
  });

  it("22:00 UTC returns 07:00 next day", () => {
    const from = utc(22, 0);
    const result = nextDeliveryWindow(from);

    expect(result.getUTCDate()).toBe(21); // next day
    expect(result.getUTCHours()).toBe(7);
  });

  it("handles month boundary correctly (Oct 31 23:00 → Nov 1 07:00)", () => {
    const from = new Date(Date.UTC(2026, 9, 31, 23, 0, 0)); // Oct 31 23:00 UTC
    const result = nextDeliveryWindow(from);

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(10); // November
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCHours()).toBe(7);
  });
});
