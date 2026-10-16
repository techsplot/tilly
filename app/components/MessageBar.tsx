"use client";

import { type FormEvent, useState } from "react";
import VoiceInput from "./VoiceInput";

export default function MessageBar({
  disabled,
  placeholder,
  onSend,
  wakeWord,
  wakeWordEnabled,
}: {
  disabled: boolean;
  placeholder: string;
  onSend: (message: string) => void;
  wakeWord?: string;
  wakeWordEnabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  }

  function handleVoiceTranscript(transcript: string) {
    // Voice input sends the transcript directly
    if (transcript.trim()) {
      onSend(transcript);
    }
    setIsVoiceActive(false);
  }

  return (
    <div className="message-bar-container">
      <form className="message-bar" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="farm-message">
          Describe what happened on your farm
        </label>

        {/* Voice Input Component */}
        <div className="voice-input-wrapper">
          <VoiceInput
            onTranscript={handleVoiceTranscript}
            wakeWord={wakeWord}
            wakeWordEnabled={wakeWordEnabled}
            disabled={disabled}
          />
        </div>

        <input
          id="farm-message"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          disabled={disabled || isVoiceActive}
          autoComplete="off"
        />
        <button type="submit" disabled={disabled || !value.trim()}>
          Send
        </button>
      </form>

      <style jsx>{`
        .message-bar-container {
          position: relative;
        }

        .voice-input-wrapper {
          position: absolute;
          left: 8px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 10;
        }
      `}</style>
    </div>
  );
}
