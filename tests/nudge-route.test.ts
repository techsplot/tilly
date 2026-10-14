import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = {};
const mockGetExistingFarmId = vi.hoisted(() => vi.fn());
const mockGetNudge = vi.hoisted(() => vi.fn());

vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => mockDb),
}));
vi.mock("../src/application/farm-context", () => ({
  getExistingFarmId: mockGetExistingFarmId,
}));
vi.mock("../src/application/farm-agent", () => ({
  getNudge: mockGetNudge,
}));

import * as nudgeRoute from "../app/api/agent/nudge/route";

const request = () =>
  new Request("http://localhost/api/agent/nudge", { method: "POST" });

// Review 2, finding 5: showing a nudge marks it as shown, so the route is a
// POST; a GET (prefetch, retry, Strict Mode) must not change state.
describe("agent nudge route", () => {
  beforeEach(() => {
    mockGetExistingFarmId.mockReset();
    mockGetNudge.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed as POST only", () => {
    expect(typeof nudgeRoute.POST).toBe("function");
    expect("GET" in nudgeRoute).toBe(false);
  });

  it("returns the nudge for an existing farm", async () => {
    const action = {
      type: "question",
      text: "Quick one: which field did you spray on 10 Oct?",
      pending: { kind: "gap", eventId: "event-id" },
    };
    mockGetExistingFarmId.mockResolvedValue("farm-id");
    mockGetNudge.mockResolvedValue(action);

    const response = await nudgeRoute.POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ action });
    expect(mockGetNudge).toHaveBeenCalledWith(mockDb, "farm-id");
  });

  it("returns no nudge and touches nothing without a farm", async () => {
    mockGetExistingFarmId.mockResolvedValue(undefined);

    const response = await nudgeRoute.POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ action: null });
    expect(mockGetNudge).not.toHaveBeenCalled();
  });

  it("returns a 502 when the nudge lookup fails", async () => {
    mockGetExistingFarmId.mockResolvedValue("farm-id");
    mockGetNudge.mockRejectedValue(new Error("db down"));

    const response = await nudgeRoute.POST(request());

    expect(response.status).toBe(502);
  });
});
