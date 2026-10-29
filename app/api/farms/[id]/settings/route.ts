import { z } from "zod";
import { getSessionId, isUuid } from "@/src/application/farm-context";
import { wakeWordSchema } from "@/src/domain/wake-word";
import { getDb } from "@/src/infrastructure/db/client";
import {
  findFarmVoiceSettings,
  updateFarmVoiceSettings,
} from "@/src/infrastructure/db/farm-event-repository";
import { logError } from "@/src/infrastructure/request-log";

const voiceSettingsSchema = z.object({
  wakeWord: wakeWordSchema,
  wakeWordEnabled: z.boolean(),
});

type RouteContext = { params: Promise<{ id: string }> };

const notFound = () =>
  Response.json({ error: "Farm not found." }, { status: 404 });

// GET /api/farms/:id/settings - voice settings for a farm this session owns
export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    const sessionId = await getSessionId(request);
    const settings = await findFarmVoiceSettings(getDb(), id, sessionId);
    return settings ? Response.json(settings) : notFound();
  } catch (error) {
    logError("Load voice settings failed", error);
    return Response.json(
      { error: "Voice settings could not be loaded." },
      { status: 500 },
    );
  }
}

// PATCH /api/farms/:id/settings - replace the wake word and its switch
export async function PATCH(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Please send a valid JSON request." },
      { status: 400 },
    );
  }
  const parsed = voiceSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settings." },
      { status: 400 },
    );
  }

  try {
    const sessionId = await getSessionId(request);
    const settings = await updateFarmVoiceSettings(
      getDb(),
      id,
      sessionId,
      parsed.data,
    );
    return settings ? Response.json(settings) : notFound();
  } catch (error) {
    logError("Save voice settings failed", error);
    return Response.json(
      { error: "Voice settings could not be saved." },
      { status: 500 },
    );
  }
}
