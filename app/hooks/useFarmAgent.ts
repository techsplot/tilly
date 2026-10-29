"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// Mirrors the server's PendingEvent exactly; the browser sends it back
// unchanged, never touching it (finding 2).
const pendingEventSchema = z.object({
  activity: z.string(),
  crop: z.string().nullable(),
  field: z.string().nullable(),
  eventDate: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  eventTime: z.string().nullable(),
  timeOfDay: z.string().nullable(),
  sourceText: z.string(),
  memoryEventIds: z.array(z.string()),
  unresolvedReferences: z.array(z.string()),
});

const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clarification"),
    originalMessage: z.string(),
    event: pendingEventSchema,
    question: z.string(),
    clarifications: z.array(
      z.object({ question: z.string(), answer: z.string() }),
    ),
  }),
  z.object({ kind: z.literal("gap"), eventId: z.string() }),
  z.object({ kind: z.literal("correction"), eventId: z.string() }),
]);

const citedRecordSchema = z.object({
  id: z.string(),
  activity: z.string(),
  crop: z.string().nullable(),
  field: z.string().nullable(),
  eventDate: z.string().nullable(),
  eventTime: z.string().nullable(),
  timeOfDay: z.string().nullable(),
});

const suggestionSchema = z.object({
  type: z.enum(["gap", "pattern", "follow-up"]),
  text: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recorded"),
    event: savedFarmEventSchema,
    possibleDuplicate: z.boolean().optional(),
    suggestions: z.array(suggestionSchema).optional(),
  }),
  z.object({
    type: z.literal("corrected"),
    event: savedFarmEventSchema,
    changes: z.array(changeSchema),
    correctionId: z.string().nullable(),
  }),
  z.object({ type: z.literal("deleted"), event: savedFarmEventSchema }),
  z.object({
    type: z.literal("question"),
    text: z.string(),
    pending: pendingSchema,
  }),
  z.object({ type: z.literal("reply"), text: z.string() }),
  z.object({
    type: z.literal("answer"),
    text: z.string(),
    citedRecords: z.array(citedRecordSchema),
  }),
  z.object({
    type: z.literal("briefing"),
    text: z.string(),
    suggestions: z.array(suggestionSchema),
  }),
  z.object({
    type: z.literal("reminder-set"),
    reminderId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("reminders-list"),
    reminders: z.array(
      z.object({
        id: z.string(),
        activity: z.string(),
        field: z.string().nullable(),
        crop: z.string().nullable(),
        date: z.string(),
      }),
    ),
  }),
]);

const agentResponseSchema = z.object({ actions: z.array(agentActionSchema) });
const nudgeResponseSchema = z.object({ action: agentActionSchema.nullable() });

export type SavedFarmEvent = z.infer<typeof savedFarmEventSchema>;
export type Pending = z.infer<typeof pendingSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type UndoableAgentAction = Extract<
  AgentAction,
  { type: "recorded" | "corrected" | "deleted" }
>;

type AgentRequestPayload = {
  message: string;
  currentDate: string;
  pending?: Pending | undefined;
  recentEventIds: string[];
};

// `at` is when the item joined the feed, shown as the bubble's time.
export type FeedItem =
  | { id: string; at: number; kind: "farmer"; text: string }
  | {
      id: string;
      at: number;
      kind: "failed";
      text: string;
      error: string;
      request: AgentRequestPayload;
      retryable: boolean;
      attempts: number;
      retrying: boolean;
      nextRetryAt: number;
    }
  | {
      id: string;
      at: number;
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

function undoRequestBody(action: UndoableAgentAction): Record<string, unknown> {
  return action.type === "corrected"
    ? { action: action.type, correctionId: action.correctionId ?? undefined }
    : { action: action.type };
}

class AgentRequestError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

// Over a rate limit (429). Not a failure of the message: Tilly says it is
// busy in an ordinary bubble, and nothing is retried automatically.
class BusyError extends Error {}

function busyReply(text: string): FeedItem {
  return {
    id: newId(),
    at: Date.now(),
    kind: "action",
    action: { type: "reply", text },
    undone: false,
    undoing: false,
  };
}

const autoRetryDelays = [1200, 3500];
const manualRetryCooldownMs = 10000;
const maxManualRetryAttempts = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return [408, 502, 503, 504].includes(status);
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
  return "Tilly could not process that message. Please try again.";
}

async function postAgentRequest(
  payload: AgentRequestPayload,
): Promise<AgentAction[]> {
  let response: Response;
  try {
    response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AgentRequestError(
      "Network connection failed. Tilly could not confirm whether this was saved.",
      true,
    );
  }

  if (response.status === 429) {
    throw new BusyError(await readErrorMessage(response));
  }
  if (!response.ok) {
    throw new AgentRequestError(
      await readErrorMessage(response),
      isRetryableStatus(response.status),
    );
  }

  const body: unknown = await response.json();
  const parsed = agentResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new AgentRequestError("Tilly returned invalid data.", false);
  return parsed.data.actions;
}

async function postAgentRequestWithAutoRetry(
  payload: AgentRequestPayload,
): Promise<AgentAction[]> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await postAgentRequest(payload);
    } catch (error) {
      if (
        !(error instanceof AgentRequestError) ||
        !error.retryable ||
        attempt >= autoRetryDelays.length
      ) {
        throw error;
      }
      await sleep(autoRetryDelays[attempt]!);
    }
  }
}

const farmsResponseSchema = z.object({
  farms: z.array(z.object({ id: z.string(), name: z.string() })),
  activeFarmId: z.string(),
  lastRecord: z
    .object({
      activity: z.string(),
      crop: z.string().nullable(),
      field: z.string().nullable(),
      eventDate: z.string().nullable(),
    })
    .nullable(),
});

export type FarmSummary = { id: string; name: string };
export type LastRecord = z.infer<typeof farmsResponseSchema>["lastRecord"];

export function useFarmAgent() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [lastQuestionText, setLastQuestionText] = useState<string | undefined>(
    undefined,
  );
  const [recentEventIds, setRecentEventIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [activeFarmId, setActiveFarmId] = useState<string | undefined>(
    undefined,
  );
  const [farmError, setFarmError] = useState<string | null>(null);
  const [lastRecord, setLastRecord] = useState<LastRecord>(null);
  const [history, setHistory] = useState<SavedFarmEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyOpenRef = useRef(false);
  const nudgeOfferedRef = useRef(false);
  const startedRef = useRef(false);

  const activeFarmName =
    farms.find((farm) => farm.id === activeFarmId)?.name ?? "My Farm";

  // Farm identity loads first and on its own: a new session's first call
  // creates its cookies, so nothing may race it, and settings must not wait
  // for the full history.
  const loadFarms = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/farms");
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const parsed = farmsResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Farms returned invalid data.");
      setFarms(parsed.data.farms);
      setLastRecord(parsed.data.lastRecord);
      setActiveFarmId(parsed.data.activeFarmId);
      setFarmError(null);
      return true;
    } catch {
      setFarmError(
        "Your farm could not be loaded. Check your connection and reload the page.",
      );
      return false;
    }
  }, []);

  // History is only fetched while the records drawer is open.
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error("Your records could not be loaded.");
      const parsed = z
        .object({ events: z.array(savedFarmEventSchema) })
        .safeParse(await response.json());
      if (!parsed.success)
        throw new Error("Your records returned invalid data.");
      setHistory(parsed.data.events);
      setHistoryError(null);
    } catch (caughtError) {
      setHistoryError(
        caughtError instanceof Error
          ? caughtError.message
          : "Your records could not be loaded.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshHistoryIfOpen = useCallback(async () => {
    if (historyOpenRef.current) await refreshHistory();
  }, [refreshHistory]);

  const setHistoryOpen = useCallback(
    (open: boolean) => {
      historyOpenRef.current = open;
      if (open) void refreshHistory();
    },
    [refreshHistory],
  );

  // Finding 12: offer at most one gap reminder per session, on load and
  // after a saved record, as long as nothing is already pending.
  const offerNudge = useCallback(async () => {
    if (nudgeOfferedRef.current || pending) return;
    try {
      const response = await fetch("/api/agent/nudge", { method: "POST" });
      if (!response.ok) return;
      const body: unknown = await response.json();
      const parsed = nudgeResponseSchema.safeParse(body);
      if (!parsed.success || !parsed.data.action) return;
      nudgeOfferedRef.current = true;
      const action = parsed.data.action;
      if (action.type !== "question") return;
      setFeed((prev) => [
        ...prev,
        {
          id: newId(),
          at: Date.now(),
          kind: "action",
          action,
          undone: false,
          undoing: false,
        },
      ]);
      setPending(action.pending);
      setLastQuestionText(action.text);
    } catch {
      // A missed nudge is not worth surfacing as an error.
    }
  }, [pending]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      if (await loadFarms()) await offerNudge();
    })();
  }, [loadFarms, offerNudge]);

  const applyActions = useCallback(
    async (actions: AgentAction[]) => {
      const at = Date.now();
      setFeed((prev) => [
        ...prev,
        ...actions.map((action) => ({
          id: newId(),
          at,
          kind: "action" as const,
          action,
          undone: false,
          undoing: false,
        })),
      ]);

      const question = actions.find(
        (action) => action.type === "question" || action.type === "answer",
      );
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
        await refreshHistoryIfOpen();
        if (!question) await offerNudge();
      }
    },
    [offerNudge, refreshHistoryIfOpen],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isLoading) return;
      const request: AgentRequestPayload = {
        message: trimmed,
        currentDate: getLocalDateString(),
        pending,
        recentEventIds,
      };

      setFeed((prev) => [
        ...prev,
        { id: newId(), at: Date.now(), kind: "farmer", text: trimmed },
      ]);
      setIsLoading(true);
      setError(null);

      try {
        const actions = await postAgentRequestWithAutoRetry(request);
        await applyActions(actions);
      } catch (caughtError) {
        if (caughtError instanceof BusyError) {
          // The pending question, if any, is kept for the next message.
          setFeed((prev) => [...prev, busyReply(caughtError.message)]);
          return;
        }
        const retryable =
          caughtError instanceof AgentRequestError
            ? caughtError.retryable
            : false;
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Something went wrong. Please try again.";
        setFeed((prev) => [
          ...prev,
          {
            id: newId(),
            at: Date.now(),
            kind: "failed",
            text: trimmed,
            error: message,
            request,
            retryable,
            attempts: 0,
            retrying: false,
            nextRetryAt: Date.now() + manualRetryCooldownMs,
          },
        ]);
        await refreshHistoryIfOpen();
      } finally {
        setIsLoading(false);
      }
    },
    [applyActions, isLoading, pending, recentEventIds, refreshHistoryIfOpen],
  );

  const retry = useCallback(
    async (itemId: string) => {
      const failed = feed.find(
        (item): item is Extract<FeedItem, { kind: "failed" }> =>
          item.id === itemId && item.kind === "failed",
      );
      if (
        !failed ||
        !failed.retryable ||
        failed.retrying ||
        failed.nextRetryAt > Date.now() ||
        failed.attempts >= maxManualRetryAttempts
      )
        return;

      setFeed((prev) =>
        prev.map((item) =>
          item.id === itemId && item.kind === "failed"
            ? { ...item, retrying: true, attempts: item.attempts + 1 }
            : item,
        ),
      );
      setIsLoading(true);
      setError(null);

      try {
        const actions = await postAgentRequestWithAutoRetry(failed.request);
        setFeed((prev) => prev.filter((item) => item.id !== itemId));
        await applyActions(actions);
      } catch (caughtError) {
        if (caughtError instanceof BusyError) {
          setFeed((prev) => [
            ...prev.filter((item) => item.id !== itemId),
            busyReply(caughtError.message),
          ]);
          return;
        }
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Something went wrong. Please try again.";
        setFeed((prev) =>
          prev.map((item) =>
            item.id === itemId && item.kind === "failed"
              ? {
                  ...item,
                  retrying: false,
                  error: message,
                  retryable:
                    caughtError instanceof AgentRequestError
                      ? caughtError.retryable
                      : false,
                  nextRetryAt: Date.now() + manualRetryCooldownMs,
                }
              : item,
          ),
        );
        await refreshHistoryIfOpen();
      } finally {
        setIsLoading(false);
      }
    },
    [applyActions, feed, refreshHistoryIfOpen],
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
          body: JSON.stringify(undoRequestBody(action)),
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
        await refreshHistoryIfOpen();
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
    [refreshHistoryIfOpen],
  );

  // Another farm starts a new conversation: pending questions and "that
  // record" references belong to the farm they were asked about.
  const startFarmConversation = useCallback(
    async (farmId: string) => {
      setActiveFarmId(farmId);
      setLastRecord(null);
      setFeed([]);
      setPending(undefined);
      setLastQuestionText(undefined);
      setRecentEventIds([]);
      setError(null);
      setHistory([]);
      nudgeOfferedRef.current = false;
      await Promise.all([loadFarms(), refreshHistoryIfOpen()]);
    },
    [loadFarms, refreshHistoryIfOpen],
  );

  const switchFarm = useCallback(
    async (farmId: string) => {
      const response = await fetch("/api/farms/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmId }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      await startFarmConversation(farmId);
    },
    [startFarmConversation],
  );

  // Creates the sample farm the first time and switches to it; the server
  // makes it the active farm.
  const openSampleFarm = useCallback(async () => {
    const response = await fetch("/api/farms/sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentDate: getLocalDateString() }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response));
    const sample = z.object({ id: z.string() }).parse(await response.json());
    await startFarmConversation(sample.id);
  }, [startFarmConversation]);

  const addFarm = useCallback(
    async (name: string) => {
      const response = await fetch("/api/farms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const created = z
        .object({ id: z.string(), name: z.string() })
        .parse(await response.json());
      setFarms((prev) => [...prev, created]);
      await switchFarm(created.id);
    },
    [switchFarm],
  );

  return {
    feed,
    pending,
    lastQuestionText,
    isLoading,
    error,
    farms,
    activeFarmId,
    activeFarmName,
    lastRecord,
    farmError,
    history,
    historyLoading,
    historyError,
    setHistoryOpen,
    sendMessage,
    retry,
    undo,
    switchFarm,
    addFarm,
    openSampleFarm,
  };
}
