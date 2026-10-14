CREATE TYPE "public"."farm_event_saved_by" AS ENUM('agent', 'farmer');--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "saved_by" "farm_event_saved_by" DEFAULT 'farmer' NOT NULL;--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "deleted_at" timestamp with time zone;