import OpenAI from "openai";

export type ModelRole = "extraction" | "answer";

export class ModelConfigurationError extends Error {}

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

function getModelForRole(role: ModelRole): string {
  const envVar =
    role === "extraction" ? "NEBIUS_MODEL_EXTRACTION" : "NEBIUS_MODEL_ANSWER";
  const model =
    process.env[envVar] ??
    (role === "extraction" ? process.env.NEBIUS_MODEL : undefined);

  if (!model) {
    throw new ModelConfigurationError(
      `${envVar} is required. Set it to a permitted NVIDIA model available to your Nebius account.`,
    );
  }

  return model;
}

export function getNebiusModel(role: ModelRole = "extraction"): string {
  return getModelForRole(role);
}

export function getDefaultExtractionModel(): string {
  return (
    process.env.NEBIUS_MODEL_EXTRACTION ??
    process.env.NEBIUS_MODEL ??
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
  );
}

export function getDefaultAnswerModel(): string {
  return process.env.NEBIUS_MODEL_ANSWER ?? "nvidia/Nemotron-3-Ultra-550b-a55b";
}
