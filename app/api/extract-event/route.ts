import { extractFarmEvent } from "@/src/application/extract-farm-event";
import { farmInteractionResultSchema } from "@/src/application/farm-response-schema";

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("message" in body) ||
      typeof body.message !== "string" ||
      body.message.trim().length === 0
    ) {
      return Response.json(
        { error: "A non-empty farm message is required." },
        { status: 400 },
      );
    }

    const result = await extractFarmEvent(
      body.message,
      new Date().toISOString().slice(0, 10),
    );

    const parsed = farmInteractionResultSchema.safeParse(result);
    if (!parsed.success) {
      return Response.json(
        { error: "FarmMind returned invalid data." },
        { status: 502 },
      );
    }

    return Response.json(parsed.data);
  } catch (error: unknown) {
    console.error("Farm event extraction failed", error);
    return Response.json(
      { error: "FarmMind could not process that message. Please try again." },
      { status: 502 },
    );
  }
}
