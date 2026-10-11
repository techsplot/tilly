"use client";

import { type FormEvent, useState, useRef, useEffect } from "react";
import {
  FarmEvent,
  FarmInteractionResult,
  farmInteractionResultSchema,
  correctEvent,
  confirmEvent,
  rejectEvent,
} from "@/src/domain/farm-event";

function formatStatus(status: FarmEvent["status"]): string {
  switch (status) {
    case "incomplete":
      return "Needs a detail";
    case "proposed":
      return "Ready to confirm";
    case "confirmed":
      return "Confirmed (not saved yet)";
    case "corrected":
      return "Ready to confirm";
    case "rejected":
      return "Rejected";
  }
}

function getStatusDotClass(isLoading: boolean, error: string | null): string {
  if (error) return "error";
  if (isLoading) return "working";
  return "ready";
}

function getStatusDotLabel(isLoading: boolean, error: string | null): string {
  if (error) return "Error";
  if (isLoading) return "Working";
  return "Ready";
}

function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function HomePage() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<FarmInteractionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [clarifications, setClarifications] = useState<
    Array<{ question: string; answer: string }>
  >([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState<{
    crop?: string | null;
    field?: string | null;
    eventDate?: string | null;
    quantity?: number | null;
    unit?: string | null;
  } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedIntervalRef = useRef<number | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) {
      setElapsedSeconds(0);
      elapsedIntervalRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    }
    return () => {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
      }
    };
  }, [isLoading]);

  function buildPayload(nextClarifications = clarifications): {
    message: string;
    currentDate: string;
    clarifications: Array<{ question: string; answer: string }>;
  } {
    return {
      message,
      currentDate: currentDate ?? getLocalDateString(),
      clarifications: nextClarifications,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    const nextDate = getLocalDateString();
    setCurrentDate(nextDate);
    setClarifications([]);
    setResult(null);
    await submitNote([], nextDate);
  }

  async function submitNote(
    nextClarifications: Array<{ question: string; answer: string }>,
    requestDate = currentDate ?? getLocalDateString(),
  ) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/extract-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildPayload(nextClarifications),
          currentDate: requestDate,
        }),
      });

      if (!response.ok) {
        const body = await response.json();
        const errorMessage =
          typeof body.error === "string"
            ? body.error
            : "FarmMind could not process that message.";
        throw new Error(errorMessage);
      }

      const body = await response.json();
      const parsed = farmInteractionResultSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("FarmMind returned invalid data.");
      }

      setResult(parsed.data);
      setClarificationAnswer("");
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

  async function handleClarificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clarificationAnswer.trim()) return;
    if (!result?.clarificationQuestion) return;

    const nextClarifications = [
      ...clarifications,
      {
        question: result.clarificationQuestion,
        answer: clarificationAnswer.trim(),
      },
    ];
    setClarifications(nextClarifications);
    setClarificationAnswer("");
    await submitNote(nextClarifications);
  }

  function startEdit(index: number) {
    const event = result?.events[index];
    if (!event) return;
    setEditDraft({
      crop: event.crop ?? "",
      field: event.field ?? "",
      eventDate: event.eventDate ?? "",
      quantity: event.quantity,
      unit: event.unit ?? "",
    });
    setIsEditing(true);
    setEditingIndex(index);
  }

  function handleEditChange(
    field: keyof FarmEvent,
    value: string | number | null,
  ) {
    setEditDraft((prev) => (prev ? { ...prev, [field]: value } : null));
  }

  function saveEdit() {
    if (
      !editDraft ||
      editingIndex < 0 ||
      !result ||
      editingIndex >= result.events.length
    )
      return;
    const eventToEdit = result.events[editingIndex]!;
    try {
      const updatedEvent = correctEvent(eventToEdit, editDraft);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e, i) =>
                i === editingIndex ? updatedEvent : e,
              ),
            }
          : null,
      );
    } catch (err) {
      console.error("Failed to save edit", err);
      setError("Please check the date and required details.");
      return;
    }
    setIsEditing(false);
    setEditingIndex(-1);
    setEditDraft(null);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditingIndex(-1);
    setEditDraft(null);
  }

  function handleConfirm(index: number) {
    if (!result || index >= result.events.length) return;
    const eventToConfirm = result.events[index]!;
    try {
      const updatedEvent = confirmEvent(eventToConfirm);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e, i) =>
                i === index ? updatedEvent : e,
              ),
            }
          : null,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Cannot confirm this event",
      );
    }
  }

  function handleReject(index: number) {
    if (!result || index >= result.events.length) return;
    const eventToReject = result.events[index]!;
    try {
      const updatedEvent = rejectEvent(eventToReject);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e, i) =>
                i === index ? updatedEvent : e,
              ),
            }
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot reject this event");
    }
  }

  function startOver() {
    setMessage("");
    setResult(null);
    setClarificationAnswer("");
    setClarifications([]);
    setIsEditing(false);
    setEditingIndex(-1);
    setEditDraft(null);
    setError(null);
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
          <span className={`status-dot ${getStatusDotClass(isLoading, error)}`}>
            ● {getStatusDotLabel(isLoading, error)}
          </span>
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

      {isLoading && (
        <section
          className="feedback-card working-card"
          role="status"
          aria-live="polite"
        >
          <span className="icon-circle">⏳</span>
          <div>
            <p>
              {elapsedSeconds > 8
                ? `Still working (${elapsedSeconds}s). FarmMind is thinking about your note.`
                : `FarmMind is thinking (${elapsedSeconds}s).`}
            </p>
          </div>
        </section>
      )}

      {result &&
        result.clarificationRequired &&
        result.clarificationQuestion &&
        !isLoading &&
        clarifications.length < 3 && (
          <section className="clarification-card">
            <div className="section-heading">
              <p className="eyebrow">CLARIFICATION NEEDED</p>
            </div>
            <p className="clarification-question">
              {result.clarificationQuestion}
            </p>
            <form onSubmit={handleClarificationSubmit}>
              <textarea
                rows={2}
                placeholder="Type the missing detail..."
                value={clarificationAnswer}
                onChange={(event) => setClarificationAnswer(event.target.value)}
                disabled={isLoading}
              />
              <div className="form-footer">
                <button
                  type="submit"
                  disabled={isLoading || !clarificationAnswer.trim()}
                  className="primary-button"
                >
                  Submit answer
                </button>
              </div>
            </form>
          </section>
        )}

      {result &&
        clarifications.length >= 3 &&
        result.clarificationRequired &&
        !isLoading && (
          <section className="clarification-card">
            <p className="clarification-question">
              Three clarification rounds reached. Please edit the event directly
              to fill in the remaining details.
            </p>
            <div className="form-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
          </section>
        )}

      {result && result.events.length > 0 && (
        <section className="feedback-card" aria-live="polite">
          <div className="result-heading">
            <span className="icon-circle">✓</span>
            <div>
              <p className="eyebrow">FARMMIND UNDERSTOOD</p>
              <h2>Here is what I heard</h2>
            </div>
          </div>

          {result.events.map((farmEvent, index) => (
            <article
              key={`${farmEvent.activity}-${index}`}
              className="event-card"
            >
              <div className="event-title">
                <span className="event-type">{farmEvent.activity}</span>
                <span className={`event-status ${farmEvent.status}`}>
                  {formatStatus(farmEvent.status)}
                </span>
              </div>

              {isEditing && editingIndex === index ? (
                <div className="edit-form">
                  <div>
                    <label htmlFor={`edit-crop-${index}`}>Crop</label>
                    <input
                      id={`edit-crop-${index}`}
                      type="text"
                      value={editDraft?.crop ?? ""}
                      onChange={(e) => handleEditChange("crop", e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`edit-field-${index}`}>Field</label>
                    <input
                      id={`edit-field-${index}`}
                      type="text"
                      value={editDraft?.field ?? ""}
                      onChange={(e) =>
                        handleEditChange("field", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`edit-date-${index}`}>Date</label>
                    <input
                      id={`edit-date-${index}`}
                      type="date"
                      value={editDraft?.eventDate ?? ""}
                      onChange={(e) =>
                        handleEditChange("eventDate", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`edit-quantity-${index}`}>Quantity</label>
                    <input
                      id={`edit-quantity-${index}`}
                      type="number"
                      value={editDraft?.quantity ?? ""}
                      onChange={(e) =>
                        handleEditChange(
                          "quantity",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`edit-unit-${index}`}>Unit</label>
                    <input
                      id={`edit-unit-${index}`}
                      type="text"
                      value={editDraft?.unit ?? ""}
                      onChange={(e) => handleEditChange("unit", e.target.value)}
                    />
                  </div>
                  <div className="form-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveEdit}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}

              <div className="action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => startEdit(index)}
                  disabled={
                    isLoading ||
                    farmEvent.status === "confirmed" ||
                    farmEvent.status === "rejected"
                  }
                >
                  Edit details
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleConfirm(index)}
                  disabled={
                    isLoading ||
                    farmEvent.missingFields.length > 0 ||
                    farmEvent.status === "confirmed" ||
                    farmEvent.status === "rejected"
                  }
                >
                  {farmEvent.missingFields.length > 0
                    ? "Cannot confirm"
                    : farmEvent.status === "confirmed"
                      ? "Confirmed"
                      : "Confirm record"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleReject(index)}
                  disabled={
                    isLoading ||
                    farmEvent.status === "rejected" ||
                    farmEvent.status === "confirmed"
                  }
                >
                  {farmEvent.status === "rejected"
                    ? "Rejected"
                    : farmEvent.status === "confirmed"
                      ? "Cannot reject"
                      : "Reject"}
                </button>
              </div>
            </article>
          ))}

          <button
            type="button"
            className="secondary-button"
            onClick={startOver}
          >
            Start over
          </button>
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
