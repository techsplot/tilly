import type { NextRequest } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { updateCarrierStatus } from "@/src/infrastructure/db/reminder-repository";

export const dynamic = "force-dynamic";

/**
 * POST /api/sms/status/[reminderId]
 * Twilio status callback — called by Twilio when the carrier confirms
 * delivery, failure, or other status changes for a sent SMS.
 *
 * Twilio sends form-encoded data (application/x-www-form-urlencoded).
 * This endpoint MUST always return HTTP 200, even on errors — Twilio
 * treats non-200 responses as failures and will retry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reminderId: string }> },
): Promise<Response> {
  try {
    const formData = await request.formData();
    const messageStatus = formData.get("MessageStatus") as string | null;

    const { reminderId } = await params;

    if (!messageStatus) {
      // Gracefully handle missing MessageStatus — Twilio must always get 200
      console.warn(
        `[sms/status] Missing MessageStatus for reminder ${reminderId}`,
      );
      return new Response(null, { status: 200 });
    }

    const db = getDb();
    await updateCarrierStatus(db, reminderId, messageStatus);

    return new Response(null, { status: 200 });
  } catch (error) {
    // Log but never surface errors to Twilio — always return 200
    console.error(`[sms/status] Error processing status callback:`, error);
    return new Response(null, { status: 200 });
  }
}
