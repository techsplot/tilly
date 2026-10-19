import {
  createNebiusClient,
  getNebiusModel,
} from "../infrastructure/nebius/nebius-client";
import {
  queryEvents,
  aggregateReport,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import type { QuestionFilter, ReportFilter } from "../domain/farm-event";

export type CitedRecord = {
  id: string;
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
  eventTime: string | null;
  timeOfDay: string | null;
};

export type AnswerResult = {
  text: string;
  citedRecords: CitedRecord[];
};

const questionInstructions = `
You are Tilly, a farm memory assistant. If you refer to yourself, you are Tilly.
You answer a farmer's question about their farm history using only the provided records.

Return JSON only with this exact shape:
{
  "answer": "string",
  "citedRecordIds": ["id"]
}

Rules:
- Only state facts that are directly supported by the provided records.
- If the records do not contain enough information to answer, return "I can't tell from your records." and an empty citedRecordIds array.
- Do not invent dates, counts, crops, fields, or activities not in the records.
- Cite every record you use by including its id in citedRecordIds.
- Keep the answer short and conversational, like Tilly, a helpful farm assistant.
`;

const reportInstructions = `
You are Tilly, a farm memory assistant. If you refer to yourself, you are Tilly.
You write a short, plain-language report for a farmer based on the provided summary numbers.

Return JSON only with this exact shape:
{
  "answer": "string",
  "citedRecordIds": ["id"]
}

The summary provides:
- total: total number of records
- byActivity: counts grouped by activity
- byField: counts grouped by field
- byCrop: counts grouped by crop
- byDay: counts grouped by event date
- records: the actual records (up to 50) that were counted

Rules:
- Only state facts directly supported by the summary numbers and records.
- If total is 0, return "I don't have any records matching that." and an empty citedRecordIds array.
- Write a short summary in plain language (2-4 sentences).
- Mention the key groupings relevant to the report type (e.g., for by_activity, list activities and counts).
- Cite the records by including their ids in citedRecordIds.
- Do not invent any numbers, dates, or activities not in the summary.
`;

function formatDateForModel(date: string | null): string {
  if (!date) return "no date";
  const parts = date.split("-").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return date;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatCitedRecord(record: {
  activity: string;
  crop: string | null;
  field: string | null;
  eventDate: string | null;
  eventTime: string | null;
  timeOfDay: string | null;
}): string {
  const parts = [record.activity];
  if (record.crop) parts.push(record.crop);
  if (record.field) parts.push(record.field);
  if (record.eventDate)
    parts.push(`on ${formatDateForModel(record.eventDate)}`);
  if (record.eventTime) parts.push(`at ${record.eventTime}`);
  else if (record.timeOfDay) parts.push(record.timeOfDay);
  return parts.join(" · ");
}

function formatRecordsForModel(
  records: {
    id: string;
    activity: string;
    crop: string | null;
    field: string | null;
    eventDate: string | null;
    eventTime: string | null;
    timeOfDay: string | null;
  }[],
): string {
  if (records.length === 0) return "No records.";
  return records
    .map((r, i) => `${i + 1}. [${r.id}] ${formatCitedRecord(r)}`)
    .join("\n");
}

function formatSummaryForModel(
  summary: {
    total: number;
    byActivity: Record<string, number>;
    byField: Record<string, number>;
    byCrop: Record<string, number>;
    byDay: Record<string, number>;
  },
  records: {
    id: string;
    activity: string;
    crop: string | null;
    field: string | null;
    eventDate: string | null;
    eventTime: string | null;
    timeOfDay: string | null;
  }[],
): string {
  const lines = [
    `Total records: ${summary.total}`,
    "",
    "By activity:",
    ...Object.entries(summary.byActivity).map(
      ([activity, count]) => `  ${activity}: ${count}`,
    ),
    "",
    "By field:",
    ...Object.entries(summary.byField).map(
      ([field, count]) => `  ${field}: ${count}`,
    ),
    "",
    "By crop:",
    ...Object.entries(summary.byCrop).map(
      ([crop, count]) => `  ${crop}: ${count}`,
    ),
    "",
    "By day:",
    ...Object.entries(summary.byDay).map(
      ([day, count]) => `  ${day}: ${count}`,
    ),
    "",
    "Records:",
    formatRecordsForModel(records),
  ];
  return lines.join("\n");
}

function parseAnswerModelOutput(content: string): {
  answer: string;
  citedRecordIds: string[];
} | null {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed.answer === "string" &&
      Array.isArray(parsed.citedRecordIds)
    ) {
      return {
        answer: parsed.answer,
        citedRecordIds: parsed.citedRecordIds.filter(
          (id: unknown) => typeof id === "string",
        ),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isLimitationAnswer(answer: string): boolean {
  const normalized = answer.toLowerCase();
  return (
    normalized.includes("can't tell") ||
    normalized.includes("do not have") ||
    normalized.includes("don't have") ||
    normalized.includes("no records")
  );
}

function citedRecordsFromRows(
  rows: Awaited<ReturnType<typeof queryEvents>>,
  citedRecordIds: string[],
): CitedRecord[] {
  return rows
    .filter((r) => citedRecordIds.includes(r.id))
    .map<CitedRecord>((r) => ({
      id: r.id,
      activity: r.activity,
      crop: r.crop,
      field: r.fieldName,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      timeOfDay: r.timeOfDay,
    }));
}

function groundedAnswer(
  rows: Awaited<ReturnType<typeof queryEvents>>,
  parsed: { answer: string; citedRecordIds: string[] },
): AnswerResult {
  const citedRecords = citedRecordsFromRows(rows, parsed.citedRecordIds);
  if (citedRecords.length === 0 && !isLimitationAnswer(parsed.answer)) {
    throw new Error("Model answer did not cite any returned records.");
  }
  return {
    text: parsed.answer,
    citedRecords,
  };
}

export async function answerQuestion(
  db: Database,
  farmId: string,
  filter: QuestionFilter,
): Promise<AnswerResult> {
  const rows = await queryEvents(db, farmId, filter, 50);

  if (rows.length === 0) {
    return {
      text: "I can't tell from your records.",
      citedRecords: [],
    };
  }

  const client = createNebiusClient("answer");
  const recordsText = formatRecordsForModel(
    rows.map((r) => ({
      id: r.id,
      activity: r.activity,
      crop: r.crop,
      field: r.fieldName,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      timeOfDay: r.timeOfDay,
    })),
  );

  const response = await client.chat.completions.create({
    model: getNebiusModel("answer"),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: questionInstructions },
      {
        role: "user",
        content: `Question filter: ${JSON.stringify(filter)}\n\nRecords:\n${recordsText}`,
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error(
      "Nebius returned an empty model response for question answer.",
    );
  }

  const parsed = parseAnswerModelOutput(content);
  if (!parsed) {
    throw new Error("Model returned invalid answer format.");
  }

  return groundedAnswer(rows, parsed);
}

export async function generateReport(
  db: Database,
  farmId: string,
  filter: ReportFilter,
): Promise<AnswerResult> {
  const [summary, rows] = await Promise.all([
    aggregateReport(db, farmId, filter),
    queryEvents(db, farmId, filter, 50),
  ]);

  if (summary.total === 0) {
    return {
      text: "I don't have any records matching that.",
      citedRecords: [],
    };
  }

  const client = createNebiusClient("answer");
  const summaryObj = {
    total: summary.total,
    byActivity: summary.byActivity,
    byField: summary.byField,
    byCrop: summary.byCrop,
    byDay: summary.byDay,
  };
  const summaryText = formatSummaryForModel(
    summaryObj,
    rows.map((r) => ({
      id: r.id,
      activity: r.activity,
      crop: r.crop,
      field: r.fieldName,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      timeOfDay: r.timeOfDay,
    })),
  );

  const response = await client.chat.completions.create({
    model: getNebiusModel("answer"),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: reportInstructions },
      {
        role: "user",
        content: `Report filter: ${JSON.stringify(filter)}\n\nSummary:\n${summaryText}`,
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error(
      "Nebius returned an empty model response for report answer.",
    );
  }

  const parsed = parseAnswerModelOutput(content);
  if (!parsed) {
    throw new Error("Model returned invalid answer format.");
  }

  return groundedAnswer(rows, parsed);
}
