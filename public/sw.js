// Tilly service worker: shows reminder push notifications and makes the app
// installable. It has no fetch handler and caches nothing, so a redeploy is
// never hidden behind a stale copy.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Payload sent by src/infrastructure/push/push-client.ts:
// { title, body, reminderId }
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title =
    typeof payload.title === "string" ? payload.title : "Tilly reminder";
  const body =
    typeof payload.body === "string" ? payload.body : "You have a reminder.";
  const reminderId =
    typeof payload.reminderId === "string" ? payload.reminderId : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: reminderId,
      data: { reminderId },
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (open) {
        await open.focus();
        return;
      }
      await self.clients.openWindow("/");
    })(),
  );
});
