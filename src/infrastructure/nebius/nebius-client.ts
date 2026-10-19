import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { DailyCap, modelDailyLimit } from "../rate-limit";

export type ModelRole = "extraction" | "answer";

export class ModelConfigurationError extends Error {
  // Which model is missing, so the error shown to the farmer names the
  // right one.
  role: ModelRole;

  constructor(message: string, role: ModelRole = "answer") {
    super(message);
    this.name = "ModelConfigurationError";
    this.role = role;
  }
}

// Thrown before a model call once the day's budget is spent.
export class ModelBudgetExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("The daily model call budget is used up.");
    this.name = "ModelBudgetExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// One budget for every user of this process, so rotating cookies or IPs
// cannot drain the account. It counts calls, not requests: one farmer
// message can make two (the thinking-mode retry). In memory, so it is per
// container and resets on restart.
export const modelCallBudget = new DailyCap(modelDailyLimit);

type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  // Token Factory option, passed through by the SDK.
  chat_template_kwargs?: Record<string, unknown>;
};

export type NebiusClient = {
  chat: {
    completions: { create(params: ChatParams): Promise<ChatCompletion> };
  };
};

export function createNebiusClient(): NebiusClient {
  const apiKey = process.env.NEBIUS_API_KEY;
  const baseURL =
    process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/";

  if (!apiKey) {
    throw new Error(
      "NEBIUS_API_KEY is required. Copy .env.example to .env and set it.",
    );
  }

  const openai = new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 1 });
  return {
    chat: {
      completions: {
        create(params) {
          const budget = modelCallBudget.take();
          if (!budget.allowed) {
            return Promise.reject(
              new ModelBudgetExceededError(budget.retryAfterSeconds),
            );
          }
          return openai.chat.completions.create(params);
        },
      },
    },
  };
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
      role,
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
