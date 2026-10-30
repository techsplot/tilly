"use client";

const MAX_VISIBLE = 3;

export type DueReminder = {
  id: string;
  activity: string;
  fieldName: string | null;
  crop: string | null;
  reminderDate: string;
  status: string;
};

type ReminderBannerProps = {
  reminders: DueReminder[];
  onDone: (id: string) => Promise<void>;
  onSnooze: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
};

function isDueLabel(reminderDate: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return reminderDate < today ? "Overdue" : "Due today";
}

/**
 * ReminderBanner
 *
 * Displays up to 3 due or overdue reminder cards above the agent feed.
 * Each card shows the activity, optional field name, and a "Due today" / "Overdue" label.
 *
 * Actions:
 *   "Done"  → onDone(id)   (green button)
 *   "Later" → onSnooze(id) (muted button — snooze 60 min)
 *   "×"     → onDismiss(id)(dismiss without completing)
 *
 * When more than 3 reminders exist a "+N more" count is shown.
 */
export default function ReminderBanner({
  reminders,
  onDone,
  onSnooze,
  onDismiss,
}: ReminderBannerProps) {
  if (reminders.length === 0) return null;

  const visible = reminders.slice(0, MAX_VISIBLE);
  const overflow = reminders.length - MAX_VISIBLE;

  return (
    <div className="reminder-banner" role="region" aria-label="Due reminders">
      {visible.map((reminder) => (
        <ReminderCard
          key={reminder.id}
          reminder={reminder}
          onDone={onDone}
          onSnooze={onSnooze}
          onDismiss={onDismiss}
        />
      ))}
      {overflow > 0 && (
        <p className="reminder-banner-overflow" aria-live="polite">
          +{overflow} more
        </p>
      )}
    </div>
  );
}

function ReminderCard({
  reminder,
  onDone,
  onSnooze,
  onDismiss,
}: {
  reminder: DueReminder;
  onDone: (id: string) => Promise<void>;
  onSnooze: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const label = isDueLabel(reminder.reminderDate);
  const isOverdue = label === "Overdue";

  const title = reminder.fieldName
    ? `${reminder.activity} · ${reminder.fieldName}`
    : reminder.activity;

  return (
    <div
      className={`reminder-card${isOverdue ? " reminder-card--overdue" : ""}`}
      role="alert"
    >
      <div className="reminder-card-body">
        <span className="reminder-card-title">{title}</span>
        <span
          className={`reminder-card-label${isOverdue ? " reminder-card-label--overdue" : ""}`}
        >
          {label}
        </span>
      </div>
      <div className="reminder-card-actions">
        <button
          type="button"
          className="reminder-btn reminder-btn--done"
          aria-label={`Mark "${title}" as done`}
          onClick={() => void onDone(reminder.id)}
        >
          Done
        </button>
        <button
          type="button"
          className="reminder-btn reminder-btn--snooze"
          aria-label={`Snooze "${title}" for later`}
          onClick={() => void onSnooze(reminder.id)}
        >
          Later
        </button>
        <button
          type="button"
          className="reminder-btn reminder-btn--dismiss"
          aria-label={`Dismiss "${title}"`}
          onClick={() => void onDismiss(reminder.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
