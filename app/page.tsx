"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFarmAgent } from "@/app/hooks/useFarmAgent";
import AgentFeed from "@/app/components/AgentFeed";
import ChatHeader, { type MenuChoice } from "@/app/components/ChatHeader";
import Drawer from "@/app/components/Drawer";
import FarmHistory from "@/app/components/FarmHistory";
import FarmsPanel from "@/app/components/FarmsPanel";
import MessageBar from "@/app/components/MessageBar";
import ReminderBanner, {
  type DueReminder,
} from "@/app/components/ReminderBanner";
import WakeWordSettings, {
  type VoiceSettings,
} from "@/app/components/WakeWordSettings";
import NotificationsSettings from "@/app/components/NotificationsSettings";
import { buildGreeting } from "@/app/lib/greeting";
import { subscribeToPush } from "@/app/lib/push";
import { latestReply } from "@/app/lib/spoken-reply";
import { SAMPLE_FARM_NAME } from "@/src/application/sample-farm-data";
import { DEFAULT_WAKE_WORD } from "@/src/domain/wake-word";

const DRAWER_TITLES: Record<MenuChoice, string> = {
  records: "My records",
  farms: "Farms",
  voice: "Voice settings",
  notifications: "Notifications",
};

const REMINDER_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Talk back is a choice about this device (speakers, a quiet office), so it
// is kept in the browser rather than with the farm. On unless turned off.
const TALK_BACK_KEY = "tilly.talkBack";

export default function HomePage() {
  const agent = useFarmAgent();
  const { activeFarmId, isLoading, setHistoryOpen } = agent;
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState<MenuChoice | null>(null);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(
    null,
  );
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(
    null,
  );
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [dueReminders, setDueReminders] = useState<DueReminder[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [talkBack, setTalkBack] = useState(true);
  const [talkBackSupported, setTalkBackSupported] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const reply = useMemo(() => latestReply(agent.feed), [agent.feed]);

  useEffect(() => {
    setTalkBackSupported("speechSynthesis" in window);
    try {
      setTalkBack(window.localStorage.getItem(TALK_BACK_KEY) !== "off");
    } catch {
      // Storage can be blocked; talk back stays on for this visit.
    }
  }, []);

  useEffect(() => {
    if (!activeFarmId) return;
    let cancelled = false;
    setVoiceSettings(null);
    setVoiceSettingsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/farms/${activeFarmId}/settings`);
        if (!response.ok) throw new Error();
        const data = (await response.json()) as VoiceSettings & {
          phoneNumber?: string | null;
        };
        if (!cancelled) {
          setVoiceSettings({
            wakeWord: data.wakeWord,
            wakeWordEnabled: data.wakeWordEnabled,
          });
          setCurrentPhone(data.phoneNumber ?? null);
        }
      } catch {
        if (!cancelled)
          setVoiceSettingsError("Voice settings could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFarmId]);

  // Fetch due reminders on mount and poll every 5 minutes
  useEffect(() => {
    if (!activeFarmId) return;

    async function fetchDueReminders() {
      try {
        const response = await fetch("/api/reminders?due=today");
        if (!response.ok) return;
        const data = (await response.json()) as { reminders: DueReminder[] };
        setDueReminders(data.reminders);
      } catch {
        // Silently ignore — not critical if poll fails
      }
    }

    void fetchDueReminders();
    const interval = window.setInterval(
      () => void fetchDueReminders(),
      REMINDER_POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [activeFarmId]);

  // Register push subscription once when the farm loads, if permission is granted
  useEffect(() => {
    if (!activeFarmId) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    subscribeToPush().catch(() => {
      // Silently ignore push registration errors (push not configured, or
      // the browser doesn't support push)
    });
  }, [activeFarmId]);

  useEffect(() => {
    if (!isLoading) return;
    setElapsedSeconds(0);
    const interval = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [agent.feed, isLoading]);

  const openDrawer = useCallback(
    (choice: MenuChoice) => {
      setDrawer(choice);
      setHistoryOpen(choice === "records");
    },
    [setHistoryOpen],
  );

  const closeDrawer = useCallback(() => {
    setDrawer(null);
    setHistoryOpen(false);
  }, [setHistoryOpen]);

  async function saveVoiceSettings(
    settings: VoiceSettings,
    speakReplies: boolean,
  ) {
    if (!activeFarmId) throw new Error("Your farm is still loading.");
    setTalkBack(speakReplies);
    try {
      window.localStorage.setItem(TALK_BACK_KEY, speakReplies ? "on" : "off");
    } catch {
      // Storage can be blocked; the choice still applies for this visit.
    }
    const response = await fetch(`/api/farms/${activeFarmId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const body = (await response.json().catch(() => ({}))) as
      VoiceSettings | { error?: string };
    if (!response.ok) {
      throw new Error(
        ("error" in body && body.error) || "Voice settings could not be saved.",
      );
    }
    setVoiceSettings(body as VoiceSettings);
    closeDrawer();
  }

  async function savePhoneNumber(phone: string) {
    if (!activeFarmId) throw new Error("Your farm is still loading.");
    const response = await fetch(`/api/farms/${activeFarmId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: phone }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      phoneNumber?: string;
    };
    if (!response.ok) {
      throw new Error(body.error ?? "Phone number could not be saved.");
    }
    setCurrentPhone(body.phoneNumber ?? phone);
  }

  async function patchReminder(
    id: string,
    action: "done" | "acknowledge" | "snooze",
    minutes?: number,
  ) {
    await fetch(`/api/reminders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...(minutes !== undefined ? { minutes } : {}),
      }),
    });
    // Re-fetch due reminders after any action
    try {
      const response = await fetch("/api/reminders?due=today");
      if (response.ok) {
        const data = (await response.json()) as { reminders: DueReminder[] };
        setDueReminders(data.reminders);
      }
    } catch {
      // Ignore re-fetch errors
    }
  }

  async function handleReminderDone(id: string) {
    await patchReminder(id, "done");
  }

  async function handleReminderSnooze(id: string) {
    await patchReminder(id, "snooze", 60);
  }

  async function handleReminderDismiss(id: string) {
    await patchReminder(id, "acknowledge");
  }

  const wakeWord = voiceSettings?.wakeWord ?? DEFAULT_WAKE_WORD;
  const placeholder =
    agent.pending && agent.lastQuestionText
      ? "Type your answer…"
      : "What happened on the farm today?";

  return (
    <div className="app">
      <ChatHeader
        farmName={agent.activeFarmName}
        menuButtonRef={menuButtonRef}
        onChoose={openDrawer}
      />

      <main className="chat" aria-label="Conversation with Tilly">
        <div className="chat-column">
          {agent.farmError && (
            <p className="banner-error" role="alert">
              {agent.farmError}
            </p>
          )}
          <ReminderBanner
            reminders={dueReminders}
            onDone={handleReminderDone}
            onSnooze={handleReminderSnooze}
            onDismiss={handleReminderDismiss}
          />
          <AgentFeed
            items={agent.feed}
            isLoading={isLoading}
            elapsedSeconds={elapsedSeconds}
            error={agent.error}
            onUndo={agent.undo}
            onRetry={agent.retry}
            greeting={
              activeFarmId
                ? buildGreeting(agent.activeFarmName, agent.lastRecord)
                : null
            }
            onTrySample={
              activeFarmId &&
              !agent.lastRecord &&
              agent.activeFarmName !== SAMPLE_FARM_NAME
                ? agent.openSampleFarm
                : null
            }
          />
          <div ref={feedEndRef} />
        </div>
      </main>

      <MessageBar
        value={draft}
        onChange={setDraft}
        onSend={(message) => void agent.sendMessage(message)}
        busy={isLoading}
        placeholder={placeholder}
        voiceMode={voiceSettings?.wakeWordEnabled ? "wakeWord" : "direct"}
        wakeWord={wakeWord}
        onOpenVoiceSettings={() => openDrawer("voice")}
        talkBack={talkBack}
        reply={reply}
      />

      {drawer && (
        <Drawer
          title={DRAWER_TITLES[drawer]}
          onClose={closeDrawer}
          returnFocusRef={menuButtonRef}
        >
          {drawer === "records" && (
            <FarmHistory
              history={agent.history}
              loading={agent.historyLoading}
              error={agent.historyError}
            />
          )}
          {drawer === "farms" && (
            <FarmsPanel
              farms={agent.farms}
              activeFarmId={activeFarmId}
              onSwitch={async (farmId) => {
                await agent.switchFarm(farmId);
                closeDrawer();
              }}
              onAdd={async (name) => {
                await agent.addFarm(name);
                closeDrawer();
              }}
              onTrySample={async () => {
                await agent.openSampleFarm();
                closeDrawer();
              }}
            />
          )}
          {drawer === "voice" &&
            (voiceSettings ? (
              <WakeWordSettings
                current={voiceSettings}
                onSave={saveVoiceSettings}
                talkBack={talkBack}
                talkBackSupported={talkBackSupported}
              />
            ) : (
              <p
                className={voiceSettingsError ? "drawer-error" : "drawer-note"}
                role={voiceSettingsError ? "alert" : undefined}
              >
                {voiceSettingsError ??
                  (agent.farmError
                    ? agent.farmError
                    : "Loading voice settings…")}
              </p>
            ))}
          {drawer === "notifications" && (
            <NotificationsSettings
              currentPhone={currentPhone}
              onSave={savePhoneNumber}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
