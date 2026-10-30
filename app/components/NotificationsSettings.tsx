"use client";

import { type FormEvent, useEffect, useState } from "react";

export type NotificationsSettingsProps = {
  currentPhone?: string | null;
  onSave: (phone: string) => Promise<void>;
};

/** Convert a URL-safe base64 string to a Uint8Array (for VAPID applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export default function NotificationsSettings({
  currentPhone,
  onSave,
}: NotificationsSettingsProps) {
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [pushPermission, setPushPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [pushEnabling, setPushEnabling] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // Read current push permission state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPushPermission("unsupported");
      return;
    }
    setPushPermission(Notification.permission);
  }, []);

  async function handlePhoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      setPhoneError("Please enter a phone number.");
      return;
    }
    setPhoneSaving(true);
    setPhoneSaved(false);
    setPhoneError(null);
    try {
      await onSave(trimmed);
      setPhoneSaved(true);
      // Reset "Saved!" label after 3 seconds
      setTimeout(() => setPhoneSaved(false), 3000);
    } catch (caught) {
      setPhoneError(
        caught instanceof Error
          ? caught.message
          : "Phone number could not be saved.",
      );
    } finally {
      setPhoneSaving(false);
    }
  }

  async function handleEnablePush() {
    if (!("Notification" in window)) return;
    setPushEnabling(true);
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        // User denied — nothing more to do
        setPushEnabling(false);
        return;
      }

      if (!("serviceWorker" in navigator)) {
        setPushError("Push notifications require a service worker.");
        setPushEnabling(false);
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setPushError("Push notifications are not configured.");
        setPushEnabling(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys) {
        setPushError("Could not read push subscription.");
        setPushEnabling(false);
        return;
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setPushError(data.error ?? "Could not save push subscription.");
      }
    } catch (caught) {
      setPushError(
        caught instanceof Error
          ? caught.message
          : "Push notifications could not be enabled.",
      );
    } finally {
      setPushEnabling(false);
    }
  }

  function pushStatusLabel(): string {
    switch (pushPermission) {
      case "granted":
        return "Enabled";
      case "denied":
        return "Blocked by browser";
      case "default":
        return "Not yet enabled";
      case "unsupported":
        return "Not supported in this browser";
    }
  }

  return (
    <div className="settings-form">
      {/* Section 1: Phone number */}
      <fieldset className="settings-group">
        <legend>SMS reminders</legend>
        <form onSubmit={handlePhoneSubmit}>
          <label className="custom-wake-word">
            <span>Phone number</span>
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              placeholder="+234 80 123 4567"
              onChange={(event) => {
                setPhone(event.target.value);
                setPhoneSaved(false);
                setPhoneError(null);
              }}
            />
          </label>
          <p className="settings-note">
            Tilly will send you an SMS when a reminder is due and you're not in
            the app. Start with your country code, for example{" "}
            <code>+1 555 123 4567</code> (US) or <code>+234 801 234 5678</code>{" "}
            (Nigeria).
          </p>
          {phoneError && (
            <p className="drawer-error" role="alert">
              {phoneError}
            </p>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={phoneSaving}
          >
            {phoneSaving ? "Saving…" : phoneSaved ? "Saved!" : "Save number"}
          </button>
        </form>
      </fieldset>

      {/* Section 2: Push notifications */}
      <fieldset className="settings-group">
        <legend>Push notifications</legend>
        <p className="settings-note">
          Status: <strong>{pushStatusLabel()}</strong>
        </p>
        <p className="settings-note">
          Push notifications let Tilly alert you when reminders are due, even
          when your browser is closed. Requires installing Tilly as a PWA or
          keeping the tab open in the background.
        </p>
        {pushError && (
          <p className="drawer-error" role="alert">
            {pushError}
          </p>
        )}
        {pushPermission === "default" && (
          <button
            type="button"
            className="primary-button"
            disabled={pushEnabling}
            onClick={() => void handleEnablePush()}
          >
            {pushEnabling ? "Enabling…" : "Enable notifications"}
          </button>
        )}
        {pushPermission === "denied" && (
          <p className="settings-note">
            Notifications are blocked. To re-enable, update your browser's site
            permissions for this page.
          </p>
        )}
        {pushPermission === "granted" && (
          <p className="settings-note">
            Push notifications are active. Tilly will alert you when reminders
            are due.
          </p>
        )}
      </fieldset>
    </div>
  );
}
