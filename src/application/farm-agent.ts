import {
  correctEvent,
  LifecycleError,
  ValidationError,
  type FarmEvent,
  type FarmInteractionResult,
} from "../domain/farm-event";
import { isUuid } from "./farm-context";
import { extractFarmEvent } from "./extract-farm-event";
import { loadFarmMemory } from "./farm-memory";
import {
  changedFields,
  correctRecordedEvent,
  recordAgentEvent,
  undoAgentAction as undoAgentActionPersisted,
  type SavedFarmEvent,
  type UndoableAction,
} from "./persist-farm-event";
import {
  findDuplicateEvent,
  findFirstOwnedActiveEvent,
  toFarmEvent,
  upsertField,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import type { FarmMemory } from "../domain/farm-memory";

export type Pending = {
  kind: "clarification" | "duplicate";
  originalMessage: string;
  clarifications: { question: string; answer: string }[];
};

export type Change = {
  field: string;
  before: unknown;
  after: unknown;
};

export type AgentAction =
  | { type: "recorded"; event: SavedFarmEvent }
  | { type: "corrected"; event: SavedFarmEvent; changes: Change[] }
  | { type: "deleted"; event: SavedFarmEvent }
  | { type: "question"; text: string; pending: Pending }
  | { type: "reply"; text: string };

export type HandleFarmerMessageInput = {
  message: string;
  currentDate: string;
  pending?: Pending | undefined;
  recentEventIds: string[];
};

const NOTHING_TO_TARGET_REPLY =
  "I don't have a recent record to change. Tell me what you did.";
const UNSUPPORTED_REPLY =
  "I can record farm activities for now. Questions and reminders are coming soon.";
const UNDERSTOOD_NOTHING_REPLY =
  "I did not understand that. Please describe a farm activity.";

export function parseYesNo(message: string): "yes" | "no" | null {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (/^(yes|yeah|yep|yup|sure|correct|right|ok|okay)\b/.test(normalized))
    return "yes";
  if (/^(no|nope|nah|cancel)\b/.test(normalized)) return "no";
  return null;
}

function isQuestionReply(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.endsWith("?")) return true;
  return /^(what|who|why|when|where|which|how|can|could|do|does|is|are)\b/i.test(
    trimmed,
  );
}

function buildDuplicateQuestion(event: FarmEvent, currentDate: string): string {
  const dateLabel =
    event.eventDate === currentDate
      ? "today"
      : (event.eventDate ?? "that date");
  const location = event.field ? ` on ${event.field}` : "";
  return `You already recorded ${event.activity}${location} ${dateLabel}. Record it again?`;
}

async function loadFarmMemoryQuietly(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<FarmMemory> {
  try {
    return await loadFarmMemory(db, farmId, currentDate);
  } catch (error) {
    console.error("FarmMind memory load failed", error);
    return { fields: [], recentEvents: [] };
  }
}

async function isDuplicateEvent(
  db: Database,
  farmId: string,
  event: FarmEvent,
): Promise<boolean> {
  const field = event.field ? await upsertField(db, farmId, event.field) : null;
  const existing = await findDuplicateEvent(db, farmId, {
    activity: event.activity,
    eventDate: event.eventDate as string,
    fieldId: field?.id ?? null,
  });
  return Boolean(existing);
}

async function applyRecordFlow(
  db: Database,
  farmId: string,
  originalMessage: string,
  currentDate: string,
  interaction: FarmInteractionResult,
  clarifications: { question: string; answer: string }[],
  forceIncomplete: boolean,
): Promise<AgentAction[]> {
  const event = interaction.events[0];

  if (!event) {
    if (
      interaction.clarificationRequired &&
      interaction.clarificationQuestion
    ) {
      return [
        {
          type: "question",
          text: interaction.clarificationQuestion,
          pending: { kind: "clarification", originalMessage, clarifications },
        },
      ];
    }
    return [{ type: "reply", text: UNDERSTOOD_NOTHING_REPLY }];
  }

  const hasIssue = event.missingFields.length > 0;

  if (hasIssue && !forceIncomplete) {
    const question =
      interaction.clarificationQuestion ??
      `To complete this ${event.activity} record, what is the ${event.missingFields[0]}?`;
    return [
      {
        type: "question",
        text: question,
        pending: { kind: "clarification", originalMessage, clarifications },
      },
    ];
  }

  if (hasIssue && forceIncomplete) {
    const saved = await recordAgentEvent(db, farmId, {
      final: event,
      status: "incomplete",
    });
    return [{ type: "recorded", event: saved }];
  }

  if (await isDuplicateEvent(db, farmId, event)) {
    return [
      {
        type: "question",
        text: buildDuplicateQuestion(event, currentDate),
        pending: { kind: "duplicate", originalMessage, clarifications },
      },
    ];
  }

  const saved = await recordAgentEvent(db, farmId, {
    final: event,
    status: "confirmed",
  });
  return [{ type: "recorded", event: saved }];
}

async function applyCorrection(
  db: Database,
  farmId: string,
  message: string,
  interaction: FarmInteractionResult,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  const target = await findFirstOwnedActiveEvent(db, farmId, recentEventIds);
  if (!target) return [{ type: "reply", text: NOTHING_TO_TARGET_REPLY }];

  const changes = interaction.correction?.changes ?? {};
  const cleanChanges = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Parameters<typeof correctEvent>[1];

  if (Object.keys(cleanChanges).length === 0) {
    return [
      {
        type: "question",
        text: "What should I change it to?",
        pending: {
          kind: "clarification",
          originalMessage: message,
          clarifications: [],
        },
      },
    ];
  }

  try {
    const before = toFarmEvent(target);
    const saved = await correctRecordedEvent(
      db,
      farmId,
      target.id,
      cleanChanges,
    );
    const changeList: Change[] = Object.entries(
      changedFields(before, saved)?.after ?? {},
    ).map(([field]) => ({
      field,
      before: before[field as keyof FarmEvent],
      after: saved[field as keyof FarmEvent],
    }));
    return [{ type: "corrected", event: saved, changes: changeList }];
  } catch (error) {
    if (error instanceof ValidationError || error instanceof LifecycleError) {
      return [
        {
          type: "question",
          text: "What should I change it to?",
          pending: {
            kind: "clarification",
            originalMessage: message,
            clarifications: [],
          },
        },
      ];
    }
    throw error;
  }
}

async function applyDelete(
  db: Database,
  farmId: string,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  const target = await findFirstOwnedActiveEvent(db, farmId, recentEventIds);
  if (!target) return [{ type: "reply", text: NOTHING_TO_TARGET_REPLY }];
  const deleted = await undoAgentActionPersisted(
    db,
    farmId,
    target.id,
    "recorded",
  );
  return [{ type: "deleted", event: deleted }];
}

async function handlePendingDuplicate(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  pending: Pending,
): Promise<AgentAction[]> {
  const deterministic = parseYesNo(message);
  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    pending.originalMessage,
    currentDate,
    pending.clarifications,
    memory,
  );
  const confirmed =
    deterministic === "yes"
      ? true
      : deterministic === "no"
        ? false
        : interaction.intent === "record";

  if (!confirmed) {
    return [{ type: "reply", text: "OK, nothing new recorded." }];
  }

  const event = interaction.events[0];
  if (!event || event.missingFields.length > 0) {
    const question =
      interaction.clarificationQuestion ??
      "Can you tell me more about that activity?";
    return [
      {
        type: "question",
        text: question,
        pending: {
          kind: "clarification",
          originalMessage: pending.originalMessage,
          clarifications: pending.clarifications,
        },
      },
    ];
  }

  const saved = await recordAgentEvent(db, farmId, {
    final: event,
    status: "confirmed",
  });
  return [{ type: "recorded", event: saved }];
}

async function handlePendingClarification(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  pending: Pending,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  if (isQuestionReply(message)) {
    const lastQuestion = pending.clarifications.at(-1)?.question;
    return [
      {
        type: "question",
        text: lastQuestion ?? "Can you clarify?",
        pending,
      },
    ];
  }

  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    pending.originalMessage,
    currentDate,
    pending.clarifications,
    memory,
  );

  if (interaction.intent === "correct")
    return applyCorrection(db, farmId, message, interaction, recentEventIds);
  if (interaction.intent === "delete")
    return applyDelete(db, farmId, recentEventIds);
  if (interaction.intent === "other")
    return [{ type: "reply", text: UNSUPPORTED_REPLY }];

  const skip = interaction.skip === true;
  const atLimit = pending.clarifications.length >= 3;

  return applyRecordFlow(
    db,
    farmId,
    pending.originalMessage,
    currentDate,
    interaction,
    pending.clarifications,
    skip || atLimit,
  );
}

export async function handleFarmerMessage(
  db: Database,
  farmId: string,
  input: HandleFarmerMessageInput,
): Promise<AgentAction[]> {
  const recentEventIds = input.recentEventIds.filter(isUuid);

  if (input.pending?.kind === "duplicate") {
    return handlePendingDuplicate(
      db,
      farmId,
      input.message,
      input.currentDate,
      input.pending,
    );
  }
  if (input.pending?.kind === "clarification") {
    return handlePendingClarification(
      db,
      farmId,
      input.message,
      input.currentDate,
      input.pending,
      recentEventIds,
    );
  }

  const memory = await loadFarmMemoryQuietly(db, farmId, input.currentDate);
  const interaction = await extractFarmEvent(
    input.message,
    input.currentDate,
    undefined,
    memory,
  );

  if (interaction.intent === "correct")
    return applyCorrection(
      db,
      farmId,
      input.message,
      interaction,
      recentEventIds,
    );
  if (interaction.intent === "delete")
    return applyDelete(db, farmId, recentEventIds);
  if (interaction.intent === "other")
    return [{ type: "reply", text: UNSUPPORTED_REPLY }];

  return applyRecordFlow(
    db,
    farmId,
    input.message,
    input.currentDate,
    interaction,
    [],
    false,
  );
}

export async function undoAgentAction(
  db: Database,
  farmId: string,
  eventId: string,
  action: UndoableAction,
): Promise<SavedFarmEvent> {
  return undoAgentActionPersisted(db, farmId, eventId, action);
}
