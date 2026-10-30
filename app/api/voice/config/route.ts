import { deepgramConfigured } from "@/src/infrastructure/deepgram/deepgram-client";

// Which speech services the browser should use. Without a Deepgram key it
// falls back to the browser's own recognition and voices.
export function GET(): Response {
  return Response.json({
    provider: deepgramConfigured() ? "deepgram" : "browser",
  });
}
