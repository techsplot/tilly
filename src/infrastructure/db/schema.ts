import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const farmActivityEnum = pgEnum("farm_activity", [
  "planting",
  "fertilizing",
  "weeding",
  "spraying",
  "harvesting",
  "inspection",
  "irrigation",
  "other",
] as const);
export const farmEventStatusEnum = pgEnum("farm_event_status", [
  "proposed",
  "incomplete",
  "confirmed",
  "corrected",
  "rejected",
] as const);
export const farmEventSavedByEnum = pgEnum("farm_event_saved_by", [
  "agent",
  "farmer",
] as const);
export const farmTimeOfDayEnum = pgEnum("farm_time_of_day", [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const);

export const farms = pgTable(
  "farms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    sessionId: text("session_id").notNull(),
    wakeWord: text("wake_word").notNull().default("hey farmmind"),
    wakeWordEnabled: boolean("wake_word_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    wakeWordEnabledIdx: index("farms_wake_word_enabled_idx").on(
      table.id,
      table.wakeWordEnabled,
    ),
  }),
);

export const fields = pgTable(
  "fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    farmNormalizedName: uniqueIndex("fields_farm_normalized_name_idx").on(
      table.farmId,
      table.normalizedName,
    ),
  }),
);

export const farmEvents = pgTable(
  "farm_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id").references(() => fields.id, {
      onDelete: "set null",
    }),
    activity: farmActivityEnum("activity").notNull(),
    crop: text("crop"),
    fieldName: text("field_name"),
    eventDate: date("event_date"),
    quantity: numeric("quantity"),
    unit: text("unit"),
    status: farmEventStatusEnum("status").notNull(),
    missingFields: text("missing_fields").array().notNull(),
    sourceText: text("source_text").notNull(),
    memoryEventIds: uuid("memory_event_ids").array().notNull().default([]),
    savedBy: farmEventSavedByEnum("saved_by").notNull().default("farmer"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    dateAssumed: boolean("date_assumed").notNull().default(false),
    eventTime: time("event_time"),
    timeOfDay: farmTimeOfDayEnum("time_of_day"),
    lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
    nudgesStopped: boolean("nudges_stopped").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    farmDate: index("farm_events_farm_date_idx").on(
      table.farmId,
      table.eventDate,
    ),
  }),
);

export const eventCorrections = pgTable("event_corrections", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => farmEvents.id, { onDelete: "cascade" }),
  before: jsonb("before").notNull(),
  after: jsonb("after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type FarmRow = typeof farms.$inferSelect;
export type FieldRow = typeof fields.$inferSelect;
export type FarmEventRow = typeof farmEvents.$inferSelect;
export type EventCorrectionRow = typeof eventCorrections.$inferSelect;
