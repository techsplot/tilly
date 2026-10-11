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

export const farmInteractionSchema = z.object({
  events: z.array(farmEventCandidateSchema),
  clarificationRequired: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type FarmEventCandidate = z.infer<typeof farmEventCandidateSchema>;
export type FarmEvent = z.infer<typeof farmEventSchema>;
export type FarmInteraction = z.infer<typeof farmInteractionSchema>;

export const farmInteractionResultSchema = z.object({
  events: z.array(farmEventSchema),
  clarificationRequired: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type FarmInteractionResult = z.infer<typeof farmInteractionResultSchema>;
