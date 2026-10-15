import { z } from "zod";
import {
  getSessionId,
  farmCookieHeader,
  isUuid,
} from "@/src/application/farm-context";
import { getDb } from "@/src/infrastructure/db/client";
import { findFarmByIdAndSession } from "@/src/infrastructure/db/farm-event-repository";

const setActiveFarmSchema = z.object({
  farmId: z.string().uuid("Farm id must be a valid UUID"),
});

// PUT /api/farms/active - Set the active farm
export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Please send a valid JSON request." },
      { status: 400 },
    );
  }

  const parsed = setActiveFarmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  if (!isUuid(parsed.data.farmId)) {
    return Response.json(
      { error: "Farm id must be a valid UUID." },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const sessionId = await getSessionId(request);

    // Verify the farm belongs to this session
    const farm = await findFarmByIdAndSession(
      db,
      parsed.data.farmId,
      sessionId,
    );

    if (!farm) {
      return Response.json(
        { error: "Farm not found or access denied." },
        { status: 404 },
      );
    }

    const response = Response.json({ id: farm.id, name: farm.name });
    response.headers.set("Set-Cookie", farmCookieHeader(farm.id));
    return response;
  } catch (error) {
    console.error("Set active farm failed", error);
    return Response.json(
      { error: "Failed to set active farm." },
      { status: 500 },
    );
  }
}
