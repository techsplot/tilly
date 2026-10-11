"use client";

import { FormEvent, useState } from "react";
import {
  FarmEvent,
  FarmInteractionResult,
  farmInteractionResultSchema,
} from "@/src/domain/farm-event";

type FarmInteractionResult = FarmInteractionResult;

export default function HomePage() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<FarmInteractionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [clarifications, setClarifications] = useState<
    Array<{ question: string; answer: string }>
  >([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const payload =
        result && result.clarificationRequired && clarificationAnswer.trim()
          ? {
              message,
              clarificationAnswer,
              clarifications: [...clarifications, { question: result.clarificationQuestion!, answer: clarificationAnswer }],
            }
          : { message };

      const response = await fetch("/api/extract-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json();
        const errorMessage =
          typeof body.error === "string" ? body.error : "FarmMind could not process that message.";
        throw new Error(errorMessage);
      }

      const body = await response.json();
      const parsed = farmInteractionResultSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("FarmMind returned invalid data.");
      }

      setResult(parsed.data as FarmInteractionResult);
      setClarificationAnswer("");
      setClarifications(
        result?.clarificationRequired && clarifications.length < 3
          ? [...clarifications, { question: result.clarificationQuestion!, answer: "" }]
          : clarifications
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Something went wrong. Please try again.",
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

      {result &&
        result.clarificationRequired &&
        clarificationAnswer.length < 1 &&
        !isLoading && (
        <section className="clarification-card">
          <div className="section-heading">
            <p className="eyebrow">CLARIFICATION NEEDED</p>
            <h3>To complete this {result.events[0]?.activity} record, what is the <u>one detail</u> needed?</h3>
          </div>
          <p className="clarification-question">
            {result.clarificationQuestion}
          </p>
          <textarea
            rows={2}
            placeholder="Type the missing detail..."
            value={clarificationAnswer}
            onChange={(e) => setClarificationAnswer(e.target.value)}
            disabled={isLoading}
          />
          <div className="form-footer">
            <button
              type="submit"
              disabled={isLoading}
              className="primary-button"
              onClick={handleSubmit}
            >
              Submit answer
            </button>
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
                {(isEditing && editingIndex === index) ? (
                  <div className="edit-fields-popup">
                    <div className="popup-header">
                      <span className="popup-title">Edit {farmEvent.activity}</span>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setEditingIndex(-1);
                          setResult(null);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="popup-body">
                      <div>
                        <label>Crop</label>
                        <input
                          defaultValue={farmEvent.crop || ""}
                          onChange={(e) =>
                            setResult((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                events: prev.events.map((e, i) =>
                                  i === index
                                    ? { ...e, crop: e.target.value }
                                    : e
                                ),
                              };
                            }}
                        />
                      </div>
                      <div>
                        <label>Field</label>
                        <input
                          defaultValue={farmEvent.field || ""}
                          onChange={(e) =>
                            setResult((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                events: prev.events.map((e, i) =>
                                  i === index
                                    ? { ...e, field: e.target.value }
                                    : e
                                ),
                              };
                            }}
                        />
                      </div>
                      <div>
                        <label>Date (YYYY-MM-DD)</label>
                        <input
                          defaultValue={farmEvent.eventDate || ""}
                          onChange={(e) =>
                            setResult((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                events: prev.events.map((e, i) =>
                                  i === index
                                    ? { ...e, eventDate: e.target.value }
                                    : e
                                ),
                              };
                            }}
                        />
                      </div>
                    </div>
                    <div className="popup-footer">
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setIsEditing(false);
                          setEditingIndex(-1);
                          setResult(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button className="primary-button" onClick={() => setIsEditing(false)}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
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
                )}
                {farmEvent.missingFields.length > 0 && (
                  <p className="missing-note">
                    Missing: {farmEvent.missingFields.join(", ")}
                  </p>
                )}
              </dl>
            </article>
          ))}

          {!result.clarificationRequired && result.events.length > 0 && (
            <div className="action-row">
              <button
                className="secondary-button" type="button"
                onClick={() => setIsEditing(true)}
              >
                Edit details
              </button>
              <button
                className="primary-button" type="button"
                onClick={() => setResult((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    events: prev.events.map((event, i) =>
                      i === editingIndex
                        ? { ...event, status: "confirmed" }
                        : event
                    ),
                    isEditing: false,
                    editingIndex: -1,
                  };
                }}
              >
                Confirm record
              </button>
              <button
                className="secondary-button" type="button"
                onClick={() => setResult((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    events: prev.events.map((event, i) =>
                      i === editingIndex
                        ? { ...event, status: "rejected" }
                        : event
                    ),
                    isEditing: false,
                    editingIndex: -1,
                  };
                }}
              >
                Reject record
              </button>
            </div>
          )}
        </section>
      )}

      <footer>
        <span>Private by design</span>
        <span>•</span>
        <span>Records are not saved yet in this preview.</span>
      </footer>
    </main>
  );
}