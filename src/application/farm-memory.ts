import {
  loadMemoryEvents,
  loadMemoryFields,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import type { FarmMemory } from "../domain/farm-memory";

export type {
  FarmMemory,
  MemoryEvent,
  MemoryField,
} from "../domain/farm-memory";

export async function loadFarmMemory(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<FarmMemory> {
  const [fields, recentEvents] = await Promise.all([
    loadMemoryFields(db, farmId),
    loadMemoryEvents(db, farmId, currentDate),
  ]);
  return { fields, recentEvents };
}
