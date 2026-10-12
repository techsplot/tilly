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

export const farmTimeOfDaySchema = z.enum([
  "morning",
  "afternoon",
  "evening",
  "night",
]);

const eventTimePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Loose on the wire: a malformed model value is dropped by the application
// layer rather than failing the whole response (see isValidEventTime).
export const eventTimeSchema = z.string().nullable();

export function isValidEventTime(value: string): boolean {
  return eventTimePattern.test(value);
}

export const farmEventCandidateSchema = z.object({
  activity: farmActivitySchema,
  crop: z.string().trim().min(1).nullable(),
  field: z.string().trim().min(1).nullable(),
  eventDate: z.iso.date().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  fieldSource: z.enum(["message", "memory"]).nullable().optional(),
  cropSource: z.enum(["message", "memory"]).nullable().optional(),
  memoryEventIds: z.array(z.string()).optional(),
  eventTime: eventTimeSchema.optional(),
  timeOfDay: farmTimeOfDaySchema.nullable().optional(),
  dateAssumed: z.boolean().optional(),
});

export const farmEventStatusSchema = z.enum([
  "proposed",
  "incomplete",
  "confirmed",
  "corrected",
  "rejected",
]);

export class LifecycleError extends Error {}
export class ValidationError extends Error {}

export const farmEventSchema = farmEventCandidateSchema.extend({
  status: farmEventStatusSchema,
  missingFields: z.array(z.string()),
  sourceText: z.string(),
  resolvedFromMemory: z
    .array(
      z.object({
        field: z.literal("field").optional(),
        crop: z.literal("crop").optional(),
        eventId: z.uuid(),
        activity: z.string(),
        eventDate: z.iso.date().nullable(),
      }),
    )
    .optional(),
  unresolvedReferences: z.array(z.string()).optional(),
});

export const agentIntentSchema = z.enum([
  "record",
  "correct",
  "delete",
  "other",
]);

export const correctionChangesSchema = z.object({
  crop: z.string().trim().min(1).nullable().optional(),
  field: z.string().trim().min(1).nullable().optional(),
  eventDate: z.iso.date().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  eventTime: eventTimeSchema.optional(),
});

export const farmInteractionSchema = z
  .object({
    intent: agentIntentSchema.optional().default("record"),
    events: z.array(farmEventCandidateSchema),
    clarificationRequired: z.boolean(),
    clarificationQuestion: z.string().nullable(),
    followUpQuestion: z.string().nullable().optional(),
    correction: z
      .object({ changes: correctionChangesSchema })
      .nullable()
      .optional(),
    skip: z.boolean().optional().default(false),
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
    intent: agentIntentSchema.optional().default("record"),
    events: z.array(farmEventSchema),
    clarificationRequired: z.boolean(),
    clarificationQuestion: z.string().nullable(),
    followUpQuestion: z.string().nullable().optional(),
    correction: z
      .object({ changes: correctionChangesSchema })
      .nullable()
      .optional(),
    skip: z.boolean().optional().default(false),
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

// Important-detail policy for the agent's "save first, ask almost never"
// flow (finding 8). Unlike requiredFieldsByActivity, these never block a
// save; they only decide whether the agent asks one question first. The
// date is always important, since a missing one must be assumed and
// flagged rather than silently guessed.
export const importantFieldsByActivity: Record<
  FarmInteraction["events"][number]["activity"],
  Array<"crop" | "field">
> = {
  planting: ["crop", "field"],
  fertilizing: ["crop", "field"],
  weeding: ["crop", "field"],
  spraying: ["crop", "field"],
  harvesting: ["crop", "field"],
  inspection: ["field"],
  irrigation: ["field"],
  other: [],
};

export function getImportantMissingDetails(
  event: Pick<FarmEvent, "activity" | "crop" | "field" | "eventDate">,
  unresolvedReferences: string[] = [],
): string[] {
  const details = new Set<string>();
  if (!event.eventDate) details.add("eventDate");
  for (const field of importantFieldsByActivity[event.activity] ?? []) {
    if (!event[field]) details.add(field);
  }
  for (const reference of unresolvedReferences) {
    if (reference === "field" || reference === "crop") details.add(reference);
  }
  return Array.from(details);
}

// Fixed time-of-day boundaries (finding 17). The model's own timeOfDay
// guess is ignored whenever eventTime is present so the two can never
// disagree.
export function deriveTimeOfDay(
  eventTime: string,
): z.infer<typeof farmTimeOfDaySchema> {
  const hour = Number(eventTime.slice(0, 2));
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 20) return "evening";
  return "night";
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
    throw new LifecycleError(
      `correctEvent: cannot edit a ${event.status} event`,
    );
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
    throw new ValidationError("correctEvent: validation failed");
  }
  const { missingFields } = computeMissingFieldsAndStatus(updated);
  const status =
    missingFields.length > 0
      ? "incomplete"
      : event.status === "confirmed" || event.status === "corrected"
        ? "corrected"
        : "proposed";
  return { ...updated, missingFields, status };
}

// Correct an agent-saved event. Unlike correctEvent, a gap never demotes
// the record to "incomplete" (rule 6: agent-saved records are always facts)
// and a cleared date is re-assumed rather than left null.
export function correctAgentEvent(
  event: FarmEvent,
  changes: {
    crop?: string | null;
    field?: string | null;
    eventDate?: string | null;
    quantity?: number | null;
    unit?: string | null;
    eventTime?: string | null;
    timeOfDay?: z.infer<typeof farmTimeOfDaySchema> | null;
  },
  currentDate: string,
): FarmEvent {
  if (event.status === "rejected") {
    throw new LifecycleError(
      `correctAgentEvent: cannot edit a ${event.status} event`,
    );
  }
  const { eventTime: rawEventTime, timeOfDay: rawTimeOfDay, ...valueChanges } =
    changes;
  const normalizedChanges = Object.fromEntries(
    Object.entries(valueChanges).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() || null : value,
    ]),
  ) as typeof valueChanges;
  const updated = { ...event, ...normalizedChanges } as FarmEvent;

  const dateWasChanged = Object.hasOwn(changes, "eventDate");
  let dateAssumed = event.dateAssumed ?? false;
  if (!updated.eventDate) {
    updated.eventDate = currentDate;
    dateAssumed = true;
  } else if (dateWasChanged) {
    dateAssumed = false;
  }

  const parsed = farmEventCandidateSchema.safeParse({
    activity: updated.activity,
    crop: updated.crop,
    field: updated.field,
    eventDate: updated.eventDate,
    quantity: updated.quantity,
    unit: updated.unit,
  });
  if (!parsed.success) {
    throw new ValidationError("correctAgentEvent: validation failed");
  }

  let eventTime = event.eventTime ?? null;
  let timeOfDay = event.timeOfDay ?? null;
  if (rawEventTime !== undefined) {
    if (rawEventTime !== null && isValidEventTime(rawEventTime)) {
      eventTime = rawEventTime;
      timeOfDay = deriveTimeOfDay(rawEventTime);
    } else {
      eventTime = null;
      timeOfDay = rawTimeOfDay ?? null;
    }
  } else if (rawTimeOfDay !== undefined) {
    eventTime = null;
    timeOfDay = rawTimeOfDay;
  }

  const importantGaps = (
    importantFieldsByActivity[updated.activity] ?? []
  ).filter((field) => !updated[field]);
  const missingFields = dateAssumed
    ? [...importantGaps, "eventDate"]
    : importantGaps;
  const status =
    event.status === "confirmed" || event.status === "corrected"
      ? "corrected"
      : event.status;

  return {
    ...updated,
    eventTime,
    timeOfDay,
    dateAssumed,
    missingFields,
    status,
  };
}

// Confirm an event; only allowed from proposed or corrected with no missing fields
export function confirmEvent(event: FarmEvent): FarmEvent {
  if (event.missingFields.length > 0) {
    throw new LifecycleError("confirmEvent: event has missing fields");
  }
  if (event.status !== "proposed" && event.status !== "corrected") {
    throw new LifecycleError(
      "confirmEvent: only allowed from proposed or corrected status",
    );
  }
  return { ...event, status: "confirmed" };
}

// Reject an event; only unconfirmed events may be rejected
export function rejectEvent(event: FarmEvent): FarmEvent {
  if (event.status === "confirmed" || event.status === "corrected") {
    throw new LifecycleError("rejectEvent: cannot reject a confirmed event");
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
