import OpenAI from "openai";

export function createNebiusClient(): OpenAI {
  const apiKey = process.env.NEBIUS_API_KEY;
  const baseURL =
    process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/";

  if (!apiKey) {
    throw new Error(
      "NEBIUS_API_KEY is required. Copy .env.example to .env and set it.",
    );
  }

  return new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 1 });
}

export function getNebiusModel(): string {
  const model = process.env.NEBIUS_MODEL;

  if (!model) {
    throw new Error(
      "NEBIUS_MODEL is required. Set it to a permitted NVIDIA model available to your Nebius account.",
    );
  }

  return model;
}
