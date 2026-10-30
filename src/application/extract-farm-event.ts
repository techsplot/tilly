import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  deriveTimeOfDay,
  farmInteractionSchema,
  getMissingFields,
  isValidEventTime,
  type FarmEvent,
  type FarmInteraction,
  type FarmInteractionResult,
} from "../domain/farm-event";
import {
  getMemoryReferenceOptions,
  verifyMemoryReferences,
  type FarmMemory,
} from "../domain/farm-memory";
import { mentionedActivities } from "../domain/activity-words";
import {
  keepConversationValue,
  type ConversationTurn,
} from "../domain/conversation";
import { looksLikeQuestion } from "../domain/question-shape";
import { resolveWeekdayDate } from "../domain/weekday-date";
import {
  createNebiusClient,
  getNebiusModel,
} from "../infrastructure/nebius/nebius-client";

config();

const extractionInstructions = `
You are Tilly, a farm memory assistant. You extract farm activities from a farmer's message.

Return JSON only with this exact shape:
{
  "intent": "record|correct|delete|question|report|reminder|help|other",
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
      "memoryEventIds": ["id"],
      "eventTime": "HH:MM in 24-hour time, or null",
      "timeOfDay": "morning|afternoon|evening|night or null"
    }
  ],
  "clarificationRequired": "boolean",
  "clarificationQuestion": "string or null",
  "followUpQuestion": "string or null",
  "correction": { "changes": { "crop": "string or null", "field": "string or null", "eventDate": "YYYY-MM-DD or null", "quantity": "number or null", "unit": "string or null", "eventTime": "HH:MM or null", "timeOfDay": "morning|afternoon|evening|night or null" } } or null,
  "skip": "boolean",
  "filter": {
    "activity": "planting|fertilizing|weeding|spraying|harvesting|inspection|irrigation|other or null",
    "crop": "string or null",
    "field": "string or null",
    "dateFrom": "YYYY-MM-DD or null",
    "dateTo": "YYYY-MM-DD or null",
    "reportType": "summary|by_activity|by_field|by_crop|by_day or null"
  } or null,
  "reminder": {
    "activity": "string",
    "field": "string or null",
    "crop": "string or null",
    "when": "string",
    "message": "string or null"
  } or null,
  "farmReference": "string or null"
}

Use the current date supplied by the application to resolve relative dates.
Never invent a crop, field, date, quantity, or unit. The agent saves what the
farmer said immediately; it does not wait for every detail. Leave any field
you are not told set to null rather than guessing.

If the farmer mentions a specific farm by name (for example "I planted maize at
River Farm" or "what did I do at Home Plot?"), extract that farm name exactly as
stated into farmReference. If no farm is mentioned, leave farmReference null.
Never invent a farm name.

The application, not you, decides whether a question is needed; it looks at
which important details (date, and crop/field for most activities) are still
null. Your only job when asked for a question is to write one short, friendly
sentence in followUpQuestion that acknowledges the note and asks for the
missing details together, for example "Got it, spraying. Which field was it,
and was it today?" If the date is one of the missing details, ask about the
time in the same sentence too (for example "...and when, today this
morning?"); never ask about the time on its own, since it is optional and
never required. Always set followUpQuestion to your best such sentence,
even if you believe nothing is missing; the application ignores it when it
is not needed.

If the farmer states a specific time ("at 4pm"), set eventTime to that exact
24-hour time and leave timeOfDay null. If the farmer only gives a vague time
of day ("this morning", "in the evening") with no exact time, leave eventTime
null and set timeOfDay to the matching value. Never guess a time that was not
said.

Clarifications are the farmer's answers and take precedence over the original
message. If an answer provides a value for a missing field, fill that field.
If the farmer's answer declines to give the missing detail (for example "I
don't know" or "skip"), set skip to true and do not guess a value. If an
answer instead describes a different, unrelated activity, set intent to
"record" and events to that new activity only; do not merge it into the
activity being asked about.

intent is "record" for a farm activity, including an answer to a pending
question; "correct" when the farmer changes a value of something already
recorded ("no, it was the north field", "it was yesterday, not today", "it
was in the evening"); "delete" when the farmer wants the last record removed
("delete that", "that was wrong, remove it"); "question" when the farmer asks
about their farm history ("when did I last spray?", "what did I plant in the
north field?", "what did I do today?", "show me everything"); "report" when
the farmer asks for a summary ("what did I do this week?", "give me a report
for October"); "reminder" when the farmer asks to be reminded to do something
("remind me to weed tomorrow", "set a reminder to fertilize the north field
next week"); "help" when the farmer asks a conceptual or general farming
question that is not about their specific records ("what is the difference
between farm and field?", "how do I plant maize?", "what is weeding?");
otherwise "other" (greetings, anything else not covered). For "correct", set correction.changes to only the
fields the farmer wants changed, and leave events empty. For "delete",
"help", or "other", leave events and correction empty. For "help", you may
set filter.crop and filter.activity when the question names them ("how do I
control aphids on tomatoes?" sets crop "tomatoes"); leave the other filter
fields null. For "question" or
"report", set filter to the structured filter with only the fields mentioned
(activity, crop, field, dateFrom, dateTo, reportType). If the question does
not specify any particular criteria (like "what did I do today?", "show me
everything"), you may leave all filter fields null - the application will
query recent records. Leave events and correction empty for questions and
reports. For "reminder", set reminder to the activity, field, crop (if
mentioned), when (the natural language time phrase like "tomorrow", "in 3
days", "next week"), and optional message; leave events, correction, and
filter empty.

farmMemory is the farmer's own confirmed history. Use it only to resolve
references in the message such as "that field", "the maize", or "same place
as last week". Never copy a value from memory unless the message refers to it.
If a reference could match more than one field or crop, leave the value null
and name the options in followUpQuestion; the application does not block the
save on this. Cite the memory event ids used for each memory-sourced value.
Only resolve a field or crop from recentEvents, and cite the event ids you
used.

recentConversation, when present, is the last few turns of the chat, oldest
first ("farmer" is the farmer, "tilly" is you). Use it only to understand what
farmerMessage refers to: "the same field", "there too", "and the cassava",
"what about last week?". A field or crop the farmer named in an earlier turn,
or that you named in a receipt, may be used for such a reference; set its
source to "message". Only farmerMessage says what to record, correct, or ask
now: never record an activity from an earlier turn again, and never take a
value from the conversation when farmerMessage does not refer back to it.
`;

// Finding 17: an invalid model time is dropped, never a 502. When
// eventTime is present and valid, time_of_day is derived from it and the
// model's own timeOfDay guess is ignored, so the two can never disagree.
export function resolveTimeFields(
  eventTime: string | null,
  timeOfDay: "morning" | "afternoon" | "evening" | "night" | null,
): {
  eventTime: string | null;
  timeOfDay: "morning" | "afternoon" | "evening" | "night" | null;
} {
  if (eventTime !== null && isValidEventTime(eventTime)) {
    return { eventTime, timeOfDay: deriveTimeOfDay(eventTime) };
  }
  return { eventTime: null, timeOfDay };
}

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

// A reply that could not be used; worth asking again, unlike a timeout or
// a configuration error.
class InvalidModelReplyError extends Error {}

// In an evaluation of 14 typical messages (2026-10-17), the fast mode got
// 11 right; all three misses were "question" for something else ("I
// sprayed", a weather question, a reminder request). An answer is checked
// again when it is "question" or "report" but the message is not worded as
// one, or "other", which drops the message.
function needsCarefulRead(
  intent: FarmInteraction["intent"],
  farmerMessage: string,
  clarifications: { question: string; answer: string }[] | undefined,
): boolean {
  if (clarifications && clarifications.length > 0) return false;
  if (intent === "other") return true;
  return (
    (intent === "question" || intent === "report") &&
    !looksLikeQuestion(farmerMessage)
  );
}

// A reply to Tilly's question that is itself a question, or names an
// activity the original note did not, needs the careful read from the
// start. Live testing showed the fast mode storing "I sprayed" as the crop
// of a pending weeding note and swallowing "when did I last spray?".
function isDoubtfulAnswer(
  farmerMessage: string,
  clarifications: { question: string; answer: string }[] | undefined,
): boolean {
  const answer = clarifications?.at(-1)?.answer;
  if (!answer) return false;
  if (looksLikeQuestion(answer)) return true;
  const original = mentionedActivities(farmerMessage);
  return [...mentionedActivities(answer)].some(
    (activity) => !original.has(activity),
  );
}

export async function extractFarmEvent(
  farmerMessage: string,
  currentDate: string,
  clarifications?: { question: string; answer: string }[],
  farmMemory: FarmMemory = { fields: [], recentEvents: [] },
  conversation: ConversationTurn[] = [],
): Promise<FarmInteractionResult> {
  const client = createNebiusClient("extraction");

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
    recentConversation?: ConversationTurn[];
  } = { currentDate, farmerMessage };
  if (clarifications) userContent.clarifications = clarifications;
  if (farmMemory.fields.length > 0 || farmMemory.recentEvents.length > 0)
    userContent.farmMemory = farmMemory;
  if (conversation.length > 0) userContent.recentConversation = conversation;

  const model = getNebiusModel("extraction");
  async function requestInteraction(thinking: boolean) {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: extractionInstructions },
        {
          role: "user",
          content: JSON.stringify(userContent),
        },
      ],
      // Nemotron Nano reasons before answering unless told not to. Not an
      // OpenAI parameter, so the SDK passes it through to Token Factory.
      ...(thinking ? {} : { chat_template_kwargs: { enable_thinking: false } }),
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new InvalidModelReplyError(
        "Nebius returned an empty model response.",
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new InvalidModelReplyError("Nebius returned invalid JSON.", {
        cause: error,
      });
    }

    const validated = farmInteractionSchema.safeParse(parsed);
    if (!validated.success) {
      throw new InvalidModelReplyError(
        `Model response failed FarmInteraction validation: ${validated.error.message}`,
      );
    }
    return validated.data;
  }

  // Fast first: with thinking off, Nano answers in about 2 s instead of
  // about 20 s, and gets most messages right. It is asked again with
  // thinking on only when its reply is unusable or its intent is doubtful.
  let interaction: FarmInteraction;
  if (isDoubtfulAnswer(farmerMessage, clarifications)) {
    interaction = await requestInteraction(true);
  } else {
    try {
      interaction = await requestInteraction(false);
    } catch (error) {
      if (!(error instanceof InvalidModelReplyError)) throw error;
      interaction = await requestInteraction(true);
    }
    if (needsCarefulRead(interaction.intent, farmerMessage, clarifications)) {
      interaction = await requestInteraction(true);
    }
  }
  const result = { data: interaction };

  // Weekday names are resolved by code, not the model: live testing saved
  // "I planted maize on Monday" as today. Only for a single event, so "on
  // Monday" cannot move a second activity said to be today.
  const farmerWords = [
    farmerMessage,
    ...(clarifications ?? []).map((clarification) => clarification.answer),
  ].join(" ");
  const weekdayDate =
    result.data.events.length === 1
      ? resolveWeekdayDate(farmerWords, currentDate)
      : null;

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
      crop: keepConversationValue(
        "crop",
        verified.event.crop,
        farmerWords,
        conversation,
        farmMemory,
      ),
      field: keepConversationValue(
        "field",
        verified.event.field,
        farmerWords,
        conversation,
        farmMemory,
      ),
      ...resolveTimeFields(event.eventTime ?? null, event.timeOfDay ?? null),
      ...(weekdayDate ? { eventDate: weekdayDate } : {}),
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
