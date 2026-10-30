import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSpeakerOptions,
  Speaker,
  type SynthesisLike,
  type UtteranceLike,
  type VoiceLike,
} from "../app/lib/speaker";

class FakeUtterance implements UtteranceLike {
  static instances: FakeUtterance[] = [];
  lang = "";
  rate = 0;
  voice: VoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly text: string) {
    FakeUtterance.instances.push(this);
  }
}

const latest = () => FakeUtterance.instances.at(-1)!;

function setup(voices: VoiceLike[] = []) {
  const synthesis: SynthesisLike & { spoken: string[]; cancels: number } = {
    spoken: [],
    cancels: 0,
    speak(utterance) {
      this.spoken.push((utterance as FakeUtterance).text);
    },
    cancel() {
      this.cancels += 1;
    },
    getVoices: () => voices,
  };
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const speaker = new Speaker({
    synthesis,
    Utterance: FakeUtterance,
    lang: "en-GB",
    schedule: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
  });
  return { speaker, synthesis, timers };
}

describe("speaker", () => {
  beforeEach(() => {
    FakeUtterance.instances = [];
  });

  it("finds the browser's speech synthesis, or none", () => {
    expect(getSpeakerOptions(undefined)).toBeNull();
    expect(getSpeakerOptions({})).toBeNull();
    expect(
      getSpeakerOptions({
        speechSynthesis: {},
        SpeechSynthesisUtterance: FakeUtterance,
      }),
    ).not.toBeNull();
  });

  it("speaks with a local voice in the page language and calls done once", () => {
    const local = { lang: "en-US", localService: true };
    const { speaker, synthesis } = setup([
      { lang: "fr-FR", localService: true },
      { lang: "en-GB", localService: false },
      local,
    ]);
    const done = vi.fn();
    speaker.speak("Recorded: spraying", done);

    expect(synthesis.spoken).toEqual(["Recorded: spraying"]);
    expect(latest().voice).toBe(local);
    expect(latest().lang).toBe("en-GB");
    expect(speaker.speaking).toBe(true);

    latest().onend?.();
    latest().onend?.();
    expect(done).toHaveBeenCalledTimes(1);
    expect(speaker.speaking).toBe(false);
  });

  it("moves on when the browser never says it finished", () => {
    const { speaker, timers } = setup();
    const done = vi.fn();
    speaker.speak("Hello", done);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBeGreaterThan(3000);

    timers[0]!.callback();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a cancelled reply", () => {
    const { speaker, synthesis, timers } = setup();
    const done = vi.fn();
    speaker.speak("Hello", done);
    const first = latest();
    speaker.cancel();

    first.onend?.();
    expect(done).not.toHaveBeenCalled();
    expect(synthesis.cancels).toBe(1);
    expect(timers).toHaveLength(0);
    expect(speaker.speaking).toBe(false);
  });
});
