"use client";

import { type FormEvent, useState } from "react";

export default function MessageBar({
  disabled,
  placeholder,
  onSend,
}: {
  disabled: boolean;
  placeholder: string;
  onSend: (message: string) => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  }

  return (
    <form className="message-bar" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="farm-message">
        Describe what happened on your farm
      </label>
      <button
        type="button"
        className="mic-button"
        disabled
        aria-label="Voice input (coming soon)"
        title="Voice input is coming soon"
      >
        🎤
      </button>
      <input
        id="farm-message"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
