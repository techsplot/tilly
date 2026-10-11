import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
} from "@/src/application/farm-context";
import { correctRecordedEvent } from "@/src/application/persist-farm-event";
import { getDb } from "@/src/infrastructure/db/client";

const changesSchema = z
  .object({
    crop: z.string().nullable().optional(),
    field: z.string().nullable().optional(),
    eventDate: z.iso.date().nullable().optional(),
    quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .strict();

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

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
    const saved = await correctRecordedEvent(db, context.farmId, id, changes);
    const response = Response.json(saved);
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Farm event was not found."
    ) {
      return Response.json(
        { error: "Farm event was not found." },
        { status: 404 },
      );
    }
    if (error instanceof Error && error.message.includes("cannot edit")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Farm event correction failed", error);
    return Response.json(
      { error: "FarmMind could not save that record. Please try again." },
      { status: 500 },
    );
  }
}
