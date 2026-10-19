"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRecognitionConstructor,
  VoiceController,
  type VoiceMode,
  type VoiceState,
} from "@/app/lib/voice-controller";

// A short rising tone so the farmer knows the wake word was heard without
// looking at the screen.
function playChime(context: AudioContext | null) {
  if (!context) return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.25, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.2);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.2);
  } catch {
    // The chime is a nicety; the visual state still changes.
  }
}

export function useVoiceInput({
  mode,
  wakeWord,
  onTranscript,
}: {
  mode: VoiceMode;
  wakeWord: string;
  onTranscript: (text: string, mode: VoiceMode) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<VoiceController | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = getRecognitionConstructor(window);
    if (!Recognition) return;
    setSupported(true);
    const controller = new VoiceController({
      Recognition,
      lang: navigator.language || "en-US",
      onState: setState,
      onInterim: setInterim,
      onTranscript: (text, from) => onTranscriptRef.current(text, from),
      onActivate: () => playChime(audioRef.current),
      onError: setError,
    });
    controllerRef.current = controller;
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.configure(mode, wakeWord);
  }, [mode, wakeWord, supported]);

  const toggle = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (controller.listening) {
      controller.stop();
      return;
    }
    // Browsers only allow audio after a tap, so the chime's context is
    // created here rather than when the wake word is heard.
    if (!audioRef.current && typeof AudioContext !== "undefined") {
      audioRef.current = new AudioContext();
    }
    void audioRef.current?.resume();
    controller.start();
  }, []);

  const stop = useCallback(() => controllerRef.current?.stop(), []);

  return {
    supported,
    state,
    interim,
    error,
    listening: state === "listening" || state === "activated",
    toggle,
    stop,
  };
}
