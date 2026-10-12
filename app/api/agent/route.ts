import { z } from "zod";
import {
  getFarmContext,
  farmCookieHeader,
} from "@/src/application/farm-context";
import { handleFarmerMessage } from "@/src/application/farm-agent";
import { getDb } from "@/src/infrastructure/db/client";
import { agentErrorResponse } from "./errors";

const pendingSchema = z.object({
  kind: z.enum(["clarification", "duplicate"]),
  originalMessage: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(1000, "Message must be 1000 characters or less"),
  clarifications: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Question cannot be empty"),
        answer: z.string().trim().min(1, "Answer cannot be empty"),
      }),
    )
    .max(3, "Maximum 3 clarifications allowed"),
});

const agentRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(1000, "Message must be 1000 characters or less"),
  currentDate: z.iso.date("A date in YYYY-MM-DD format is required"),
  pending: pendingSchema.optional(),
  recentEventIds: z
    .array(z.string())
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
    const actions = await handleFarmerMessage(db, context.farmId, parsed.data);
    const response = Response.json({ actions });
    if (context.isNew)
      response.headers.set("Set-Cookie", farmCookieHeader(context.farmId));
    return response;
  } catch (error) {
    return agentErrorResponse(error);
  }
}
