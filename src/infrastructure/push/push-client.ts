import webPush from "web-push";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { pushSubscriptions } from "../db/schema";

export type PushResult = {
  success: boolean;
  error?: string;
  expired?: boolean; // true when push service returns 410 Gone
};

type PushPayload = {
  title: string;
  body: string;
  reminderId: string;
};

// VAPID keys are read on first send, not at import time, so a deployment
// without push still runs the reminder job (it falls through to SMS).
let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT;
  if (!publicKey || !privateKey || !contact) return false;
  webPush.setVapidDetails(contact, publicKey, privateKey);
  vapidReady = true;
  return true;
}

/**
 * Send a Web Push notification to a stored subscription.
 * On HTTP 410 Gone (subscription expired), marks the subscription inactive
 * in the DB and returns { success: false, expired: true }.
 */
export async function sendPushNotification(
  subscription: {
    id: string;
    endpoint: string;
    keys: Record<string, string>;
  },
  payload: PushPayload,
): Promise<PushResult> {
  if (!ensureVapid()) {
    return { success: false, error: "Push is not configured" };
  }

  const pushSubscription: webPush.PushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys["p256dh"] ?? "",
      auth: subscription.keys["auth"] ?? "",
    },
  };

  const serialisedPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    reminderId: payload.reminderId,
  });

  try {
    await webPush.sendNotification(pushSubscription, serialisedPayload);
    return { success: true };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };

    // 410 Gone means the subscription has expired — mark it inactive
    if (error.statusCode === 410) {
      try {
        const db = getDb();
        await db
          .update(pushSubscriptions)
          .set({ active: false })
          .where(eq(pushSubscriptions.id, subscription.id));
      } catch (dbErr) {
        console.error(
          "Failed to mark push subscription inactive after 410:",
          dbErr,
        );
      }
      return { success: false, expired: true };
    }

    console.error("Push notification failed:", error.message ?? err);
    return {
      success: false,
      error: error.message ?? "Unknown push error",
    };
  }
}
