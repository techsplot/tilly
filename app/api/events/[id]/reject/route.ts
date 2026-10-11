import {
  getFarmContext,
  farmCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { rejectRecordedEvent } from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";

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
    if (error instanceof Error && error.message === "Farm event was not found.")
      return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof Error)
      return Response.json({ error: error.message }, { status: 409 });
    console.error("Farm event rejection failed", error);
    return Response.json(
      { error: "FarmMind could not save that record. Please try again." },
      { status: 500 },
    );
  }
}
