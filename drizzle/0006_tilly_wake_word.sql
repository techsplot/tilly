ALTER TABLE "farms" ALTER COLUMN "wake_word" SET DEFAULT 'hey tilly';--> statement-breakpoint
-- Farms still on the old default answer to the new name. Custom wake words
-- and the other presets are left as the farmer chose them.
UPDATE "farms" SET "wake_word" = 'hey tilly' WHERE "wake_word" = 'hey farmmind';
