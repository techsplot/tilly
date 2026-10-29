import { z } from "zod";
import {
  getFarmContext,
  sessionCookieHeader,
  farmCookieHeader,
} from "@/src/application/farm-context";
import { getDb } from "@/src/infrastructure/db/client";
import {
  createFarm,
  findLatestRecord,
  listFarmsBySession,
} from "@/src/infrastructure/db/farm-event-repository";
import { logError } from "@/src/infrastructure/request-log";

// GET /api/farms - List the session's farms, which one is active, and its
// latest record for the greeting. A first visit creates the session and its
// first farm here.
export async function GET(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const context = await getFarmContext(db, request);
    const [farms, lastRecord] = await Promise.all([
      listFarmsBySession(db, context.sessionId),
      findLatestRecord(db, context.farmId),
    ]);
    const response = Response.json({
      farms: farms.map(({ id, name }) => ({ id, name })),
      activeFarmId: context.farmId,
      lastRecord,
    });
    const cookies: string[] = [];
    if (context.isNewSession)
      cookies.push(sessionCookieHeader(context.sessionId));
    if (context.isNewFarm) cookies.push(farmCookieHeader(context.farmId));
    if (cookies.length > 0)
      response.headers.set("Set-Cookie", cookies.join(", "));
    return response;
  } catch (error) {
    logError("List farms failed", error);
    return Response.json({ error: "Failed to list farms." }, { status: 500 });
  }
}

const createFarmSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Farm name cannot be empty")
    .max(100, "Farm name must be 100 characters or less"),
});

// POST /api/farms - Create a new farm
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Please send a valid JSON request." },
      { status: 400 },
    );
  }

  const parsed = createFarmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const context = await getFarmContext(db, request);
    const farmId = await createFarm(db, context.sessionId, parsed.data.name);

    const response = Response.json(
      { id: farmId, name: parsed.data.name },
      { status: 201 },
    );

    // Set session cookie if new session
    if (context.isNewSession) {
      response.headers.set(
        "Set-Cookie",
        sessionCookieHeader(context.sessionId),
      );
    }

    return response;
  } catch (error) {
    logError("Create farm failed", error);
    return Response.json({ error: "Failed to create farm." }, { status: 500 });
  }
}
