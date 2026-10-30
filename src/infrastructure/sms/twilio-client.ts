/**
 * Twilio SMS client using the REST API directly (no SDK dependency).
 *
 * Credentials are read when an SMS is sent, not at import time, so a
 * deployment without Twilio still runs the reminder job: sendSMS returns a
 * failed result and the job marks that reminder as failed.
 */

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber, appUrl: process.env.APP_URL };
}

export type SMSResult = {
  success: boolean;
  messageId?: string; // Twilio SID — present when success=true
  error?: string; // Error message — present when success=false
};

type ReminderForSMS = {
  activity: string;
  fieldName?: string | null;
  crop?: string | null;
  reminderDate: string; // ISO date string e.g. "2026-10-20"
};

/**
 * Format a reminder into an SMS body.
 *
 * Standard:  "🌾 Tilly: weed - North Field. Reply DONE when complete."
 * No field:  "🌾 Tilly: weed. Reply DONE when complete."
 * Overdue:   "(overdue since Oct 28) 🌾 Tilly: weed - North Field. Reply DONE when complete."
 */
export function formatReminderSMS(reminder: ReminderForSMS): string {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = reminder.reminderDate < today;

  // Build activity + field portion
  const activityPart = reminder.fieldName
    ? `${reminder.activity} - ${reminder.fieldName}`
    : reminder.activity;

  const core = `🌾 Tilly: ${activityPart}. Reply DONE when complete.`;

  if (isOverdue) {
    const overdueSince = formatOverdueDate(reminder.reminderDate);
    return `(overdue since ${overdueSince}) ${core}`;
  }

  return core;
}

/**
 * Format a date string like "2026-10-28" → "Oct 28"
 */
function formatOverdueDate(isoDate: string): string {
  // Parse as UTC to avoid timezone-shifting the date
  const [year, month, day] = isoDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Send an SMS via the Twilio REST API.
 *
 * The statusCallback URL is set automatically so Twilio will POST delivery
 * updates to /api/sms/status/[reminderId].
 */
export async function sendSMS(
  toPhoneNumber: string,
  message: string,
  reminderId: string,
): Promise<SMSResult> {
  const config = twilioConfig();
  if (!config) return { success: false, error: "SMS is not configured" };
  const { accountSid, authToken, fromNumber, appUrl } = config;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const body = new URLSearchParams({
    To: toPhoneNumber,
    From: fromNumber,
    Body: message,
  });

  // Only add statusCallback if APP_URL is configured
  if (appUrl) {
    body.append("StatusCallback", `${appUrl}/api/sms/status/${reminderId}`);
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString(
    "base64",
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = (await response.json()) as {
      sid?: string;
      message?: string;
      code?: number;
    };

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? `Twilio error ${response.status}`,
      };
    }

    return {
      success: true,
      ...(data.sid !== undefined ? { messageId: data.sid } : {}),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown network error",
    };
  }
}
