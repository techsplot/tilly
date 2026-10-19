import { z } from "zod";
import { APIConnectionTimeoutError } from "openai";
import { LifecycleError, ValidationError } from "@/src/domain/farm-event";
import { NotFoundError } from "@/src/application/errors";
import {
  ModelBudgetExceededError,
  ModelConfigurationError,
} from "@/src/infrastructure/nebius/nebius-client";
import { DAILY_CAP_REPLY, tooManyRequests } from "../rate-limit";
import { logError } from "@/src/infrastructure/request-log";

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError || error instanceof ValidationError)
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? "Invalid request.")
            : error.message,
      },
      { status: 400 },
    );
  if (error instanceof NotFoundError)
    return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof LifecycleError)
    return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof ModelBudgetExceededError)
    return tooManyRequests(error.retryAfterSeconds, DAILY_CAP_REPLY);
  if (error instanceof ModelConfigurationError) {
    logError("Tilly model configuration failed", error);
    return Response.json(
      {
        error:
          error.role === "extraction"
            ? "Tilly can't read messages yet: the server has no extraction model set (NEBIUS_MODEL_EXTRACTION)."
            : "Tilly can't answer questions or give reports yet: the server has no answer model set (NEBIUS_MODEL_ANSWER).",
      },
      { status: 500 },
    );
  }
  if (error instanceof APIConnectionTimeoutError)
    return Response.json(
      { error: "Tilly is taking longer than expected. Please try again." },
      { status: 504 },
    );
  logError("Tilly agent request failed", error);
  return Response.json(
    { error: "Tilly could not process that message. Please try again." },
    { status: 502 },
  );
}
