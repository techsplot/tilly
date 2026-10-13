import { getExistingFarmId } from "@/src/application/farm-context";
import { getNudge } from "@/src/application/farm-agent";
import { getDb } from "@/src/infrastructure/db/client";
import { agentErrorResponse } from "../errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const db = getDb();
    const farmId = await getExistingFarmId(db, request);
    if (!farmId) return Response.json({ action: null });
    const action = await getNudge(db, farmId);
    return Response.json({ action });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
