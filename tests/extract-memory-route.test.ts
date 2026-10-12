import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExtractFarmEvent = vi.hoisted(() => vi.fn());
const mockGetExistingFarmId = vi.hoisted(() => vi.fn());
const mockLoadFarmMemory = vi.hoisted(() => vi.fn());

vi.mock("../src/application/extract-farm-event", () => ({
  extractFarmEvent: mockExtractFarmEvent,
}));
vi.mock("../src/application/farm-context", () => ({
  getExistingFarmId: mockGetExistingFarmId,
}));
vi.mock("../src/application/farm-memory", () => ({
  loadFarmMemory: mockLoadFarmMemory,
}));
vi.mock("../src/infrastructure/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

import { POST } from "../app/api/extract-event/route";

const result = {
  events: [],
  clarificationRequired: true,
  clarificationQuestion: "Which field?",
};

describe("extract route farm memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    mockExtractFarmEvent.mockReset().mockResolvedValue(result);
    mockGetExistingFarmId.mockReset();
    mockLoadFarmMemory.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not load or create farm memory without an existing cookie", async () => {
    mockGetExistingFarmId.mockResolvedValue(undefined);
    const response = await POST(
      new Request("http://localhost/api/extract-event", {
        method: "POST",
        body: JSON.stringify({
          message: "I weeded that field",
          currentDate: "2026-10-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockLoadFarmMemory).not.toHaveBeenCalled();
    expect(mockExtractFarmEvent).toHaveBeenCalledWith(
      "I weeded that field",
      "2026-10-12",
      undefined,
      { fields: [], recentEvents: [] },
    );
  });

  it("continues extraction when memory loading fails", async () => {
    mockGetExistingFarmId.mockResolvedValue("farm-id");
    mockLoadFarmMemory.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(
      new Request("http://localhost/api/extract-event", {
        method: "POST",
        body: JSON.stringify({
          message: "I weeded that field",
          currentDate: "2026-10-12",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockExtractFarmEvent).toHaveBeenCalledWith(
      "I weeded that field",
      "2026-10-12",
      undefined,
      { fields: [], recentEvents: [] },
    );
  });
});
