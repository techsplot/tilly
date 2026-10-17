import { matchWakeWord } from "@/src/domain/wake-word";

// The slice of the Web Speech API the controller uses. Declared here so the
// controller can be driven by a fake in tests.
export interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export type RecognitionConstructor = new () => RecognitionLike;

export type VoiceMode = "direct" | "wakeWord";
export type VoiceState = "idle" | "listening" | "activated" | "error";

export interface VoiceControllerOptions {
  Recognition: RecognitionConstructor;
  lang?: string;
  onState: (state: VoiceState) => void;
  // Text to show in the input while the farmer speaks; "" clears it.
  onInterim: (text: string) => void;
  // Direct mode: the transcript to review. Wake word mode: the command.
  onTranscript: (text: string, mode: VoiceMode) => void;
  onActivate: () => void;
  onError: (message: string | null) => void;
  schedule?: (callback: () => void, ms: number) => () => void;
}

export function getRecognitionConstructor(
  scope: object | undefined,
): RecognitionConstructor | null {
  if (!scope) return null;
  const candidate = scope as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

const NETWORK_RETRY_DELAYS = [1000, 2000, 4000];
const ARMED_TIMEOUT_MS = 8000;
const ACTIVATED_MS = 700;

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.",
  "service-not-allowed":
    "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.",
  "audio-capture": "No microphone was found on this device.",
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  network:
    "Voice needs an internet connection. Check your connection, or type instead.",
};

function defaultSchedule(callback: () => void, ms: number): () => void {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
}

/**
 * Runs one speech recognition session at a time.
 *
 * Direct mode listens for one utterance and hands back the transcript for
 * the farmer to review. Wake word mode listens until stopped, matches every
 * finished phrase locally, and hands back only what follows the wake word.
 * Saying just the wake word arms the next phrase as the command.
 */
export class VoiceController {
  private readonly options: VoiceControllerOptions;
  private readonly schedule: (callback: () => void, ms: number) => () => void;
  private recognition: RecognitionLike | null = null;
  private mode: VoiceMode = "direct";
  private wakeWord = "";
  private wantListening = false;
  private networkFailures = 0;
  private armed = false;
  private cancelArmed: (() => void) | null = null;
  private cancelPending: (() => void) | null = null;

  constructor(options: VoiceControllerOptions) {
    this.options = options;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  configure(mode: VoiceMode, wakeWord: string): void {
    const changed = mode !== this.mode || wakeWord !== this.wakeWord;
    this.mode = mode;
    this.wakeWord = wakeWord;
    if (changed && this.wantListening) this.stop();
  }

  get listening(): boolean {
    return this.wantListening;
  }

  start(): void {
    if (this.wantListening) return;
    this.wantListening = true;
    this.networkFailures = 0;
    this.options.onError(null);
    this.open();
  }

  stop(): void {
    this.wantListening = false;
    this.disarm();
    this.cancelPending?.();
    this.cancelPending = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    }
    this.options.onInterim("");
    this.options.onState("idle");
  }

  private open(): void {
    const recognition = new this.options.Recognition();
    recognition.continuous = this.mode === "wakeWord";
    recognition.interimResults = true;
    recognition.lang = this.options.lang ?? "en-US";
    recognition.onstart = () => this.options.onState("listening");
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.handleError(event.error);
    recognition.onend = () => this.handleEnd();
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.fail("Voice input could not start. Please try again.");
    }
  }

  private handleResult(event: RecognitionEventLike): void {
    if (this.networkFailures > 0) {
      this.networkFailures = 0;
      this.options.onError(null);
    }
    let interim = "";
    let final = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      if (!result) continue;
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }

    if (this.mode === "direct") {
      if (final.trim()) {
        const transcript = final.trim();
        this.stop();
        this.options.onTranscript(transcript, "direct");
      } else {
        this.options.onInterim(interim.trim());
      }
      return;
    }

    if (final.trim()) this.handleWakePhrase(final.trim());
    else this.options.onInterim(this.wakeInterim(interim.trim()));
  }

  // Only speech meant for FarmMind is shown in the input.
  private wakeInterim(interim: string): string {
    if (!interim) return "";
    if (this.armed) return interim;
    const match = matchWakeWord(interim, this.wakeWord);
    return match.matched ? (match.command ?? "") : "";
  }

  private handleWakePhrase(phrase: string): void {
    if (this.armed) {
      this.disarm();
      this.deliver(phrase);
      return;
    }
    const match = matchWakeWord(phrase, this.wakeWord);
    this.options.onInterim("");
    if (!match.matched) return;
    this.options.onActivate();
    if (match.command) {
      this.deliver(match.command);
      return;
    }
    this.armed = true;
    this.options.onState("activated");
    this.cancelArmed = this.schedule(() => {
      this.disarm();
      if (this.wantListening) this.options.onState("listening");
    }, ARMED_TIMEOUT_MS);
  }

  private deliver(command: string): void {
    this.options.onInterim("");
    this.options.onState("activated");
    this.options.onTranscript(command, "wakeWord");
    this.schedule(() => {
      if (this.wantListening && !this.armed) this.options.onState("listening");
    }, ACTIVATED_MS);
  }

  private disarm(): void {
    this.armed = false;
    this.cancelArmed?.();
    this.cancelArmed = null;
  }

  private handleError(error: string): void {
    if (error === "aborted") return;
    if (error === "no-speech" && this.mode === "wakeWord") return;
    if (error === "network" && this.wantListening) {
      const delay = NETWORK_RETRY_DELAYS[this.networkFailures];
      this.networkFailures += 1;
      if (delay !== undefined) {
        this.options.onError("Connection lost. Trying again…");
        this.retryAfter(delay);
        return;
      }
    }
    this.fail(ERROR_MESSAGES[error] ?? "Voice input stopped. Please try again.");
  }

  private retryAfter(delay: number): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      recognition.abort();
    }
    this.cancelPending = this.schedule(() => {
      this.cancelPending = null;
      if (this.wantListening) this.open();
    }, delay);
  }

  private handleEnd(): void {
    this.recognition = null;
    // Browsers end continuous sessions after a pause; keep listening until
    // the farmer stops.
    if (this.wantListening && this.mode === "wakeWord") {
      this.open();
      return;
    }
    this.wantListening = false;
    this.disarm();
    this.options.onInterim("");
    this.options.onState("idle");
  }

  private fail(message: string): void {
    this.stop();
    this.options.onError(message);
    this.options.onState("error");
  }
}
