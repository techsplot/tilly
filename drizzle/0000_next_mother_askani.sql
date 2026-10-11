CREATE TYPE "public"."farm_activity" AS ENUM('planting', 'fertilizing', 'weeding', 'spraying', 'harvesting', 'inspection', 'irrigation', 'other');--> statement-breakpoint
CREATE TYPE "public"."farm_event_status" AS ENUM('proposed', 'incomplete', 'confirmed', 'corrected', 'rejected');--> statement-breakpoint
CREATE TABLE "event_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farm_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"field_id" uuid,
	"activity" "farm_activity" NOT NULL,
	"crop" text,
	"field_name" text,
	"event_date" date,
	"quantity" numeric,
	"unit" text,
	"status" "farm_event_status" NOT NULL,
	"missing_fields" text[] NOT NULL,
	"source_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_corrections" ADD CONSTRAINT "event_corrections_event_id_farm_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."farm_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_events" ADD CONSTRAINT "farm_events_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm_events" ADD CONSTRAINT "farm_events_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "farm_events_farm_date_idx" ON "farm_events" USING btree ("farm_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_farm_normalized_name_idx" ON "fields" USING btree ("farm_id","normalized_name");