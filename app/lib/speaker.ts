// The slice of the Web Speech synthesis API the speaker uses. Declared here
// so the speaker can be driven by a fake in tests.
export interface VoiceLike {
  lang: string;
  localService: boolean;
}

export interface UtteranceLike {
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
}

export type UtteranceConstructor = new (text: string) => UtteranceLike;

export interface SpeakerOptions {
  synthesis: SynthesisLike;
  Utterance: UtteranceConstructor;
  lang?: string;
  schedule?: (callback: () => void, ms: number) => () => void;
}

// Chrome sometimes never fires `end`, which would leave the conversation
// waiting forever, so every utterance also gets a generous deadline. The
// base allows for a natural voice being downloaded before it plays.
const BASE_DEADLINE_MS = 5000;
const DEADLINE_MS_PER_CHARACTER = 100;

function defaultSchedule(callback: () => void, ms: number): () => void {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
}

export function getSpeakerOptions(
  scope: object | undefined,
): Pick<SpeakerOptions, "synthesis" | "Utterance"> | null {
  if (!scope) return null;
  const candidate = scope as {
    speechSynthesis?: SynthesisLike;
    SpeechSynthesisUtterance?: UtteranceConstructor;
  };
  if (!candidate.speechSynthesis || !candidate.SpeechSynthesisUtterance) {
    return null;
  }
  return {
    synthesis: candidate.speechSynthesis,
    Utterance: candidate.SpeechSynthesisUtterance,
  };
}

/**
 * Reads Tilly's replies aloud, one at a time. Prefers a voice installed on
 * the device, which works offline and is not cut short like some online
 * voices. `done` is called exactly once per utterance: when it ends, fails,
 * or runs past its deadline. Cancelling does not call it.
 */
export class Speaker {
  private readonly options: SpeakerOptions;
  private readonly schedule: (callback: () => void, ms: number) => () => void;
  private current: UtteranceLike | null = null;
  private cancelDeadline: (() => void) | null = null;

  constructor(options: SpeakerOptions) {
    this.options = options;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  speak(text: string, done: () => void): void {
    this.cancel();
    const lang = this.options.lang ?? "en-US";
    const utterance = new this.options.Utterance(text);
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.voice = this.pickVoice(lang);

    let finished = false;
    const finish = () => {
      if (finished || this.current !== utterance) return;
      finished = true;
      this.clear();
      done();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.current = utterance;
    // Past the deadline the voice is silenced too, so it can never talk
    // over the mic reopening.
    this.cancelDeadline = this.schedule(
      () => {
        if (finished || this.current !== utterance) return;
        this.options.synthesis.cancel();
        finish();
      },
      BASE_DEADLINE_MS + text.length * DEADLINE_MS_PER_CHARACTER,
    );
    this.options.synthesis.speak(utterance);
  }

  cancel(): void {
    if (!this.current) return;
    this.clear();
    this.options.synthesis.cancel();
  }

  private clear(): void {
    const utterance = this.current;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    this.current = null;
    this.cancelDeadline?.();
    this.cancelDeadline = null;
  }

  private pickVoice(lang: string): VoiceLike | null {
    const language = lang.toLowerCase().split("-")[0]!;
    const voices = this.options.synthesis
      .getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith(language));
    return voices.find((voice) => voice.localService) ?? voices[0] ?? null;
  }
}
