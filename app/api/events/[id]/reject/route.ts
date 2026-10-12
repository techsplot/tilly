import {
  getFarmContext,
  farmCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { rejectRecordedEvent } from "@/src/application/persist-farm-event";
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
    const saved = await rejectRecordedEvent(db, context.farmId, id);
    const response = Response.json(saved);
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    return eventErrorResponse(error);
  }
}
