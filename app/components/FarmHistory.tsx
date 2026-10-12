"use client";

import type { SavedFarmEvent } from "@/app/hooks/useFarmAgent";

function formatStatus(status: SavedFarmEvent["status"]): string {
  switch (status) {
    case "incomplete":
      return "Needs a detail";
    case "proposed":
      return "Proposed";
    case "confirmed":
      return "Confirmed";
    case "corrected":
      return "Corrected";
    case "rejected":
      return "Rejected";
  }
}

export default function FarmHistory({
  history,
  loading,
}: {
  history: SavedFarmEvent[];
  loading: boolean;
}) {
  return (
    <section
      className="feedback-card history-card"
      aria-labelledby="history-heading"
    >
      <div className="result-heading">
        <span className="icon-circle">⌂</span>
        <div>
          <p className="eyebrow">FARM HISTORY</p>
          <h2 id="history-heading">Your saved records</h2>
        </div>
      </div>
      {loading ? (
        <p className="hint">Loading your farm history...</p>
      ) : history.length === 0 ? (
        <p className="hint">
          No saved records yet. Tell FarmMind what happened on the farm.
        </p>
      ) : (
        <div className="history-list">
          {history.map((savedEvent) => (
            <article className="history-item" key={savedEvent.id}>
              <div>
                <strong>{savedEvent.activity}</strong>
                <p>
                  {savedEvent.eventDate ?? "Date missing"} ·{" "}
                  {savedEvent.crop ?? "Crop missing"} ·{" "}
                  {savedEvent.field ?? "Field missing"}
                </p>
              </div>
              <div className="history-actions">
                <span className={`event-status ${savedEvent.status}`}>
                  {formatStatus(savedEvent.status)}
                </span>
                {savedEvent.savedBy === "agent" && (
                  <span className="by-agent-label">by FarmMind</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
