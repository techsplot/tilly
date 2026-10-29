import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { listUpcomingReminders } from "@/src/application/reminder-service";
import { getFarmContext } from "@/src/application/farm-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders
 * List upcoming reminders for the active farm
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { farmId } = await getFarmContext(db, request);

    const reminders = await listUpcomingReminders(db, farmId);

    return NextResponse.json({
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        activity: reminder.activity,
        fieldName: reminder.fieldName,
        crop: reminder.crop,
        reminderDate: reminder.reminderDate,
        message: reminder.message,
        reminderKind: reminder.reminderKind,
        createdAt: reminder.createdAt,
      })),
    });
  } catch (error) {
    console.error("Failed to list reminders:", error);
    return NextResponse.json(
      { error: "Failed to list reminders" },
      { status: 500 },
    );
  }
}
