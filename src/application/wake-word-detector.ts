import { z } from "zod";
import { createNebiusClient } from "../infrastructure/nebius/nebius-client.js";

const wakeWordResponseSchema = z.object({
  is_wake_word: z.boolean(),
  command: z.string().nullable(),
});

export type WakeWordResponse = z.infer<typeof wakeWordResponseSchema>;

export class WakeWordDetectionError extends Error {
  override cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "WakeWordDetectionError";
    this.cause = cause;
  }
}

interface DetectionCache {
  transcript: string;
  result: WakeWordResponse;
  timestamp: number;
}

// Cache recent detections (avoid re-checking same transcript)
const detectionCache = new Map<string, DetectionCache>();
const CACHE_TTL = 30000; // 30 seconds

function getCachedDetection(transcript: string): WakeWordResponse | null {
  const cached = detectionCache.get(transcript.toLowerCase().trim());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  return null;
}

function cacheDetection(transcript: string, result: WakeWordResponse): void {
  const key = transcript.toLowerCase().trim();
  detectionCache.set(key, {
    transcript: key,
    result,
    timestamp: Date.now(),
  });

  // Cleanup old cache entries (keep last 100)
  if (detectionCache.size > 100) {
    const entries = Array.from(detectionCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - 100);
    toDelete.forEach(([key]) => detectionCache.delete(key));
  }
}

/**
 * Build system prompt for wake word detection with custom wake word support
 */
function buildSystemPrompt(customWakeWord?: string): string {
  const basePrompt = `You are a wake word detector. Analyze the user's speech and determine if it starts with a wake word, then extract the command that follows.

Respond with JSON in this exact format:
{
  "is_wake_word": boolean,
  "command": string or null
}

Default wake words: "hey farmmind", "ok farm", "hey farm"`;

  if (customWakeWord) {
    return `${basePrompt}

Custom wake word for this user: "${customWakeWord}"

If the text starts with ANY of these wake words (default or custom), set is_wake_word to true and extract the command after the wake word.
If there is no wake word, set is_wake_word to false and command to null.

Examples with custom wake word "${customWakeWord}":
- "${customWakeWord} I weeded the field" → {"is_wake_word": true, "command": "I weeded the field"}
- "I weeded the field" → {"is_wake_word": false, "command": null}`;
  }

  return `${basePrompt}

If the text starts with a wake word, set is_wake_word to true and extract the command after the wake word.
If there is no wake word, set is_wake_word to false and command to null.`;
}

/**
 * Simple string matching fallback when API fails
 */
function fallbackDetection(
  transcript: string,
  customWakeWord?: string,
): WakeWordResponse {
  const normalized = transcript.toLowerCase().trim();

  const defaultWakeWords = [
    "hey farmmind",
    "hey farm mind",
    "ok farm",
    "okay farm",
    "hey farm",
    "farm mind",
  ];

  const allWakeWords = customWakeWord
    ? [...defaultWakeWords, customWakeWord.toLowerCase()]
    : defaultWakeWords;

  for (const wakeWord of allWakeWords) {
    if (normalized.startsWith(wakeWord)) {
      // Extract command after wake word, removing punctuation
      let command = transcript.substring(wakeWord.length).trim();
      // Remove leading punctuation (commas, etc.)
      command = command.replace(/^[,\s]+/, "").trim();
      return {
        is_wake_word: true,
        command: command || null,
      };
    }
  }

  return {
    is_wake_word: false,
    command: null,
  };
}

/**
 * Detect if transcript contains a wake word using fine-tuned Nemotron model
 *
 * @param transcript - The speech transcript to analyze
 * @param customWakeWord - Optional custom wake word for this user
 * @returns Detection result with wake word flag and extracted command
 */
export async function detectWakeWord(
  transcript: string,
  customWakeWord?: string,
): Promise<WakeWordResponse> {
  // Check cache first
  const cached = getCachedDetection(transcript);
  if (cached) {
    return cached;
  }

  const wakeWordModelId = process.env.WAKE_WORD_MODEL_ID;

  if (!wakeWordModelId) {
    // Fall back to simple string matching if model not trained yet
    const result = fallbackDetection(transcript, customWakeWord);
    cacheDetection(transcript, result);
    return result;
  }

  try {
    const client = createNebiusClient();
    const systemPrompt = buildSystemPrompt(customWakeWord);

    const response = await client.chat.completions.create({
      model: wakeWordModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // Low temperature for consistent detection
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new WakeWordDetectionError("No response content from model");
    }

    const parsed = JSON.parse(content);
    const validated = wakeWordResponseSchema.parse(parsed);

    // Cache successful detection
    cacheDetection(transcript, validated);

    return validated;
  } catch (error) {
    // Log error but fall back gracefully
    console.error("Wake word detection failed, using fallback:", error);

    const result = fallbackDetection(transcript, customWakeWord);
    cacheDetection(transcript, result);
    return result;
  }
}

/**
 * Clear the detection cache (useful for testing)
 */
export function clearDetectionCache(): void {
  detectionCache.clear();
}
