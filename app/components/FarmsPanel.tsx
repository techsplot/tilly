"use client";

import { type FormEvent, useState } from "react";
import type { FarmSummary } from "@/app/hooks/useFarmAgent";
import { SAMPLE_FARM_NAME } from "@/src/application/sample-farm-data";

export default function FarmsPanel({
  farms,
  activeFarmId,
  onSwitch,
  onAdd,
  onTrySample,
}: {
  farms: FarmSummary[];
  activeFarmId: string | undefined;
  onSwitch: (farmId: string) => Promise<void>;
  onAdd: (name: string) => Promise<void>;
  onTrySample: () => Promise<void>;
}) {
  const sampleFarm = farms.find((farm) => farm.name === SAMPLE_FARM_NAME);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "That did not work. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      await onAdd(trimmed);
      setName("");
    });
  }

  return (
    <div className="farms-panel">
      <ul className="farm-list">
        {farms.map((farm) => {
          const active = farm.id === activeFarmId;
          return (
            <li key={farm.id}>
              <button
                type="button"
                className={`farm-option${active ? " farm-option-active" : ""}`}
                aria-current={active ? "true" : undefined}
                disabled={busy || active}
                onClick={() => void run(() => onSwitch(farm.id))}
              >
                <span className="avatar avatar-small" aria-hidden="true">
                  {farm.name.charAt(0).toUpperCase()}
                </span>
                <span className="farm-option-name">{farm.name}</span>
                {active && <span className="farm-option-tag">Current</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <form className="add-farm" onSubmit={handleAdd}>
        <label htmlFor="new-farm-name">Add a farm</label>
        <div className="add-farm-row">
          <input
            id="new-farm-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. River Farm"
            maxLength={100}
            autoComplete="off"
          />
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !name.trim()}
          >
            Add
          </button>
        </div>
      </form>

      {!sampleFarm && (
        <div className="sample-farm">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void run(onTrySample)}
          >
            Try a sample farm
          </button>
          <p className="drawer-note">
            A farm with three weeks of planting, weeding, spraying and harvest
            records, to see what Tilly can answer.
          </p>
        </div>
      )}

      {error && (
        <p className="drawer-error" role="alert">
          {error}
        </p>
      )}
      <p className="drawer-note">
        You can also name a farm in a message, like “I weeded at River Farm”.
      </p>
    </div>
  );
}
