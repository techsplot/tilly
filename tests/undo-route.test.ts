import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = {};
const mockGetFarmContext = vi.hoisted(() => vi.fn());
const mockUndoAgentAction = vi.hoisted(() => vi.fn());

vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => mockDb),
}));
vi.mock("../src/application/farm-context", () => ({
  getFarmContext: mockGetFarmContext,
  farmCookieHeader: vi.fn((farmId: string) => `farm=${farmId}`),
  isUuid: vi.fn((value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  ),
}));
vi.mock("../src/application/persist-farm-event", () => ({
  undoAgentAction: mockUndoAgentAction,
}));

import { POST } from "../app/api/events/[id]/undo/route";
import { LifecycleError } from "../src/domain/farm-event";
import { NotFoundError } from "../src/application/errors";

const eventId = "11111111-1111-4111-8111-111111111111";
const savedEvent = {
  activity: "weeding",
  crop: "maize",
  field: "Back Field",
  eventDate: "2026-10-12",
  quantity: null,
  unit: null,
  status: "confirmed",
  missingFields: [],
  sourceText: "I weeded the back field.",
  id: eventId,
  savedBy: "agent",
};

function request(id: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/events/${id}/undo`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("undo route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetFarmContext.mockResolvedValue({ farmId: "farm-id", isNew: false });
    mockUndoAgentAction.mockReset();
  });

  it("undoes a recorded action", async () => {
    mockUndoAgentAction.mockResolvedValue({
      ...savedEvent,
      status: "proposed",
    });
    const response = await request(eventId, { action: "recorded" });
    expect(response.status).toBe(200);
    expect(mockUndoAgentAction).toHaveBeenCalledWith(
      mockDb,
      "farm-id",
      eventId,
      "recorded",
    );
  });

  it("returns 404 for a malformed id", async () => {
    const response = await request("not-an-id", { action: "recorded" });
    expect(response.status).toBe(404);
    expect(mockUndoAgentAction).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid action", async () => {
    const response = await request(eventId, { action: "bogus" });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the record belongs to another farm", async () => {
    mockUndoAgentAction.mockRejectedValue(
      new NotFoundError("Farm event was not found."),
    );
    const response = await request(eventId, { action: "recorded" });
    expect(response.status).toBe(404);
  });

  it("returns 409 when the action does not match the record's current state", async () => {
    mockUndoAgentAction.mockRejectedValue(
      new LifecycleError("This record has already been deleted."),
    );
    const response = await request(eventId, { action: "recorded" });
    expect(response.status).toBe(409);
  });

  it("sets the farm cookie on first use", async () => {
    mockGetFarmContext.mockResolvedValue({ farmId: "farm-id", isNew: true });
    mockUndoAgentAction.mockResolvedValue(savedEvent);
    const response = await request(eventId, { action: "deleted" });
    expect(response.headers.get("set-cookie")).toBe("farm=farm-id");
  });

  it("does not expose unexpected errors", async () => {
    mockUndoAgentAction.mockRejectedValue(new Error("database password"));
    const response = await request(eventId, { action: "recorded" });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "FarmMind could not save that record. Please try again.",
    });
  });
});
