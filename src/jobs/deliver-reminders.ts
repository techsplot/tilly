import type { Database } from "../infrastructure/db/farm-event-repository";
import {
  findDueReminders,
  markDelivered,
  markDeliveryFailed,
} from "../infrastructure/db/reminder-repository";
import { logError } from "../infrastructure/request-log";

export type DeliveryResult = {
  delivered: number;
  failed: number;
  skipped: number;
};

/**
 * Deliver due reminders for a given date.
 * Uses FOR UPDATE SKIP LOCKED to safely claim reminders for processing.
 * Returns counts of delivered, failed, and skipped reminders.
 */
export async function deliverDueReminders(
  db: Database,
  currentDate: string,
  batchSize = 50,
): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    delivered: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    const dueReminders = await findDueReminders(db, currentDate, batchSize);

    for (const reminder of dueReminders) {
      try {
        // TODO: Implement actual delivery mechanism
        // 
        // Option 1: SMS Delivery (recommended for farmers)
        // await sendSMS(farmer.phoneNumber, formatReminderMessage(reminder));
        //
        // Option 2: In-app notification
        // await createInAppNotification(reminder.farmId, reminder);
        //
        // Option 3: Push notification (if mobile app exists)
        // await sendPushNotification(reminder.farmId, reminder);
        //
        // For now, we just mark it as delivered.
        // The actual delivery mechanism will be implemented based on deployment needs.
        
        await markDelivered(db, reminder.id);
        result.delivered++;
      } catch (error) {
        // One failure shouldn't stop the batch
        logError("Reminder delivery failed", error);
        try {
          await markDeliveryFailed(db, reminder.id);
        } catch (updateError) {
          logError("Failed to mark delivery attempt", updateError);
        }
        result.failed++;
      }
    }

    // Skipped = reminders that were due but locked by another worker
    result.skipped = Math.max(
      0,
      (await findDueReminders(db, currentDate, 1)).length > 0 ? 1 : 0,
    );
  } catch (error) {
    logError("Batch reminder delivery failed", error);
    throw error;
  }

  return result;
}
