import {
  confirmEvent,
  correctEvent,
  farmEventCandidateSchema,
  getMissingFields,
  rejectEvent,
  type FarmEvent,
} from "../domain/farm-event";
import {
  findFarmEvent,
  insertCorrection,
  insertFarmEvent,
  listFarmEvents as listRows,
  normalizeFieldName,
  toFarmEvent,
  updateFarmEvent,
  upsertField,
  type Database,
} from "../infrastructure/db/farm-event-repository";

export type Decision = "confirm" | "reject" | "save_incomplete";
export type SavedFarmEvent = FarmEvent & { id: string };

function withId(
  row: Awaited<ReturnType<typeof insertFarmEvent>>,
): SavedFarmEvent {
  return { ...toFarmEvent(row), id: row.id };
}

function validateFinal(event: FarmEvent): FarmEvent {
  const candidate = farmEventCandidateSchema.safeParse(event);
  if (!candidate.success) {
    throw new Error(
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
  if (decision === "confirm") return confirmEvent(validated);
  if (decision === "reject") return rejectEvent(validated);
  if (validated.missingFields.length === 0) {
    throw new Error("save_incomplete requires missing fields");
  }
  return { ...validated, status: "incomplete" };
}

function changedFields(
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
    const final = decisionEvent(input.final, input.decision);
    const field = final.field
      ? await upsertField(tx, farmId, final.field)
      : null;
    const row = await insertFarmEvent(tx, {
      farmId,
      fieldId: field?.id ?? null,
      final,
      sourceText: input.proposal.sourceText,
    });
    const correction = changedFields(input.proposal, final);
    if (correction) {
      await insertCorrection(tx, row.id, correction.before, correction.after);
    }
    return withId(row);
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
    if (!row) throw new Error("Farm event was not found.");
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
    if (!row) throw new Error("Farm event was not found.");
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
  return rows.map((row) => ({ ...toFarmEvent(row), id: row.id }));
}

export { normalizeFieldName };
