import { z } from "zod";
import {
  DeepgramError,
  MAX_SPEAK_CHARACTERS,
  synthesizeSpeech,
} from "@/src/infrastructure/deepgram/deepgram-client";
import { logError, withRequestLog } from "@/src/infrastructure/request-log";
import { limitVoiceRequest } from "../../rate-limit";

const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARACTERS),
});

// Tilly's reply as speech. The audio is streamed through as it arrives, so
// playback can start before the whole reply is synthesised.
async function handlePost(request: Request): Promise<Response> {
  const limited = limitVoiceRequest(request);
  if (limited) return limited;
  const parsed = speakRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json({ error: "Nothing to say." }, { status: 400 });
  }
  try {
    const audio = await synthesizeSpeech(parsed.data.text);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    logError("Deepgram speech failed", error);
    const status =
      error instanceof DeepgramError && error.status === 503 ? 503 : 502;
    return Response.json({ error: "Tilly could not speak." }, { status });
  }
}

export function POST(request: Request): Promise<Response> {
  return withRequestLog("/api/voice/speak", () => handlePost(request));
}
