import {
  confirmEvent,
  correctEvent,
  farmEventCandidateSchema,
  getMissingFields,
  LifecycleError,
  rejectEvent,
  ValidationError,
  type FarmEvent,
} from "../domain/farm-event";
import {
  findActionableMemoryEventIds,
  findFarmEvent,
  findFarmEventAny,
  findLatestCorrection,
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
  const keys = ["crop", "field", "eventDate", "quantity", "unit"] as const;
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

export async function recordAgentEvent(
  db: Database,
  farmId: string,
  input: { final: FarmEvent; status: "confirmed" | "incomplete" },
): Promise<SavedFarmEvent> {
  return db.transaction(async (tx) => {
    const validated = validateFinal(input.final);
    const final = {
      ...validated,
      status: validated.missingFields.length > 0 ? "incomplete" : input.status,
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
    return withId(row);
  });
}

export async function undoAgentAction(
  db: Database,
  farmId: string,
  eventId: string,
  action: UndoableAction,
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

    const correction = await findLatestCorrection(tx, eventId);
    if (!correction) {
      throw new LifecycleError("No correction to undo for this record.");
    }
    const before = toFarmEvent(row);
    const reversed = correctEvent(
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

export async function correctRecordedEvent(
  db: Database,
  farmId: string,
  eventId: string,
  changes: Parameters<typeof correctEvent>[1],
): Promise<SavedFarmEvent> {
  return db.transaction(async (tx) => {
    const row = await findFarmEvent(tx, farmId, eventId);
    if (!row) throw new NotFoundError("Farm event was not found.");
    const before = toFarmEvent(row);
    const corrected = correctEvent(before, changes);
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
    if (correction) {
      await insertCorrection(tx, eventId, correction.before, correction.after);
    }
    return withId(updated);
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
