import { extractFarmEvent } from "@/src/application/extract-farm-event";
import { getExistingFarmId } from "@/src/application/farm-context";
import { loadFarmMemory } from "@/src/application/farm-memory";
import { getDb } from "@/src/infrastructure/db/client";
import type { FarmMemory } from "@/src/domain/farm-memory";
import { APIConnectionTimeoutError } from "openai";
import {
  farmInteractionResultSchema,
  farmRequestSchema,
} from "@/src/domain/farm-event";

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
  } catch (error: unknown) {
    console.error("Invalid request JSON", error);
    return Response.json(
      { error: "Please send a valid JSON request." },
      { status: 400 },
    );
  }
  const parsed = farmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  const { message, currentDate, clarifications } = parsed.data;
  const serverDate = new Date().toISOString().slice(0, 10);
  if (!isWithinOneDay(currentDate, serverDate)) {
    return Response.json(
      { error: "The date you provided is more than one day away from today." },
      { status: 400 },
    );
  }
  const modelStart = Date.now();
  try {
    let farmMemory: FarmMemory = { fields: [], recentEvents: [] };
    let farmId: string | undefined;
    try {
      const db = getDb();
      farmId = await getExistingFarmId(db, request);
      if (farmId) farmMemory = await loadFarmMemory(db, farmId, currentDate);
    } catch (memoryError) {
      console.error("Tilly memory load failed", memoryError);
      farmMemory = { fields: [], recentEvents: [] };
    }
    const result = await extractFarmEvent(
      message,
      currentDate,
      clarifications,
      farmMemory,
    );
    console.info("Tilly memory interpretation", {
      farmId: farmId ?? null,
      memoryItems: farmMemory.fields.length + farmMemory.recentEvents.length,
      memoryEventIds: result.events.flatMap(
        (event) => event.memoryEventIds ?? [],
      ),
    });
    const parsedResult = farmInteractionResultSchema.safeParse(result);
    const duration = Date.now() - modelStart;
    console.info(`Tilly model call: ${duration}ms`);
    if (!parsedResult.success) {
      console.error("Tilly returned invalid data", parsedResult.error);
      return Response.json(
        { error: "Tilly could not process that message. Please try again." },
        { status: 502 },
      );
    }
    return Response.json(parsedResult.data);
  } catch (error: unknown) {
    const duration = Date.now() - modelStart;
    const status = error instanceof APIConnectionTimeoutError ? 504 : 502;
    console.error(
      `Tilly model call failed (${status}) after ${duration}ms`,
      error,
    );
    return Response.json(
      {
        error:
          status === 504
            ? "Tilly is taking longer than expected. Please try again."
            : "Tilly could not process that message. Please try again.",
      },
      { status },
    );
  }
}
