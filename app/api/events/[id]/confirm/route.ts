import {
  getFarmContext,
  farmCookieHeader,
  sessionCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { confirmRecordedEvent } from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { eventErrorResponse } from "../../errors";

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
    const db = getDb();
    const context = await getFarmContext(db, request);
    const saved = await confirmRecordedEvent(db, context.farmId, id);
    const response = Response.json(saved);
    const cookies: string[] = [];
    if (context.isNewSession)
      cookies.push(sessionCookieHeader(context.sessionId));
    if (context.isNewFarm) cookies.push(farmCookieHeader(context.farmId));
    if (cookies.length > 0) response.headers.set("Set-Cookie", cookies.join(", "));
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}
