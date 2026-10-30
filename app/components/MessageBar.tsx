"use client";

import { type FormEvent, useEffect, useRef } from "react";
import { useSpeaker } from "@/app/hooks/useSpeaker";
import { useVoiceInput } from "@/app/hooks/useVoiceInput";
import { displayWakeWord } from "@/app/lib/format";
import type { SpokenReply } from "@/app/lib/spoken-reply";
import type { VoiceMode } from "@/app/lib/voice-controller";

const LONG_PRESS_MS = 600;
// A short gap after Tilly stops talking so the mic does not catch the tail
// of her own voice.
const RELISTEN_DELAY_MS = 300;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function MessageBar({
  value,
  onChange,
  onSend,
  busy,
  placeholder,
  voiceMode,
  wakeWord,
  onOpenVoiceSettings,
  talkBack,
  reply,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  busy: boolean;
  placeholder: string;
  voiceMode: VoiceMode;
  wakeWord: string;
  onOpenVoiceSettings: () => void;
  talkBack: boolean;
  reply: SpokenReply | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(busy);
  const pressTimerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  // Set when a spoken message is sent with talk back on: Tilly's reply to
  // it is read aloud, then the mic reopens.
  const awaitingReplyRef = useRef(false);
  const relistenTimerRef = useRef<number | null>(null);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const speaker = useSpeaker();
  const conversing = talkBack && speaker.supported;
  const conversingRef = useRef(conversing);
  useEffect(() => {
    conversingRef.current = conversing;
  }, [conversing]);

  const voice = useVoiceInput({
    mode: voiceMode,
    wakeWord,
    onTranscript: (text, from) => {
      // With talk back on, a spoken message is a turn in a conversation:
      // it goes straight to Tilly, and listening pauses until she answers.
      if (conversingRef.current && !busyRef.current) {
        if (from === "wakeWord") voice.stop();
        awaitingReplyRef.current = true;
        onSend(text);
        return;
      }
      // Direct mode: the farmer reviews the words before sending. Wake word
      // mode is hands-free, so the command goes straight to Tilly unless
      // it is still answering, in which case it waits in the input.
      if (from === "direct" || busyRef.current) {
        onChange(text);
        inputRef.current?.focus();
        return;
      }
      onSend(text);
    },
  });
  const { speak, cancel: cancelSpeech } = speaker;
  const { start: startListening } = voice;

  // Once Tilly has answered a spoken turn, say the answer, then listen again.
  useEffect(() => {
    if (busy || !awaitingReplyRef.current) return;
    awaitingReplyRef.current = false;
    const relisten = () => {
      relistenTimerRef.current = window.setTimeout(() => {
        relistenTimerRef.current = null;
        startListening();
      }, RELISTEN_DELAY_MS);
    };
    if (reply) speak(reply.text, relisten);
    else relisten();
  }, [busy, reply, speak, startListening]);

  useEffect(
    () => () => {
      if (relistenTimerRef.current !== null) {
        window.clearTimeout(relistenTimerRef.current);
      }
    },
    [],
  );

  // Ends the conversation: Tilly stops talking and the mic stays closed.
  function endConversation() {
    awaitingReplyRef.current = false;
    if (relistenTimerRef.current !== null) {
      window.clearTimeout(relistenTimerRef.current);
      relistenTimerRef.current = null;
    }
    cancelSpeech();
    voice.stop();
  }

  const hasText = value.trim().length > 0;
  const showMic = voice.supported && !hasText;
  const shownValue = voice.listening && voice.interim ? voice.interim : value;
  const shownPlaceholder = !voice.listening
    ? placeholder
    : voiceMode === "wakeWord"
      ? `Listening for "${displayWakeWord(wakeWord)}"…`
      : "Listening… speak now";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasText || busy) return;
    onSend(value);
    onChange("");
  }

  function clearPress() {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  function handlePressStart() {
    longPressedRef.current = false;
    clearPress();
    pressTimerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      endConversation();
      onOpenVoiceSettings();
    }, LONG_PRESS_MS);
  }

  function handleMicClick() {
    clearPress();
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (
      speaker.speaking ||
      awaitingReplyRef.current ||
      relistenTimerRef.current !== null
    ) {
      endConversation();
      return;
    }
    voice.toggle();
  }

  const status = voice.error
    ? { text: voice.error, alert: true }
    : speaker.speaking
      ? { text: "Tilly is talking… Tap the mic to stop.", alert: false }
      : voice.listening && voiceMode === "wakeWord"
        ? { text: "Hands-free is on. Tap the mic to stop.", alert: false }
        : voice.listening && conversing
          ? { text: "Talking with Tilly. Tap the mic to stop.", alert: false }
          : null;

  return (
    <div className="composer">
      {status && (
        <p
          className={`composer-status${status.alert ? " composer-status-error" : ""}`}
          role={status.alert ? "alert" : "status"}
        >
          {status.text}
        </p>
      )}
      <form className="composer-row" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="farm-message">
          Describe what happened on your farm
        </label>
        <input
          ref={inputRef}
          id="farm-message"
          className="composer-input"
          type="text"
          value={shownValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={shownPlaceholder}
          readOnly={voice.listening}
          autoComplete="off"
          enterKeyHint="send"
        />
        {showMic ? (
          <button
            type="button"
            className={`action-button mic-button mic-${speaker.speaking ? "activated" : voice.state}`}
            onClick={handleMicClick}
            onPointerDown={handlePressStart}
            onPointerUp={clearPress}
            onPointerLeave={clearPress}
            onContextMenu={(event) => event.preventDefault()}
            aria-label={
              speaker.speaking
                ? "Stop Tilly talking"
                : voice.listening
                  ? "Stop listening"
                  : voiceMode === "wakeWord"
                    ? `Start hands-free listening for ${displayWakeWord(wakeWord)}`
                    : "Speak a message"
            }
            aria-pressed={voice.listening}
            title="Tap to speak. Hold for voice settings."
          >
            <MicIcon />
            {voiceMode === "wakeWord" && (
              <span className="mic-badge" aria-hidden="true">
                👂
              </span>
            )}
          </button>
        ) : (
          <button
            type="submit"
            className="action-button send-button"
            disabled={!hasText || busy}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        )}
      </form>
    </div>
  );
}
