"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFarmAgent } from "@/app/hooks/useFarmAgent";
import AgentFeed from "@/app/components/AgentFeed";
import ChatHeader, { type MenuChoice } from "@/app/components/ChatHeader";
import Drawer from "@/app/components/Drawer";
import FarmHistory from "@/app/components/FarmHistory";
import FarmsPanel from "@/app/components/FarmsPanel";
import MessageBar from "@/app/components/MessageBar";
import WakeWordSettings, {
  type VoiceSettings,
} from "@/app/components/WakeWordSettings";
import { buildGreeting } from "@/app/lib/greeting";
import { DEFAULT_WAKE_WORD } from "@/src/domain/wake-word";

const DRAWER_TITLES: Record<MenuChoice, string> = {
  records: "My records",
  farms: "Farms",
  voice: "Voice settings",
};

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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeFarmId) return;
    let cancelled = false;
    setVoiceSettings(null);
    setVoiceSettingsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/farms/${activeFarmId}/settings`);
        if (!response.ok) throw new Error();
        const data = (await response.json()) as VoiceSettings;
        if (!cancelled) setVoiceSettings(data);
      } catch {
        if (!cancelled)
          setVoiceSettingsError("Voice settings could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
    };
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

  async function saveVoiceSettings(settings: VoiceSettings) {
    if (!activeFarmId) throw new Error("Your farm is still loading.");
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
            />
          )}
          {drawer === "voice" &&
            (voiceSettings ? (
              <WakeWordSettings
                current={voiceSettings}
                onSave={saveVoiceSettings}
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
        </Drawer>
      )}
    </div>
  );
}
