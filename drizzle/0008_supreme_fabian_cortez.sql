CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "delivery_method" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "carrier_status" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "carrier_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "twilio_message_sid" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_farm_idx" ON "push_subscriptions" USING btree ("farm_id");--> statement-breakpoint
CREATE INDEX "farms_phone_number_idx" ON "farms" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "reminders_twilio_sid_idx" ON "reminders" USING btree ("twilio_message_sid");--> statement-breakpoint
CREATE INDEX "reminders_snoozed_until_idx" ON "reminders" USING btree ("snoozed_until");