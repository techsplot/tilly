import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
} from "@/src/application/farm-context";
import {
  listTimeline,
  recordFarmEvent,
  type Decision,
} from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { farmEventSchema } from "@/src/domain/farm-event";

const recordRequestSchema = z.object({
  proposal: farmEventSchema,
  final: farmEventSchema,
  decision: z.enum(["confirm", "reject", "save_incomplete"]),
});

function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  if (error instanceof Error) {
    if (error.message === "Farm event was not found.") {
      return Response.json(
        { error: "Farm event was not found." },
        { status: 404 },
      );
    }
    if (
      error.message.includes("requires missing fields") ||
      error.message.includes("only allowed") ||
      error.message.includes("cannot reject")
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
  }
  console.error("Farm event request failed", error);
  return Response.json(
    { error: "FarmMind could not save that record. Please try again." },
    { status: 500 },
  );
}

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
    if (!parsed.success) return errorResponse(parsed.error);
    const db = getDb();
    const context = await getFarmContext(db, request);
    const saved = await recordFarmEvent(
      db,
      context.farmId,
      parsed.data as {
        proposal: z.infer<typeof farmEventSchema>;
        final: z.infer<typeof farmEventSchema>;
        decision: Decision;
      },
    );
    const response = Response.json(saved, { status: 201 });
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const context = await getFarmContext(db, request);
    const response = Response.json({
      events: await listTimeline(db, context.farmId),
    });
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
