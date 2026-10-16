import type { Database } from "../src/infrastructure/db/farm-event-repository";
import { createFarm as createFarmRepo } from "../src/infrastructure/db/farm-event-repository";

let sessionCounter = 0;

export async function createTestFarm(
  db: Database,
  name = "Test Farm",
): Promise<string> {
  const sessionId = `test-session-${++sessionCounter}`;
  return createFarmRepo(db, sessionId, name);
}
