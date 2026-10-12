import {
  confirmEvent,
  correctAgentEvent,
  correctEvent,
  farmEventCandidateSchema,
  getMissingFields,
  importantFieldsByActivity,
  LifecycleError,
  rejectEvent,
  ValidationError,
  type FarmEvent,
} from "../domain/farm-event";
import {
  findActionableMemoryEventIds,
  findDuplicateEvent,
  findFarmEvent,
  findFarmEventAny,
  findFieldByNormalizedName,
  findLatestCorrection,
  findLatestFieldCorrection,
  insertCorrection,
  insertFarmEvent,
  listFarmEvents as listRows,
  restoreFarmEvent,
  softDeleteFarmEvent,
  toFarmEvent,
  updateFarmEvent,
  upsertField,
  type Database,
  type SavedBy,
} from "../infrastructure/db/farm-event-repository";
import { NotFoundError } from "./errors";

export type Decision = "confirm" | "reject" | "save_incomplete";
export type UndoableAction = "recorded" | "corrected" | "deleted";
export type SavedFarmEvent = FarmEvent & { id: string; savedBy: SavedBy };

function withId(
  row: Awaited<ReturnType<typeof insertFarmEvent>>,
): SavedFarmEvent {
  return { ...toFarmEvent(row), id: row.id, savedBy: row.savedBy };
}

function validateFinal(event: FarmEvent): FarmEvent {
  const candidate = farmEventCandidateSchema.safeParse(event);
  if (!candidate.success) {
    throw new ValidationError(
      candidate.error.issues[0]?.message ?? "Invalid farm event.",
    );
  }
  return {
    ...event,
    ...candidate.data,
    missingFields: getMissingFields(candidate.data),
  };
}

function decisionEvent(event: FarmEvent, decision: Decision): FarmEvent {
  const validated = validateFinal(event);
  const missingFields = getMissingFields(validated);
  const normalized = {
    ...validated,
    missingFields,
    status: missingFields.length > 0 ? "incomplete" : "proposed",
  } satisfies FarmEvent;
  if (decision === "confirm") return confirmEvent(normalized);
  if (decision === "reject") return rejectEvent(normalized);
  if (normalized.missingFields.length === 0) {
    throw new LifecycleError("save_incomplete requires missing fields");
  }
  return normalized;
}

export function changedFields(
  before: FarmEvent,
  after: FarmEvent,
): {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} | null {
  const keys = [
    "crop",
    "field",
    "eventDate",
    "quantity",
    "unit",
    "eventTime",
    "timeOfDay",
  ] as const;
  const beforeValues: Record<string, unknown> = {};
  const afterValues: Record<string, unknown> = {};
  for (const key of keys) {
    if (before[key] !== after[key]) {
      beforeValues[key] = before[key];
      afterValues[key] = after[key];
    }
  }
  return Object.keys(beforeValues).length > 0
    ? { before: beforeValues, after: afterValues }
    : null;
}

export async function recordFarmEvent(
  db: Database,
  farmId: string,
  input: { proposal: FarmEvent; final: FarmEvent; decision: Decision },
): Promise<SavedFarmEvent> {
  return db.transaction(async (tx) => {
    const decided = decisionEvent(input.final, input.decision);
    const final = {
      ...decided,
      memoryEventIds: await findActionableMemoryEventIds(
        tx,
        farmId,
        decided.memoryEventIds ?? [],
      ),
    } satisfies FarmEvent;
    const field = final.field
      ? await upsertField(tx, farmId, final.field)
      : null;
    const row = await insertFarmEvent(tx, {
      farmId,
      fieldId: field?.id ?? null,
      final,
      sourceText: input.proposal.sourceText,
      savedBy: "farmer",
    });
    const correction = changedFields(input.proposal, final);
    if (correction) {
      await insertCorrection(tx, row.id, correction.before, correction.after);
    }
    return withId(row);
  });
}

// Rule 11 ("save rules"): agent-saved records are always confirmed. A
// missing date is assumed to be currentDate and flagged via date_assumed
// and missing_fields; other gaps are simply left null and listed. Finding
// 6: the duplicate check runs inside the same transaction as the save and
// returns a signal rather than blocking it (finding 13: duplicates are
// saved and flagged, not questioned).
export async function recordAgentEvent(
  db: Database,
  farmId: string,
  input: { final: FarmEvent; currentDate: string },
): Promise<{ event: SavedFarmEvent; possibleDuplicate: boolean }> {
  return db.transaction(async (tx) => {
    const candidate = farmEventCandidateSchema.safeParse(input.final);
    if (!candidate.success) {
      throw new ValidationError(
        candidate.error.issues[0]?.message ?? "Invalid farm event.",
      );
    }
    const dateAssumed = !candidate.data.eventDate;
    const eventDate = candidate.data.eventDate ?? input.currentDate;
    const importantGaps = (
      importantFieldsByActivity[candidate.data.activity] ?? []
    ).filter((field) => !candidate.data[field]);
    const missingFields = dateAssumed
      ? [...importantGaps, "eventDate"]
      : importantGaps;

    // Lookup-only: checking for a duplicate must never create a field.
    const existingField = candidate.data.field
      ? await findFieldByNormalizedName(tx, farmId, candidate.data.field)
      : null;
    const possibleDuplicate = Boolean(
      await findDuplicateEvent(tx, farmId, {
        activity: candidate.data.activity,
        eventDate,
        fieldId: existingField?.id ?? null,
      }),
    );

    const final = {
      ...input.final,
      ...candidate.data,
      eventDate,
      dateAssumed,
      missingFields,
      status: "confirmed",
      memoryEventIds: await findActionableMemoryEventIds(
        tx,
        farmId,
        input.final.memoryEventIds ?? [],
      ),
    } satisfies FarmEvent;
    const field = final.field
      ? await upsertField(tx, farmId, final.field)
      : null;
    const row = await insertFarmEvent(tx, {
      farmId,
      fieldId: field?.id ?? null,
      final,
      sourceText: final.sourceText,
      savedBy: "agent",
    });
    return { event: withId(row), possibleDuplicate };
  });
}

const CHANGED_SINCE_REPLY =
  "This record changed since; tell me what it should be.";

export async function undoAgentAction(
  db: Database,
  farmId: string,
  eventId: string,
  action: UndoableAction,
  correctionId?: string,
): Promise<SavedFarmEvent> {
  return db.transaction(async (tx) => {
    const row = await findFarmEventAny(tx, farmId, eventId);
    if (!row) throw new NotFoundError("Farm event was not found.");
    const isDeleted = row.deletedAt !== null;

    if (action === "deleted") {
      if (!isDeleted) {
        throw new LifecycleError("This record is not currently deleted.");
      }
      const restored = await restoreFarmEvent(tx, farmId, eventId);
      await insertCorrection(
        tx,
        eventId,
        { deleted: true },
        { deleted: false },
      );
      return withId(restored);
    }

    if (isDeleted) {
      throw new LifecycleError("This record has already been deleted.");
    }

    if (action === "recorded") {
      const deleted = await softDeleteFarmEvent(tx, farmId, eventId);
      await insertCorrection(
        tx,
        eventId,
        { deleted: false },
        { deleted: true },
      );
      return withId(deleted);
    }

    // Finding 4: delete/restore also write event_corrections rows, so look
    // only at the latest row that changed field values, and refuse to undo
    // unless it is still the correction that produced the record's current
    // values (and, when given, the exact row the caller meant to undo).
    const correction = await findLatestFieldCorrection(tx, eventId);
    if (!correction) {
      throw new LifecycleError("No correction to undo for this record.");
    }
    const before = toFarmEvent(row);
    const afterValues = correction.after as Record<string, unknown>;
    const stillCurrent =
      (correctionId === undefined || correctionId === correction.id) &&
      Object.entries(afterValues).every(
        ([key, value]) => (before as Record<string, unknown>)[key] === value,
      );
    if (!stillCurrent) {
      throw new LifecycleError(CHANGED_SINCE_REPLY);
    }
    const reversed =
      row.savedBy === "agent"
        ? correctAgentEvent(
            before,
            correction.before as Parameters<typeof correctAgentEvent>[1],
            before.eventDate ?? new Date().toISOString().slice(0, 10),
          )
        : correctEvent(
            before,
            correction.before as Parameters<typeof correctEvent>[1],
          );
    const field = reversed.field
      ? await upsertField(tx, farmId, reversed.field)
      : null;
    const updated = await updateFarmEvent(
      tx,
      farmId,
      eventId,
      reversed,
      field?.id ?? null,
    );
    const diff = changedFields(before, reversed);
    if (diff) {
      await insertCorrection(tx, eventId, diff.before, diff.after);
    }
    return withId(updated);
  });
}

export type CorrectionResult = {
  event: SavedFarmEvent;
  correctionId: string | null;
};

// Agent-saved records use correctAgentEvent (rule 11: a gap never demotes
// status, and a cleared date is re-assumed); farmer-saved records from the
// older Phase 2/3 flow keep correctEvent's required-field policy.
export async function correctRecordedEvent(
  db: Database,
  farmId: string,
  eventId: string,
  changes: Parameters<typeof correctEvent>[1] &
    Pick<Parameters<typeof correctAgentEvent>[1], "eventTime" | "timeOfDay">,
  currentDate?: string,
): Promise<CorrectionResult> {
  return db.transaction(async (tx) => {
    const row = await findFarmEvent(tx, farmId, eventId);
    if (!row) throw new NotFoundError("Farm event was not found.");
    const before = toFarmEvent(row);
    const corrected =
      row.savedBy === "agent"
        ? correctAgentEvent(
            before,
            changes,
            currentDate ??
              before.eventDate ??
              new Date().toISOString().slice(0, 10),
          )
        : correctEvent(before, changes);
    const field = corrected.field
      ? await upsertField(tx, farmId, corrected.field)
      : null;
    const updated = await updateFarmEvent(
      tx,
      farmId,
      eventId,
      corrected,
      field?.id ?? null,
    );
    const correction = changedFields(before, corrected);
    const correctionId = correction
      ? await insertCorrection(tx, eventId, correction.before, correction.after)
      : null;
    return { event: withId(updated), correctionId };
  });
}

export async function confirmRecordedEvent(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<SavedFarmEvent> {
  return transitionSavedEvent(db, farmId, eventId, confirmEvent);
}

export async function rejectRecordedEvent(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<SavedFarmEvent> {
  return transitionSavedEvent(db, farmId, eventId, rejectEvent);
}

async function transitionSavedEvent(
  db: Database,
  farmId: string,
  eventId: string,
  transition: (event: FarmEvent) => FarmEvent,
): Promise<SavedFarmEvent> {
  return db.transaction(async (tx) => {
    const row = await findFarmEvent(tx, farmId, eventId);
    if (!row) throw new NotFoundError("Farm event was not found.");
    const updated = await updateFarmEvent(
      tx,
      farmId,
      eventId,
      transition(toFarmEvent(row)),
      row.fieldId,
    );
    return withId(updated);
  });
}

export async function listTimeline(
  db: Database,
  farmId: string,
): Promise<SavedFarmEvent[]> {
  const rows = await listRows(db, farmId);
  return rows.map((row) => withId(row));
}
