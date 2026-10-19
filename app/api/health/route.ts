import { sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";

// Never cached or prerendered: each probe must reach the database.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

// For the host's health probe. Checks only that the database answers; it
// never calls a model, and a failure says nothing about why, so connection
// strings and driver errors cannot leak.
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "error" }, { status: 503, headers });
  }
}
