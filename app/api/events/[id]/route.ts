import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
  sessionCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { correctRecordedEvent } from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { eventErrorResponse } from "../errors";

const changesSchema = z
  .object({
    crop: z.string().nullable().optional(),
    field: z.string().nullable().optional(),
    eventDate: z.iso.date().nullable().optional(),
    quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(
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
    const parsed = changesSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    const db = getDb();
    const context = await getFarmContext(db, request);
    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    ) as Parameters<typeof correctRecordedEvent>[3];
    const { event: saved } = await correctRecordedEvent(
      db,
      context.farmId,
      id,
      changes,
    );
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
