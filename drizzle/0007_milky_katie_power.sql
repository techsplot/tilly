CREATE TYPE "public"."reminder_kind" AS ENUM('manual', 'gap', 'suggested');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"source_event_id" uuid,
	"reminder_date" date NOT NULL,
	"activity" text NOT NULL,
	"field_name" text,
	"crop" text,
	"message" text,
	"status" "reminder_status" DEFAULT 'pending' NOT NULL,
	"reminder_kind" "reminder_kind" NOT NULL,
	"delivery_attempts" numeric DEFAULT '0' NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_source_event_required_for_gap_suggested" CHECK (
		(reminder_kind = 'manual') OR 
		(reminder_kind IN ('gap', 'suggested') AND source_event_id IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_source_event_id_farm_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."farm_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_farm_status_date_idx" ON "reminders" USING btree ("farm_id","status","reminder_date");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_source_event_kind_idx" ON "reminders" USING btree ("source_event_id","reminder_kind") WHERE source_event_id IS NOT NULL;