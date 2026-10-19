import { describe, expect, it } from "vitest";
import { buildGreeting } from "../app/lib/greeting";

// Local time, so the tests do not depend on the machine's timezone.
const at = (hour: number) => new Date(2026, 9, 17, hour, 0);

const weeding = {
  activity: "weeding",
  crop: null,
  field: "North Field",
  eventDate: "2026-10-15",
};

describe("buildGreeting", () => {
  it("greets a farm with no records and invites the first one", () => {
    expect(buildGreeting("River Farm", null, at(8))).toBe(
      "Good morning! I'm Tilly. Tell me what happened on River Farm today, in your own words, and I'll keep the record.",
    );
  });

  it("mentions the last record for a returning farmer", () => {
    expect(buildGreeting("River Farm", weeding, at(14))).toBe(
      "Good afternoon! The last thing you recorded on River Farm was weeding in North Field on 15 Oct. What did you do today?",
    );
  });

  it("says today and yesterday instead of a date", () => {
    expect(
      buildGreeting(
        "River Farm",
        { ...weeding, eventDate: "2026-10-17" },
        at(19),
      ),
    ).toContain("weeding in North Field today.");
    expect(
      buildGreeting(
        "River Farm",
        { ...weeding, eventDate: "2026-10-16" },
        at(19),
      ),
    ).toContain("weeding in North Field yesterday.");
  });

  it("follows the farmer's time of day", () => {
    expect(buildGreeting("River Farm", null, at(3))).toMatch(/^Hello!/);
    expect(buildGreeting("River Farm", null, at(11))).toMatch(/^Good morning!/);
    expect(buildGreeting("River Farm", null, at(16))).toMatch(
      /^Good afternoon!/,
    );
    expect(buildGreeting("River Farm", null, at(20))).toMatch(/^Good evening!/);
  });

  it("names the crop only where it reads naturally", () => {
    expect(
      buildGreeting(
        "River Farm",
        {
          activity: "planting",
          crop: "maize",
          field: "Back Field",
          eventDate: null,
        },
        at(9),
      ),
    ).toContain("was planting maize in Back Field.");
    expect(
      buildGreeting(
        "River Farm",
        { activity: "inspection", crop: "maize", field: null, eventDate: null },
        at(9),
      ),
    ).toContain("was an inspection.");
  });

  it("does not put the default farm name in a sentence", () => {
    expect(buildGreeting("My Farm", null, at(9))).toContain(
      "on your farm today",
    );
    expect(buildGreeting("My Farm", weeding, at(9))).toContain(
      "recorded on your farm was",
    );
  });

  it("describes an 'other' activity in words", () => {
    expect(
      buildGreeting(
        "River Farm",
        { activity: "other", crop: null, field: null, eventDate: null },
        at(9),
      ),
    ).toContain("was a farm activity.");
  });
});
