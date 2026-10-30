import type { Database } from "../infrastructure/db/farm-event-repository";
import {
  findDueReminders,
  markDeliveryFailed,
  isFarmerActiveInApp,
  getPushSubscription,
  recordPushSent,
  getFarmPhoneNumber,
  recordTwilioSid,
  markNoContactMethod,
} from "../infrastructure/db/reminder-repository";
import { isInQuietHours } from "../infrastructure/sms/quiet-hours";
import { logError } from "../infrastructure/request-log";

// Both clients return a failed result when their env vars are missing, so
// the job still runs where push or SMS is not configured.
import {
  sendSMS,
  formatReminderSMS,
} from "../infrastructure/sms/twilio-client";
import { sendPushNotification } from "../infrastructure/push/push-client";

export type DeliveryResult = {
  delivered: number;
  failed: number;
  skipped: number;
};

/**
 * Deliver due reminders for a given date using the three-tier escalation ladder.
 *
 * Tier 0 — In-app banner:   farmer active in last 30 min → skip (banner handles it)
 * Tier 1 — Push:            push subscription exists AND not yet acknowledged → send push,
 *                            set snoozed_until = now+2h.  When job re-runs and push was
 *                            acknowledged, skip.  If still unacked, fall through to Tier 2.
 * Tier 2 — SMS via Twilio:  farm has a phone number → send SMS
 *           No contact:     no phone number → mark no_contact_method
 *
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
        // ── Tier 0: In-app banner ──────────────────────────────────────────
        // If the farmer has been active in the last 30 minutes, the in-app
        // banner will show this reminder.  No push or SMS needed.
        const isActive = await isFarmerActiveInApp(db, reminder.farmId, 30);
        if (isActive) {
          result.skipped++;
          continue;
        }

        // ── Quiet hours check ────────────────────────────────────────────
        // No outbound notifications between 22:00 and 07:00 UTC.
        if (isInQuietHours()) {
          result.skipped++;
          continue;
        }

        // ── Tier 1: Push notification ────────────────────────────────────
        // The push path has two passes:
        //   Pass 1 — subscription found AND acknowledged_at IS NULL:
        //             send push, set snoozed_until = now+2h, count as delivered.
        //             The reminder disappears from the queue until snoozed_until
        //             expires (~2h later).
        //   Pass 2 — reminder re-enters queue after 2h:
        //             • acknowledged_at IS NOT NULL → farmer tapped the push.  Skip.
        //             • acknowledged_at IS NULL     → push was ignored.  Fall through to SMS.
        const subscription = await getPushSubscription(db, reminder.farmId);

        if (subscription !== null) {
          // Check if farmer has already acknowledged this reminder (push was tapped).
          if (reminder.acknowledgedAt !== null) {
            // Farmer acknowledged via push — no further action needed.
            result.skipped++;
            continue;
          }

          // First push pass: send the notification and set the escalation wait.
          const pushResult = await sendPushNotification(
            {
              ...subscription,
              keys: subscription.keys as Record<string, string>,
            },
            {
              title: "🌾 Tilly Reminder",
              body: reminder.fieldName
                ? `${reminder.activity} - ${reminder.fieldName}`
                : reminder.activity,
              reminderId: reminder.id,
            },
          );

          if (pushResult.success) {
            await recordPushSent(db, reminder.id);
            result.delivered++;
            continue;
          }
          // Push failed (e.g. expired subscription) — fall through to SMS.
        }

        // ── Tier 2: SMS via Twilio ───────────────────────────────────────
        const phoneNumber = await getFarmPhoneNumber(db, reminder.farmId);

        if (!phoneNumber) {
          // No contact method at all — log it and move on.
          await markNoContactMethod(db, reminder.id);
          result.failed++;
          continue;
        }

        const message = formatReminderSMS({
          activity: reminder.activity,
          fieldName: reminder.fieldName,
          crop: reminder.crop,
          reminderDate: reminder.reminderDate,
        });

        const smsResult = await sendSMS(phoneNumber, message, reminder.id);

        if (smsResult.success && smsResult.messageId) {
          await recordTwilioSid(db, reminder.id, smsResult.messageId);
          result.delivered++;
        } else {
          await markDeliveryFailed(db, reminder.id);
          result.failed++;
        }
      } catch (error) {
        // One failure shouldn't stop the batch.
        logError("Reminder delivery failed", error);
        try {
          await markDeliveryFailed(db, reminder.id);
        } catch (updateError) {
          logError("Failed to mark delivery attempt", updateError);
        }
        result.failed++;
      }
    }
  } catch (error) {
    logError("Batch reminder delivery failed", error);
    throw error;
  }

  return result;
}
