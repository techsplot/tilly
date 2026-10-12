import {
  createFarm,
  findFarm,
  type Database,
} from "../infrastructure/db/farm-event-repository";

const farmCookieName = "fieldledger_farm";

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function readCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  const match = cookieHeader?.match(
    new RegExp(`(?:^|;\\s*)${farmCookieName}=([^;]+)`),
  );
  return match?.[1];
}

export async function getFarmContext(
  db: Database,
  request: Request,
): Promise<{ farmId: string; isNew: boolean }> {
  const cookieFarmId = readCookie(request);
  if (
    cookieFarmId &&
    isUuid(cookieFarmId) &&
    (await findFarm(db, cookieFarmId))
  ) {
    return { farmId: cookieFarmId, isNew: false };
  }
  return { farmId: await createFarm(db), isNew: true };
}

export async function getExistingFarmId(
  db: Database,
  request: Request,
): Promise<string | undefined> {
  const cookieFarmId = readCookie(request);
  if (
    cookieFarmId &&
    isUuid(cookieFarmId) &&
    (await findFarm(db, cookieFarmId))
  )
    return cookieFarmId;
  return undefined;
}

export function farmCookieHeader(farmId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${farmCookieName}=${farmId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
}
