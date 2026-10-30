import { describe, expect, it } from "vitest";
import type { FeedItem, SavedFarmEvent } from "../app/hooks/useFarmAgent";
import { recentConversation } from "../app/lib/conversation";
import {
  conversationSchema,
  keepConversationValue,
  type ConversationTurn,
} from "../src/domain/conversation";
import type { FarmMemory } from "../src/domain/farm-memory";

const memory: FarmMemory = {
  fields: [{ id: "f1", name: "North Field" }],
  recentEvents: [
    {
      id: "e1",
      activity: "weeding",
      crop: "cassava",
      field: "North Field",
      eventDate: "2026-10-29",
    },
  ],
};

const chat: ConversationTurn[] = [
  { from: "farmer", text: "I planted maize in the river plot" },
  {
    from: "tilly",
    text: "Recorded: weeding, cassava, North Field. Which field: Hill Farm or North Field?",
  },
];

describe("keepConversationValue", () => {
  it("keeps what the farmer says now, whatever the chat holds", () => {
    expect(
      keepConversationValue(
        "field",
        "Hill Farm",
        "sprayed hill farm",
        chat,
        memory,
      ),
    ).toBe("Hill Farm");
  });

  it("keeps a value the farmer said in an earlier turn", () => {
    expect(
      keepConversationValue("crop", "maize", "same crop again", chat, memory),
    ).toBe("maize");
  });

  it("keeps a real field or crop Tilly named in a receipt", () => {
    expect(
      keepConversationValue("field", "North Field", "there too", chat, memory),
    ).toBe("North Field");
    expect(
      keepConversationValue("crop", "cassava", "that crop", chat, memory),
    ).toBe("cassava");
  });

  it("drops a new name only Tilly ever said", () => {
    expect(
      keepConversationValue("field", "Hill Farm", "there too", chat, memory),
    ).toBeNull();
  });

  it("changes nothing without a conversation", () => {
    expect(
      keepConversationValue("field", "Hill Farm", "there too", [], memory),
    ).toBe("Hill Farm");
  });

  it("matches whole words, not parts of words", () => {
    expect(
      keepConversationValue(
        "crop",
        "corn",
        "same again",
        [{ from: "tilly", text: "Popcorn is a snack." }],
        memory,
      ),
    ).toBe("corn");
  });
});

describe("conversationSchema", () => {
  it("accepts up to six short turns and rejects more", () => {
    const turn = { from: "farmer", text: "hi" };
    expect(conversationSchema.safeParse(Array(6).fill(turn)).success).toBe(
      true,
    );
    expect(conversationSchema.safeParse(Array(7).fill(turn)).success).toBe(
      false,
    );
    expect(
      conversationSchema.safeParse([{ from: "farmer", text: "x".repeat(301) }])
        .success,
    ).toBe(false);
    expect(
      conversationSchema.safeParse([{ from: "system", text: "hi" }]).success,
    ).toBe(false);
  });
});

describe("recentConversation", () => {
  const weeding = {
    id: "00000000-0000-4000-8000-000000000001",
    activity: "weeding",
    crop: "cassava",
    field: "North Field",
    eventDate: "2026-10-29",
    dateAssumed: false,
    eventTime: null,
    timeOfDay: null,
    missingFields: [],
    savedBy: "agent",
  } as unknown as SavedFarmEvent;

  let id = 0;
  const farmer = (text: string): FeedItem => ({
    id: `${++id}`,
    at: 0,
    kind: "farmer",
    text,
  });
  const tilly = (
    action: Extract<FeedItem, { kind: "action" }>["action"],
    undone = false,
  ): FeedItem => ({
    id: `${++id}`,
    at: 0,
    kind: "action",
    action,
    undone,
    undoing: false,
  });

  it("turns the chat into plain turns, joining Tilly's actions in a row", () => {
    expect(
      recentConversation([
        farmer("I weeded the cassava"),
        tilly({ type: "recorded", event: weeding }),
        tilly({ type: "reply", text: "Want a reminder?" }),
      ]),
    ).toEqual([
      { from: "farmer", text: "I weeded the cassava" },
      {
        from: "tilly",
        text: "Recorded: weeding, cassava, North Field, 29 Oct Want a reminder?",
      },
    ]);
  });

  it("leaves out undone records and keeps only the last six turns", () => {
    const feed: FeedItem[] = [];
    for (let turn = 1; turn <= 5; turn += 1) {
      feed.push(farmer(`note ${turn}`));
      feed.push(tilly({ type: "reply", text: `reply ${turn}` }));
    }
    feed.push(
      farmer("undo me"),
      tilly({ type: "recorded", event: weeding }, true),
    );
    const turns = recentConversation(feed);
    expect(turns).toHaveLength(6);
    expect(turns[0]).toEqual({ from: "tilly", text: "reply 3" });
    expect(turns.at(-1)).toEqual({ from: "farmer", text: "undo me" });
  });

  it("clips a long turn to fit the request limit", () => {
    const [turn] = recentConversation([farmer("x".repeat(500))]);
    expect(turn!.text).toHaveLength(300);
    expect(turn!.text.endsWith("…")).toBe(true);
  });
});
