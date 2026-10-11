import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  farmInteractionSchema,
  requiredFieldsByActivity,
  type FarmEvent,
  type FarmInteraction,
  type FarmInteractionResult,
} from "../domain/farm-event";
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
      "unit": "string or null"
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
`;

function applyInteractionPolicy(
  interaction: FarmInteraction,
  sourceText: string,
): FarmInteractionResult {
  const events: FarmEvent[] = interaction.events.map((event) => {
    const requiredFields = requiredFieldsByActivity[event.activity];
    if (!requiredFields) {
      throw new Error(
        `No required-field policy exists for activity "${event.activity}".`,
      );
    }

    const missingFields = requiredFields.filter((field) => {
      const value = event[field];
      return value === null || value === undefined || value === "";
    });

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
    clarificationQuestion: `To complete this ${firstIncompleteEvent.activity} record, what is the ${firstIncompleteEvent.missingFields[0]}?`,
    events,
  };
}

export async function extractFarmEvent(
  farmerMessage: string,
  currentDate: string,
  clarifications?: { question: string; answer: string }[],
): Promise<FarmInteractionResult> {
  const client = createNebiusClient();

  // Build sourceText with provenance: original message + Q/A pairs
  let sourceText = farmerMessage;
  if (clarifications && clarifications.length > 0) {
    const qaPairs = clarifications
      .slice(0, 3) // limit to 3 clarifications
      .map((c) => `Q: ${c.question} A: ${c.answer}`)
      .join(" ");
    sourceText = `${farmerMessage} ${qaPairs}`;
  }

  const response = await client.chat.completions.create({
    model: getNebiusModel(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: extractionInstructions },
      {
        role: "user",
        content: JSON.stringify({ currentDate, farmerMessage, clarifications }),
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

  return applyInteractionPolicy(result.data, sourceText);
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
