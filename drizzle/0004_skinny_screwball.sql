-- Add columns as nullable first
ALTER TABLE "farms" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "session_id" text;--> statement-breakpoint

-- Set default values for existing farms
UPDATE "farms" SET "name" = 'My Farm', "session_id" = "id"::text WHERE "name" IS NULL;--> statement-breakpoint

-- Make columns non-nullable
ALTER TABLE "farms" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "farms" ALTER COLUMN "session_id" SET NOT NULL;