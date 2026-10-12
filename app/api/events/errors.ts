import { z } from "zod";
import { LifecycleError, ValidationError } from "@/src/domain/farm-event";
import { NotFoundError } from "@/src/application/errors";

export function eventErrorResponse(error: unknown): Response {
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
  console.error("Farm event request failed", error);
  return Response.json(
    { error: "FarmMind could not save that record. Please try again." },
    { status: 500 },
  );
}
