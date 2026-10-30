import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { listUpcomingReminders } from "@/src/application/reminder-service";
import { getFarmContext } from "@/src/application/farm-context";
import { findDueRemindersForFarm } from "@/src/infrastructure/db/reminder-repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders
 * List upcoming reminders for the active farm.
 *
 * ?due=today  Returns pending reminders due today or overdue (for the in-app banner).
 *             Response shape: { reminders: DueReminder[] }
 *
 * (no param)  Returns all upcoming reminders in the standard shape.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { farmId } = await getFarmContext(db, request);

    const { searchParams } = new URL(request.url);
    const dueToday = searchParams.get("due") === "today";

    if (dueToday) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const dueReminders = await findDueRemindersForFarm(db, farmId, today);

      return NextResponse.json({
        reminders: dueReminders.map((reminder) => ({
          id: reminder.id,
          activity: reminder.activity,
          fieldName: reminder.fieldName,
          crop: reminder.crop,
          reminderDate: reminder.reminderDate,
          status: reminder.status,
        })),
      });
    }

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
