import { z } from "zod";
import {
  createNebiusClient,
  getNebiusModel,
} from "../infrastructure/nebius/nebius-client";
import {
  queryEvents,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import {
  searchTavily,
  type TavilyResult,
} from "../infrastructure/tavily/tavily-client";
import type { QuestionFilter } from "../domain/farm-event";
import { formatRecordsForModel, type CitedRecord } from "./farm-question";

// General farming questions ("how do I control aphids?") answered from
// trusted web sources found with Tavily, next to the farmer's own related
// records. The two stay separate: guidance is cited, never saved as a farm
// fact, and the links shown come from Tavily, never from model text.

export type GuidanceSource = {
  id: number;
  title: string;
  url: string;
  domain: string;
};

export type GuidanceResult =
  | {
      kind: "guidance";
      text: string;
      sources: GuidanceSource[];
      citedRecords: CitedRecord[];
    }
  | { kind: "none"; text: string };

export const NO_GUIDANCE_REPLY =
  "I couldn't find trusted guidance on that. Your local extension officer is the best person to ask.";

const MAX_QUERY_CHARS = 300;
const MAX_RELATED_RECORDS = 3;

const guidanceInstructions = `
You are Tilly, a farm assistant for smallholder farmers. If you refer to yourself, you are Tilly.
You answer a general farming question using only the numbered sources provided.

Return JSON only with this exact shape:
{
  "answer": "string",
  "sourceIds": [1]
}

Rules:
- Use only the numbered sources. Do not add outside knowledge.
- Answer in 2 to 4 short, plain sentences a farmer can follow.
- Do not diagnose a disease. Do not name a pesticide product, dose, or quantity unless a source states it.
- If farm records are provided, you may mention them briefly. Never invent records.
- List in sourceIds the number of every source you used.
- If the sources do not answer the question, return an empty answer and an empty sourceIds array.
`;

const modelOutputSchema = z.object({
  answer: z.string(),
  sourceIds: z.array(z.number().int()),
});

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatSourcesForModel(
  sources: GuidanceSource[],
  results: TavilyResult[],
) {
  return sources
    .map(
      (source, index) =>
        `[${source.id}] ${source.title} (${source.domain})\n${results[index]?.content ?? ""}`,
    )
    .join("\n\n");
}

async function loadRelatedRecords(
  db: Database,
  farmId: string,
  filter: QuestionFilter | null,
): Promise<CitedRecord[]> {
  // Only crop and activity: "how do I control aphids on tomatoes?" relates
  // to every tomato record, whichever field or date it has.
  if (!filter?.crop && !filter?.activity) return [];
  const rows = await queryEvents(
    db,
    farmId,
    { crop: filter.crop ?? null, activity: filter.activity ?? null },
    MAX_RELATED_RECORDS,
  );
  return rows.map((row) => ({
    id: row.id,
    activity: row.activity,
    crop: row.crop,
    field: row.fieldName,
    eventDate: row.eventDate,
    eventTime: row.eventTime,
    timeOfDay: row.timeOfDay,
  }));
}

export async function answerGuidance(
  db: Database,
  farmId: string,
  farmerMessage: string,
  filter: QuestionFilter | null,
): Promise<GuidanceResult> {
  const [results, citedRecords] = await Promise.all([
    searchTavily(farmerMessage.trim().slice(0, MAX_QUERY_CHARS)),
    loadRelatedRecords(db, farmId, filter),
  ]);
  if (results.length === 0) return { kind: "none", text: NO_GUIDANCE_REPLY };

  const sources = results.map<GuidanceSource>((result, index) => ({
    id: index + 1,
    title: result.title,
    url: result.url,
    domain: domainOf(result.url),
  }));

  const recordsText =
    citedRecords.length > 0
      ? `\n\nThe farmer's related records:\n${formatRecordsForModel(citedRecords)}`
      : "";

  const response = await createNebiusClient("answer").chat.completions.create({
    model: getNebiusModel("answer"),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: guidanceInstructions },
      {
        role: "user",
        content: `Question: ${farmerMessage}\n\nSources:\n${formatSourcesForModel(sources, results)}${recordsText}`,
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  let raw: unknown = null;
  try {
    raw = content ? JSON.parse(content) : null;
  } catch {
    raw = null;
  }
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Model returned invalid guidance format.");
  }

  // Code, not the model, decides which links are shown: only ids that match
  // a real Tavily result survive.
  const used = new Set(parsed.data.sourceIds);
  const citedSources = sources.filter((source) => used.has(source.id));
  const text = parsed.data.answer.trim();
  if (!text || citedSources.length === 0) {
    return { kind: "none", text: NO_GUIDANCE_REPLY };
  }

  return { kind: "guidance", text, sources: citedSources, citedRecords };
}
