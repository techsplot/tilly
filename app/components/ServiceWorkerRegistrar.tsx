"use client";

import { useEffect } from "react";

// Registers public/sw.js, which shows reminder notifications and makes Tilly
// installable. Push subscription waits on this registration being ready.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);
  return null;
}
