"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { farmEventSchema } from "@/src/domain/farm-event";

const savedFarmEventSchema = farmEventSchema.extend({
  id: z.uuid(),
  savedBy: z.enum(["agent", "farmer"]),
});

const changeSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

const pendingSchema = z.object({
  kind: z.enum(["clarification", "duplicate"]),
  originalMessage: z.string(),
  clarifications: z.array(
    z.object({ question: z.string(), answer: z.string() }),
  ),
});

const agentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("recorded"), event: savedFarmEventSchema }),
  z.object({
    type: z.literal("corrected"),
    event: savedFarmEventSchema,
    changes: z.array(changeSchema),
  }),
  z.object({ type: z.literal("deleted"), event: savedFarmEventSchema }),
  z.object({
    type: z.literal("question"),
    text: z.string(),
    pending: pendingSchema,
  }),
  z.object({ type: z.literal("reply"), text: z.string() }),
]);

const agentResponseSchema = z.object({ actions: z.array(agentActionSchema) });

export type SavedFarmEvent = z.infer<typeof savedFarmEventSchema>;
export type Pending = z.infer<typeof pendingSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type UndoableAgentAction = Extract<
  AgentAction,
  { type: "recorded" | "corrected" | "deleted" }
>;

export type FeedItem =
  | { id: string; kind: "farmer"; text: string }
  | {
      id: string;
      kind: "action";
      action: AgentAction;
      undone: boolean;
      undoing: boolean;
    };

function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function isUndoable(action: AgentAction): action is UndoableAgentAction {
  return (
    action.type === "recorded" ||
    action.type === "corrected" ||
    action.type === "deleted"
  );
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    )
      return body.error;
  } catch {
    // fall through to the generic message
  }
  return "FarmMind could not process that message. Please try again.";
}

export function useFarmAgent() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [lastQuestionText, setLastQuestionText] = useState<string | undefined>(
    undefined,
  );
  const [recentEventIds, setRecentEventIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedFarmEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error("Farm history could not be loaded.");
      const body: unknown = await response.json();
      const parsed = z
        .object({ events: z.array(savedFarmEventSchema) })
        .safeParse(body);
      if (!parsed.success)
        throw new Error("Farm history returned invalid data.");
      setHistory(parsed.data.events);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Farm history could not be loaded.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isLoading) return;

      setFeed((prev) => [
        ...prev,
        { id: newId(), kind: "farmer", text: trimmed },
      ]);
      setIsLoading(true);
      setError(null);

      const pendingToSend: Pending | undefined =
        pending?.kind === "clarification"
          ? {
              ...pending,
              clarifications: [
                ...pending.clarifications,
                { question: lastQuestionText ?? "", answer: trimmed },
              ],
            }
          : pending;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            currentDate: getLocalDateString(),
            pending: pendingToSend,
            recentEventIds,
          }),
        });

        if (!response.ok) throw new Error(await readErrorMessage(response));

        const body: unknown = await response.json();
        const parsed = agentResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("FarmMind returned invalid data.");

        const actions = parsed.data.actions;
        setFeed((prev) => [
          ...prev,
          ...actions.map((action) => ({
            id: newId(),
            kind: "action" as const,
            action,
            undone: false,
            undoing: false,
          })),
        ]);

        const question = actions.find((action) => action.type === "question");
        if (question?.type === "question") {
          setPending(question.pending);
          setLastQuestionText(question.text);
        } else {
          setPending(undefined);
          setLastQuestionText(undefined);
        }

        const savedIds = actions.filter(isUndoable).map((a) => a.event.id);
        if (savedIds.length > 0) {
          setRecentEventIds((prev) =>
            [...savedIds, ...prev.filter((id) => !savedIds.includes(id))].slice(
              0,
              20,
            ),
          );
        }

        if (actions.some((action) => action.type !== "question")) {
          await refreshHistory();
        }
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Something went wrong. Please try again.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, pending, lastQuestionText, recentEventIds, refreshHistory],
  );

  const undo = useCallback(
    async (itemId: string, action: UndoableAgentAction) => {
      setFeed((prev) =>
        prev.map((item) =>
          item.id === itemId && item.kind === "action"
            ? { ...item, undoing: true }
            : item,
        ),
      );
      try {
        const response = await fetch(`/api/events/${action.event.id}/undo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: action.type }),
        });
        if (!response.ok) throw new Error(await readErrorMessage(response));
        setFeed((prev) =>
          prev.map((item) =>
            item.id === itemId && item.kind === "action"
              ? { ...item, undone: true, undoing: false }
              : item,
          ),
        );
        setRecentEventIds((prev) =>
          prev.filter((id) => id !== action.event.id),
        );
        await refreshHistory();
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Could not undo that action.",
        );
        setFeed((prev) =>
          prev.map((item) =>
            item.id === itemId && item.kind === "action"
              ? { ...item, undoing: false }
              : item,
          ),
        );
      }
    },
    [refreshHistory],
  );

  return {
    feed,
    pending,
    lastQuestionText,
    isLoading,
    error,
    history,
    historyLoading,
    sendMessage,
    undo,
  };
}
