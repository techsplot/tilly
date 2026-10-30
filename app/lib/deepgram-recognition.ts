import type {
  RecognitionConstructor,
  RecognitionEventLike,
  RecognitionLike,
} from "@/app/lib/voice-controller";

// Live speech to text with Deepgram, shaped like the browser's
// SpeechRecognition so VoiceController drives it unchanged. Audio is
// streamed as it is recorded; Deepgram sends words as they are heard and
// says when the farmer has finished, which becomes one final result.

const LISTEN_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=en" +
  "&smart_format=true&interim_results=true&endpointing=400" +
  "&utterance_end_ms=1200&vad_events=true";

// How often recorded audio is sent.
const CHUNK_MS = 250;
// Tap to speak gives up on silence after this long, like the browser does.
const NO_SPEECH_MS = 8000;

// How a browser passes a temporary token is not spelled out in Deepgram's
// docs, so both known forms are tried, in order.
const AUTH_PROTOCOLS = (token: string) => [
  ["bearer", token],
  ["token", token],
];

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
};

function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "not-allowed";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "audio-capture";
  return "audio-capture";
}

function recorderOptions(): MediaRecorderOptions | undefined {
  for (const mimeType of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ]) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
  }
  return undefined;
}

export function createDeepgramRecognition(
  getToken: () => Promise<string>,
): RecognitionConstructor {
  return class DeepgramRecognition implements RecognitionLike {
    continuous = false;
    interimResults = true;
    lang = "en-US";
    onstart: (() => void) | null = null;
    onresult: ((event: RecognitionEventLike) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;

    private socket: WebSocket | null = null;
    private recorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private heard = "";
    // The latest words not yet final, kept in case the stream ends first.
    private partial = "";
    // Audio recorded before the stream opened, sent as soon as it does, so
    // words said right after the tap are not lost.
    private queued: Blob[] = [];
    private finished = false;
    private noSpeechTimer: ReturnType<typeof setTimeout> | null = null;

    start(): void {
      void this.open();
    }

    // Ends the stream; words already heard still arrive before `end`.
    stop(): void {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.stopRecording();
        this.socket.send(JSON.stringify({ type: "CloseStream" }));
      } else {
        this.finish();
      }
    }

    abort(): void {
      this.onresult = null;
      this.onerror = null;
      this.finish();
    }

    private async open(): Promise<void> {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (error) {
        this.fail(micError(error));
        return;
      }
      if (this.finished) {
        this.stopRecording();
        return;
      }
      // Listening starts at the tap; the stream catches up when it opens.
      this.startRecording();
      this.onstart?.();
      let token: string;
      try {
        token = await getToken();
      } catch {
        this.fail("network");
        return;
      }
      if (this.finished) return;
      this.connect(AUTH_PROTOCOLS(token));
    }

    private connect(protocolOptions: string[][]): void {
      const [protocols, ...fallbacks] = protocolOptions;
      if (!protocols) {
        this.fail("network");
        return;
      }
      let opened = false;
      const socket = new WebSocket(LISTEN_URL, protocols);
      this.socket = socket;
      socket.onopen = () => {
        opened = true;
        for (const chunk of this.queued) socket.send(chunk);
        this.queued = [];
        this.armNoSpeech();
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") this.handle(event.data);
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        // Refused before opening: try the next way to send the token.
        if (!opened && !this.finished && fallbacks.length > 0) {
          this.connect(fallbacks);
          return;
        }
        if (!opened && !this.finished) {
          this.fail("network");
          return;
        }
        this.flush();
        this.finish();
      };
    }

    private startRecording(): void {
      if (!this.stream) return;
      const recorder = new MediaRecorder(this.stream, recorderOptions());
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const socket = this.socket;
        if (socket?.readyState === WebSocket.OPEN) socket.send(event.data);
        else this.queued.push(event.data);
      };
      recorder.start(CHUNK_MS);
      this.recorder = recorder;
    }

    private handle(raw: string): void {
      let message: DeepgramMessage;
      try {
        message = JSON.parse(raw) as DeepgramMessage;
      } catch {
        return;
      }
      if (message.type === "UtteranceEnd") {
        this.flush();
        return;
      }
      if (message.type !== "Results") return;
      const words = message.channel?.alternatives?.[0]?.transcript?.trim();
      if (words) this.clearNoSpeech();
      if (message.is_final) {
        if (words) this.heard = `${this.heard} ${words}`.trim();
        this.partial = "";
      } else {
        this.partial = words ?? "";
      }
      const shown = message.is_final
        ? this.heard
        : `${this.heard} ${words ?? ""}`.trim();
      if (message.speech_final) {
        this.flush();
        return;
      }
      if (shown) this.emit(shown, false);
    }

    // Everything heard since the last pause, as one finished phrase.
    private flush(): void {
      const phrase = `${this.heard} ${this.partial}`.trim();
      this.heard = "";
      this.partial = "";
      if (!phrase) return;
      this.emit(phrase, true);
      if (!this.continuous) this.stop();
    }

    private emit(transcript: string, isFinal: boolean): void {
      this.onresult?.({
        resultIndex: 0,
        results: [{ isFinal, 0: { transcript } }],
      });
    }

    private armNoSpeech(): void {
      if (this.continuous) return;
      this.noSpeechTimer = setTimeout(() => {
        this.noSpeechTimer = null;
        this.fail("no-speech");
      }, NO_SPEECH_MS);
    }

    private clearNoSpeech(): void {
      if (this.noSpeechTimer) clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }

    private stopRecording(): void {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.stop();
      }
      this.recorder = null;
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    private fail(error: string): void {
      if (this.finished) return;
      this.onerror?.({ error });
      this.finish();
    }

    private finish(): void {
      if (this.finished) return;
      this.finished = true;
      this.clearNoSpeech();
      this.stopRecording();
      const socket = this.socket;
      this.socket = null;
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
      this.onend?.();
    }
  };
}
