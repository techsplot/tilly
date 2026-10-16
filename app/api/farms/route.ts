import { z } from "zod";
import {
  getFarmContext,
  sessionCookieHeader,
  getSessionId,
} from "@/src/application/farm-context";
import { getDb } from "@/src/infrastructure/db/client";
import {
  listFarmsBySession,
  createFarm,
} from "@/src/infrastructure/db/farm-event-repository";

// GET /api/farms - List all farms for the current session
export async function GET(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const sessionId = await getSessionId(request);
    const farms = await listFarmsBySession(db, sessionId);
    return Response.json({ farms });
  } catch (error) {
    console.error("List farms failed", error);
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
    console.error("Create farm failed", error);
    return Response.json({ error: "Failed to create farm." }, { status: 500 });
  }
}
