import { extractFarmEvent } from "@/src/application/extract-farm-event";
import { getExistingFarmId } from "@/src/application/farm-context";
import { loadFarmMemory } from "@/src/application/farm-memory";
import { getDb } from "@/src/infrastructure/db/client";
import { logError, withRequestLog } from "@/src/infrastructure/request-log";
import type { FarmMemory } from "@/src/domain/farm-memory";
import { APIConnectionTimeoutError } from "openai";
import { ModelBudgetExceededError } from "@/src/infrastructure/nebius/nebius-client";
import {
  DAILY_CAP_REPLY,
  limitModelRequest,
  tooManyRequests,
} from "../rate-limit";
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

async function handlePost(request: Request): Promise<Response> {
  const limited = limitModelRequest(request);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Not logged: the parse error quotes the body, which is farmer text.
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
  try {
    let farmMemory: FarmMemory = { fields: [], recentEvents: [] };
    try {
      const db = getDb();
      const farmId = await getExistingFarmId(db, request);
      if (farmId) farmMemory = await loadFarmMemory(db, farmId, currentDate);
    } catch (memoryError) {
      logError("Tilly memory load failed", memoryError);
      farmMemory = { fields: [], recentEvents: [] };
    }
    const result = await extractFarmEvent(
      message,
      currentDate,
      clarifications,
      farmMemory,
    );
    const parsedResult = farmInteractionResultSchema.safeParse(result);
    if (!parsedResult.success) {
      logError("Tilly returned invalid data", parsedResult.error);
      return Response.json(
        { error: "Tilly could not process that message. Please try again." },
        { status: 502 },
      );
    }
    return Response.json(parsedResult.data);
  } catch (error: unknown) {
    if (error instanceof ModelBudgetExceededError)
      return tooManyRequests(error.retryAfterSeconds, DAILY_CAP_REPLY);
    const status = error instanceof APIConnectionTimeoutError ? 504 : 502;
    logError("Tilly model call failed", error);
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

export function POST(request: Request): Promise<Response> {
  return withRequestLog("/api/extract-event", () => handlePost(request));
}
