import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import {
  generateSuggestions,
  generateDailyBriefing,
} from "../src/application/farm-insights";
import { recordAgentEvent } from "../src/application/persist-farm-event";
import type { FarmEvent } from "../src/domain/farm-event";
import * as schema from "../src/infrastructure/db/schema";
import { createTestFarm } from "./test-helpers";

const migrationFolder = "drizzle";

function testEvent(overrides: Partial<FarmEvent> = {}): FarmEvent {
  return {
    activity: "weeding",
    crop: null,
    field: "Test Field",
    eventDate: "2026-10-01",
    quantity: null,
    unit: null,
    status: "confirmed",
    missingFields: [],
    sourceText: "test event",
    ...overrides,
  };
}

describe("Smart Suggestions", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let farmId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
    farmId = await createTestFarm(db);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  describe("Gap detection", () => {
    it("suggests weeding for field not weeded in 14+ days", async () => {
      const currentDate = "2026-10-16";
      const oldDate = "2026-10-01"; // 15 days ago

      const event = testEvent({
        activity: "weeding",
        field: "North Field",
        eventDate: oldDate,
        sourceText: "weeded north field",
      });

      await recordAgentEvent(db, farmId, {
        final: event,
        currentDate: oldDate,
      });

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      expect(suggestions.length).toBeGreaterThan(0);
      const gapSuggestion = suggestions.find(
        (s) =>
          s.type === "gap" &&
          s.relatedActivity === "weeding" &&
          s.relatedField === "North Field",
      );
      expect(gapSuggestion).toBeDefined();
      expect(gapSuggestion?.confidence).toBe("medium");
      expect(gapSuggestion?.text).toContain("15 days ago");
    });

    it("suggests with high confidence for field not weeded in 21+ days", async () => {
      const currentDate = "2026-10-16";
      const oldDate = "2026-09-24"; // 22 days ago

      const event = testEvent({
        activity: "weeding",
        crop: "maize",
        field: "North Field",
        eventDate: oldDate,
        sourceText: "weeded north field",
      });

      await recordAgentEvent(db, farmId, {
        final: event,
        currentDate: oldDate,
      });

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const gapSuggestion = suggestions.find(
        (s) =>
          s.type === "gap" &&
          s.relatedActivity === "weeding" &&
          s.relatedField === "North Field",
      );
      expect(gapSuggestion).toBeDefined();
      expect(gapSuggestion?.confidence).toBe("high");
    });

    it("does not suggest for field weeded recently", async () => {
      const currentDate = "2026-10-16";
      const recentDate = "2026-10-10"; // 6 days ago

      const event = testEvent({
        activity: "weeding",
        crop: "maize",
        field: "North Field",
        eventDate: recentDate,
        sourceText: "weeded north field",
      });

      await recordAgentEvent(db, farmId, {
        final: event,
        currentDate: recentDate,
      });

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const gapSuggestion = suggestions.find(
        (s) =>
          s.type === "gap" &&
          s.relatedActivity === "weeding" &&
          s.relatedField === "North Field",
      );
      expect(gapSuggestion).toBeUndefined();
    });

    it("ignores deleted events in gap detection", async () => {
      const currentDate = "2026-10-16";
      const oldDate = "2026-10-01"; // 15 days ago

      const event = testEvent({
        activity: "weeding",
        crop: "maize",
        field: "North Field",
        eventDate: oldDate,
        sourceText: "weeded north field",
      });

      const { event: saved } = await recordAgentEvent(db, farmId, {
        final: event,
        currentDate: oldDate,
      });

      // Soft delete the event
      await db
        .update(schema.farmEvents)
        .set({ deletedAt: new Date() })
        .where(eq(schema.farmEvents.id, saved.id));

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const gapSuggestion = suggestions.find(
        (s) => s.type === "gap" && s.relatedField === "North Field",
      );
      expect(gapSuggestion).toBeUndefined();
    });
  });

  describe("Pattern recognition", () => {
    it("detects recurring activities (same activity + field, 3+ times)", async () => {
      const dates = ["2026-09-01", "2026-09-15", "2026-09-29"];

      for (const date of dates) {
        const event = testEvent({
          activity: "weeding",
          crop: "maize",
          field: "North Field",
          eventDate: date,
          sourceText: "weeded north field",
        });
        await recordAgentEvent(db, farmId, { final: event, currentDate: date });
      }

      const currentDate = "2026-10-13"; // 14 days after last weeding
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const patternSuggestion = suggestions.find(
        (s) =>
          s.type === "pattern" &&
          s.relatedActivity === "weeding" &&
          s.relatedField === "North Field",
      );
      expect(patternSuggestion).toBeDefined();
      expect(patternSuggestion?.text).toContain("every");
      expect(patternSuggestion?.text).toContain("days");
    });

    it("calculates typical interval between occurrences", async () => {
      // Pattern: every 10 days
      const dates = ["2026-09-01", "2026-09-11", "2026-09-21", "2026-10-01"];

      for (const date of dates) {
        const event = testEvent({
          activity: "fertilizing",
          crop: "tomatoes",
          field: "Greenhouse",
          eventDate: date,
          sourceText: "fertilized greenhouse",
        });
        await recordAgentEvent(db, farmId, { final: event, currentDate: date });
      }

      const currentDate = "2026-10-09"; // 8 days after last, approaching 10
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const patternSuggestion = suggestions.find((s) => s.type === "pattern");
      expect(patternSuggestion).toBeDefined();
      expect(patternSuggestion?.text).toMatch(/every (9|10|11) days/);
    });

    it("suggests when current gap approaches typical interval", async () => {
      const dates = ["2026-09-01", "2026-09-15", "2026-09-29"];

      for (const date of dates) {
        const event = testEvent({
          activity: "irrigation",
          field: "Greenhouse",
          eventDate: date,
          sourceText: "watered greenhouse",
        });
        await recordAgentEvent(db, farmId, { final: event, currentDate: date });
      }

      // 11 days after last watering (interval is ~14 days, 11/14 = 78%, below 80%)
      const tooEarly = "2026-10-10";
      let suggestions = await generateSuggestions(db, farmId, tooEarly);
      let patternSuggestion = suggestions.find(
        (s) => s.type === "pattern" && s.relatedActivity === "irrigation",
      );
      expect(patternSuggestion).toBeUndefined();

      // 12 days after last watering (12/14 = 85%, above 80%)
      const justRight = "2026-10-11";
      suggestions = await generateSuggestions(db, farmId, justRight);
      patternSuggestion = suggestions.find(
        (s) => s.type === "pattern" && s.relatedActivity === "irrigation",
      );
      expect(patternSuggestion).toBeDefined();
      expect(patternSuggestion?.confidence).toBe("medium");

      // 15 days after (beyond typical interval)
      const overdue = "2026-10-14";
      suggestions = await generateSuggestions(db, farmId, overdue);
      patternSuggestion = suggestions.find(
        (s) => s.type === "pattern" && s.relatedActivity === "irrigation",
      );
      expect(patternSuggestion).toBeDefined();
      expect(patternSuggestion?.confidence).toBe("high");
    });

    it("does not suggest for one-off activities", async () => {
      const event = testEvent({
        activity: "planting",
        crop: "maize",
        field: "North Field",
        eventDate: "2026-09-01",
        sourceText: "planted maize",
      });

      await recordAgentEvent(db, farmId, {
        final: event,
        currentDate: "2026-09-01",
      });

      const currentDate = "2026-10-16";
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const patternSuggestion = suggestions.find(
        (s) => s.type === "pattern" && s.relatedActivity === "planting",
      );
      expect(patternSuggestion).toBeUndefined();
    });
  });

  describe("Follow-up detection", () => {
    it("detects spray → weed pattern when it happens 2+ times", async () => {
      // First cycle: spray then weed 3 days later
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "South Field",
          eventDate: "2026-09-01",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-01",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "South Field",
          eventDate: "2026-09-04",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-04",
      });

      // Second cycle
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "South Field",
          eventDate: "2026-09-15",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-15",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "South Field",
          eventDate: "2026-09-18",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-18",
      });

      // Third spray without follow-up weeding yet
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "South Field",
          eventDate: "2026-10-01",
          sourceText: "sprayed",
        }),
        currentDate: "2026-10-01",
      });

      const currentDate = "2026-10-03"; // 2 days after spraying
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      const followUpSuggestion = suggestions.find(
        (s) =>
          s.type === "follow-up" &&
          s.relatedActivity === "weeding" &&
          s.relatedField === "South Field",
      );
      expect(followUpSuggestion).toBeDefined();
      expect(followUpSuggestion?.text).toContain("usually");
      expect(followUpSuggestion?.text).toContain("after spraying");
    });

    it("suggests weeding 2-7 days after spraying if pattern exists", async () => {
      // Establish pattern
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "West Field",
          eventDate: "2026-09-01",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-01",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "West Field",
          eventDate: "2026-09-05",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-05",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "West Field",
          eventDate: "2026-09-20",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-20",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "West Field",
          eventDate: "2026-09-24",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-24",
      });

      // Recent spray
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "West Field",
          eventDate: "2026-10-10",
          sourceText: "sprayed",
        }),
        currentDate: "2026-10-10",
      });

      // Too early (1 day)
      let suggestions = await generateSuggestions(db, farmId, "2026-10-11");
      let followUp = suggestions.find((s) => s.type === "follow-up");
      expect(followUp).toBeUndefined();

      // Within window (4 days)
      suggestions = await generateSuggestions(db, farmId, "2026-10-14");
      followUp = suggestions.find((s) => s.type === "follow-up");
      expect(followUp).toBeDefined();

      // Still in window (7 days)
      suggestions = await generateSuggestions(db, farmId, "2026-10-17");
      followUp = suggestions.find((s) => s.type === "follow-up");
      expect(followUp).toBeDefined();

      // Too late (8 days)
      suggestions = await generateSuggestions(db, farmId, "2026-10-18");
      followUp = suggestions.find((s) => s.type === "follow-up");
      expect(followUp).toBeUndefined();
    });

    it("does not suggest if already weeded after spraying", async () => {
      // Establish pattern
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "East Field",
          eventDate: "2026-09-01",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-01",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "East Field",
          eventDate: "2026-09-04",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-04",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "East Field",
          eventDate: "2026-09-20",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-20",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "East Field",
          eventDate: "2026-09-23",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-23",
      });

      // Recent spray and weed
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "East Field",
          eventDate: "2026-10-10",
          sourceText: "sprayed",
        }),
        currentDate: "2026-10-10",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "East Field",
          eventDate: "2026-10-13",
          sourceText: "weeded",
        }),
        currentDate: "2026-10-13",
      });

      const suggestions = await generateSuggestions(db, farmId, "2026-10-15");

      const followUp = suggestions.find(
        (s) => s.type === "follow-up" && s.relatedField === "East Field",
      );
      expect(followUp).toBeUndefined();
    });

    it("requires same field for follow-up", async () => {
      // Spray one field, weed another - no pattern
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "Field A",
          eventDate: "2026-09-01",
          sourceText: "sprayed",
        }),
        currentDate: "2026-09-01",
      });
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "Field B",
          eventDate: "2026-09-04",
          sourceText: "weeded",
        }),
        currentDate: "2026-09-04",
      });

      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "spraying",
          field: "Field A",
          eventDate: "2026-10-10",
          sourceText: "sprayed",
        }),
        currentDate: "2026-10-10",
      });

      const suggestions = await generateSuggestions(db, farmId, "2026-10-13");

      const followUp = suggestions.find((s) => s.type === "follow-up");
      expect(followUp).toBeUndefined();
    });
  });

  describe("Suggestion limits", () => {
    it("returns at most 3 suggestions", async () => {
      const currentDate = "2026-10-16";

      // Create many old weeding events (potential gap suggestions)
      const fields = [
        "Field 1",
        "Field 2",
        "Field 3",
        "Field 4",
        "Field 5",
        "Field 6",
      ];
      for (const field of fields) {
        await recordAgentEvent(db, farmId, {
          final: testEvent({
            activity: "weeding",
            field,
            eventDate: "2026-09-01", // 45 days ago
            sourceText: "weeded",
          }),
          currentDate: "2026-09-01",
        });
      }

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it("sorts by confidence (high, medium, low)", async () => {
      const currentDate = "2026-10-16";

      // High confidence gap (30 days)
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "High Priority Field",
          eventDate: "2026-09-16", // 30 days
          sourceText: "weeded",
        }),
        currentDate: "2026-09-16",
      });

      // Medium confidence gap (15 days)
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "Medium Priority Field",
          eventDate: "2026-10-01", // 15 days
          sourceText: "weeded",
        }),
        currentDate: "2026-10-01",
      });

      const suggestions = await generateSuggestions(db, farmId, currentDate);

      if (suggestions.length >= 2) {
        const confidenceOrder = ["high", "medium", "low"];
        for (let i = 0; i < suggestions.length - 1; i++) {
          const current = confidenceOrder.indexOf(suggestions[i]!.confidence);
          const next = confidenceOrder.indexOf(suggestions[i + 1]!.confidence);
          expect(current).toBeLessThanOrEqual(next);
        }
      }
    });

    it("handles empty event history gracefully", async () => {
      const currentDate = "2026-10-16";
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      expect(suggestions).toEqual([]);
    });
  });

  describe("Date handling", () => {
    it("uses currentDate parameter consistently", async () => {
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "Test Field",
          eventDate: "2026-10-01",
          sourceText: "weeded",
        }),
        currentDate: "2026-10-01",
      });

      // Same gap calculated differently with different current dates
      const suggestions1 = await generateSuggestions(db, farmId, "2026-10-10");
      const suggestions2 = await generateSuggestions(db, farmId, "2026-10-20");

      // First check: 9 days, no suggestion expected
      expect(
        suggestions1.find((s) => s.relatedField === "Test Field"),
      ).toBeUndefined();

      // Second check: 19 days, suggestion expected
      expect(
        suggestions2.find((s) => s.relatedField === "Test Field"),
      ).toBeDefined();
    });

    it("handles null eventDate fields safely", async () => {
      // Insert event with null eventDate directly using drizzle
      await db.insert(schema.farmEvents).values({
        farmId,
        activity: "weeding",
        fieldName: "Null Date Field",
        eventDate: null,
        status: "confirmed",
        sourceText: "weeded",
        savedBy: "agent",
        missingFields: [],
        crop: null,
        quantity: null,
        unit: null,
      });

      const currentDate = "2026-10-16";
      const suggestions = await generateSuggestions(db, farmId, currentDate);

      // Should not crash, and null-date events should be ignored
      expect(suggestions).toBeDefined();
    });

    it("calculates day differences correctly", async () => {
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity: "weeding",
          field: "Date Test Field",
          eventDate: "2026-10-01",
          sourceText: "weeded",
        }),
        currentDate: "2026-10-01",
      });

      const suggestions = await generateSuggestions(db, farmId, "2026-10-16");

      const gapSuggestion = suggestions.find(
        (s) => s.relatedField === "Date Test Field",
      );
      expect(gapSuggestion?.text).toContain("15 days ago");
    });
  });
});

describe("Daily Briefing", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let farmId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationFolder });
  }, 180000);

  beforeEach(async () => {
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
    farmId = await createTestFarm(db);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("includes yesterday's activities in summary", async () => {
    const yesterday = "2026-10-15";
    const today = "2026-10-16";

    await recordAgentEvent(db, farmId, {
      final: testEvent({
        activity: "weeding",
        field: "North Field",
        eventDate: yesterday,
        sourceText: "weeded",
      }),
      currentDate: yesterday,
    });
    await recordAgentEvent(db, farmId, {
      final: testEvent({
        activity: "spraying",
        field: "South Field",
        eventDate: yesterday,
        sourceText: "sprayed",
      }),
      currentDate: yesterday,
    });

    const briefing = await generateDailyBriefing(db, farmId, today);

    expect(briefing).toContain("Yesterday:");
    expect(briefing).toContain("weeding");
    expect(briefing).toContain("North Field");
    expect(briefing).toContain("spraying");
    expect(briefing).toContain("South Field");
  });

  it("starts with welcome message when no yesterday activities", async () => {
    const today = "2026-10-16";
    const briefing = await generateDailyBriefing(db, farmId, today);

    // When no activities and no suggestions, should give welcome message
    expect(briefing).toBe("Welcome back! Tell me what happened on the farm.");
  });

  it("includes high-priority suggestion", async () => {
    const oldDate = "2026-09-24"; // 22 days ago
    const today = "2026-10-16";

    await recordAgentEvent(db, farmId, {
      final: testEvent({
        activity: "weeding",
        field: "Priority Field",
        eventDate: oldDate,
        sourceText: "weeded",
      }),
      currentDate: oldDate,
    });

    const briefing = await generateDailyBriefing(db, farmId, today);

    expect(briefing).toContain("Priority Field");
    expect(briefing).toContain("22 days ago");
  });

  it("says everything's up to date when no suggestions", async () => {
    const yesterday = "2026-10-15";
    const today = "2026-10-16";

    await recordAgentEvent(db, farmId, {
      final: testEvent({
        activity: "weeding",
        field: "North Field",
        eventDate: yesterday,
        sourceText: "weeded",
      }),
      currentDate: yesterday,
    });

    const briefing = await generateDailyBriefing(db, farmId, today);

    expect(briefing).toContain("Everything's up to date");
  });

  it("handles deleted events correctly (excludes them)", async () => {
    const yesterday = "2026-10-15";
    const today = "2026-10-16";

    const { event: saved } = await recordAgentEvent(db, farmId, {
      final: testEvent({
        activity: "weeding",
        field: "Deleted Field",
        eventDate: yesterday,
        sourceText: "weeded",
      }),
      currentDate: yesterday,
    });

    // Soft delete
    await db
      .update(schema.farmEvents)
      .set({ deletedAt: new Date() })
      .where(eq(schema.farmEvents.id, saved.id));

    const briefing = await generateDailyBriefing(db, farmId, today);

    expect(briefing).not.toContain("Deleted Field");
    expect(briefing).not.toContain("weeding");
  });

  it("formats multiple activities correctly", async () => {
    const yesterday = "2026-10-15";
    const today = "2026-10-16";

    const activities = [
      { activity: "weeding" as const, field: "Field A" },
      { activity: "spraying" as const, field: "Field B" },
      { activity: "fertilizing" as const, field: "Field C" },
    ];

    for (const { activity, field } of activities) {
      await recordAgentEvent(db, farmId, {
        final: testEvent({
          activity,
          field,
          eventDate: yesterday,
          sourceText: activity,
        }),
        currentDate: yesterday,
      });
    }

    const briefing = await generateDailyBriefing(db, farmId, today);

    expect(briefing).toContain("Yesterday:");
    expect(briefing).toContain(","); // Multiple activities separated by commas
  });
});
