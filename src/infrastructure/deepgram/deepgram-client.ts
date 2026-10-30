// Deepgram hears and speaks for Tilly when DEEPGRAM_API_KEY is set; without
// it the browser's own speech services are used. The key never leaves the
// server: the browser streams speech with a short-lived token instead.

const DEEPGRAM_URL = "https://api.deepgram.com/v1";

// A warm, friendly voice. DEEPGRAM_VOICE overrides it with any Aura model.
export const DEFAULT_VOICE = "aura-2-helena-en";

// Aura-2 accepts up to 2,000 characters per request.
export const MAX_SPEAK_CHARACTERS = 2000;

// The token only has to be valid while the WebSocket opens.
const TOKEN_TTL_SECONDS = 60;

export class DeepgramError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeepgramError";
    this.status = status;
  }
}

export function deepgramConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw new DeepgramError("DEEPGRAM_API_KEY is not set.", 503);
  return key;
}

async function failure(response: Response, what: string): Promise<never> {
  const detail = await response.text().catch(() => "");
  throw new DeepgramError(
    `Deepgram ${what} failed (${response.status}): ${detail.slice(0, 200)}`,
    response.status,
  );
}

export async function grantListenToken(
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetchImpl(`${DEEPGRAM_URL}/auth/grant`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
  });
  if (!response.ok) await failure(response, "token grant");
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw new DeepgramError("Deepgram returned no access token.", 502);
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 30,
  };
}

/** Returns Deepgram's MP3 stream for the text, to pass straight through. */
export async function synthesizeSpeech(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadableStream<Uint8Array>> {
  const voice = process.env.DEEPGRAM_VOICE?.trim() || DEFAULT_VOICE;
  const response = await fetchImpl(
    `${DEEPGRAM_URL}/speak?model=${encodeURIComponent(voice)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok || !response.body) await failure(response, "speech");
  return response.body!;
}
