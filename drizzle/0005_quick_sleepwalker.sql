ALTER TABLE "farms" ADD COLUMN "wake_word" text DEFAULT 'hey farmmind' NOT NULL;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "wake_word_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "farms_wake_word_enabled_idx" ON "farms" USING btree ("id","wake_word_enabled");