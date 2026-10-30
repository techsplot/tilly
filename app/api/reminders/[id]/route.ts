import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { getFarmContext } from "@/src/application/farm-context";
import {
  acknowledgeReminder,
  snoozeReminder,
} from "@/src/infrastructure/db/reminder-repository";

export const dynamic = "force-dynamic";

type PatchBody = {
  action: "done" | "acknowledge" | "snooze";
  minutes?: number;
};

/**
 * PATCH /api/reminders/[id]
 * Perform an action on a reminder.
 *
 * Body: { action: "done" | "acknowledge" | "snooze"; minutes?: number }
 *
 * - "done"       → marks the reminder as acknowledged (completed by farmer)
 * - "acknowledge"→ marks the reminder as acknowledged (dismissed without completing)
 * - "snooze"     → snoozes the reminder for `minutes` (default 60)
 *
 * Returns { ok: true } on success, or HTTP 404 if the reminder is not found
 * or does not belong to the current farm.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = getDb();
    const { farmId } = await getFarmContext(db, request);

    const { id: reminderId } = await params;

    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const { action, minutes } = body;

    if (action === "done" || action === "acknowledge") {
      await acknowledgeReminder(db, farmId, reminderId);
    } else if (action === "snooze") {
      const snoozeMinutes = minutes ?? 60;
      const until = new Date(Date.now() + snoozeMinutes * 60_000);
      await snoozeReminder(db, farmId, reminderId, until);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update reminder:", error);
    return NextResponse.json(
      { error: "Failed to update reminder" },
      { status: 500 },
    );
  }
}
