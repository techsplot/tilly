"use client";

import type { SavedFarmEvent } from "@/app/hooks/useFarmAgent";
import { formatDate } from "@/app/lib/format";

function formatWhen(event: SavedFarmEvent): string {
  const date = event.eventDate ? formatDate(event.eventDate) : "Date missing";
  if (event.eventTime) return `${date}, ${event.eventTime.slice(0, 5)}`;
  if (event.timeOfDay) return `${date}, ${event.timeOfDay}`;
  return date;
}

// Farmers see whether a record is complete, not the review lifecycle.
function plainStatus(event: SavedFarmEvent): string | null {
  if (event.status === "incomplete") return "Needs a detail";
  if (event.status === "corrected") return "Corrected";
  return null;
}

export default function FarmHistory({
  history,
  loading,
  error,
}: {
  history: SavedFarmEvent[];
  loading: boolean;
  error: string | null;
}) {
  const visible = history.filter((event) => event.status !== "rejected");

  if (error) {
    return (
      <p className="drawer-note drawer-error" role="alert">
        {error}
      </p>
    );
  }
  if (loading && visible.length === 0) {
    return <p className="drawer-note">Loading your records…</p>;
  }
  if (visible.length === 0) {
    return (
      <p className="drawer-note">
        No records yet. Tell Tilly what happened on the farm and it will appear
        here.
      </p>
    );
  }

  return (
    <ul className="record-list">
      {visible.map((event) => {
        const status = plainStatus(event);
        const details = [event.crop, event.field].filter(Boolean).join(" · ");
        return (
          <li className="record" key={event.id}>
            <div className="record-main">
              <strong className="record-activity">{event.activity}</strong>
              {details && <span className="record-details">{details}</span>}
              <span className="record-when">{formatWhen(event)}</span>
            </div>
            {status && (
              <span className={`record-status record-status-${event.status}`}>
                {status}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
