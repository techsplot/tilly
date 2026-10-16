"use client";

import { useEffect, useRef, useState } from "react";
import { useFarmAgent } from "@/app/hooks/useFarmAgent";
import AgentFeed from "@/app/components/AgentFeed";
import MessageBar from "@/app/components/MessageBar";
import FarmHistory from "@/app/components/FarmHistory";

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
    sendMessage,
    retry,
    undo,
  } = useFarmAgent();
  const [activeTab, setActiveTab] = useState<"feed" | "history">("feed");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedIntervalRef = useRef<number | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

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

  const placeholder =
    pending && lastQuestionText
      ? `Answer: ${lastQuestionText}`
      : "What happened on the farm today?";

  return (
    <main className="shell">
      <section className="hero">
        <div className="brand-mark">F</div>
        <p className="eyebrow">FIELDLEDGER · FARMMIND</p>
        <h1>Your farm remembers.</h1>
        <p className="farm-context">{activeFarmName}</p>
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
      />

      <footer>
        <span>Private by design</span>
        <span>•</span>
        <span>
          Records are saved for this browser. Clearing browser data starts a new
          farm.
        </span>
      </footer>
    </main>
  );
}
