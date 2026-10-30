"use client";

import { type FormEvent, useState } from "react";
import { PRESET_WAKE_WORDS, wakeWordSchema } from "@/src/domain/wake-word";
import { displayWakeWord } from "@/app/lib/format";

export type VoiceSettings = { wakeWord: string; wakeWordEnabled: boolean };

export default function WakeWordSettings({
  current,
  onSave,
  talkBack,
  talkBackSupported,
}: {
  current: VoiceSettings;
  onSave: (settings: VoiceSettings, talkBack: boolean) => Promise<void>;
  talkBack: boolean;
  talkBackSupported: boolean;
}) {
  const [enabled, setEnabled] = useState(current.wakeWordEnabled);
  const [speakReplies, setSpeakReplies] = useState(talkBack);
  const [wakeWord, setWakeWord] = useState(current.wakeWord);
  const [custom, setCustom] = useState(
    !PRESET_WAKE_WORDS.includes(current.wakeWord),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = wakeWordSchema.safeParse(wakeWord);
  const preview = parsed.success ? displayWakeWord(parsed.data) : "…";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the wake word.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        { wakeWord: parsed.data, wakeWordEnabled: enabled },
        speakReplies,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Voice settings could not be saved.",
      );
      setSaving(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <fieldset className="settings-group">
        <legend>How the mic listens</legend>
        <label className="choice">
          <input
            type="radio"
            name="voice-mode"
            checked={!enabled}
            onChange={() => setEnabled(false)}
          />
          <span>
            <strong>Tap to speak</strong>
            <small>
              Tap the mic, speak, check the words, then send. Best in noisy
              places.
            </small>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="voice-mode"
            checked={enabled}
            onChange={() => setEnabled(true)}
          />
          <span>
            <strong>Hands-free</strong>
            <small>
              Tap the mic once, then start each message with your wake word.
              Tilly only receives what you say after it.
            </small>
          </span>
        </label>
        {talkBackSupported && (
          <label className="choice">
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={(event) => setSpeakReplies(event.target.checked)}
            />
            <span>
              <strong>Talk back</strong>
              <small>
                Tilly reads her replies aloud, then listens for your answer, so
                you can keep talking without touching the screen. Spoken
                messages are sent as soon as you pause.
              </small>
            </span>
          </label>
        )}
        <p className="settings-note">
          Your browser turns speech into text using its own service (Google in
          Chrome, Microsoft in Edge), which hears everything said while the mic
          is on.
        </p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Wake word</legend>
        <div className="preset-row">
          {PRESET_WAKE_WORDS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`preset${!custom && wakeWord === preset ? " preset-active" : ""}`}
              aria-pressed={!custom && wakeWord === preset}
              onClick={() => {
                setWakeWord(preset);
                setCustom(false);
                setError(null);
              }}
            >
              {displayWakeWord(preset)}
            </button>
          ))}
          <button
            type="button"
            className={`preset${custom ? " preset-active" : ""}`}
            aria-pressed={custom}
            onClick={() => {
              setCustom(true);
              setError(null);
            }}
          >
            Custom
          </button>
        </div>
        {custom && (
          <label className="custom-wake-word">
            <span>Your wake word</span>
            <input
              type="text"
              value={wakeWord}
              onChange={(event) => {
                setWakeWord(event.target.value);
                setError(null);
              }}
              placeholder="e.g. Hey Buddy"
              maxLength={50}
              autoComplete="off"
            />
            <small>
              Two or three words work best. Letters and spaces only.
            </small>
          </label>
        )}
        <p className="wake-preview">
          You&apos;ll say: <q>{preview}, I weeded the north field</q>
        </p>
      </fieldset>

      {error && (
        <p className="drawer-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
