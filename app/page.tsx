"use client";

import { FormEvent, useState } from "react";

type FarmEvent = {
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
  status: "proposed" | "incomplete" | "confirmed" | "corrected" | "rejected";
  missingFields: string[];
};

type FarmInteractionResult = {
  events: FarmEvent[];
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
};

export default function HomePage() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<FarmInteractionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/extract-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        throw new Error("FarmMind could not process that message.");
      }

      setResult(body as FarmInteractionResult);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="brand-mark">F</div>
        <p className="eyebrow">FIELDLEDGER · FARMMIND</p>
        <h1>Your farm remembers.</h1>
        <p className="hero-copy">
          Tell FarmMind what happened in your own words. It will help turn it
          into a clear farm record.
        </p>
      </section>

      <section className="capture-card" aria-labelledby="capture-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">NEW FARM NOTE</p>
            <h2 id="capture-heading">What happened today?</h2>
          </div>
          <span className="status-dot">● Ready</span>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="farm-message">
            Describe what happened on your farm
          </label>
          <textarea
            id="farm-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="For example: I planted maize in the back field yesterday."
            rows={4}
            disabled={isLoading}
          />
          <div className="form-footer">
            <span className="hint">
              Write naturally. FarmMind will ask if needed.
            </span>
            <button type="submit" disabled={isLoading || !message.trim()}>
              {isLoading ? "Understanding..." : "Record activity"}
              {!isLoading && <span aria-hidden="true"> →</span>}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <section className="feedback-card error-card" role="alert">
          <span className="icon-circle">!</span>
          <div>
            <h2>We could not process that</h2>
            <p>{error}</p>
          </div>
        </section>
      )}

      {result && (
        <section className="feedback-card" aria-live="polite">
          <div className="result-heading">
            <span className="icon-circle">
              {result.clarificationRequired ? "?" : "✓"}
            </span>
            <div>
              <p className="eyebrow">
                {result.clarificationRequired
                  ? "ONE DETAIL NEEDED"
                  : "FARMMIND UNDERSTOOD"}
              </p>
              <h2>
                {result.clarificationRequired
                  ? result.clarificationQuestion
                  : "Here is what I heard"}
              </h2>
            </div>
          </div>

          {result.events.map((farmEvent, index) => (
            <article
              className="event-card"
              key={`${farmEvent.activity}-${index}`}
            >
              <div className="event-title">
                <span className="event-type">{farmEvent.activity}</span>
                <span className={`event-status ${farmEvent.status}`}>
                  {farmEvent.status}
                </span>
              </div>
              <dl className="event-details">
                <div>
                  <dt>Crop</dt>
                  <dd>{farmEvent.crop ?? "Missing"}</dd>
                </div>
                <div>
                  <dt>Field</dt>
                  <dd>{farmEvent.field ?? "Missing"}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{farmEvent.eventDate ?? "Missing"}</dd>
                </div>
              </dl>
              {farmEvent.missingFields.length > 0 && (
                <p className="missing-note">
                  Missing: {farmEvent.missingFields.join(", ")}
                </p>
              )}
            </article>
          ))}

          {!result.clarificationRequired && result.events.length > 0 && (
            <div className="action-row">
              <button className="secondary-button" type="button">
                Edit details
              </button>
              <button className="primary-button" type="button">
                Confirm record
              </button>
            </div>
          )}
        </section>
      )}

      <footer>
        <span>Private by design</span>
        <span>•</span>
        <span>Nothing is saved until you confirm</span>
      </footer>
    </main>
  );
}
