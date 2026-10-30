"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeakerOptions, Speaker } from "@/app/lib/speaker";

export function useSpeaker() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakerRef = useRef<Speaker | null>(null);

  useEffect(() => {
    const options = getSpeakerOptions(window);
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
  }, []);

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
