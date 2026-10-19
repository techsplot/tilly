import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  getFarmContext,
  farmCookieHeader,
  sessionCookieHeader,
} from "@/src/application/farm-context";
import {
  listTimeline,
  recordFarmEvent,
} from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { farmEventSchema } from "@/src/domain/farm-event";
import { farms } from "@/src/infrastructure/db/schema";
import { eventErrorResponse } from "./errors";

const recordRequestSchema = z.object({
  proposal: farmEventSchema,
  final: farmEventSchema,
  decision: z.enum(["confirm", "reject", "save_incomplete"]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Please send a valid JSON request." },
        { status: 400 },
      );
    }
    const parsed = recordRequestSchema.safeParse(body);
    if (!parsed.success) return eventErrorResponse(parsed.error);
    const db = getDb();
    const context = await getFarmContext(db, request);
    const saved = await recordFarmEvent(db, context.farmId, parsed.data);
    const response = Response.json(saved, { status: 201 });
    const cookies: string[] = [];
    if (context.isNewSession)
      cookies.push(sessionCookieHeader(context.sessionId));
    if (context.isNewFarm) cookies.push(farmCookieHeader(context.farmId));
    if (cookies.length > 0)
      response.headers.set("Set-Cookie", cookies.join(", "));
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const context = await getFarmContext(db, request);
    const [events, farmRows] = await Promise.all([
      listTimeline(db, context.farmId),
      db
        .select({ name: farms.name, id: farms.id })
        .from(farms)
        .where(eq(farms.id, context.farmId))
        .limit(1),
    ]);
    const response = Response.json({
      events,
      farmName: farmRows[0]?.name ?? "My Farm",
      farmId: farmRows[0]?.id,
    });
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}
