import { describe, expect, it } from "vitest";
import type {
  AgentAction,
  FeedItem,
  SavedFarmEvent,
} from "../app/hooks/useFarmAgent";
import { latestReply, speakable, spokenText } from "../app/lib/spoken-reply";

const spraying = {
  id: "00000000-0000-4000-8000-000000000001",
  activity: "spraying",
  crop: "tomatoes",
  field: null,
  eventDate: "2026-10-30",
  dateAssumed: true,
  eventTime: null,
  timeOfDay: "morning",
  missingFields: ["field"],
  savedBy: "agent",
} as unknown as SavedFarmEvent;

let nextId = 0;
const farmer = (text: string): FeedItem => ({
  id: `f${++nextId}`,
  at: 0,
  kind: "farmer",
  text,
});
const agent = (action: AgentAction, undone = false): FeedItem => ({
  id: `a${++nextId}`,
  at: 0,
  kind: "action",
  action,
  undone,
  undoing: false,
});

describe("speakable", () => {
  it("turns receipt symbols into words and drops emoji", () => {
    expect(
      speakable("✓ Corrected: spraying · field nothing → North Field"),
    ).toBe("Corrected: spraying, field nothing to North Field");
    expect(speakable("📅 Reminder set")).toBe("Reminder set");
  });
});

describe("spokenText", () => {
  it("reads a receipt the way the screen shows it", () => {
    expect(spokenText({ type: "recorded", event: spraying })).toBe(
      "Recorded: spraying, today, morning (field not given)",
    );
  });

  it("says the text of replies, questions and answers", () => {
    expect(spokenText({ type: "reply", text: "You're welcome!" })).toBe(
      "You're welcome!",
    );
    expect(
      spokenText({ type: "answer", text: "On 20 Oct.", citedRecords: [] }),
    ).toBe("On 20 Oct.");
  });

  it("counts reminders and reads only the first few", () => {
    const reminder = (id: string, activity: string) => ({
      id,
      activity,
      field: null,
      crop: null,
      date: "2026-11-02",
    });
    expect(spokenText({ type: "reminders-list", reminders: [] })).toBe(
      "You have no upcoming reminders.",
    );
    expect(
      spokenText({
        type: "reminders-list",
        reminders: [
          reminder("1", "weeding"),
          reminder("2", "spraying"),
          reminder("3", "harvest"),
          reminder("4", "planting"),
        ],
      }),
    ).toBe(
      "You have 4 upcoming reminders: 2 Nov weeding; 2 Nov spraying; 2 Nov harvest. And 1 more.",
    );
  });
});

describe("latestReply", () => {
  it("waits while the farmer's message has no reply yet", () => {
    expect(latestReply([])).toBeNull();
    expect(latestReply([farmer("I sprayed")])).toBeNull();
  });

  it("joins everything Tilly said since the farmer's latest message", () => {
    const first = agent({ type: "reply", text: "Old reply." });
    const receipt = agent({ type: "recorded", event: spraying });
    const tip = agent({ type: "reply", text: "Want a reminder?" });
    const reply = latestReply([
      farmer("hi"),
      first,
      farmer("I sprayed the tomatoes"),
      receipt,
      tip,
    ]);
    expect(reply).toEqual({
      key: tip.id,
      text: "Recorded: spraying, today, morning (field not given) Want a reminder?",
    });
  });

  it("says why a message failed, and skips undone records", () => {
    const failed: FeedItem = {
      id: "x1",
      at: 0,
      kind: "failed",
      text: "I sprayed",
      error: "Tilly is not reachable right now.",
      request: {
        message: "I sprayed",
        currentDate: "2026-10-30",
        recentEventIds: [],
      },
      retryable: true,
      attempts: 0,
      retrying: false,
      nextRetryAt: 0,
    };
    expect(latestReply([farmer("I sprayed"), failed])?.text).toBe(
      "Tilly is not reachable right now.",
    );
    expect(
      latestReply([
        farmer("I sprayed"),
        agent({ type: "recorded", event: spraying }, true),
      ]),
    ).toBeNull();
  });
});
