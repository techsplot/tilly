import type { Database } from "../infrastructure/db/farm-event-repository";
import { findFarmByNameAndSession } from "../infrastructure/db/farm-event-repository";

export type FarmResolutionResult =
  | { status: "resolved"; farmId: string }
  | { status: "ambiguous"; matches: Array<{ id: string; name: string }> }
  | { status: "not_found"; reference: string };

/**
 * Resolve a farm reference from natural language to a farm ID.
 * - If exactly one owned farm matches, return resolved with that farm ID
 * - If multiple matches, return ambiguous
 * - If no match, return not_found
 * Never invents farms or bypasses ownership checks.
 */
export async function resolveFarmReference(
  db: Database,
  sessionId: string,
  farmReference: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _defaultFarmId: string,
): Promise<FarmResolutionResult | null> {
  if (!farmReference) return null;

  const matches = await findFarmByNameAndSession(db, farmReference, sessionId);

  if (matches.length === 0) {
    return { status: "not_found", reference: farmReference };
  }

  if (matches.length === 1 && matches[0]) {
    return { status: "resolved", farmId: matches[0].id };
  }

  return { status: "ambiguous", matches };
}
