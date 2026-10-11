import { z } from "zod";

export const farmActivitySchema = z.enum([
  "planting",
  "fertilizing",
  "weeding",
  "spraying",
  "harvesting",
  "inspection",
  "irrigation",
  "other",
]);

export const farmEventCandidateSchema = z.object({
  activity: farmActivitySchema,
  crop: z.string().trim().min(1).nullable(),
  field: z.string().trim().min(1).nullable(),
  eventDate: z.iso.date().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const farmEventStatusSchema = z.enum([
  "proposed",
  "incomplete",
  "confirmed",
  "corrected",
  "rejected",
]);

export const farmEventSchema = farmEventCandidateSchema.extend({
  status: farmEventStatusSchema,
  missingFields: z.array(z.string()),
  sourceText: z.string(),
});

export const farmInteractionSchema = z
  .object({
    events: z.array(farmEventCandidateSchema),
    clarificationRequired: z.boolean(),
    clarificationQuestion: z.string().nullable(),
  })
  .refine(
    (data) => {
      if (data.clarificationRequired && data.clarificationQuestion === null)
        return false;
      if (
        data.clarificationRequired &&
        data.clarificationQuestion?.trim() === ""
      )
        return false;
      return true;
    },
    {
      message:
        "clarificationQuestion is required when clarificationRequired is true",
    },
  );

export const farmInteractionResultSchema = z
  .object({
    events: z.array(farmEventSchema),
    clarificationRequired: z.boolean(),
    clarificationQuestion: z.string().nullable(),
  })
  .refine(
    (data) => {
      if (data.clarificationRequired && data.clarificationQuestion === null)
        return false;
      if (
        data.clarificationRequired &&
        data.clarificationQuestion?.trim() === ""
      )
        return false;
      return true;
    },
    {
      message:
        "clarificationQuestion is required when clarificationRequired is true",
    },
  );

// Required-field policy by activity (used by domain functions)
export const requiredFieldsByActivity: Record<
  FarmInteraction["events"][number]["activity"],
  Array<"crop" | "field" | "eventDate">
> = {
  planting: ["crop", "field", "eventDate"],
  fertilizing: ["crop", "field", "eventDate"],
  weeding: ["crop", "field", "eventDate"],
  spraying: ["crop", "field", "eventDate"],
  harvesting: ["crop", "field", "eventDate"],
  inspection: ["field", "eventDate"],
  irrigation: ["field", "eventDate"],
  other: ["eventDate"],
};

export function getMissingFields(
  event: Pick<FarmEvent, "activity" | "crop" | "field" | "eventDate">,
): Array<"crop" | "field" | "eventDate"> {
  const required = requiredFieldsByActivity[event.activity];
  if (!required) {
    throw new Error(
      `No required-field policy exists for activity "${event.activity}".`,
    );
  }
  return required.filter((field) => {
    const value = event[field];
    return value === null || value === undefined || value === "";
  });
}

// Apply the required-field policy to compute missingFields and status
function computeMissingFieldsAndStatus(event: FarmEvent): {
  missingFields: string[];
  status: FarmEvent["status"];
} {
  const missing = getMissingFields(event);
  const status = missing.length > 0 ? "incomplete" : "proposed";
  return { missingFields: missing, status };
}

// Correct an event with the given changes; validates and recomputes missingFields
export function correctEvent(
  event: FarmEvent,
  changes: {
    crop?: string | null;
    field?: string | null;
    eventDate?: string | null;
    quantity?: number | null;
    unit?: string | null;
  },
): FarmEvent {
  if (event.status === "rejected") {
    throw new Error(`correctEvent: cannot edit a ${event.status} event`);
  }
  const normalizedChanges = Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() || null : value,
    ]),
  ) as typeof changes;
  const updated = { ...event, ...normalizedChanges } as FarmEvent;
  const parsed = farmEventCandidateSchema.safeParse({
    activity: updated.activity,
    crop: updated.crop,
    field: updated.field,
    eventDate: updated.eventDate,
    quantity: updated.quantity,
    unit: updated.unit,
  });
  if (!parsed.success) {
    throw new Error("correctEvent: validation failed");
  }
  const { missingFields } = computeMissingFieldsAndStatus(updated);
  const status = missingFields.length > 0 ? "incomplete" : "corrected";
  return { ...updated, missingFields, status };
}

// Confirm an event; only allowed from proposed or corrected with no missing fields
export function confirmEvent(event: FarmEvent): FarmEvent {
  if (event.missingFields.length > 0) {
    throw new Error("confirmEvent: event has missing fields");
  }
  if (event.status !== "proposed" && event.status !== "corrected") {
    throw new Error(
      "confirmEvent: only allowed from proposed or corrected status",
    );
  }
  return { ...event, status: "confirmed" };
}

// Reject an event; allowed from any non-confirmed status
export function rejectEvent(event: FarmEvent): FarmEvent {
  if (event.status === "confirmed") {
    throw new Error("rejectEvent: cannot reject a confirmed event");
  }

  return { ...event, status: "rejected" };
}

export function isActionable(event: FarmEvent): boolean {
  return event.status === "confirmed" || event.status === "corrected";
}

export type FarmEventCandidate = z.infer<typeof farmEventCandidateSchema>;
export type FarmEvent = z.infer<typeof farmEventSchema>;
export type FarmInteraction = z.infer<typeof farmInteractionSchema>;
export type FarmInteractionResult = z.infer<typeof farmInteractionResultSchema>;

export type FarmRequest = z.infer<typeof farmRequestSchema>;

export const farmRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(1000, "Message must be 1000 characters or less"),
  currentDate: z.iso.date("A date in YYYY-MM-DD format is required"),
  clarifications: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Question cannot be empty"),
        answer: z.string().trim().min(1, "Answer cannot be empty"),
      }),
    )
    .max(3, "Maximum 3 clarifications allowed")
    .optional(),
});
