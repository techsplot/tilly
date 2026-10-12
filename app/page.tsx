"use client";

import { type FormEvent, useState, useRef, useEffect } from "react";
import { z } from "zod";
import {
  FarmEvent,
  FarmInteractionResult,
  farmInteractionResultSchema,
  farmEventSchema,
  correctEvent,
} from "@/src/domain/farm-event";

type SavedFarmEvent = FarmEvent & { id: string };
const savedFarmEventSchema = farmEventSchema.extend({ id: z.uuid() });

function formatStatus(status: FarmEvent["status"]): string {
  switch (status) {
    case "incomplete":
      return "Needs a detail";
    case "proposed":
      return "Ready to confirm";
    case "confirmed":
      return "Confirmed";
    case "corrected":
      return "Ready to confirm";
    case "rejected":
      return "Rejected";
  }
}

function formatMissingField(field: string): string {
  return field === "eventDate" ? "event date" : field;
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
  const [proposalEvents, setProposalEvents] = useState<FarmEvent[]>([]);
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<SavedFarmEvent[]>([]);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error("Farm history could not be loaded.");
      const body: unknown = await response.json();
      const parsed = z
        .object({ events: z.array(savedFarmEventSchema) })
        .safeParse(body);
      if (!parsed.success)
        throw new Error("Farm history returned invalid data.");
      setHistory(parsed.data.events);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Farm history could not be loaded.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

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
  ): Promise<boolean> {
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
      setProposalEvents(parsed.data.events);
      setSavedIds({});
      setClarificationAnswer("");
      return true;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
    return false;
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
    const succeeded = await submitNote(nextClarifications);
    if (succeeded) {
      setClarifications(nextClarifications);
      setClarificationAnswer("");
    }
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

  async function saveEdit() {
    if (
      !editDraft ||
      editingIndex < 0 ||
      !result ||
      editingIndex >= result.events.length
    )
      return;
    const eventToEdit = result.events[editingIndex]!;
    try {
      let updatedEvent: FarmEvent;
      const savedId = savedIds[editingIndex];
      if (savedId) {
        const response = await fetch(`/api/events/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editDraft),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
              ? body.error
              : "Farm event could not be saved.",
          );
        }
        const parsed = savedFarmEventSchema.safeParse(body);
        if (!parsed.success)
          throw new Error("Farm event returned invalid data.");
        updatedEvent = parsed.data;
      } else {
        updatedEvent = correctEvent(eventToEdit, editDraft);
      }
      setResult((prev) => {
        if (!prev) return null;
        const events = prev.events.map((e, i) =>
          i === editingIndex ? updatedEvent : e,
        );
        const hasMissingFields = events.some(
          (farmEvent) => farmEvent.missingFields.length > 0,
        );
        const firstIncompleteEvent = events.find(
          (farmEvent) => farmEvent.missingFields.length > 0,
        );
        return {
          ...prev,
          events,
          clarificationRequired: hasMissingFields,
          clarificationQuestion: hasMissingFields
            ? `To complete this ${firstIncompleteEvent?.activity} record, what is the ${formatMissingField(firstIncompleteEvent?.missingFields[0] ?? "detail")}?`
            : null,
        };
      });
      await refreshHistory();
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

  async function saveDecision(
    index: number,
    decision: "confirm" | "reject" | "save_incomplete",
  ) {
    if (!result || index >= result.events.length) return;
    setSavingIndex(index);
    setError(null);
    try {
      const eventToSave = result.events[index]!;
      const savedId = savedIds[index];
      const requestInit: RequestInit = savedId
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proposal: proposalEvents[index] ?? eventToSave,
              final: eventToSave,
              decision,
            }),
          };
      const response = await fetch(
        savedId
          ? `/api/events/${savedId}/${decision === "confirm" ? "confirm" : "reject"}`
          : "/api/events",
        requestInit,
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "Farm event could not be saved.",
        );
      }
      const parsed = savedFarmEventSchema.safeParse(body);
      if (!parsed.success) throw new Error("Farm event returned invalid data.");
      setSavedIds((previous) => ({ ...previous, [index]: parsed.data.id }));
      setResult((previous) =>
        previous
          ? {
              ...previous,
              events: previous.events.map((event, eventIndex) =>
                eventIndex === index ? parsed.data : event,
              ),
            }
          : null,
      );
      await refreshHistory();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Farm event could not be saved.",
      );
    } finally {
      setSavingIndex(null);
    }
  }

  function openHistoryEvent(savedEvent: SavedFarmEvent) {
    setResult({
      events: [savedEvent],
      clarificationRequired: false,
      clarificationQuestion: null,
    });
    setProposalEvents([savedEvent]);
    setSavedIds({ 0: savedEvent.id });
    setIsEditing(false);
    setEditingIndex(-1);
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
    setProposalEvents([]);
    setSavedIds({});
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
            <span className="icon-circle">
              {result.events.some((event) => event.missingFields.length > 0)
                ? "?"
                : "✓"}
            </span>
            <div>
              <p className="eyebrow">
                {result.events.some((event) => event.missingFields.length > 0)
                  ? "FARMMIND NEEDS ONE MORE DETAIL"
                  : "FARMMIND UNDERSTOOD"}
              </p>
              <h2>
                {result.events.some((event) => event.missingFields.length > 0)
                  ? "Here is what I heard so far"
                  : "Here is what I heard"}
              </h2>
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
                  disabled={isLoading || farmEvent.status === "rejected"}
                >
                  Edit details
                </button>
                {farmEvent.missingFields.length > 0 ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void saveDecision(index, "save_incomplete")}
                    disabled={
                      isLoading ||
                      savingIndex !== null ||
                      Boolean(savedIds[index])
                    }
                  >
                    {savingIndex === index
                      ? "Saving..."
                      : savedIds[index]
                        ? "Saved for later"
                        : "Save for later"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void saveDecision(index, "confirm")}
                    disabled={
                      isLoading ||
                      savingIndex !== null ||
                      farmEvent.status === "confirmed"
                    }
                  >
                    {savingIndex === index
                      ? "Saving..."
                      : farmEvent.status === "confirmed"
                        ? "Saved"
                        : "Confirm record"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void saveDecision(index, "reject")}
                  disabled={
                    isLoading ||
                    savingIndex !== null ||
                    farmEvent.status === "rejected" ||
                    farmEvent.status === "confirmed" ||
                    farmEvent.status === "corrected"
                  }
                >
                  {farmEvent.status === "rejected" ? "Rejected" : "Reject"}
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
        {historyLoading ? (
          <p className="hint">Loading your farm history...</p>
        ) : history.length === 0 ? (
          <p className="hint">
            No saved records yet. Confirm an activity or save an incomplete one
            for later.
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
                  {savedEvent.status === "incomplete" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openHistoryEvent(savedEvent)}
                    >
                      Complete
                    </button>
                  ) : savedEvent.status === "confirmed" ||
                    savedEvent.status === "corrected" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openHistoryEvent(savedEvent)}
                    >
                      Correct
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

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
