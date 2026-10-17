import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/src/infrastructure/db/client";
import { farms } from "@/src/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { cookies } from "next/headers";

const wakeWordSettingsSchema = z.object({
  wakeWord: z
    .string()
    .min(2, "Wake word must be at least 2 characters")
    .max(50, "Wake word must be at most 50 characters")
    .regex(/^[a-zA-Z\s]+$/, "Wake word can only contain letters and spaces"),
  wakeWordEnabled: z.boolean(),
});

/**
 * GET /api/farms/:id/settings
 * Get wake word settings for a farm
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = (await cookies()).get("farm_session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "No session found" }, { status: 401 });
    }

    const db = getDb();
    const [farm] = await db
      .select({
        id: farms.id,
        wakeWord: farms.wakeWord,
        wakeWordEnabled: farms.wakeWordEnabled,
      })
      .from(farms)
      .where(eq(farms.id, id))
      .limit(1);

    if (!farm) {
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }

    // Verify ownership
    const [ownedFarm] = await db
      .select({ id: farms.id })
      .from(farms)
      .where(and(eq(farms.id, id), eq(farms.sessionId, sessionId)))
      .limit(1);

    if (!ownedFarm) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json({
      wakeWord: farm.wakeWord,
      wakeWordEnabled: farm.wakeWordEnabled,
    });
  } catch (error) {
    console.error("Error fetching wake word settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/farms/:id/settings
 * Update wake word settings for a farm
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessionId = (await cookies()).get("farm_session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "No session found" }, { status: 401 });
    }

    const db = getDb();
    // Verify ownership
    const [ownedFarm] = await db
      .select({ id: farms.id })
      .from(farms)
      .where(and(eq(farms.id, id), eq(farms.sessionId, sessionId)))
      .limit(1);

    if (!ownedFarm) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const validated = wakeWordSettingsSchema.parse(body);

    // Update settings
    await db
      .update(farms)
      .set({
        wakeWord: validated.wakeWord.toLowerCase().trim(),
        wakeWordEnabled: validated.wakeWordEnabled,
      })
      .where(eq(farms.id, id));

    return NextResponse.json({
      wakeWord: validated.wakeWord.toLowerCase().trim(),
      wakeWordEnabled: validated.wakeWordEnabled,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid settings", details: error.issues },
        { status: 400 },
      );
    }

    console.error("Error updating wake word settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 },
    );
  }
}
