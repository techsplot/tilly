import { z } from "zod";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { getFarmContext } from "@/src/application/farm-context";
import { savePushSubscription } from "@/src/infrastructure/db/reminder-repository";

export const dynamic = "force-dynamic";

const subscribeBodySchema = z.object({
  endpoint: z.string().url("endpoint must be a valid URL"),
  keys: z.object({
    p256dh: z.string().min(1, "p256dh key is required"),
    auth: z.string().min(1, "auth key is required"),
  }),
});

/**
 * POST /api/push/subscribe
 * Saves a browser push subscription for the current farm.
 * Called from the browser after the farmer grants notification permission.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Please send a valid JSON request." },
      { status: 400 },
    );
  }

  const parsed = subscribeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid subscription data.",
      },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const { farmId } = await getFarmContext(db, request);

    const userAgent = request.headers.get("user-agent") ?? null;

    await savePushSubscription(db, farmId, {
      endpoint: parsed.data.endpoint,
      keys: {
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save push subscription:", error);
    return NextResponse.json(
      { error: "Failed to save push subscription." },
      { status: 500 },
    );
  }
}
