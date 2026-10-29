"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  AgentAction,
  FeedItem,
  SavedFarmEvent,
  UndoableAgentAction,
} from "@/app/hooks/useFarmAgent";
import { formatClock, formatDate } from "@/app/lib/format";

function formatFieldLabel(field: string): string {
  if (field === "eventDate") return "date";
  if (field === "eventTime") return "time";
  if (field === "timeOfDay") return "time of day";
  return field;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  return String(value);
}

function dateTimeLabel(event: SavedFarmEvent): string {
  const date = !event.eventDate
    ? "no date"
    : event.dateAssumed
      ? "today"
      : formatDate(event.eventDate);
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

function undoableSummary(action: UndoableAgentAction): string {
  if (action.type === "recorded") {
    if (action.possibleDuplicate) return "Looks like a repeat.";
    const segments: string[] = [action.event.activity];
    if (action.event.field) segments.push(action.event.field);
    segments.push(dateTimeLabel(action.event));
    return `Recorded: ${segments.join(" · ")}${gapNote(action.event.missingFields)}`;
  }
  if (action.type === "corrected") {
    const changes = action.changes
      .map(
        (change) =>
          `${formatFieldLabel(change.field)} ${formatValue(change.before)} → ${formatValue(change.after)}`,
      )
      .join(", ");
    return `Corrected: ${action.event.activity} · ${changes}`;
  }
  return `Deleted: ${action.event.activity} · ${action.event.field ?? "no field"} · ${formatDate(action.event.eventDate)}`;
}

function citedRecordLabel(
  record: Extract<AgentAction, { type: "answer" }>["citedRecords"][number],
): string {
  const parts = [record.activity];
  if (record.crop) parts.push(record.crop);
  if (record.field) parts.push(record.field);
  if (record.eventDate) parts.push(formatDate(record.eventDate));
  if (record.eventTime) parts.push(record.eventTime.slice(0, 5));
  else if (record.timeOfDay) parts.push(record.timeOfDay);
  return parts.join(" · ");
}

function Bubble({
  from,
  tone,
  at,
  footer,
  role,
  children,
}: {
  from: "farmer" | "agent";
  tone?: "question" | "error" | "muted" | undefined;
  at?: number;
  footer?: ReactNode;
  role?: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div className={`bubble-row bubble-row-${from}`}>
      <article
        className={`bubble bubble-${from}${tone ? ` bubble-${tone}` : ""}`}
        role={role}
      >
        {children}
        {(footer || at !== undefined) && (
          <div className="bubble-footer">
            {footer}
            {at !== undefined && (
              <time
                className="bubble-time"
                dateTime={new Date(at).toISOString()}
              >
                {formatClock(at)}
              </time>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

function Suggestions({
  items,
}: {
  items: Array<{ text: string; confidence: string }> | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="suggestions">
      {items.map((suggestion, index) => (
        <li
          key={index}
          className={`suggestion suggestion-${suggestion.confidence}`}
        >
          {suggestion.text}
        </li>
      ))}
    </ul>
  );
}

function ActionBubble({
  item,
  onUndo,
}: {
  item: Extract<FeedItem, { kind: "action" }>;
  onUndo: (itemId: string, action: UndoableAgentAction) => void;
}) {
  const { action } = item;

  if (action.type === "question") {
    return (
      <Bubble from="agent" tone="question" at={item.at}>
        <p>{action.text}</p>
      </Bubble>
    );
  }
  if (action.type === "reply") {
    return (
      <Bubble from="agent" at={item.at}>
        <p>{action.text}</p>
      </Bubble>
    );
  }
  if (action.type === "answer") {
    return (
      <Bubble from="agent" at={item.at}>
        <p>{action.text}</p>
        {action.citedRecords.length > 0 && (
          <div className="cited-records">
            <p className="cited-label">Based on</p>
            <ul>
              {action.citedRecords.map((record) => (
                <li key={record.id}>{citedRecordLabel(record)}</li>
              ))}
            </ul>
          </div>
        )}
      </Bubble>
    );
  }
  if (action.type === "briefing") {
    return (
      <Bubble from="agent" at={item.at}>
        <p>{action.text}</p>
        <Suggestions items={action.suggestions} />
      </Bubble>
    );
  }

  const memory = action.event.resolvedFromMemory ?? [];
  return (
    <Bubble
      from="agent"
      tone={item.undone ? "muted" : undefined}
      at={item.at}
      footer={
        item.undone ? (
          <span className="bubble-action bubble-action-done">Undone</span>
        ) : (
          <button
            type="button"
            className="bubble-action"
            onClick={() => onUndo(item.id, action)}
            disabled={item.undoing}
          >
            {item.undoing ? "Undoing…" : "Undo"}
          </button>
        )
      }
    >
      <p>
        <span className="receipt-mark" aria-hidden="true">
          ✓{" "}
        </span>
        {undoableSummary(action)}
      </p>
      {memory.length > 0 && (
        <div className="memory-note">
          {memory.map((resolution) => (
            <p
              key={`${resolution.eventId}-${resolution.field ?? resolution.crop}`}
            >
              {resolution.field
                ? `Field from your ${resolution.activity} record`
                : `Crop from your ${resolution.activity} record`}
              {resolution.eventDate
                ? ` on ${formatDate(resolution.eventDate)}.`
                : "."}
            </p>
          ))}
        </div>
      )}
      {action.type === "recorded" && <Suggestions items={action.suggestions} />}
    </Bubble>
  );
}

function FailedBubble({
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
    <Bubble
      from="agent"
      tone="error"
      role="alert"
      at={item.at}
      footer={
        item.retryable ? (
          <button
            type="button"
            className="bubble-action"
            onClick={() => onRetry(item.id)}
            disabled={retryDisabled}
          >
            {item.retrying
              ? "Retrying…"
              : retryLimitReached
                ? "Retry limit reached"
                : waitSeconds > 0
                  ? `Retry in ${waitSeconds}s`
                  : "Retry"}
          </button>
        ) : (
          <span className="bubble-action bubble-action-done">
            Retry unavailable
          </span>
        )
      }
    >
      <p>{item.error}</p>
    </Bubble>
  );
}

function WelcomeBubble({
  greeting,
  onTrySample,
}: {
  greeting: string;
  onTrySample: (() => Promise<void>) | null;
}) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function trySample(open: () => Promise<void>) {
    setOpening(true);
    setFailed(null);
    try {
      await open();
    } catch (caughtError) {
      setFailed(
        caughtError instanceof Error
          ? caughtError.message
          : "The sample farm could not be opened. Please try again.",
      );
      setOpening(false);
    }
  }

  return (
    <Bubble
      from="agent"
      footer={
        onTrySample ? (
          <button
            type="button"
            className="bubble-action"
            disabled={opening}
            onClick={() => void trySample(onTrySample)}
          >
            {opening ? "Opening the sample farm…" : "Try a sample farm"}
          </button>
        ) : undefined
      }
    >
      <p>{greeting}</p>
      {onTrySample && (
        <p className="welcome-sample-note">
          New here? The sample farm has three weeks of records to ask about.
        </p>
      )}
      {failed && (
        <p className="welcome-sample-error" role="alert">
          {failed}
        </p>
      )}
    </Bubble>
  );
}

export default function AgentFeed({
  items,
  isLoading,
  elapsedSeconds,
  error,
  onUndo,
  onRetry,
  greeting,
  onTrySample,
}: {
  items: FeedItem[];
  isLoading: boolean;
  elapsedSeconds: number;
  error: string | null;
  onUndo: (itemId: string, action: UndoableAgentAction) => void;
  onRetry: (itemId: string) => void;
  // Shown while the conversation is empty; null until the farm has loaded.
  greeting: string | null;
  // Offered on an empty farm's welcome; null when there is nothing to offer.
  onTrySample: (() => Promise<void>) | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!items.some((item) => item.kind === "failed")) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [items]);

  return (
    <div className="feed" aria-live="polite">
      {items.length === 0 && !isLoading && greeting && (
        <WelcomeBubble greeting={greeting} onTrySample={onTrySample} />
      )}
      {items.map((item) =>
        item.kind === "farmer" ? (
          <Bubble key={item.id} from="farmer" at={item.at}>
            <p>{item.text}</p>
          </Bubble>
        ) : item.kind === "failed" ? (
          <FailedBubble key={item.id} item={item} now={now} onRetry={onRetry} />
        ) : (
          <ActionBubble key={item.id} item={item} onUndo={onUndo} />
        ),
      )}
      {isLoading && (
        <Bubble from="agent" role="status">
          <p className="typing">
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {elapsedSeconds > 8
              ? `Still working (${elapsedSeconds}s)…`
              : "Tilly is thinking…"}
          </p>
        </Bubble>
      )}
      {error && (
        <Bubble from="agent" tone="error" role="alert">
          <p>{error}</p>
        </Bubble>
      )}
    </div>
  );
}
