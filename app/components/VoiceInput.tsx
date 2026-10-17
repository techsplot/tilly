"use client";

import { useEffect, useRef, useState } from "react";
import { matchWakeWord } from "@/src/domain/wake-word";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  wakeWord: string | undefined;
  wakeWordEnabled: boolean | undefined;
  disabled?: boolean;
}

type VoiceMode = "direct" | "wakeWord";
type VoiceState = "idle" | "listening" | "processing" | "activated" | "error";

// Browser speech recognition types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

/**
 * Check if browser supports speech recognition
 */
function isSpeechRecognitionSupported(): boolean {
  return !!(
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

/**
 * Voice input component with wake word detection support
 * Supports two modes:
 * - Direct: Tap to speak, sends transcript immediately
 * - Wake Word: Continuous listening, activates on wake word
 */
export default function VoiceInput({
  onTranscript,
  wakeWord = "hey farmmind",
  wakeWordEnabled = false,
  disabled = false,
}: VoiceInputProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<VoiceMode>("direct");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Check browser support on mount
  useEffect(() => {
    setIsSupported(isSpeechRecognitionSupported());
  }, []);

  // Initialize speech recognition
  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = mode === "wakeWord";
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setState("listening");
      setErrorMessage(null);
    };

    recognition.onresult = async (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;

        const alternative = result[0];
        if (!alternative) continue;

        const transcript = alternative.transcript;
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
      }

      if (final) {
        if (mode === "wakeWord" && wakeWordEnabled) {
          // Check for wake word
          await handleWakeWordDetection(final);
        } else {
          // Direct mode: send immediately
          handleTranscriptComplete(final);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);

      let message = "Speech recognition error";
      switch (event.error) {
        case "no-speech":
          message = "No speech detected. Please try again.";
          break;
        case "audio-capture":
          message = "No microphone found. Please check your device.";
          break;
        case "not-allowed":
          message =
            "Microphone permission denied. Please enable it in settings.";
          break;
        case "network":
          message = "Network error. Please check your connection.";
          break;
        default:
          message = `Error: ${event.error}`;
      }

      setErrorMessage(message);
      setState("error");

      // Auto-recover from some errors
      if (mode === "wakeWord" && event.error === "no-speech") {
        setTimeout(() => {
          if (recognitionRef.current && state === "listening") {
            try {
              recognitionRef.current.start();
            } catch (e) {
              console.error("Failed to restart recognition:", e);
            }
          }
        }, 1000);
      }
    };

    recognition.onend = () => {
      if (mode === "wakeWord" && state === "listening") {
        // Restart continuous listening
        try {
          recognition.start();
        } catch (e) {
          console.error("Failed to restart continuous listening:", e);
          setState("idle");
        }
      } else {
        setState("idle");
        setInterimTranscript("");
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [isSupported, mode, state, wakeWordEnabled]);

  /**
   * Handle wake word detection
   */
  async function handleWakeWordDetection(transcript: string) {
    const match = matchWakeWord(transcript, wakeWord);
    if (match.matched && match.command) {
      setState("activated");
      playActivationSound();
      handleTranscriptComplete(match.command);
    } else {
      setState("listening");
      setInterimTranscript("");
    }
  }

  /**
   * Handle completed transcript
   */
  function handleTranscriptComplete(text: string) {
    setInterimTranscript("");
    onTranscript(text);

    // In direct mode, stop after sending
    if (mode === "direct") {
      stopListening();
    } else {
      // In wake word mode, reset to listening after brief pause
      setTimeout(() => {
        setState("listening");
      }, 500);
    }
  }

  /**
   * Play activation sound when wake word detected
   */
  function playActivationSound() {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = 800;
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (error) {
      console.error("Failed to play activation sound:", error);
    }
  }

  /**
   * Start listening
   */
  function startListening() {
    if (!recognitionRef.current || state === "listening") return;

    try {
      setErrorMessage(null);
      recognitionRef.current.start();
    } catch (error) {
      console.error("Failed to start recognition:", error);
      setErrorMessage("Failed to start listening");
      setState("error");
    }
  }

  /**
   * Stop listening
   */
  function stopListening() {
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.stop();
      setState("idle");
      setInterimTranscript("");
    } catch (error) {
      console.error("Failed to stop recognition:", error);
    }
  }

  /**
   * Toggle listening
   */
  function toggleListening() {
    if (state === "listening") {
      stopListening();
    } else {
      startListening();
    }
  }

  /**
   * Handle long press to switch modes
   */
  function handleMouseDown() {
    longPressTimerRef.current = setTimeout(() => {
      if (wakeWordEnabled) {
        setMode(mode === "direct" ? "wakeWord" : "direct");
        playActivationSound();
      }
    }, 800);
  }

  function handleMouseUp() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Not supported
  if (!isSupported) {
    return (
      <div className="text-sm text-gray-500 text-center p-2">
        Voice input not supported in this browser.
        <br />
        Try Chrome, Edge, or Safari.
      </div>
    );
  }

  const isListening = state === "listening";
  const isActive = state === "activated";

  return (
    <div className="voice-input">
      <button
        type="button"
        onClick={toggleListening}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        disabled={disabled || state === "processing"}
        className={`
          voice-button
          ${isListening ? "listening" : ""}
          ${isActive ? "activated" : ""}
          ${state === "error" ? "error" : ""}
          ${disabled ? "disabled" : ""}
        `}
        aria-label={
          isListening
            ? "Stop listening"
            : mode === "wakeWord"
              ? `Listening for "${wakeWord}"`
              : "Start voice input"
        }
      >
        {/* Mic icon */}
        <svg
          className="mic-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>

        {/* Wake word mode badge */}
        {mode === "wakeWord" && wakeWordEnabled && (
          <span className="mode-badge">👂</span>
        )}
      </button>

      {/* Interim transcript */}
      {interimTranscript && (
        <div className="interim-transcript">{interimTranscript}</div>
      )}

      {/* Status text */}
      {isListening && mode === "wakeWord" && (
        <div className="status-text">
          Listening for &quot;{wakeWord}&quot;...
        </div>
      )}

      {/* Error message */}
      {errorMessage && <div className="error-text">{errorMessage}</div>}

      <style jsx>{`
        .voice-input {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .voice-button {
          position: relative;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 2px solid #3b82f6;
          background: white;
          color: #3b82f6;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-button:hover:not(:disabled) {
          background: #eff6ff;
          transform: scale(1.05);
        }

        .voice-button:active:not(:disabled) {
          transform: scale(0.95);
        }

        .voice-button.listening {
          background: #ef4444;
          border-color: #ef4444;
          color: white;
          animation: pulse 1.5s ease-in-out infinite;
        }

        .voice-button.activated {
          background: #10b981;
          border-color: #10b981;
          color: white;
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);
        }

        .voice-button.error {
          background: #f87171;
          border-color: #f87171;
          color: white;
        }

        .voice-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mic-icon {
          width: 24px;
          height: 24px;
        }

        .mode-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 24px;
          height: 24px;
          background: #10b981;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          border: 2px solid white;
        }

        .interim-transcript {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 8px;
          padding: 8px 12px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          border-radius: 8px;
          font-size: 14px;
          white-space: nowrap;
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .status-text {
          font-size: 12px;
          color: #6b7280;
          text-align: center;
        }

        .error-text {
          font-size: 12px;
          color: #ef4444;
          text-align: center;
          max-width: 250px;
        }

        @keyframes pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
          }
        }
      `}</style>
    </div>
  );
}
