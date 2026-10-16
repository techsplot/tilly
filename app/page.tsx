"use client";

import { useEffect, useRef, useState } from "react";
import { useFarmAgent } from "@/app/hooks/useFarmAgent";
import AgentFeed from "@/app/components/AgentFeed";
import MessageBar from "@/app/components/MessageBar";
import FarmHistory from "@/app/components/FarmHistory";
import WakeWordSettings from "@/app/components/WakeWordSettings";

export default function HomePage() {
  const {
    feed,
    pending,
    lastQuestionText,
    isLoading,
    error,
    history,
    historyLoading,
    activeFarmName,
    activeFarmId,
    sendMessage,
    retry,
    undo,
  } = useFarmAgent();
  const [activeTab, setActiveTab] = useState<"feed" | "history">("feed");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedIntervalRef = useRef<number | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  // Wake word settings state
  const [showSettings, setShowSettings] = useState(false);
  const [wakeWord, setWakeWord] = useState("hey farmmind");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Load wake word settings on mount
  useEffect(() => {
    async function loadSettings() {
      if (!activeFarmId) {
        setSettingsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/farms/${activeFarmId}/settings`);
        if (response.ok) {
          const data = await response.json();
          setWakeWord(data.wakeWord ?? "hey farmmind");
          setWakeWordEnabled(data.wakeWordEnabled ?? false);
        }
      } catch (error) {
        console.error("Failed to load wake word settings:", error);
      } finally {
        setSettingsLoading(false);
      }
    }

    void loadSettings();
  }, [activeFarmId]);

  useEffect(() => {
    if (isLoading) {
      setElapsedSeconds(0);
      elapsedIntervalRef.current = window.setInterval(() => {
        setElapsedSeconds((seconds) => seconds + 1);
      }, 1000);
    } else if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [isLoading]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed, isLoading]);

  async function handleSaveSettings(settings: {
    wakeWord: string;
    wakeWordEnabled: boolean;
  }) {
    if (!activeFarmId) {
      throw new Error("No active farm");
    }

    const response = await fetch(`/api/farms/${activeFarmId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? "Failed to save settings");
    }

    const data = await response.json();
    setWakeWord(data.wakeWord);
    setWakeWordEnabled(data.wakeWordEnabled);
    setShowSettings(false);
  }

  const placeholder =
    pending && lastQuestionText
      ? `Answer: ${lastQuestionText}`
      : "What happened on the farm today?";

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-content">
          <div className="brand-mark">F</div>
          <div className="hero-text">
            <p className="eyebrow">FIELDLEDGER · FARMMIND</p>
            <h1>Your farm remembers.</h1>
            <p className="farm-context">{activeFarmName}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="settings-button"
            aria-label="Wake word settings"
            title="Voice settings"
          >
            ⚙️
          </button>
        </div>
      </section>

      <nav className="tab-row" aria-label="View">
        <button
          type="button"
          className={activeTab === "feed" ? "tab active" : "tab"}
          onClick={() => setActiveTab("feed")}
        >
          Feed
        </button>
        <button
          type="button"
          className={activeTab === "history" ? "tab active" : "tab"}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
      </nav>

      <div className="panels">
        <section
          className={`feed-panel ${activeTab === "feed" ? "" : "panel-hidden-mobile"}`}
        >
          <AgentFeed
            items={feed}
            isLoading={isLoading}
            elapsedSeconds={elapsedSeconds}
            error={error}
            onUndo={undo}
            onRetry={retry}
          />
          <div ref={feedEndRef} />
        </section>

        <section
          className={`history-panel ${activeTab === "history" ? "" : "panel-hidden-mobile"}`}
        >
          <FarmHistory history={history} loading={historyLoading} />
        </section>
      </div>

      <MessageBar
        disabled={isLoading}
        placeholder={placeholder}
        onSend={(message) => void sendMessage(message)}
        wakeWord={wakeWord}
        wakeWordEnabled={wakeWordEnabled}
      />

      {showSettings && !settingsLoading && activeFarmId && (
        <>
          <div
            className="settings-overlay"
            onClick={() => setShowSettings(false)}
          />
          <WakeWordSettings
            farmId={activeFarmId}
            currentWakeWord={wakeWord}
            currentEnabled={wakeWordEnabled}
            onSave={handleSaveSettings}
            onClose={() => setShowSettings(false)}
          />
        </>
      )}

      <footer>
        <span>Private by design</span>
        <span>•</span>
        <span>
          Records are saved for this browser. Clearing browser data starts a new
          farm.
        </span>
      </footer>

      <style jsx>{`
        .hero-content {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          position: relative;
        }

        .hero-text {
          flex: 1;
        }

        .settings-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          padding: 8px;
          opacity: 0.7;
          transition: opacity 0.2s;
        }

        .settings-button:hover {
          opacity: 1;
        }

        .settings-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 999;
        }
      `}</style>
    </main>
  );
}
