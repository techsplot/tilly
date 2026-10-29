import { describe, it, expect } from "vitest";
import {
  calculateDueDate,
  validateReminderSource,
  ReminderError,
} from "../src/domain/reminder";

describe("calculateDueDate", () => {
  it("calculates tomorrow from a base date", () => {
    expect(calculateDueDate("2026-10-15", "tomorrow")).toBe("2026-10-16");
  });

  it("calculates today (no offset)", () => {
    expect(calculateDueDate("2026-10-15", "today")).toBe("2026-10-15");
  });

  it("calculates 'in 3 days'", () => {
    expect(calculateDueDate("2026-10-15", "in 3 days")).toBe("2026-10-18");
  });

  it("calculates 'in 1 day' (singular)", () => {
    expect(calculateDueDate("2026-10-15", "in 1 day")).toBe("2026-10-16");
  });

  it("calculates 'next week'", () => {
    expect(calculateDueDate("2026-10-15", "next week")).toBe("2026-10-22");
  });

  it("calculates 'in 2 weeks'", () => {
    expect(calculateDueDate("2026-10-15", "in 2 weeks")).toBe("2026-10-29");
  });

  it("calculates 'in 1 week' (singular)", () => {
    expect(calculateDueDate("2026-10-15", "in 1 week")).toBe("2026-10-22");
  });

  it("handles month boundaries correctly", () => {
    expect(calculateDueDate("2026-10-31", "tomorrow")).toBe("2026-11-01");
    expect(calculateDueDate("2026-10-25", "in 1 week")).toBe("2026-11-01");
  });

  it("handles year boundaries correctly", () => {
    expect(calculateDueDate("2026-12-31", "tomorrow")).toBe("2027-01-01");
    expect(calculateDueDate("2026-12-28", "in 1 week")).toBe("2027-01-04");
  });

  it("handles leap year (2024)", () => {
    expect(calculateDueDate("2024-02-28", "tomorrow")).toBe("2024-02-29");
    expect(calculateDueDate("2024-02-29", "tomorrow")).toBe("2024-03-01");
  });

  it("handles non-leap year (2026)", () => {
    expect(calculateDueDate("2026-02-28", "tomorrow")).toBe("2026-03-01");
  });

  it("rejects invalid date format", () => {
    expect(() => calculateDueDate("10-15-2026", "tomorrow")).toThrow(
      ReminderError,
    );
    expect(() => calculateDueDate("2026/10/15", "tomorrow")).toThrow(
      ReminderError,
    );
    expect(() => calculateDueDate("2026-13-01", "tomorrow")).toThrow(
      ReminderError,
    );
    expect(() => calculateDueDate("2026-02-31", "tomorrow")).toThrow(
      ReminderError,
    );
  });

  it("rejects invalid offset", () => {
    expect(() => calculateDueDate("2026-10-15", "sometime")).toThrow(
      ReminderError,
    );
    expect(() => calculateDueDate("2026-10-15", "in a while")).toThrow(
      ReminderError,
    );
  });

  it("rejects past dates", () => {
    expect(() => calculateDueDate("2026-10-15", "in -3 days")).toThrow(
      ReminderError,
    );
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(calculateDueDate("2026-10-15", "  TOMORROW  ")).toBe("2026-10-16");
    expect(calculateDueDate("2026-10-15", "  In 3 Days  ")).toBe("2026-10-18");
    expect(calculateDueDate("2026-10-15", "  Next Week  ")).toBe("2026-10-22");
  });
});

describe("validateReminderSource", () => {
  it("allows confirmed events", () => {
    expect(() => validateReminderSource("confirmed")).not.toThrow();
  });

  it("allows corrected events", () => {
    expect(() => validateReminderSource("corrected")).not.toThrow();
  });

  it("rejects incomplete events", () => {
    expect(() => validateReminderSource("incomplete")).toThrow(ReminderError);
  });

  it("rejects proposed events", () => {
    expect(() => validateReminderSource("proposed")).toThrow(ReminderError);
  });

  it("rejects rejected events", () => {
    expect(() => validateReminderSource("rejected")).toThrow(ReminderError);
  });
});
