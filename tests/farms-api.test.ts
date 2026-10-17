import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../src/infrastructure/db/schema";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => holder.db),
}));

import { GET as listFarms } from "../app/api/farms/route";
import {
  GET as getSettings,
  PATCH as patchSettings,
} from "../app/api/farms/[id]/settings/route";
import { createFarm } from "../src/infrastructure/db/farm-event-repository";

const SESSION = "a".repeat(64);
const OTHER_SESSION = "b".repeat(64);

function request(
  url: string,
  options: { session?: string; farm?: string; method?: string; body?: unknown } = {},
) {
  const cookies = [
    options.session ? `fieldledger_session=${options.session}` : null,
    options.farm ? `fieldledger_farm=${options.farm}` : null,
  ].filter(Boolean);
  return new Request(`http://localhost${url}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("farms API", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let homeId: string;
  let riverId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    holder.db = db;
  }, 180000);

  beforeEach(async () => {
    await db.delete(schema.eventCorrections);
    await db.delete(schema.farmEvents);
    await db.delete(schema.fields);
    await db.delete(schema.farms);
    homeId = await createFarm(db, SESSION, "Home Plot");
    riverId = await createFarm(db, SESSION, "River Farm");
    vi.spyOn(console, "error").mockImplementation(() => {});
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  describe("GET /api/farms", () => {
    it("returns the farms and the active farm from the cookie", async () => {
      const response = await listFarms(
        request("/api/farms", { session: SESSION, farm: riverId }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        farms: [
          { id: homeId, name: "Home Plot" },
          { id: riverId, name: "River Farm" },
        ],
        activeFarmId: riverId,
      });
    });

    it("defaults to the first farm without a farm cookie", async () => {
      const response = await listFarms(request("/api/farms", { session: SESSION }));
      const body = (await response.json()) as { activeFarmId: string };
      expect(body.activeFarmId).toBe(homeId);
    });

    it("creates a session and a farm on a first visit", async () => {
      const response = await listFarms(request("/api/farms"));
      const body = (await response.json()) as {
        farms: Array<{ name: string }>;
        activeFarmId: string;
      };
      expect(body.farms).toEqual([{ id: body.activeFarmId, name: "My Farm" }]);
      const cookies = response.headers.get("set-cookie") ?? "";
      expect(cookies).toContain("fieldledger_session=");
      expect(cookies).toContain(`fieldledger_farm=${body.activeFarmId}`);
    });
  });

  describe("voice settings", () => {
    const settingsUrl = (id: string) => `/api/farms/${id}/settings`;

    it("returns the defaults for a new farm", async () => {
      const response = await getSettings(
        request(settingsUrl(homeId), { session: SESSION }),
        params(homeId),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        wakeWord: "hey farmmind",
        wakeWordEnabled: false,
      });
    });

    it("saves settings, normalised, and reads them back", async () => {
      const saved = await patchSettings(
        request(settingsUrl(homeId), {
          session: SESSION,
          method: "PATCH",
          body: { wakeWord: "  Hey   Buddy ", wakeWordEnabled: true },
        }),
        params(homeId),
      );
      expect(saved.status).toBe(200);
      await expect(saved.json()).resolves.toEqual({
        wakeWord: "hey buddy",
        wakeWordEnabled: true,
      });

      const read = await getSettings(
        request(settingsUrl(homeId), { session: SESSION }),
        params(homeId),
      );
      await expect(read.json()).resolves.toEqual({
        wakeWord: "hey buddy",
        wakeWordEnabled: true,
      });
      const other = await getSettings(
        request(settingsUrl(riverId), { session: SESSION }),
        params(riverId),
      );
      await expect(other.json()).resolves.toMatchObject({
        wakeWord: "hey farmmind",
      });
    });

    it.each([
      ["empty", ""],
      ["too long", "a".repeat(51)],
      ["special characters", "hey <farm>!"],
      ["digits", "farm 2"],
    ])("rejects a %s wake word", async (_label, wakeWord) => {
      const response = await patchSettings(
        request(settingsUrl(homeId), {
          session: SESSION,
          method: "PATCH",
          body: { wakeWord, wakeWordEnabled: true },
        }),
        params(homeId),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/wake word/i);
    });

    it("rejects a missing enabled flag", async () => {
      const response = await patchSettings(
        request(settingsUrl(homeId), {
          session: SESSION,
          method: "PATCH",
          body: { wakeWord: "hey farm" },
        }),
        params(homeId),
      );
      expect(response.status).toBe(400);
    });

    it("hides another session's farm on read and write", async () => {
      const read = await getSettings(
        request(settingsUrl(homeId), { session: OTHER_SESSION }),
        params(homeId),
      );
      expect(read.status).toBe(404);

      const write = await patchSettings(
        request(settingsUrl(homeId), {
          session: OTHER_SESSION,
          method: "PATCH",
          body: { wakeWord: "hey thief", wakeWordEnabled: true },
        }),
        params(homeId),
      );
      expect(write.status).toBe(404);

      const owner = await getSettings(
        request(settingsUrl(homeId), { session: SESSION }),
        params(homeId),
      );
      await expect(owner.json()).resolves.toMatchObject({
        wakeWord: "hey farmmind",
      });
    });

    it("returns 404 for an id that is not a UUID", async () => {
      const response = await getSettings(
        request(settingsUrl("not-a-farm"), { session: SESSION }),
        params("not-a-farm"),
      );
      expect(response.status).toBe(404);
    });
  });
});
