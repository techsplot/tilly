import { z } from "zod";
import { getSessionId, isUuid } from "@/src/application/farm-context";
import { wakeWordSchema } from "@/src/domain/wake-word";
import { getDb } from "@/src/infrastructure/db/client";
import { updateFarmVoiceSettings } from "@/src/infrastructure/db/farm-event-repository";
import { logError } from "@/src/infrastructure/request-log";
import { farms } from "@/src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

const voiceSettingsSchema = z.object({
  wakeWord: wakeWordSchema,
  wakeWordEnabled: z.boolean(),
});

// E.164 phone number format
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

// Spaces, dashes, dots and brackets people type in "+1 (555) 123-4567".
const PHONE_SEPARATORS = /[\s\-.()]/g;

const MISSING_COUNTRY_CODE_ERROR =
  "Add your country code, for example +1 for the US or +234 for Nigeria.";

const phoneSettingsSchema = z.object({
  phone_number: z.string(),
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
    const db = getDb();
    const [farm] = await db
      .select({
        wakeWord: farms.wakeWord,
        wakeWordEnabled: farms.wakeWordEnabled,
        phoneNumber: farms.phoneNumber,
      })
      .from(farms)
      .where(and(eq(farms.id, id), eq(farms.sessionId, sessionId)))
      .limit(1);
    return farm ? Response.json(farm) : notFound();
  } catch (error) {
    logError("Load voice settings failed", error);
    return Response.json(
      { error: "Voice settings could not be loaded." },
      { status: 500 },
    );
  }
}

// PATCH /api/farms/:id/settings - update voice settings and/or phone number
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

  // Check if this is a phone number update
  const phoneCheck = phoneSettingsSchema.safeParse(body);
  if (
    phoneCheck.success &&
    !("wakeWord" in (body as Record<string, unknown>))
  ) {
    const phoneNumber = phoneCheck.data.phone_number.replace(
      PHONE_SEPARATORS,
      "",
    );
    if (!phoneNumber.startsWith("+")) {
      return Response.json(
        { error: MISSING_COUNTRY_CODE_ERROR },
        { status: 400 },
      );
    }
    if (!E164_REGEX.test(phoneNumber)) {
      return Response.json(
        { error: "That doesn't look like a full phone number." },
        { status: 400 },
      );
    }

    try {
      const sessionId = await getSessionId(request);
      const db = getDb();
      const [updated] = await db
        .update(farms)
        .set({ phoneNumber })
        .where(and(eq(farms.id, id), eq(farms.sessionId, sessionId)))
        .returning({ phoneNumber: farms.phoneNumber });
      return updated ? Response.json(updated) : notFound();
    } catch (error) {
      logError("Save phone number failed", error);
      return Response.json(
        { error: "Phone number could not be saved." },
        { status: 500 },
      );
    }
  }

  // Otherwise, treat as voice settings update
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
