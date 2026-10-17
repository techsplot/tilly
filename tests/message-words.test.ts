import { describe, expect, it } from "vitest";
import {
  mentionedActivities,
  namesAnotherActivity,
} from "../src/domain/activity-words";
import { resolveWeekdayDate } from "../src/domain/weekday-date";

describe("resolveWeekdayDate", () => {
  // 2026-10-17 is a Saturday.
  const saturday = "2026-10-17";

  it.each([
    ["I planted maize on Monday", "2026-10-12"],
    ["weeded the back field on friday", "2026-10-16"],
    ["sprayed last Tuesday", "2026-10-13"],
    ["I harvested on Saturday", "2026-10-17"],
    ["I harvested last Saturday", "2026-10-10"],
    ["Sunday I irrigated", "2026-10-11"],
  ])("%j is %s", (message, date) => {
    expect(resolveWeekdayDate(message, saturday)).toBe(date);
  });

  it.each([
    "I planted maize yesterday",
    "plant on next Monday",
    "I weeded Monday and sprayed Tuesday",
    "Mondays are busy",
  ])("leaves %j to other rules", (message) => {
    expect(resolveWeekdayDate(message, saturday)).toBeNull();
  });

  it("works across a month boundary", () => {
    expect(resolveWeekdayDate("planted on Friday", "2026-11-02")).toBe(
      "2026-10-30",
    );
  });
});

describe("activity words", () => {
  it("finds the activities a message names", () => {
    expect(
      [...mentionedActivities("I weeded and then sprayed")].sort(),
    ).toEqual(["spraying", "weeding"]);
    expect(mentionedActivities("watered the tomatoes").has("irrigation")).toBe(
      true,
    );
    expect(mentionedActivities("maize").size).toBe(0);
  });

  it("spots a new activity in a reply to a question", () => {
    expect(
      namesAnotherActivity("I sprayed", "weeding", "I weeded the north field"),
    ).toBe(true);
  });

  it("does not treat an answer as a new activity", () => {
    expect(namesAnotherActivity("maize", "weeding", "I weeded")).toBe(false);
    expect(
      namesAnotherActivity("weeded the north one", "weeding", "I weeded"),
    ).toBe(false);
    // Already part of the original note.
    expect(
      namesAnotherActivity("the back field", "weeding", "I weeded and sprayed"),
    ).toBe(false);
  });
});
