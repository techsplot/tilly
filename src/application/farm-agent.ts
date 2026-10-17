import {
  getImportantMissingDetails,
  isValidEventTime,
  LifecycleError,
  ValidationError,
  type FarmEvent,
  type QuestionFilter,
  type ReportFilter,
} from "../domain/farm-event";
import { isUuid } from "./farm-context";
import { extractFarmEvent } from "./extract-farm-event";
import { loadFarmMemory } from "./farm-memory";
import { resolveFarmReference } from "./farm-resolver";
import { classifySmallTalk, type SmallTalk } from "../domain/small-talk";
import {
  changedFields,
  correctRecordedEvent,
  recordAgentEvent,
  undoAgentAction as undoAgentActionPersisted,
  type SavedFarmEvent,
  type UndoableAction,
} from "./persist-farm-event";
import {
  answerQuestion,
  generateReport,
  type CitedRecord,
} from "./farm-question";
import {
  findFirstOwnedActiveEvent,
  findNudgeCandidate,
  listFarmsBySession,
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

export type Suggestion = {
  type: "gap" | "pattern" | "follow-up";
  text: string;
  confidence: "high" | "medium" | "low";
};

export type AgentAction =
  | {
      type: "recorded";
      event: SavedFarmEvent;
      possibleDuplicate?: boolean;
      suggestions?: Suggestion[];
    }
  | {
      type: "corrected";
      event: SavedFarmEvent;
      changes: Change[];
      correctionId: string | null;
    }
  | { type: "deleted"; event: SavedFarmEvent }
  | { type: "question"; text: string; pending: Pending }
  | { type: "reply"; text: string }
  | { type: "answer"; text: string; citedRecords: CitedRecord[] }
  | { type: "briefing"; text: string; suggestions: Suggestion[] };

export type HandleFarmerMessageInput = {
  message: string;
  currentDate: string;
  pending?: Pending | undefined;
  recentEventIds: string[];
  // Lets a new message name another farm owned by the same session.
  // Without it, every message goes to the active farm.
  sessionId?: string | undefined;
};

const NOTHING_TO_TARGET_REPLY =
  "I don't have a recent record to change. Tell me what you did.";
const UNSUPPORTED_REPLY =
  "I can't help with that. I keep your farm records: tell me what you did, ask what you've done, or ask for a report.";
const REMINDER_REPLY =
  "I can't set reminders yet. For now, tell me what you did, ask what you've done, or ask for a report.";
const SMALL_TALK_REPLIES: Record<SmallTalk, string> = {
  greeting:
    "Hello! Tell me what you did on the farm today, or ask me about your records.",
  thanks: "You're welcome.",
  farewell: "Goodbye! Your records are saved.",
};

function unsupportedReply(message: string): string {
  return /\bremind/i.test(message) ? REMINDER_REPLY : UNSUPPORTED_REPLY;
}
const UNDERSTOOD_NOTHING_REPLY =
  "I did not understand that. Please describe a farm activity, ask a question, or request a report.";
const STOP_NUDGE_REPLY = "OK, I won't ask about that again.";
const GAP_LEFT_AS_IS_REPLY = "OK, I'll leave that record as it is for now.";
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

// Review 2, finding 3: only a whole reply stops a nudge, so "no, it was the
// north field" is still answered as a correction.
function isStopNudgeReply(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[’]/g, "'");
  return /^(stop asking|stop|skip|i don'?t know|don'?t know|never mind|no)[.!?\s]*$/.test(
    normalized,
  );
}

const detailLabel: Record<string, string> = {
  eventDate: "when it was",
  crop: "which crop",
  field: "which field",
};

// How a question shows it is asking about each detail.
const detailMention: Record<string, RegExp> = {
  eventDate: /\b(when|today|yesterday|date|day)\b/i,
  crop: /\bcrops?\b/i,
  field: /\b(fields?|where)\b/i,
};

// The model's sentence is used only if it is a question about exactly the
// missing details: live testing produced "Anything else you'd like to
// record?" for a missing crop, and "Which field was it?" when the field had
// been given.
function asksForExactly(question: string, missingDetails: string[]): boolean {
  if (!question.includes("?")) return false;
  const asksMissing = missingDetails.every(
    (detail) => detailMention[detail]?.test(question) ?? false,
  );
  const asksKnown = (["crop", "field"] as const).some(
    (detail) =>
      !missingDetails.includes(detail) && detailMention[detail]!.test(question),
  );
  return asksMissing && !asksKnown;
}

// Finding 9: the application decides when a question is needed and which
// details to ask about; Nemotron only phrases it. If the model's sentence
// does not ask for exactly those details, fall back to a fixed question.
export function buildFollowUpQuestion(
  followUpQuestion: string | null | undefined,
  missingDetails: string[],
): string {
  const trimmed = followUpQuestion?.trim();
  if (trimmed && asksForExactly(trimmed, missingDetails)) return trimmed;
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

  // Generate suggestions after recording
  const { generateSuggestions } = await import("./farm-insights");
  const suggestions = await generateSuggestions(db, farmId, currentDate);

  return possibleDuplicate
    ? { type: "recorded", event: saved, possibleDuplicate: true, suggestions }
    : { type: "recorded", event: saved, suggestions };
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
    filter?: QuestionFilter | ReportFilter | null | undefined;
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
  if (interaction.intent === "question") {
    if (!interaction.filter) {
      return [
        { type: "reply", text: "I need to know what you're asking about." },
      ];
    }
    const filter = interaction.filter as QuestionFilter;
    const result = await answerQuestion(db, farmId, filter);
    return [
      { type: "answer", text: result.text, citedRecords: result.citedRecords },
    ];
  }
  if (interaction.intent === "report") {
    if (!interaction.filter) {
      return [
        {
          type: "reply",
          text: "I need to know what to include in the report.",
        },
      ];
    }
    const filter = interaction.filter as ReportFilter;
    const result = await generateReport(db, farmId, filter);
    return [
      { type: "answer", text: result.text, citedRecords: result.citedRecords },
    ];
  }
  if (interaction.intent === "other")
    return [{ type: "reply", text: unsupportedReply(message) }];
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

  // Review 2, finding 2: the first event with the pending activity is the
  // answered note; every other event in the reply is handled as a new note,
  // so an extra activity ("I also weeded...") is never dropped. If the model
  // returns only the pending activity, that is all the code can see: the
  // merged note is saved and nothing else is invented.
  if (interaction.intent === "record") {
    const mergedIndex = interaction.events.findIndex(
      (event) => event.activity === pending.event.activity,
    );
    if (mergedIndex !== -1) {
      const merged = await recordedAction(
        db,
        farmId,
        interaction.events[mergedIndex]!,
        currentDate,
      );
      const rest = interaction.events.filter(
        (_, index) => index !== mergedIndex,
      );
      if (rest.length === 0) return [merged];
      return [
        merged,
        ...(await applyRecordFlow(
          db,
          farmId,
          message,
          currentDate,
          rest,
          interaction.followUpQuestion,
        )),
      ];
    }
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
  // A reply with no activity ("I don't know", "skip") just ends the note;
  // it is not an unsupported request.
  if (interaction.intent === "other" || interaction.events.length === 0)
    return [ended];
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
  answered: {
    crop?: string | null | undefined;
    field?: string | null | undefined;
    eventDate?: string | null | undefined;
  },
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

  // Review 2, finding 3: a gap answer is applied only when it is about the
  // same activity, or the model says it corrects a record rather than
  // describing a new one. Anything else leaves the nudge unanswered and is
  // handled as a new note.
  const answered =
    interaction.intent === "record"
      ? interaction.events.find(
          (event) => event.activity === targetEvent.activity,
        )
      : interaction.intent === "correct"
        ? interaction.correction?.changes
        : undefined;
  if (!answered) {
    return handleNewMessage(db, farmId, message, currentDate, recentEventIds);
  }

  const changes = buildGapCorrectionChanges(targetEvent, answered);
  if (Object.keys(changes).length === 0) {
    return [{ type: "reply", text: GAP_LEFT_AS_IS_REPLY }];
  }
  return [await correctTarget(db, farmId, target, changes, currentDate)];
}

async function farmListReply(
  db: Database,
  sessionId: string,
  lead: string,
): Promise<AgentAction[]> {
  const farms = await listFarmsBySession(db, sessionId);
  const farmNames = farms.map((farm) => farm.name).join(", ");
  return [{ type: "reply", text: `${lead} Your farms: ${farmNames}` }];
}

async function handleNewMessage(
  db: Database,
  activeFarmId: string,
  message: string,
  currentDate: string,
  recentEventIds: string[],
  sessionId?: string,
): Promise<AgentAction[]> {
  let farmId = activeFarmId;
  const memory = await loadFarmMemoryQuietly(db, farmId, currentDate);
  let interaction = await extractFarmEvent(
    message,
    currentDate,
    undefined,
    memory,
  );

  // One extraction answers both "what happened" and "which farm". Only a
  // message naming a different farm is extracted again, because the first
  // pass resolved fields and "same as before" against the wrong farm.
  if (sessionId && interaction.farmReference) {
    const resolution = await resolveFarmReference(
      db,
      sessionId,
      interaction.farmReference,
      farmId,
    );
    if (resolution?.status === "ambiguous") {
      return farmListReply(
        db,
        sessionId,
        "I found multiple farms with that name. Which one did you mean?",
      );
    }
    if (resolution?.status === "not_found") {
      return farmListReply(
        db,
        sessionId,
        `I couldn't find a farm named "${resolution.reference}".`,
      );
    }
    if (resolution?.status === "resolved" && resolution.farmId !== farmId) {
      farmId = resolution.farmId;
      const farmMemory = await loadFarmMemoryQuietly(db, farmId, currentDate);
      interaction = await extractFarmEvent(
        message,
        currentDate,
        undefined,
        farmMemory,
      );
    }
  }

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

  // A bare greeting or thanks needs no model call. Only checked with
  // nothing pending: a reply to a question must still end and save it.
  const smallTalk = classifySmallTalk(input.message);
  if (smallTalk)
    return [{ type: "reply", text: SMALL_TALK_REPLIES[smallTalk] }];

  return handleNewMessage(
    db,
    farmId,
    input.message,
    input.currentDate,
    recentEventIds,
    input.sessionId,
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
