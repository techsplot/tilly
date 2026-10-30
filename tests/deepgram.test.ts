import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeepgramRecognition } from "../app/lib/deepgram-recognition";
import type { RecognitionEventLike } from "../app/lib/voice-controller";
import {
  DEFAULT_VOICE,
  grantListenToken,
  synthesizeSpeech,
} from "../src/infrastructure/deepgram/deepgram-client";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  refuse() {
    this.readyState = 3;
    this.onclose?.();
  }
  message(body: object) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}

class FakeRecorder {
  static latest: FakeRecorder | null = null;
  state = "inactive";
  ondataavailable: ((event: { data: { size: number } }) => void) | null = null;
  static isTypeSupported = () => true;
  start() {
    this.state = "recording";
    FakeRecorder.latest = this;
  }
  record(name: string) {
    this.ondataavailable?.({ data: { size: 1, name } as { size: number } });
  }
  stop() {
    this.state = "inactive";
  }
}

const results = (
  transcript: string,
  isFinal: boolean,
  speechFinal = false,
) => ({
  type: "Results",
  is_final: isFinal,
  speech_final: speechFinal,
  channel: { alternatives: [{ transcript }] },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Deepgram recognition", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function started() {
    const Recognition = createDeepgramRecognition(async () => "jwt");
    const recognition = new Recognition();
    const events: string[] = [];
    recognition.onstart = () => events.push("start");
    recognition.onresult = (event: RecognitionEventLike) => {
      const result = event.results[0]!;
      events.push(
        `${result.isFinal ? "final" : "interim"}:${result[0].transcript}`,
      );
    };
    recognition.onerror = (event) => events.push(`error:${event.error}`);
    recognition.onend = () => events.push("end");
    recognition.start();
    await flush();
    await flush();
    return { recognition, events, socket: FakeSocket.instances.at(-1)! };
  }

  it("streams with the token and gives one phrase when the farmer pauses", async () => {
    const { events, socket } = await started();
    expect(socket.url).toContain("model=nova-3");
    expect(socket.protocols).toEqual(["bearer", "jwt"]);
    socket.open();

    socket.message(results("I weeded", false));
    socket.message(results("I weeded the north", true));
    socket.message(results("field today", true, true));

    expect(events).toEqual([
      "start",
      "interim:I weeded",
      "interim:I weeded the north",
      "final:I weeded the north field today",
    ]);
    // One phrase in tap mode: the stream is closed politely.
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
  });

  it("finishes the phrase on UtteranceEnd when no pause was marked", async () => {
    const { events, socket } = await started();
    socket.open();
    socket.message(results("it was maize", true));
    socket.message({ type: "UtteranceEnd", channel: [0], last_word_end: 1 });
    expect(events.at(-1)).toBe("final:it was maize");
  });

  it("sends words said before the stream opened, in order", async () => {
    const { socket } = await started();
    FakeRecorder.latest!.record("first");
    FakeRecorder.latest!.record("second");
    expect(socket.sent).toEqual([]);
    socket.open();
    FakeRecorder.latest!.record("third");
    expect(
      socket.sent.map((chunk) => (chunk as { name: string }).name),
    ).toEqual(["first", "second", "third"]);
  });

  it("keeps the last words heard when the stream ends mid-phrase", async () => {
    const { events, socket } = await started();
    socket.open();
    socket.message(results("when did I last weed", false));
    socket.onclose?.();
    expect(events.slice(-2)).toEqual(["final:when did I last weed", "end"]);
  });

  it("tries the other token form when the first is refused", async () => {
    const { events } = await started();
    FakeSocket.instances[0]!.refuse();
    expect(FakeSocket.instances[1]!.protocols).toEqual(["token", "jwt"]);
    FakeSocket.instances[1]!.refuse();
    expect(events).toEqual(["start", "error:network", "end"]);
  });

  it("reports a blocked microphone", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException("no", "NotAllowedError");
        },
      },
    });
    const { events } = await started();
    expect(events).toEqual(["error:not-allowed", "end"]);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});

describe("Deepgram client", () => {
  beforeEach(() => vi.stubEnv("DEEPGRAM_API_KEY", "key-123"));
  afterEach(() => vi.unstubAllEnvs());

  it("grants a short-lived token with the server key", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: "jwt", expires_in: 60 }),
    );
    expect(await grantListenToken(fetchImpl)).toEqual({
      accessToken: "jwt",
      expiresIn: 60,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.deepgram.com/v1/auth/grant");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Token key-123",
    );
  });

  it("asks for speech in the default voice and passes the audio through", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("mp3", { headers: { "content-type": "audio/mpeg" } }),
    );
    const audio = await synthesizeSpeech("Recorded: weeding", fetchImpl);
    expect(await new Response(audio).text()).toBe("mp3");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain(`model=${DEFAULT_VOICE}`);
  });

  it("fails clearly without a key", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    await expect(grantListenToken(vi.fn())).rejects.toThrow(
      "DEEPGRAM_API_KEY is not set.",
    );
  });
});
