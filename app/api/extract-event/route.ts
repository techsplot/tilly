import { extractFarmEvent } from "@/src/application/extract-farm-event";
import { farmInteractionResultSchema, farmRequestSchema } from "@/src/domain/farm-event";

function isWithinOneDay(clientDate: string, serverDate: string): boolean {
  const client = new Date(clientDate);
  const server = new Date(serverDate);
  const diffDays = Math.abs((client.getTime() - server.getTime()) / 86400000);
  return diffDays <= 1;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "FarmMind could not process that message. Please try again.";
}

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const parsed = farmRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "A non-empty farm message is required." },
        { status: 400 },
      );
    }

    const { message, currentDate, clarifications } = parsed.data;

    const serverDate = new Date().toISOString().slice(0, 10);
    if (!isWithinOneDay(currentDate, serverDate)) {
      return Response.json(
        { error: "The date you provided is more than one day away from today." },
        { status: 400 },
      );
    }

    const result = await extractFarmEvent(message, currentDate, clarifications);

    const parsedResult = farmInteractionResultSchema.safeParse(result);
    if (!parsedResult.success) {
      return Response.json(
        { error: "FarmMind returned invalid data." },
        { status: 502 },
      );
    }

    const elapsed = Date.now() - startTime;
    console.info(`FarmMind model call: ${elapsed}ms`);

    return Response.json(parsedResult.data);
  } catch (error: unknown) {
    const elapsed = Date.now() - startTime;
    const errorMessage = formatErrorMessage(error);

    // Distinguish timeout (8+ seconds) from other errors
    if (elapsed >= 8000) {
      return Response.json(
        { error: "FarmMind is taking longer than expected. Please try again." },
        { status: 504 },
      );
    }

    // Validation and model failures return 502 without leaking internal text
    if (errorMessage.includes("FarmMind returned invalid data")
      || errorMessage.includes("Nebius returned")
      || errorMessage.includes("clarificationQuestion")) {
      return Response.json(
        { error: "FarmMind could not process that message. Please try again." },
        { status: 502 },
      );
    }

    return Response.json(
      { error: errorMessage },
      { status: 502 },
    );
  }
}