import {
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
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

export const farms = pgTable("farms", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
