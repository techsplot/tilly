import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { acknowledgeReminderBySmsFrom } from "@/src/infrastructure/db/reminder-repository";

export const dynamic = "force-dynamic";

const TWIML_EMPTY_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

function twimlResponse(): Response {
  return new NextResponse(TWIML_EMPTY_RESPONSE, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * POST /api/sms/inbound
 * Twilio inbound SMS webhook — called by Twilio when the farmer replies
 * to a reminder SMS. Recognises "done" and "completed" (case-insensitive)
 * as acknowledgment commands.
 *
 * Twilio sends form-encoded data (application/x-www-form-urlencoded).
 * Must be configured manually in the Twilio console under:
 * Phone Number → Messaging → "A message comes in" → Webhook URL.
 *
 * This endpoint MUST always return a valid TwiML response so Twilio
 * does not flag it as an error.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const formData = await request.formData();
    const body = formData.get("Body") as string | null;
    const from = formData.get("From") as string | null;

    if (!body || !from) {
      console.warn("[sms/inbound] Missing Body or From field in inbound SMS");
      return twimlResponse();
    }

    const normalised = body.trim().toLowerCase();

    if (normalised === "done" || normalised === "completed") {
      try {
        const db = getDb();
        await acknowledgeReminderBySmsFrom(db, from);
      } catch (error) {
        // Log the miss but never error to Twilio
        console.error(
          `[sms/inbound] Failed to acknowledge reminder for ${from}:`,
          error,
        );
      }
    } else {
      console.info(
        `[sms/inbound] Unrecognised reply from ${from}: "${body.substring(0, 50)}"`,
      );
    }

    return twimlResponse();
  } catch (error) {
    // Always return valid TwiML — never let Twilio see an error
    console.error(
      "[sms/inbound] Unexpected error handling inbound SMS:",
      error,
    );
    return twimlResponse();
  }
}
