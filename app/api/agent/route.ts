import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
  sessionCookieHeader,
} from "@/src/application/farm-context";
import { handleFarmerMessage } from "@/src/application/farm-agent";
import {
  farmActivitySchema,
  farmTimeOfDaySchema,
} from "@/src/domain/farm-event";
import { getDb } from "@/src/infrastructure/db/client";
import { agentErrorResponse } from "./errors";
import { resolveFarmReference } from "@/src/application/farm-resolver";
import { extractFarmEvent } from "@/src/application/extract-farm-event";
import { loadFarmMemory } from "@/src/application/farm-memory";
import { listFarmsBySession } from "@/src/infrastructure/db/farm-event-repository";

const clarificationsSchema = z
  .array(
    z.object({
      question: z.string().trim().min(1, "Question cannot be empty"),
      answer: z.string().trim().min(1, "Answer cannot be empty"),
    }),
  )
  .max(3, "Maximum 3 clarifications allowed");

const eventIdSchema = z.uuid("Event id must be a valid UUID");

// Mirrors the PendingEvent kept server-side; the client sends it back
// exactly as received (finding 2), never touching it.
const pendingEventSchema = z.object({
  activity: farmActivitySchema,
  crop: z.string().nullable(),
  field: z.string().nullable(),
  eventDate: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  eventTime: z.string().nullable(),
  timeOfDay: farmTimeOfDaySchema.nullable(),
  sourceText: z.string(),
  memoryEventIds: z.array(z.string()),
  unresolvedReferences: z.array(z.string()),
});

const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clarification"),
    originalMessage: z
      .string()
      .trim()
      .min(1, "Message cannot be empty")
      .max(1000, "Message must be 1000 characters or less"),
    event: pendingEventSchema,
    question: z.string().trim().min(1, "Question cannot be empty"),
    clarifications: clarificationsSchema,
  }),
  z.object({
    kind: z.literal("gap"),
    eventId: eventIdSchema,
  }),
  z.object({
    kind: z.literal("correction"),
    eventId: eventIdSchema,
  }),
]);

const agentRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(1000, "Message must be 1000 characters or less"),
  currentDate: z.iso.date("A date in YYYY-MM-DD format is required"),
  pending: pendingSchema.optional(),
  recentEventIds: z
    .array(eventIdSchema)
    .max(20, "Maximum 20 recent event ids allowed")
    .default([]),
});

function isWithinOneDay(clientDate: string, serverDate: string): boolean {
  const client = new Date(clientDate);
  const server = new Date(serverDate);
  const diffDays = Math.abs((client.getTime() - server.getTime()) / 86400000);
  return diffDays <= 1;
}

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
  const parsed = agentRequestSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
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

    // Farm resolution: if not handling a pending clarification/gap/correction,
    // check if the message mentions a specific farm
    let targetFarmId = context.farmId;
    if (!parsed.data.pending) {
      // Quick extraction to check for farm reference
      try {
        const memory = await loadFarmMemory(
          db,
          context.farmId,
          parsed.data.currentDate,
        );
        const extraction = await extractFarmEvent(
          parsed.data.message,
          parsed.data.currentDate,
          undefined,
          memory,
        );

        if (extraction.farmReference) {
          const resolution = await resolveFarmReference(
            db,
            context.sessionId,
            extraction.farmReference,
            context.farmId,
          );

          if (resolution?.status === "resolved") {
            targetFarmId = resolution.farmId;
          } else if (resolution?.status === "ambiguous") {
            const farms = await listFarmsBySession(db, context.sessionId);
            const farmNames = farms.map((f) => f.name).join(", ");
            return Response.json({
              actions: [
                {
                  type: "reply",
                  text: `I found multiple farms with that name. Which one did you mean? Your farms: ${farmNames}`,
                },
              ],
            });
          } else if (resolution?.status === "not_found") {
            const farms = await listFarmsBySession(db, context.sessionId);
            const farmNames = farms.map((f) => f.name).join(", ");
            return Response.json({
              actions: [
                {
                  type: "reply",
                  text: `I couldn't find a farm named "${resolution.reference}". Your farms: ${farmNames}`,
                },
              ],
            });
          }
        }
      } catch (error) {
        // If extraction fails, continue with default farm
        console.error("Farm reference extraction failed", error);
      }
    }

    const actions = await handleFarmerMessage(db, targetFarmId, parsed.data);
    const response = Response.json({ actions });
    const cookies: string[] = [];
    if (context.isNewSession)
      cookies.push(sessionCookieHeader(context.sessionId));
    if (context.isNewFarm) cookies.push(farmCookieHeader(context.farmId));
    if (cookies.length > 0)
      response.headers.set("Set-Cookie", cookies.join(", "));
    return response;
  } catch (error) {
    return agentErrorResponse(error);
  }
}
