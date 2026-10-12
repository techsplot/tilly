"use client";

import type {
  FeedItem,
  SavedFarmEvent,
  UndoableAgentAction,
} from "@/app/hooks/useFarmAgent";

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "no date";
  const parts = isoDate.split("-").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatFieldLabel(field: string): string {
  return field === "eventDate" ? "event date" : field;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  return String(value);
}

function recordedSummary(event: SavedFarmEvent): string {
  if (event.status === "incomplete") {
    const field = event.missingFields[0]
      ? formatFieldLabel(event.missingFields[0])
      : "detail";
    return `Saved without the ${field}. You can tell me later.`;
  }
  return `Recorded: ${event.activity} · ${event.field ?? "no field"} · ${formatDate(event.eventDate)}`;
}

function correctedSummary(
  action: Extract<UndoableAgentAction, { type: "corrected" }>,
): string {
  const changeText = action.changes
    .map(
      (change) =>
        `${formatFieldLabel(change.field)} ${formatValue(change.before)} → ${formatValue(change.after)}`,
    )
    .join(", ");
  return `Corrected: ${action.event.activity} · ${changeText}`;
}

function deletedSummary(event: SavedFarmEvent): string {
  return `Deleted: ${event.activity} · ${event.field ?? "no field"} · ${formatDate(event.eventDate)}`;
}

function ActionCard({
  item,
  onUndo,
}: {
  item: Extract<FeedItem, { kind: "action" }>;
  onUndo: (itemId: string, action: UndoableAgentAction) => void;
}) {
  const action = item.action;

  if (action.type === "question") {
    return (
      <article className="feed-card feed-question">
        <span className="feed-icon">?</span>
        <p>{action.text}</p>
      </article>
    );
  }

  if (action.type === "reply") {
    return (
      <article className="feed-card feed-reply">
        <p>{action.text}</p>
      </article>
    );
  }

  const isIncomplete =
    action.type === "recorded" && action.event.status === "incomplete";
  const summary =
    action.type === "recorded"
      ? recordedSummary(action.event)
      : action.type === "corrected"
        ? correctedSummary(action)
        : deletedSummary(action.event);

  return (
    <article className={`feed-card feed-${action.type}`}>
      <span className="feed-icon">{isIncomplete ? "~" : "✓"}</span>
      <div>
        <p>{summary}</p>
        {action.event.resolvedFromMemory &&
          action.event.resolvedFromMemory.length > 0 && (
            <div className="memory-note">
              {action.event.resolvedFromMemory.map((resolution) => (
                <p
                  key={`${resolution.eventId}-${resolution.field ?? resolution.crop}`}
                >
                  {resolution.field
                    ? `Field from your ${resolution.activity} record`
                    : `Crop from your ${resolution.activity} record`}
                  {resolution.eventDate ? ` on ${resolution.eventDate}.` : "."}
                </p>
              ))}
            </div>
          )}
        {item.undone ? (
          <span className="undo-link undone">Undone</span>
        ) : (
          <button
            type="button"
            className="undo-link"
            onClick={() => onUndo(item.id, action)}
            disabled={item.undoing}
          >
            {item.undoing ? "Undoing…" : "Undo"}
          </button>
        )}
      </div>
    </article>
  );
}

export default function AgentFeed({
  items,
  isLoading,
  elapsedSeconds,
  error,
  onUndo,
}: {
  items: FeedItem[];
  isLoading: boolean;
  elapsedSeconds: number;
  error: string | null;
  onUndo: (itemId: string, action: UndoableAgentAction) => void;
}) {
  return (
    <div className="agent-feed" aria-live="polite">
      {items.length === 0 && !isLoading && (
        <p className="hint feed-empty">
          Tell FarmMind what happened on the farm, in your own words.
        </p>
      )}
      {items.map((item) =>
        item.kind === "farmer" ? (
          <article key={item.id} className="feed-card feed-farmer">
            <p>{item.text}</p>
          </article>
        ) : (
          <ActionCard key={item.id} item={item} onUndo={onUndo} />
        ),
      )}
      {isLoading && (
        <article className="feed-card feed-working" role="status">
          <span className="feed-icon">⏳</span>
          <p>
            {elapsedSeconds > 8
              ? `Still working (${elapsedSeconds}s)...`
              : "FarmMind is thinking..."}
          </p>
        </article>
      )}
      {error && (
        <article className="feed-card feed-error" role="alert">
          <span className="feed-icon">!</span>
          <p>{error}</p>
        </article>
      )}
    </div>
  );
}
