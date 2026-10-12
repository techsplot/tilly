import { z } from "zod";
import {
  getExistingFarmId,
  getFarmContext,
  farmCookieHeader,
} from "@/src/application/farm-context";
import {
  listTimeline,
  recordFarmEvent,
} from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { farmEventSchema } from "@/src/domain/farm-event";
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
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const farmId = await getExistingFarmId(db, request);
    if (!farmId) return Response.json({ events: [] });
    const response = Response.json({
      events: await listTimeline(db, farmId),
    });
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}
