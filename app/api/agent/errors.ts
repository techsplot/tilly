import { z } from "zod";
import { APIConnectionTimeoutError } from "openai";
import { LifecycleError, ValidationError } from "@/src/domain/farm-event";
import { NotFoundError } from "@/src/application/errors";
import { ModelConfigurationError } from "@/src/infrastructure/nebius/nebius-client";

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
  if (error instanceof ModelConfigurationError) {
    console.error("FarmMind model configuration failed", error);
    return Response.json(
      {
        error:
          "FarmMind is not fully configured for questions and reports. Set the answer model and try again.",
      },
      { status: 500 },
    );
  }
  if (error instanceof APIConnectionTimeoutError)
    return Response.json(
      { error: "FarmMind is taking longer than expected. Please try again." },
      { status: 504 },
    );
  console.error("FarmMind agent request failed", error);
  return Response.json(
    { error: "FarmMind could not process that message. Please try again." },
    { status: 502 },
  );
}
