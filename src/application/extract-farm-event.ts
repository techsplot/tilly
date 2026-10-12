import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  farmInteractionSchema,
  getMissingFields,
  type FarmEvent,
  type FarmInteraction,
  type FarmInteractionResult,
} from "../domain/farm-event";
import {
  getMemoryReferenceOptions,
  verifyMemoryReferences,
  type FarmMemory,
} from "../domain/farm-memory";
import {
  createNebiusClient,
  getNebiusModel,
} from "../infrastructure/nebius/nebius-client";

config();

const extractionInstructions = `
You extract farm activities from a farmer's message.

Return JSON only with this exact shape:
{
  "events": [
    {
      "activity": "planting|fertilizing|weeding|spraying|harvesting|inspection|irrigation|other",
      "crop": "string or null",
      "field": "string or null",
      "eventDate": "YYYY-MM-DD or null",
      "quantity": "number or null",
      "unit": "string or null",
      "fieldSource": "message|memory|null",
      "cropSource": "message|memory|null",
      "memoryEventIds": ["id"]
    }
  ],
  "clarificationRequired": "boolean",
  "clarificationQuestion": "string or null"
}

Use the current date supplied by the application to resolve relative dates.
Never invent a crop, field, date, quantity, or unit. If the message is too
ambiguous to record safely, return no event and ask one concise question.
If the useful facts are clear but an optional detail is missing, return the
event with that field set to null and do not ask a question.

Clarifications are the farmer's answers and take precedence over the original
message. If an answer provides a value for a missing field, fill that field.

farmMemory is the farmer's own confirmed history. Use it only to resolve
references in the message such as "that field", "the maize", or "same place
as last week". Never copy a value from memory unless the message refers to it.
If a reference could match more than one field or crop, do not choose; leave
the value null and ask one question naming the options. Cite the memory event
ids used for each memory-sourced value. Only resolve a field or crop from
recentEvents, and cite the event ids you used.
`;

export function buildMemoryClarificationQuestion(
  kind: "field" | "crop",
  options: string[],
): string | null {
  if (options.length === 0) return null;
  return `Which ${kind} did you mean: ${options.join(" or ")}?`;
}

function applyInteractionPolicy(
  interaction: FarmInteraction,
  sourceText: string,
  farmMemory: FarmMemory,
): FarmInteractionResult {
  const events: FarmEvent[] = interaction.events.map((event) => {
    const missingFields = getMissingFields(event);

    return {
      ...event,
      status: missingFields.length > 0 ? "incomplete" : "proposed",
      missingFields,
      sourceText,
    };
  });

  const firstIncompleteEvent = events.find(
    (event) => event.status === "incomplete",
  );

  if (!firstIncompleteEvent || interaction.clarificationRequired) {
    return { ...interaction, events };
  }

  return {
    ...interaction,
    clarificationRequired: true,
    clarificationQuestion:
      (firstIncompleteEvent.unresolvedReferences?.includes("field")
        ? buildMemoryClarificationQuestion(
            "field",
            getMemoryReferenceOptions(farmMemory, "field"),
          )
        : firstIncompleteEvent.unresolvedReferences?.includes("crop")
          ? buildMemoryClarificationQuestion(
              "crop",
              getMemoryReferenceOptions(farmMemory, "crop"),
            )
          : null) ??
      `To complete this ${firstIncompleteEvent.activity} record, what is the ${firstIncompleteEvent.missingFields[0]}?`,
    events,
  };
}

export async function extractFarmEvent(
  farmerMessage: string,
  currentDate: string,
  clarifications?: { question: string; answer: string }[],
  farmMemory: FarmMemory = { fields: [], recentEvents: [] },
): Promise<FarmInteractionResult> {
  const client = createNebiusClient();

  // Build sourceText with provenance: original message + Q/A pairs
  let sourceText = farmerMessage;
  if (clarifications && clarifications.length > 0) {
    const qaPairs = clarifications
      .slice(0, 3) // limit to 3 clarifications
      .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
      .join("\n");
    sourceText = `${farmerMessage}\n${qaPairs}`;
  }

  const userContent: {
    currentDate: string;
    farmerMessage: string;
    clarifications?: { question: string; answer: string }[];
    farmMemory?: FarmMemory;
  } = { currentDate, farmerMessage };
  if (clarifications) userContent.clarifications = clarifications;
  if (farmMemory.fields.length > 0 || farmMemory.recentEvents.length > 0)
    userContent.farmMemory = farmMemory;

  const response = await client.chat.completions.create({
    model: getNebiusModel(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: extractionInstructions },
      {
        role: "user",
        content: JSON.stringify(userContent),
      },
    ],
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error("Nebius returned an empty model response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("Nebius returned invalid JSON.", { cause: error });
  }

  const result = farmInteractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Model response failed FarmInteraction validation: ${result.error.message}`,
    );
  }

  const verifiedEvents = result.data.events.map((event) => {
    const verified = verifyMemoryReferences(
      {
        field: event.field,
        crop: event.crop,
        ...(event.fieldSource !== undefined
          ? { fieldSource: event.fieldSource }
          : {}),
        ...(event.cropSource !== undefined
          ? { cropSource: event.cropSource }
          : {}),
        memoryEventIds: event.memoryEventIds ?? [],
      },
      farmMemory,
    );
    return {
      ...event,
      ...verified.event,
      resolvedFromMemory: verified.resolvedFromMemory,
      unresolvedReferences: verified.unresolvedReferences,
    };
  });
  return applyInteractionPolicy(
    { ...result.data, events: verifiedEvents },
    sourceText,
    farmMemory,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const message =
    process.argv.slice(2).join(" ") ||
    "I planted maize in the back field yesterday.";
  const currentDate = new Date().toISOString().slice(0, 10);

  extractFarmEvent(message, currentDate)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
