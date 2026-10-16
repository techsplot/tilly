import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { detectWakeWord } from "@/src/application/wake-word-detector";

const detectWakeWordRequestSchema = z.object({
  transcript: z.string().min(1, "Transcript is required"),
  customWakeWord: z.string().optional(),
});

/**
 * POST /api/voice/detect-wake-word
 * Detect if transcript contains a wake word using fine-tuned model
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = detectWakeWordRequestSchema.parse(body);

    const result = await detectWakeWord(
      validated.transcript,
      validated.customWakeWord,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 },
      );
    }

    console.error("Wake word detection error:", error);
    return NextResponse.json(
      { error: "Wake word detection failed" },
      { status: 500 },
    );
  }
}
