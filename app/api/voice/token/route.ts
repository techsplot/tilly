import {
  DeepgramError,
  grantListenToken,
} from "@/src/infrastructure/deepgram/deepgram-client";
import { logError, withRequestLog } from "@/src/infrastructure/request-log";
import { limitVoiceRequest } from "../../rate-limit";

const UNAVAILABLE = "Voice is not available right now. Please type instead.";

// A short-lived token so the browser can stream speech to Deepgram without
// ever seeing the API key.
async function handlePost(request: Request): Promise<Response> {
  const limited = limitVoiceRequest(request);
  if (limited) return limited;
  try {
    return Response.json(await grantListenToken(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logError("Deepgram token grant failed", error);
    const status =
      error instanceof DeepgramError && error.status === 503 ? 503 : 502;
    return Response.json({ error: UNAVAILABLE }, { status });
  }
}

export function POST(request: Request): Promise<Response> {
  return withRequestLog("/api/voice/token", () => handlePost(request));
}
