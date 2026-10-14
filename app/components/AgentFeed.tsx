"use client";

import { useEffect, useState } from "react";
import type {
  FeedItem,
  SavedFarmEvent,
  UndoableAgentAction,
} from "@/app/hooks/useFarmAgent";
import type { CitedRecord } from "@/src/application/farm-question";

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
  if (field === "eventDate") return "event date";
  if (field === "eventTime") return "time";
  if (field === "timeOfDay") return "time of day";
  return field;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  return String(value);
}

function dateLabel(event: SavedFarmEvent): string {
  if (!event.eventDate) return "no date";
  return event.dateAssumed ? "today" : formatDate(event.eventDate);
}

function dateTimeLabel(event: SavedFarmEvent): string {
  const date = dateLabel(event);
  if (event.eventTime) return `${date} ${event.eventTime.slice(0, 5)}`;
  if (event.timeOfDay) return `${date}, ${event.timeOfDay}`;
  return date;
}

// Finding 11: records save with gaps rather than blocking on them, so the
// receipt names what was not mentioned instead of hiding missing details.
function gapNote(missingFields: string[]): string {
  if (missingFields.length === 0) return "";
  const labels = missingFields.map((field) =>
    field === "eventDate" ? "date" : field,
  );
  return ` (${labels.join(", ")} not given)`;
}

function recordedSummary(event: SavedFarmEvent): string {
  const segments: string[] = [event.activity];
  if (event.field) segments.push(event.field);
  segments.push(dateTimeLabel(event));
  return `Recorded: ${segments.join(" · ")}${gapNote(event.missingFields)}`;
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

function formatCitedRecord(record: {
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
  eventTime: string | null;
  timeOfDay: string | null;
}): string {
  const parts = [record.activity];
  if (record.crop) parts.push(record.crop);
  if (record.field) parts.push(record.field);
  if (record.eventDate) parts.push(`on ${formatDate(record.eventDate)}`);
  if (record.eventTime) parts.push(`at ${record.eventTime}`);
  else if (record.timeOfDay) parts.push(record.timeOfDay);
  return parts.join(" · ");
}

function AnswerCard({
  action,
}: {
  action: Extract<FeedItem, { kind: "action"; type: "answer" }>["action"];
}) {
  const answeredAction = action as {
    text: string;
    citedRecords: CitedRecord[];
  };
  return (
    <article className="feed-card feed-answer">
      <span className="feed-icon">💬</span>
      <div>
        <p>{answeredAction.text}</p>
        {answeredAction.citedRecords.length > 0 && (
          <div className="cited-records">
            <p className="cited-label">Based on:</p>
            <ul>
              {answeredAction.citedRecords.map((record) => (
                <li key={record.id}>{formatCitedRecord(record)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
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

  if (action.type === "answer") {
    return (
      <AnswerCard
        action={
          action as Extract<
            FeedItem,
            { kind: "action"; type: "answer" }
          >["action"]
        }
      />
    );
  }

  const isDuplicate =
    action.type === "recorded" && action.possibleDuplicate === true;
  const summary = isDuplicate
    ? "Looks like a repeat."
    : action.type === "recorded"
      ? recordedSummary(action.event)
      : action.type === "corrected"
        ? correctedSummary(action)
        : deletedSummary(action.event);

  return (
    <article className={`feed-card feed-${action.type}`}>
      <span className="feed-icon">✓</span>
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

function FailedCard({
  item,
  now,
  onRetry,
}: {
  item: Extract<FeedItem, { kind: "failed" }>;
  now: number;
  onRetry: (itemId: string) => void;
}) {
  const waitSeconds = Math.max(0, Math.ceil((item.nextRetryAt - now) / 1000));
  const retryLimitReached = item.attempts >= 5;
  const retryDisabled =
    !item.retryable || item.retrying || waitSeconds > 0 || retryLimitReached;

  return (
    <article className="feed-card feed-error" role="alert">
      <span className="feed-icon">!</span>
      <div>
        <p>{item.error}</p>
        {item.retryable ? (
          <button
            type="button"
            className="retry-link"
            onClick={() => onRetry(item.id)}
            disabled={retryDisabled}
          >
            {item.retrying
              ? "Retrying..."
              : retryLimitReached
                ? "Retry limit reached"
                : waitSeconds > 0
                  ? `Retry in ${waitSeconds}s`
                  : "Retry"}
          </button>
        ) : (
          <span className="retry-link retry-unavailable">
            Retry unavailable
          </span>
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
  onRetry,
}: {
  items: FeedItem[];
  isLoading: boolean;
  elapsedSeconds: number;
  error: string | null;
  onUndo: (itemId: string, action: UndoableAgentAction) => void;
  onRetry: (itemId: string) => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!items.some((item) => item.kind === "failed")) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [items]);

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
        ) : item.kind === "failed" ? (
          <FailedCard key={item.id} item={item} now={now} onRetry={onRetry} />
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
