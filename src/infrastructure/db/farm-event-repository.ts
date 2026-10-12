import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { FarmEvent } from "../../domain/farm-event";
import {
  eventCorrections,
  farmEvents,
  fields,
  farms,
  type EventCorrectionRow,
  type FarmEventRow,
} from "./schema";
import type * as schema from "./schema";
import type { MemoryEvent, MemoryField } from "../../domain/farm-memory";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type SavedBy = "agent" | "farmer";

export function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toFarmEvent(row: FarmEventRow): FarmEvent {
  return {
    activity: row.activity,
    crop: row.crop,
    field: row.fieldName,
    eventDate: row.eventDate,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    status: row.status,
    missingFields: row.missingFields,
    sourceText: row.sourceText,
    memoryEventIds: row.memoryEventIds,
  };
}

function activeEventFilter(farmId: string, eventId: string) {
  return and(
    eq(farmEvents.farmId, farmId),
    eq(farmEvents.id, eventId),
    isNull(farmEvents.deletedAt),
  );
}

export async function createFarm(db: Database): Promise<string> {
  const [farm] = await db.insert(farms).values({}).returning({ id: farms.id });
  if (!farm) throw new Error("Farm could not be created.");
  return farm.id;
}

export async function findFarm(db: Database, farmId: string): Promise<boolean> {
  const [farm] = await db
    .select({ id: farms.id })
    .from(farms)
    .where(eq(farms.id, farmId))
    .limit(1);
  return Boolean(farm);
}

export async function findFarmEvent(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<FarmEventRow | undefined> {
  const [row] = await db
    .select()
    .from(farmEvents)
    .where(activeEventFilter(farmId, eventId))
    .limit(1);
  return row;
}

export async function findFarmEventAny(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<FarmEventRow | undefined> {
  const [row] = await db
    .select()
    .from(farmEvents)
    .where(and(eq(farmEvents.farmId, farmId), eq(farmEvents.id, eventId)))
    .limit(1);
  return row;
}

export async function findFirstOwnedActiveEvent(
  db: Database,
  farmId: string,
  eventIds: string[],
): Promise<FarmEventRow | undefined> {
  if (eventIds.length === 0) return undefined;
  const rows = await db
    .select()
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        inArray(farmEvents.id, eventIds),
        isNull(farmEvents.deletedAt),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of eventIds) {
    const row = byId.get(id);
    if (row) return row;
  }
  return undefined;
}

export async function findDuplicateEvent(
  db: Database,
  farmId: string,
  values: {
    activity: FarmEvent["activity"];
    eventDate: string;
    fieldId: string | null;
  },
): Promise<FarmEventRow | undefined> {
  const [row] = await db
    .select()
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        eq(farmEvents.activity, values.activity),
        eq(farmEvents.eventDate, values.eventDate),
        values.fieldId === null
          ? isNull(farmEvents.fieldId)
          : eq(farmEvents.fieldId, values.fieldId),
        isNull(farmEvents.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function upsertField(
  db: Database,
  farmId: string,
  name: string,
): Promise<{ id: string }> {
  const [field] = await db
    .insert(fields)
    .values({
      farmId,
      name: name.trim(),
      normalizedName: normalizeFieldName(name),
    })
    .onConflictDoUpdate({
      target: [fields.farmId, fields.normalizedName],
      set: { name: name.trim() },
    })
    .returning({ id: fields.id });
  if (!field) throw new Error("Field could not be saved.");
  return field;
}

export async function insertFarmEvent(
  db: Database,
  values: {
    farmId: string;
    fieldId: string | null;
    final: FarmEvent;
    sourceText: string;
    savedBy: SavedBy;
  },
): Promise<FarmEventRow> {
  const [row] = await db
    .insert(farmEvents)
    .values({
      farmId: values.farmId,
      fieldId: values.fieldId,
      activity: values.final.activity,
      crop: values.final.crop,
      fieldName: values.final.field,
      eventDate: values.final.eventDate,
      quantity: values.final.quantity?.toString() ?? null,
      unit: values.final.unit,
      status: values.final.status,
      missingFields: values.final.missingFields,
      sourceText: values.sourceText,
      memoryEventIds: values.final.memoryEventIds ?? [],
      savedBy: values.savedBy,
    })
    .returning();
  if (!row) throw new Error("Farm event could not be saved.");
  return row;
}

export async function findActionableMemoryEventIds(
  db: Database,
  farmId: string,
  eventIds: string[],
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const rows = await db
    .select({ id: farmEvents.id })
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        inArray(farmEvents.id, eventIds),
        inArray(farmEvents.status, ["confirmed", "corrected"]),
        isNull(farmEvents.deletedAt),
      ),
    );
  return rows.map((row) => row.id);
}

export async function softDeleteFarmEvent(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<FarmEventRow> {
  const [row] = await db
    .update(farmEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(activeEventFilter(farmId, eventId))
    .returning();
  if (!row) throw new Error("Farm event was not found.");
  return row;
}

export async function restoreFarmEvent(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<FarmEventRow> {
  const [row] = await db
    .update(farmEvents)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        eq(farmEvents.id, eventId),
        sql`${farmEvents.deletedAt} is not null`,
      ),
    )
    .returning();
  if (!row) throw new Error("Farm event was not found.");
  return row;
}

export async function findLatestCorrection(
  db: Database,
  eventId: string,
): Promise<EventCorrectionRow | undefined> {
  const [row] = await db
    .select()
    .from(eventCorrections)
    .where(eq(eventCorrections.eventId, eventId))
    .orderBy(desc(eventCorrections.createdAt))
    .limit(1);
  return row;
}

export async function insertCorrection(
  db: Database,
  eventId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.insert(eventCorrections).values({ eventId, before, after });
}

export async function updateFarmEvent(
  db: Database,
  farmId: string,
  eventId: string,
  event: FarmEvent,
  fieldId: string | null,
): Promise<FarmEventRow> {
  const [row] = await db
    .update(farmEvents)
    .set({
      fieldId,
      crop: event.crop,
      fieldName: event.field,
      eventDate: event.eventDate,
      quantity: event.quantity?.toString() ?? null,
      unit: event.unit,
      status: event.status,
      missingFields: event.missingFields,
      updatedAt: new Date(),
    })
    .where(activeEventFilter(farmId, eventId))
    .returning();
  if (!row) throw new Error("Farm event was not found.");
  return row;
}

export async function listFarmEvents(
  db: Database,
  farmId: string,
): Promise<FarmEventRow[]> {
  return db
    .select()
    .from(farmEvents)
    .where(and(eq(farmEvents.farmId, farmId), isNull(farmEvents.deletedAt)))
    .orderBy(
      sql`${farmEvents.eventDate} DESC NULLS LAST`,
      desc(farmEvents.createdAt),
    )
    .limit(200);
}

export async function loadMemoryFields(
  db: Database,
  farmId: string,
): Promise<MemoryField[]> {
  const rows = await db
    .select({
      id: fields.id,
      name: fields.name,
      lastUsedAt: sql<Date | null>`max(${farmEvents.createdAt})`,
    })
    .from(fields)
    .innerJoin(
      farmEvents,
      and(
        eq(farmEvents.fieldId, fields.id),
        eq(farmEvents.farmId, farmId),
        inArray(farmEvents.status, ["confirmed", "corrected"]),
        isNull(farmEvents.deletedAt),
      ),
    )
    .where(eq(fields.farmId, farmId))
    .groupBy(fields.id, fields.name)
    .orderBy(sql`max(${farmEvents.createdAt}) DESC NULLS LAST`, fields.name)
    .limit(20);
  return rows.map(({ id, name }) => ({ id, name }));
}

export async function loadMemoryEvents(
  db: Database,
  farmId: string,
  currentDate: string,
): Promise<MemoryEvent[]> {
  const startDate = sql`${currentDate}::date - interval '60 days'`;
  const endDate = sql`${currentDate}::date`;
  const rows = await db
    .select({
      id: farmEvents.id,
      activity: farmEvents.activity,
      crop: farmEvents.crop,
      field: farmEvents.fieldName,
      eventDate: farmEvents.eventDate,
    })
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        inArray(farmEvents.status, ["confirmed", "corrected"]),
        isNull(farmEvents.deletedAt),
        gte(farmEvents.eventDate, startDate),
        lte(farmEvents.eventDate, endDate),
      ),
    )
    .orderBy(desc(farmEvents.eventDate), desc(farmEvents.createdAt))
    .limit(10);
  return rows;
}
