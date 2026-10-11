import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = {};
const mockGetFarmContext = vi.hoisted(() => vi.fn());
const mockRecordFarmEvent = vi.hoisted(() => vi.fn());
const mockListTimeline = vi.hoisted(() => vi.fn());
const mockCorrectRecordedEvent = vi.hoisted(() => vi.fn());
const mockConfirmRecordedEvent = vi.hoisted(() => vi.fn());
const mockRejectRecordedEvent = vi.hoisted(() => vi.fn());

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
  recordFarmEvent: mockRecordFarmEvent,
  listTimeline: mockListTimeline,
  correctRecordedEvent: mockCorrectRecordedEvent,
  confirmRecordedEvent: mockConfirmRecordedEvent,
  rejectRecordedEvent: mockRejectRecordedEvent,
}));

import { POST, GET } from "../app/api/events/route";
import { PATCH } from "../app/api/events/[id]/route";
import { POST as CONFIRM } from "../app/api/events/[id]/confirm/route";

const farmEvent = {
  activity: "planting",
  crop: "maize",
  field: "Back Field",
  eventDate: "2026-10-10",
  quantity: null,
  unit: null,
  status: "proposed",
  missingFields: [],
  sourceText: "I planted maize.",
};

const savedEvent = { ...farmEvent, id: "11111111-1111-4111-8111-111111111111" };

describe("farm event routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetFarmContext.mockResolvedValue({ farmId: "farm-id", isNew: true });
    mockRecordFarmEvent.mockReset();
    mockListTimeline.mockReset();
    mockCorrectRecordedEvent.mockReset();
    mockConfirmRecordedEvent.mockReset();
    mockRejectRecordedEvent.mockReset();
  });

  it("records an event and sets the farm cookie", async () => {
    mockRecordFarmEvent.mockResolvedValue(savedEvent);
    const response = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify({
          proposal: farmEvent,
          final: farmEvent,
          decision: "confirm",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBe("farm=farm-id");
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        body: "{bad",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("lists the farm timeline", async () => {
    mockListTimeline.mockResolvedValue([savedEvent]);
    const response = await GET(new Request("http://localhost/api/events"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ events: [savedEvent] });
  });

  it("returns 404 for malformed ids", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/events/not-an-id", {
        method: "PATCH",
        body: JSON.stringify({ crop: "rice" }),
      }),
      { params: Promise.resolve({ id: "not-an-id" }) },
    );
    expect(response.status).toBe(404);
  });

  it("maps refused confirmation to 409", async () => {
    mockConfirmRecordedEvent.mockRejectedValue(
      new Error("confirmEvent: event has missing fields"),
    );
    const response = await CONFIRM(
      new Request(
        "http://localhost/api/events/11111111-1111-4111-8111-111111111111/confirm",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ id: savedEvent.id }) },
    );
    expect(response.status).toBe(409);
  });

  it("does not expose unexpected errors", async () => {
    mockListTimeline.mockRejectedValue(new Error("database password"));
    const response = await GET(new Request("http://localhost/api/events"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "FarmMind could not save that record. Please try again.",
    });
  });
});
