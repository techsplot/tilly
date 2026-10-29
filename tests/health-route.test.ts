import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../src/infrastructure/db/schema";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => {
    if (!holder.db) throw new Error("DATABASE_URL=postgres://secret@host/db");
    return holder.db;
  }),
}));
vi.mock("../src/infrastructure/nebius/nebius-client", () => ({
  createNebiusClient: vi.fn(() => {
    throw new Error("the health check must not call a model");
  }),
}));

import { GET } from "../app/api/health/route";
import { createNebiusClient } from "../src/infrastructure/nebius/nebius-client";

describe("GET /api/health", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
  }, 180000);

  afterAll(async () => {
    if (!client.closed) await client.close();
  });

  it("returns ok when the database answers", async () => {
    holder.db = drizzle(client, { schema });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(createNebiusClient).not.toHaveBeenCalled();
  });

  it("returns 503 without details when the database is not configured", async () => {
    holder.db = undefined;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "error" });
    expect(text).not.toContain("postgres");
  });

  it("returns 503 when the database stops answering", async () => {
    holder.db = drizzle(client, { schema });
    await client.close();
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "error" });
  });
});
