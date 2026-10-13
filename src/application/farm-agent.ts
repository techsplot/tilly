import {
  getImportantMissingDetails,
  isValidEventTime,
  LifecycleError,
  ValidationError,
  type FarmEvent,
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
  findFirstOwnedActiveEvent,
  findNudgeCandidate,
  markNudged,
  stopNudges,
  toFarmEvent,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import type { FarmEventRow } from "../infrastructure/db/schema";
import type { FarmMemory } from "../domain/farm-memory";

// The partial event known before the agent asked its one question, so the
// pending note can be saved with gaps (rule 10) without a second model call.
export type PendingEvent = Pick<
  FarmEvent,
  | "activity"
  | "crop"
  | "field"
  | "eventDate"
  | "quantity"
  | "unit"
  | "eventTime"
  | "timeOfDay"
  | "sourceText"
> & { memoryEventIds: string[]; unresolvedReferences: string[] };

export type Pending =
  | {
      kind: "clarification";
      originalMessage: string;
      event: PendingEvent;
      question: string;
      clarifications: { question: string; answer: string }[];
    }
  | {
      kind: "gap";
      eventId: string;
    }
  | {
      kind: "correction";
      eventId: string;
    };

export type Change = {
  field: string;
  before: unknown;
  after: unknown;
};

export type AgentAction =
  | { type: "recorded"; event: SavedFarmEvent; possibleDuplicate?: boolean }
  | {
      type: "corrected";
      event: SavedFarmEvent;
      changes: Change[];
      correctionId: string | null;
    }
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
const STOP_NUDGE_REPLY = "OK, I won't ask about that again.";
const CORRECTION_QUESTION = "What should I change it to?";
const CORRECTION_NOT_UNDERSTOOD_REPLY =
  "I didn't catch what to change, so I left that record as it was.";

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

function isStopNudgeReply(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return /^(stop asking|don'?t know|skip|no\b)/.test(normalized);
}

const detailLabel: Record<string, string> = {
  eventDate: "when it was",
  crop: "which crop",
  field: "which field",
};

// Finding 9: the application decides when a question is needed and which
// details to ask about; Nemotron only phrases it. If the model's sentence
// is missing or empty, fall back to a fixed, deterministic question.
export function buildFollowUpQuestion(
  followUpQuestion: string | null | undefined,
  missingDetails: string[],
): string {
  const trimmed = followUpQuestion?.trim();
  if (trimmed) return trimmed;
  const phrases = missingDetails.map(
    (detail) => detailLabel[detail] ?? `which ${detail}`,
  );
  const joined =
    phrases.length <= 1
      ? (phrases[0] ?? "that")
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `Got it. Can you tell me ${joined}?`;
}

const activityVerb: Record<FarmEvent["activity"], string> = {
  planting: "plant",
  fertilizing: "fertilize",
  weeding: "weed",
  spraying: "spray",
  harvesting: "harvest",
  inspection: "inspect",
  irrigation: "irrigate",
  other: "do",
};

function formatNudgeDate(isoDate: string | null): string {
  if (!isoDate) return "that day";
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Finding 12: fixed wording built from the record; Nemotron never phrases
// nudges.
export function buildNudgeQuestion(
  event: Pick<FarmEvent, "activity" | "eventDate" | "missingFields">,
): string {
  const detailFields = event.missingFields.filter(
    (field) => field !== "eventDate",
  );
  const verb = activityVerb[event.activity];
  if (detailFields.length > 0) {
    const phrase = detailFields.map((field) => `which ${field}`).join(" and ");
    return `Quick one: ${phrase} did you ${verb} on ${formatNudgeDate(event.eventDate)}?`;
  }
  return `Quick one: when did you ${verb}?`;
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

function toPendingEvent(event: FarmEvent): PendingEvent {
  return {
    activity: event.activity,
    crop: event.crop,
    field: event.field,
    eventDate: event.eventDate,
    quantity: event.quantity,
    unit: event.unit,
    eventTime: event.eventTime ?? null,
    timeOfDay: event.timeOfDay ?? null,
    sourceText: event.sourceText,
    memoryEventIds: event.memoryEventIds ?? [],
    unresolvedReferences: event.unresolvedReferences ?? [],
  };
}

function pendingEventToFarmEvent(event: PendingEvent): FarmEvent {
  return {
    activity: event.activity,
    crop: event.crop,
    field: event.field,
    eventDate: event.eventDate,
    quantity: event.quantity,
    unit: event.unit,
    eventTime: event.eventTime,
    timeOfDay: event.timeOfDay,
    status: "confirmed",
    missingFields: [],
    sourceText: event.sourceText,
    memoryEventIds: event.memoryEventIds,
  };
}

async function recordedAction(
  db: Database,
  farmId: string,
  event: FarmEvent,
  currentDate: string,
): Promise<Extract<AgentAction, { type: "recorded" }>> {
  const { event: saved, possibleDuplicate } = await recordAgentEvent(
    db,
    farmId,
    {
      final: event,
      currentDate,
    },
  );
  return possibleDuplicate
    ? { type: "recorded", event: saved, possibleDuplicate: true }
    : { type: "recorded", event: saved };
}

// Finding 1 + 14: every complete event in the note is saved; at most one
// incomplete event per note is held back for a single question.
async function applyRecordFlow(
  db: Database,
  farmId: string,
  originalMessage: string,
  currentDate: string,
  events: FarmEvent[],
  followUpQuestion: string | null | undefined,
): Promise<AgentAction[]> {
  if (events.length === 0) {
    return [{ type: "reply", text: UNDERSTOOD_NOTHING_REPLY }];
  }

  const actions: AgentAction[] = [];
  let heldBack: FarmEvent | undefined;

  for (const event of events) {
    const missing = getImportantMissingDetails(
      event,
      event.unresolvedReferences ?? [],
    );
    if (missing.length === 0 || heldBack) {
      actions.push(await recordedAction(db, farmId, event, currentDate));
    } else {
      heldBack = event;
    }
  }

  if (heldBack) {
    const missing = getImportantMissingDetails(
      heldBack,
      heldBack.unresolvedReferences ?? [],
    );
    const question = buildFollowUpQuestion(followUpQuestion, missing);
    actions.push({
      type: "question",
      text: question,
      pending: {
        kind: "clarification",
        originalMessage,
        event: toPendingEvent(heldBack),
        question,
        clarifications: [],
      },
    });
  }

  return actions;
}

function cleanCorrectionChanges(
  changes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!changes) return {};
  const entries = Object.entries(changes).filter(
    ([, value]) => value !== undefined,
  );
  const result = Object.fromEntries(entries);
  if (
    typeof result.eventTime === "string" &&
    !isValidEventTime(result.eventTime)
  ) {
    delete result.eventTime;
  }
  return result;
}

function correctionQuestion(eventId: string): AgentAction {
  return {
    type: "question",
    text: CORRECTION_QUESTION,
    pending: { kind: "correction", eventId },
  };
}

// Applies already-cleaned changes to a record the caller has checked is
// owned and active, and reports the before/after of each changed field.
async function correctTarget(
  db: Database,
  farmId: string,
  target: FarmEventRow,
  changes: Record<string, unknown>,
  currentDate: string,
): Promise<Extract<AgentAction, { type: "corrected" }>> {
  const before = toFarmEvent(target);
  const { event: saved, correctionId } = await correctRecordedEvent(
    db,
    farmId,
    target.id,
    changes as Parameters<typeof correctRecordedEvent>[3],
    currentDate,
  );
  const changeList: Change[] = Object.entries(
    changedFields(before, saved)?.after ?? {},
  ).map(([field]) => ({
    field,
    before: before[field as keyof FarmEvent],
    after: saved[field as keyof FarmEvent],
  }));
  return { type: "corrected", event: saved, changes: changeList, correctionId };
}

async function applyCorrection(
  db: Database,
  farmId: string,
  currentDate: string,
  changes: Record<string, unknown>,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  const target = await findFirstOwnedActiveEvent(db, farmId, recentEventIds);
  if (!target) return [{ type: "reply", text: NOTHING_TO_TARGET_REPLY }];

  const cleanChanges = cleanCorrectionChanges(changes);
  if (Object.keys(cleanChanges).length === 0) {
    return [correctionQuestion(target.id)];
  }

  try {
    return [await correctTarget(db, farmId, target, cleanChanges, currentDate)];
  } catch (error) {
    if (error instanceof ValidationError || error instanceof LifecycleError) {
      return [correctionQuestion(target.id)];
    }
    throw error;
  }
}

function describeRecord(event: FarmEvent): string {
  const details = [
    event.crop,
    event.field,
    event.eventDate ? `on ${formatNudgeDate(event.eventDate)}` : null,
  ].filter(Boolean);
  return details.length > 0
    ? `${event.activity} (${details.join(", ")})`
    : event.activity;
}

const correctableFields = [
  "crop",
  "field",
  "eventDate",
  "quantity",
  "unit",
  "eventTime",
  "timeOfDay",
] as const;

// Review 2, finding 1: the answer to "What should I change it to?" is
// extracted as a correction of the one record it was asked about and
// applied to that record only. Nothing new is ever saved from it, and the
// question is not asked again.
async function handleCorrectionAnswer(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  pending: Extract<Pending, { kind: "correction" }>,
): Promise<AgentAction[]> {
  const target = await findFirstOwnedActiveEvent(db, farmId, [pending.eventId]);
  if (!target) return [{ type: "reply", text: NOTHING_TO_TARGET_REPLY }];
  const targetEvent = toFarmEvent(target);

  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    `Change my ${describeRecord(targetEvent)} record.`,
    currentDate,
    [{ question: CORRECTION_QUESTION, answer: message }],
    memory,
  );

  let changes: Record<string, unknown> = {};
  if (interaction.intent === "correct") {
    changes = cleanCorrectionChanges(interaction.correction?.changes);
  } else if (interaction.intent === "record") {
    // A model may restate the record instead of returning a correction;
    // only values that differ from the record count as changes, and only
    // while it is still the same activity.
    const restated = interaction.events.find(
      (event) => event.activity === targetEvent.activity,
    );
    if (restated) {
      changes = cleanCorrectionChanges(
        Object.fromEntries(
          correctableFields
            .filter(
              (field) =>
                restated[field] != null &&
                restated[field] !== targetEvent[field],
            )
            .map((field) => [field, restated[field]]),
        ),
      );
    }
  }

  if (Object.keys(changes).length === 0) {
    return [{ type: "reply", text: CORRECTION_NOT_UNDERSTOOD_REPLY }];
  }
  try {
    return [await correctTarget(db, farmId, target, changes, currentDate)];
  } catch (error) {
    if (error instanceof ValidationError || error instanceof LifecycleError) {
      return [{ type: "reply", text: CORRECTION_NOT_UNDERSTOOD_REPLY }];
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

async function routeInteraction(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  interaction: {
    intent: string;
    events: FarmEvent[];
    followUpQuestion?: string | null | undefined;
    correction?: { changes: Record<string, unknown> } | null | undefined;
  },
  recentEventIds: string[],
): Promise<AgentAction[]> {
  if (interaction.intent === "correct")
    return applyCorrection(
      db,
      farmId,
      currentDate,
      interaction.correction?.changes ?? {},
      recentEventIds,
    );
  if (interaction.intent === "delete")
    return applyDelete(db, farmId, recentEventIds);
  if (interaction.intent === "other")
    return [{ type: "reply", text: UNSUPPORTED_REPLY }];
  return applyRecordFlow(
    db,
    farmId,
    message,
    currentDate,
    interaction.events,
    interaction.followUpQuestion,
  );
}

// Finding 2 + 10: the server, not the browser, owns merging the answer
// into the conversation, and the next message always ends the pending
// note — either by answering it (save at once with whatever is known) or
// by turning out to be something else entirely (save the pending note
// with gaps first, then handle the new message normally). Finding 3: no
// isQuestionReply short-circuit; extraction decides.
async function handlePendingClarification(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  pending: Extract<Pending, { kind: "clarification" }>,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  const clarifications = [
    ...pending.clarifications,
    { question: pending.question, answer: message },
  ];
  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    pending.originalMessage,
    currentDate,
    clarifications,
    memory,
  );

  const sameNoteAnswer =
    interaction.intent === "record" &&
    interaction.events[0]?.activity === pending.event.activity;

  if (sameNoteAnswer) {
    const merged =
      interaction.events[0] ?? pendingEventToFarmEvent(pending.event);
    return [await recordedAction(db, farmId, merged, currentDate)];
  }

  // End the pending note first, with whatever was known before this reply.
  const ended = await recordedAction(
    db,
    farmId,
    pendingEventToFarmEvent(pending.event),
    currentDate,
  );
  const extendedRecentIds = [ended.event.id, ...recentEventIds];

  if (interaction.intent === "correct")
    return [
      ended,
      ...(await applyCorrection(
        db,
        farmId,
        currentDate,
        interaction.correction?.changes ?? {},
        extendedRecentIds,
      )),
    ];
  if (interaction.intent === "delete")
    return [ended, ...(await applyDelete(db, farmId, extendedRecentIds))];
  if (interaction.intent === "other")
    return [ended, { type: "reply", text: UNSUPPORTED_REPLY }];
  return [
    ended,
    ...(await applyRecordFlow(
      db,
      farmId,
      message,
      currentDate,
      interaction.events,
      interaction.followUpQuestion,
    )),
  ];
}

function buildGapCorrectionChanges(
  target: FarmEvent,
  answered: FarmEvent,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (target.missingFields.includes("crop") && answered.crop)
    changes.crop = answered.crop;
  if (target.missingFields.includes("field") && answered.field)
    changes.field = answered.field;
  if (target.missingFields.includes("eventDate") && answered.eventDate)
    changes.eventDate = answered.eventDate;
  return changes;
}

// Finding 12: the nudge's answer is applied as a normal correction to the
// targeted record. An unrelated message leaves the nudge unanswered and is
// handled normally.
async function handleGapAnswer(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  pending: Extract<Pending, { kind: "gap" }>,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  if (isStopNudgeReply(message)) {
    await stopNudges(db, farmId, pending.eventId);
    return [{ type: "reply", text: STOP_NUDGE_REPLY }];
  }

  const target = await findFirstOwnedActiveEvent(db, farmId, [pending.eventId]);
  if (!target) {
    return handleNewMessage(db, farmId, message, currentDate, recentEventIds);
  }
  const targetEvent = toFarmEvent(target);
  const question = buildNudgeQuestion(targetEvent);
  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    question,
    currentDate,
    [{ question, answer: message }],
    memory,
  );

  const answered = interaction.events[0];
  const changes =
    interaction.intent === "record" && answered
      ? buildGapCorrectionChanges(targetEvent, answered)
      : {};

  if (Object.keys(changes).length === 0) {
    return routeInteraction(
      db,
      farmId,
      message,
      currentDate,
      interaction,
      recentEventIds,
    );
  }

  return [await correctTarget(db, farmId, target, changes, currentDate)];
}

async function handleNewMessage(
  db: Database,
  farmId: string,
  message: string,
  currentDate: string,
  recentEventIds: string[],
): Promise<AgentAction[]> {
  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  const interaction = await extractFarmEvent(
    message,
    currentDate,
    undefined,
    memory,
  );
  return routeInteraction(
    db,
    farmId,
    message,
    currentDate,
    interaction,
    recentEventIds,
  );
}

export async function handleFarmerMessage(
  db: Database,
  farmId: string,
  input: HandleFarmerMessageInput,
): Promise<AgentAction[]> {
  const recentEventIds = input.recentEventIds.filter(isUuid);

  if (input.pending?.kind === "gap") {
    return handleGapAnswer(
      db,
      farmId,
      input.message,
      input.currentDate,
      input.pending,
      recentEventIds,
    );
  }
  if (input.pending?.kind === "correction") {
    return handleCorrectionAnswer(
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

  return handleNewMessage(
    db,
    farmId,
    input.message,
    input.currentDate,
    recentEventIds,
  );
}

export async function undoAgentAction(
  db: Database,
  farmId: string,
  eventId: string,
  action: UndoableAction,
  correctionId?: string,
): Promise<SavedFarmEvent> {
  return undoAgentActionPersisted(db, farmId, eventId, action, correctionId);
}

// Finding 12: at most one gap reminder, built from fixed wording.
export async function getNudge(
  db: Database,
  farmId: string,
): Promise<Extract<AgentAction, { type: "question" }> | null> {
  const candidate = await findNudgeCandidate(db, farmId);
  if (!candidate) return null;
  await markNudged(db, candidate.id);
  const event = toFarmEvent(candidate);
  const text = buildNudgeQuestion(event);
  return {
    type: "question",
    text,
    pending: { kind: "gap", eventId: candidate.id },
  };
}
