import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
  sessionCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { undoAgentAction } from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { eventErrorResponse } from "../../errors";

const undoRequestSchema = z.object({
  action: z.enum(["recorded", "corrected", "deleted"]),
  correctionId: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id))
    return Response.json(
      { error: "Farm event was not found." },
      { status: 404 },
    );
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
    const parsed = undoRequestSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    const db = getDb();
    const context = await getFarmContext(db, request);
    const saved = await undoAgentAction(
      db,
      context.farmId,
      id,
      parsed.data.action,
      parsed.data.correctionId,
    );
    const response = Response.json(saved);
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
