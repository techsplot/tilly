import type { FarmEvent } from "../domain/farm-event";
import {
  createFarm,
  findFarmByNameAndSession,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import { correctRecordedEvent, recordFarmEvent } from "./persist-farm-event";
import {
  SAMPLE_FARM_NAME,
  SAMPLE_RECORDS,
  type SampleRecord,
} from "./sample-farm-data";

function daysBefore(currentDate: string, days: number): string {
  const date = new Date(`${currentDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function toFarmEvent(record: SampleRecord, currentDate: string): FarmEvent {
  return {
    activity: record.activity,
    crop: record.crop,
    field: record.field,
    eventDate: daysBefore(currentDate, record.daysAgo),
    quantity: record.quantity,
    unit: record.unit,
    eventTime: null,
    timeOfDay: record.timeOfDay,
    status: "proposed",
    missingFields: [],
    sourceText: record.sourceText,
  };
}

/**
 * Opens this session's sample farm, creating and filling it the first time.
 * Uses the same repository functions as the farmer's own saves, with no
 * model call, and every record is saved_by "farmer".
 */
export async function openSampleFarm(
  db: Database,
  sessionId: string,
  currentDate: string,
): Promise<{ farmId: string; name: string; created: boolean }> {
  const [existing] = await findFarmByNameAndSession(
    db,
    SAMPLE_FARM_NAME,
    sessionId,
  );
  if (existing) {
    return { farmId: existing.id, name: existing.name, created: false };
  }

  // One transaction, so a failure part-way leaves no half-filled farm.
  const farmId = await db.transaction(async (tx) => {
    const id = await createFarm(tx, sessionId, SAMPLE_FARM_NAME);
    for (const record of SAMPLE_RECORDS) {
      const event = toFarmEvent(record, currentDate);
      const saved = await recordFarmEvent(tx, id, {
        proposal: event,
        final: event,
        decision: record.gap ? "save_incomplete" : "confirm",
      });
      if (record.correctedTo) {
        await correctRecordedEvent(tx, id, saved.id, record.correctedTo);
      }
    }
    return id;
  });
  return { farmId, name: SAMPLE_FARM_NAME, created: true };
}
