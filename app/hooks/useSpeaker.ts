"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceProvider } from "@/app/hooks/useVoiceInput";
import {
  createDeepgramSynthesis,
  DeepgramUtteranceClass,
} from "@/app/lib/deepgram-speech";
import { getSpeakerOptions, Speaker } from "@/app/lib/speaker";

export function useSpeaker(provider: VoiceProvider) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakerRef = useRef<Speaker | null>(null);

  useEffect(() => {
    // Deepgram's natural voice when the server has it, otherwise the
    // voices installed in the browser.
    const options =
      provider === "deepgram" && typeof Audio !== "undefined"
        ? {
            synthesis: createDeepgramSynthesis(),
            Utterance: DeepgramUtteranceClass,
          }
        : getSpeakerOptions(window);
    if (!options) return;
    setSupported(true);
    const speaker = new Speaker({
      ...options,
      lang: navigator.language || "en-US",
    });
    speakerRef.current = speaker;
    return () => {
      speaker.cancel();
      speakerRef.current = null;
    };
  }, [provider]);

  const speak = useCallback((text: string, done: () => void) => {
    const speaker = speakerRef.current;
    if (!speaker) {
      done();
      return;
    }
    setSpeaking(true);
    speaker.speak(text, () => {
      setSpeaking(false);
      done();
    });
  }, []);

  const cancel = useCallback(() => {
    speakerRef.current?.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, cancel };
}
