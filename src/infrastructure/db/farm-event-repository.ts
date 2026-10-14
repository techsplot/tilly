import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  count,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type {
  FarmEvent,
  QuestionFilter as QuestionFilterType,
  ReportFilter as ReportFilterType,
} from "../../domain/farm-event";
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
    dateAssumed: row.dateAssumed,
    // Postgres' time column round-trips as "HH:MM:SS"; normalize back to
    // the "HH:MM" the model contract and corrections use.
    eventTime: row.eventTime ? row.eventTime.slice(0, 5) : row.eventTime,
    timeOfDay: row.timeOfDay,
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

// Lookup-only: never creates a field. Used by duplicate detection so
// checking for a duplicate never has the side effect of saving a field
// the agent then asks a question about and saves nothing (finding 5).
export async function findFieldByNormalizedName(
  db: Database,
  farmId: string,
  name: string,
): Promise<{ id: string } | null> {
  const [field] = await db
    .select({ id: fields.id })
    .from(fields)
    .where(
      and(
        eq(fields.farmId, farmId),
        eq(fields.normalizedName, normalizeFieldName(name)),
      ),
    )
    .limit(1);
  return field ?? null;
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
      dateAssumed: values.final.dateAssumed ?? false,
      eventTime: values.final.eventTime ?? null,
      timeOfDay: values.final.timeOfDay ?? null,
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

// Delete and restore also write event_corrections rows ({ deleted: ... }),
// so undoing a value correction must look only at the latest row that
// changed actual field values, ignoring those (finding 4).
export async function findLatestFieldCorrection(
  db: Database,
  eventId: string,
): Promise<EventCorrectionRow | undefined> {
  const [row] = await db
    .select()
    .from(eventCorrections)
    .where(
      and(
        eq(eventCorrections.eventId, eventId),
        sql`not (${eventCorrections.after} ? 'deleted')`,
      ),
    )
    .orderBy(desc(eventCorrections.createdAt))
    .limit(1);
  return row;
}

export async function insertCorrection(
  db: Database,
  eventId: string,
  before: unknown,
  after: unknown,
): Promise<string> {
  const [row] = await db
    .insert(eventCorrections)
    .values({ eventId, before, after })
    .returning({ id: eventCorrections.id });
  if (!row) throw new Error("Correction could not be saved.");
  return row.id;
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
      dateAssumed: event.dateAssumed ?? false,
      eventTime: event.eventTime ?? null,
      timeOfDay: event.timeOfDay ?? null,
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

// Finding 12: at most one gap reminder, for the most recent agent-saved
// record with a gap that has not been nudged in the last 24 hours and is
// not snoozed.
export async function findNudgeCandidate(
  db: Database,
  farmId: string,
): Promise<FarmEventRow | undefined> {
  const [row] = await db
    .select()
    .from(farmEvents)
    .where(
      and(
        eq(farmEvents.farmId, farmId),
        eq(farmEvents.savedBy, "agent"),
        eq(farmEvents.nudgesStopped, false),
        isNull(farmEvents.deletedAt),
        sql`array_length(${farmEvents.missingFields}, 1) > 0`,
        sql`(${farmEvents.lastNudgedAt} is null or ${farmEvents.lastNudgedAt} < now() - interval '24 hours')`,
      ),
    )
    .orderBy(
      sql`${farmEvents.eventDate} DESC NULLS LAST`,
      desc(farmEvents.createdAt),
    )
    .limit(1);
  return row;
}

export async function markNudged(db: Database, eventId: string): Promise<void> {
  await db
    .update(farmEvents)
    .set({ lastNudgedAt: new Date() })
    .where(eq(farmEvents.id, eventId));
}

export async function stopNudges(
  db: Database,
  farmId: string,
  eventId: string,
): Promise<void> {
  await db
    .update(farmEvents)
    .set({ nudgesStopped: true })
    .where(and(eq(farmEvents.farmId, farmId), eq(farmEvents.id, eventId)));
}

function buildEventFilterConditions(
  farmId: string,
  filter: QuestionFilterType | ReportFilterType,
) {
  const conditions = [
    eq(farmEvents.farmId, farmId),
    inArray(farmEvents.status, ["confirmed", "corrected"]),
    isNull(farmEvents.deletedAt),
  ];

  if (filter.activity) {
    conditions.push(eq(farmEvents.activity, filter.activity));
  }
  if (filter.crop) {
    conditions.push(eq(farmEvents.crop, filter.crop));
  }
  if (filter.field) {
    conditions.push(eq(farmEvents.fieldName, filter.field));
  }
  if (filter.dateFrom) {
    conditions.push(gte(farmEvents.eventDate, filter.dateFrom));
  }
  if (filter.dateTo) {
    conditions.push(lte(farmEvents.eventDate, filter.dateTo));
  }

  return and(...conditions);
}

export async function queryEvents(
  db: Database,
  farmId: string,
  filter: QuestionFilterType,
  limit = 50,
): Promise<FarmEventRow[]> {
  const whereClause = buildEventFilterConditions(farmId, filter);
  return db
    .select()
    .from(farmEvents)
    .where(whereClause)
    .orderBy(
      sql`${farmEvents.eventDate} DESC NULLS LAST`,
      desc(farmEvents.createdAt),
    )
    .limit(limit);
}

export async function aggregateReport(
  db: Database,
  farmId: string,
  filter: ReportFilterType,
): Promise<{
  byActivity: Record<string, number>;
  byField: Record<string, number>;
  byCrop: Record<string, number>;
  byDay: Record<string, number>;
  total: number;
}> {
  const whereClause = buildEventFilterConditions(farmId, filter);

  const [byActivityRows, byFieldRows, byCropRows, byDayRows, totalRows] =
    await Promise.all([
      db
        .select({
          activity: farmEvents.activity,
          count: count(),
        })
        .from(farmEvents)
        .where(whereClause)
        .groupBy(farmEvents.activity),
      db
        .select({
          field: farmEvents.fieldName,
          count: count(),
        })
        .from(farmEvents)
        .where(whereClause)
        .groupBy(farmEvents.fieldName),
      db
        .select({
          crop: farmEvents.crop,
          count: count(),
        })
        .from(farmEvents)
        .where(whereClause)
        .groupBy(farmEvents.crop),
      db
        .select({
          eventDate: farmEvents.eventDate,
          count: count(),
        })
        .from(farmEvents)
        .where(whereClause)
        .groupBy(farmEvents.eventDate),
      db.select({ count: count() }).from(farmEvents).where(whereClause),
    ]);

  const byActivity: Record<string, number> = {};
  for (const row of byActivityRows) {
    byActivity[row.activity] = Number(row.count);
  }

  const byField: Record<string, number> = {};
  for (const row of byFieldRows) {
    const key = row.field ?? "no field";
    byField[key] = Number(row.count);
  }

  const byCrop: Record<string, number> = {};
  for (const row of byCropRows) {
    const key = row.crop ?? "no crop";
    byCrop[key] = Number(row.count);
  }

  const byDay: Record<string, number> = {};
  for (const row of byDayRows) {
    const key = row.eventDate ?? "no date";
    byDay[key] = Number(row.count);
  }

  const total = totalRows[0] ? Number(totalRows[0].count) : 0;

  return { byActivity, byField, byCrop, byDay, total };
}
