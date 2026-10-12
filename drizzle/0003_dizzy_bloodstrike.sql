CREATE TYPE "public"."farm_time_of_day" AS ENUM('morning', 'afternoon', 'evening', 'night');--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "date_assumed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "event_time" time;--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "time_of_day" "farm_time_of_day";--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "last_nudged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "farm_events" ADD COLUMN "nudges_stopped" boolean DEFAULT false NOT NULL;