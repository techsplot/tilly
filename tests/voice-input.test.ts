import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRecognitionConstructor,
  VoiceController,
  type RecognitionEventLike,
  type RecognitionLike,
  type VoiceMode,
  type VoiceState,
} from "../app/lib/voice-controller";

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = 0;
  aborted = false;
  onstart: (() => void) | null = null;
  onresult: ((event: RecognitionEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }

  speak(transcript: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal, 0: { transcript } }],
    });
  }
}

const latest = () => FakeRecognition.instances.at(-1)!;

function setup(mode: VoiceMode, wakeWord = "hey tilly") {
  const states: VoiceState[] = [];
  const interims: string[] = [];
  const transcripts: Array<[string, VoiceMode]> = [];
  const errors: Array<string | null> = [];
  const onActivate = vi.fn();
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const controller = new VoiceController({
    Recognition: FakeRecognition,
    onState: (state) => states.push(state),
    onInterim: (text) => interims.push(text),
    onTranscript: (text, from) => transcripts.push([text, from]),
    onActivate,
    onError: (message) => errors.push(message),
    schedule: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
  });
  controller.configure(mode, wakeWord);
  const runTimers = () => {
    for (const timer of timers.splice(0)) timer.callback();
  };
  return {
    controller,
    states,
    interims,
    transcripts,
    errors,
    onActivate,
    timers,
    runTimers,
  };
}

describe("voice controller", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
  });

  it("finds the browser's speech recognition, or none", () => {
    expect(getRecognitionConstructor(undefined)).toBeNull();
    expect(getRecognitionConstructor({})).toBeNull();
    expect(
      getRecognitionConstructor({ webkitSpeechRecognition: FakeRecognition }),
    ).toBe(FakeRecognition);
  });

  describe("direct mode", () => {
    it("shows the interim text, then hands back the transcript and stops", () => {
      const voice = setup("direct");
      voice.controller.start();
      expect(latest().continuous).toBe(false);
      expect(voice.states).toContain("listening");

      latest().speak("I weeded", false);
      expect(voice.interims.at(-1)).toBe("I weeded");

      latest().speak("I weeded the north field");
      expect(voice.transcripts).toEqual([
        ["I weeded the north field", "direct"],
      ]);
      expect(voice.controller.listening).toBe(false);
      expect(voice.states.at(-1)).toBe("idle");
      expect(voice.onActivate).not.toHaveBeenCalled();
    });

    it("tells the farmer when nothing was heard", () => {
      const voice = setup("direct");
      voice.controller.start();
      latest().onerror?.({ error: "no-speech" });
      expect(voice.errors.at(-1)).toContain("didn't hear anything");
      expect(voice.states.at(-1)).toBe("error");
    });
  });

  describe("wake word mode", () => {
    it("listens continuously and hands back only the command", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      expect(latest().continuous).toBe(true);

      latest().speak("Hey Tilly, I sprayed the back field");
      expect(voice.onActivate).toHaveBeenCalledTimes(1);
      expect(voice.transcripts).toEqual([
        ["I sprayed the back field", "wakeWord"],
      ]);
      expect(voice.states).toContain("activated");
      expect(voice.controller.listening).toBe(true);

      voice.runTimers();
      expect(voice.states.at(-1)).toBe("listening");
    });

    it("hands back nothing for speech without the wake word", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().speak("I told my friend about the farm", false);
      expect(voice.interims.at(-1)).toBe("");
      latest().speak("I told my friend about the farm");
      expect(voice.transcripts).toEqual([]);
      expect(voice.onActivate).not.toHaveBeenCalled();
    });

    it("uses the next phrase as the command after the wake word alone", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().speak("Hey Tilly");
      expect(voice.onActivate).toHaveBeenCalledTimes(1);
      expect(voice.transcripts).toEqual([]);
      latest().speak("I fertilized the maize");
      expect(voice.transcripts).toEqual([
        ["I fertilized the maize", "wakeWord"],
      ]);
    });

    it("stops waiting for a command after a few seconds", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().speak("Hey Tilly");
      voice.runTimers();
      latest().speak("I told my friend about the farm");
      expect(voice.transcripts).toEqual([]);
    });

    it("uses the custom wake word", () => {
      const voice = setup("wakeWord", "hey buddy");
      voice.controller.start();
      latest().speak("hey tilly I weeded");
      latest().speak("Hey Buddy I weeded");
      expect(voice.transcripts).toEqual([["I weeded", "wakeWord"]]);
    });

    it("restarts when the browser ends the session, until stopped", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().onend?.();
      expect(FakeRecognition.instances).toHaveLength(2);
      expect(latest().started).toBe(1);

      voice.controller.stop();
      expect(latest().aborted).toBe(true);
      expect(voice.states.at(-1)).toBe("idle");
    });

    it("keeps listening through silence", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().onerror?.({ error: "no-speech" });
      expect(voice.errors.filter(Boolean)).toEqual([]);
      expect(voice.controller.listening).toBe(true);
    });
  });

  describe("errors", () => {
    it("shows a visible message when the microphone is blocked", () => {
      const voice = setup("direct");
      voice.controller.start();
      latest().onerror?.({ error: "not-allowed" });
      expect(voice.errors.at(-1)).toContain("Microphone access is blocked");
      expect(voice.states.at(-1)).toBe("error");
      expect(voice.controller.listening).toBe(false);
    });

    it("retries network errors with growing delays, then gives up", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      const delays: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        latest().onerror?.({ error: "network" });
        delays.push(voice.timers[0]!.ms);
        voice.runTimers();
      }
      expect(delays).toEqual([1000, 2000, 4000]);
      expect(FakeRecognition.instances).toHaveLength(4);

      latest().onerror?.({ error: "network" });
      expect(voice.errors.at(-1)).toContain("internet connection");
      expect(voice.states.at(-1)).toBe("error");
    });

    it("clears the retry message once speech comes through", () => {
      const voice = setup("wakeWord");
      voice.controller.start();
      latest().onerror?.({ error: "network" });
      voice.runTimers();
      latest().speak("hello", false);
      expect(voice.errors.at(-1)).toBeNull();
    });
  });

  it("stops listening when the mode or wake word changes", () => {
    const voice = setup("wakeWord");
    voice.controller.start();
    voice.controller.configure("wakeWord", "hey buddy");
    expect(voice.controller.listening).toBe(false);
    expect(latest().aborted).toBe(true);
  });
});
