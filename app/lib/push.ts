/** Convert a URL-safe base64 string to a Uint8Array (for VAPID applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/**
 * Subscribes this browser to reminder push notifications for the active farm.
 * Call only after notification permission is granted. Throws an Error with a
 * farmer-readable message when push is unavailable or the save fails.
 */
export async function subscribeToPush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser can't receive notifications.");
  }

  const keyResponse = await fetch("/api/push/public-key");
  const keyBody = (await keyResponse.json().catch(() => ({}))) as {
    publicKey?: string;
    error?: string;
  };
  if (!keyResponse.ok || !keyBody.publicKey) {
    throw new Error(keyBody.error ?? "Push notifications are not configured.");
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys) {
    throw new Error("Could not read push subscription.");
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? "Could not save push subscription.");
  }
}
