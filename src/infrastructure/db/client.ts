import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type AppDb = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: AppDb | undefined;

export function getDb(): AppDb {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Set it to a PostgreSQL connection string.",
    );
  }
  pool = new Pool({ connectionString });
  database = drizzle(pool, { schema });
  return database;
}

export function getDbPool(): Pool {
  getDb();
  if (!pool) throw new Error("Database pool was not initialized.");
  return pool;
}
