import type {
  SynthesisLike,
  UtteranceConstructor,
  UtteranceLike,
  VoiceLike,
} from "@/app/lib/speaker";

// Tilly's natural voice: the reply is synthesised by Deepgram through
// /api/voice/speak and played here. Shaped like the browser's
// speechSynthesis so Speaker drives it unchanged.

class DeepgramUtterance implements UtteranceLike {
  lang = "en-US";
  rate = 1;
  voice: VoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly text: string) {}
}

export const DeepgramUtteranceClass: UtteranceConstructor = DeepgramUtterance;

export function createDeepgramSynthesis(): SynthesisLike {
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let request: AbortController | null = null;

  function release(): void {
    request?.abort();
    request = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    audio = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  return {
    speak(utterance) {
      release();
      const { text } = utterance as DeepgramUtterance;
      const controller = new AbortController();
      request = controller;
      void (async () => {
        try {
          const response = await fetch("/api/voice/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("speech failed");
          const blob = await response.blob();
          if (request !== controller) return;
          objectUrl = URL.createObjectURL(blob);
          const player = new Audio(objectUrl);
          audio = player;
          player.onended = () => utterance.onend?.();
          player.onerror = () => utterance.onerror?.();
          await player.play();
        } catch {
          if (request === controller) utterance.onerror?.();
        }
      })();
    },
    cancel() {
      release();
    },
    getVoices: () => [],
  };
}
