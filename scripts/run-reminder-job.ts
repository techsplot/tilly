#!/usr/bin/env tsx
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/infrastructure/db/schema";
import { deliverDueReminders } from "../src/jobs/deliver-reminders";

config();

const { Pool } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    const currentDate = new Date().toISOString().slice(0, 10);
    console.log(`Running reminder delivery job for ${currentDate}`);

    const result = await deliverDueReminders(db, currentDate);

    console.log(
      `Reminder job completed: ${result.delivered} delivered, ${result.failed} failed, ${result.skipped} skipped`,
    );

    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Reminder job failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
