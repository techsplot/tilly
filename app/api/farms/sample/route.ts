import { z } from "zod";
import {
  farmCookieHeader,
  getFarmContext,
  sessionCookieHeader,
} from "@/src/application/farm-context";
import { openSampleFarm } from "@/src/application/sample-farm";
import { getDb } from "@/src/infrastructure/db/client";
import { logError } from "@/src/infrastructure/request-log";

const sampleFarmSchema = z.object({
  currentDate: z.iso.date("A date in YYYY-MM-DD format is required"),
});

function isWithinOneDay(clientDate: string, serverDate: string): boolean {
  const diffDays = Math.abs(
    (new Date(clientDate).getTime() - new Date(serverDate).getTime()) /
      86400000,
  );
  return diffDays <= 1;
}

// POST /api/farms/sample - Open the session's sample farm, creating and
// filling it the first time, and make it the active farm. No model call.
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
  const parsed = sampleFarmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  // The sample's dates count back from the farmer's today.
  const serverDate = new Date().toISOString().slice(0, 10);
  if (!isWithinOneDay(parsed.data.currentDate, serverDate)) {
    return Response.json(
      { error: "The date you provided is more than one day away from today." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const context = await getFarmContext(db, request);
    const farm = await openSampleFarm(
      db,
      context.sessionId,
      parsed.data.currentDate,
    );
    const response = Response.json(
      { id: farm.farmId, name: farm.name, created: farm.created },
      { status: farm.created ? 201 : 200 },
    );
    if (context.isNewSession)
      response.headers.append(
        "Set-Cookie",
        sessionCookieHeader(context.sessionId),
      );
    response.headers.append("Set-Cookie", farmCookieHeader(farm.farmId));
    return response;
  } catch (error) {
    logError("Open sample farm failed", error);
    return Response.json(
      { error: "The sample farm could not be opened. Please try again." },
      { status: 500 },
    );
  }
}
