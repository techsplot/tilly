import {
  createFarm,
  findFarm,
  findFarmByIdAndSession,
  listFarmsBySession,
  type Database,
} from "../infrastructure/db/farm-event-repository";
import { randomBytes } from "crypto";

const farmCookieName = "fieldledger_farm";
const sessionCookieName = "fieldledger_session";

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function readCookie(request: Request, cookieName: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  const match = cookieHeader?.match(
    new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`),
  );
  return match?.[1];
}

function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export function sessionCookieHeader(sessionId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
}

export async function getSessionId(request: Request): Promise<string> {
  const cookieSessionId = readCookie(request, sessionCookieName);
  if (cookieSessionId) return cookieSessionId;
  return generateSessionId();
}

export async function getFarmContext(
  db: Database,
  request: Request,
): Promise<{
  farmId: string;
  sessionId: string;
  isNewFarm: boolean;
  isNewSession: boolean;
}> {
  const sessionId = await getSessionId(request);
  const isNewSession = !readCookie(request, sessionCookieName);

  const cookieFarmId = readCookie(request, farmCookieName);
  if (cookieFarmId && isUuid(cookieFarmId)) {
    const farm = await findFarmByIdAndSession(db, cookieFarmId, sessionId);
    if (farm) {
      return { farmId: farm.id, sessionId, isNewFarm: false, isNewSession };
    }
  }

  // Check if this session has any farms
  const existingFarms = await listFarmsBySession(db, sessionId);
  if (existingFarms.length > 0 && existingFarms[0]) {
    // Use the first (oldest) farm as default
    return {
      farmId: existingFarms[0].id,
      sessionId,
      isNewFarm: false,
      isNewSession,
    };
  }

  // Create a new farm for new sessions
  const farmId = await createFarm(db, sessionId, "My Farm");
  return { farmId, sessionId, isNewFarm: true, isNewSession };
}

export async function getExistingFarmId(
  db: Database,
  request: Request,
): Promise<string | undefined> {
  const sessionId = await getSessionId(request);
  const cookieFarmId = readCookie(request, farmCookieName);
  if (cookieFarmId && isUuid(cookieFarmId)) {
    const farm = await findFarmByIdAndSession(db, cookieFarmId, sessionId);
    if (farm) return farm.id;
  }
  return undefined;
}

export function farmCookieHeader(farmId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${farmCookieName}=${farmId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
}
