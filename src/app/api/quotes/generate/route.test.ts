import { beforeEach, describe, expect, it, vi } from "vitest";

const { defaultRateFindManyMock, quoteCreateMock } = vi.hoisted(() => ({
  defaultRateFindManyMock: vi.fn(),
  quoteCreateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    defaultRate: { findMany: defaultRateFindManyMock },
    quote: { create: quoteCreateMock },
  },
}));

import { POST } from "./route";

const room = {
  type: "bedroom",
  name: "Master Bedroom",
  areaSqft: 120,
  dimensions: { width: 10, length: 12, unit: "ft" as const },
};

describe("POST /api/quotes/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when rooms are missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/quotes/generate", {
        method: "POST",
        body: JSON.stringify({ rooms: [] }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "rooms array is required (or provide projectId with persisted rooms)" });
  });

  it("uses provided rates without reading defaults", async () => {
    const response = await POST(
      new Request("http://localhost/api/quotes/generate", {
        method: "POST",
        body: JSON.stringify({
          rooms: [room],
          margin: 0.2,
          rates: [
            { category: "flooring", itemName: "Vinyl Flooring", unit: "sqft", unitCost: 5 },
          ],
        }),
      })
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quoteId).toBeUndefined();
    expect(payload.summary.grandTotal).toBeGreaterThan(0);
    expect(defaultRateFindManyMock).not.toHaveBeenCalled();
  });

  it("loads default rates when rates are omitted", async () => {
    defaultRateFindManyMock.mockResolvedValue([
      {
        category: "flooring",
        itemName: "Vinyl Flooring",
        unitCost: 4,
        unit: "sqft",
        description: "Default rate",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/quotes/generate", {
        method: "POST",
        body: JSON.stringify({ rooms: [room] }),
      })
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(defaultRateFindManyMock).toHaveBeenCalledTimes(1);
    expect(payload.summary.lineItems.length).toBeGreaterThan(0);
  });

  it("persists quote when projectId is provided", async () => {
    defaultRateFindManyMock.mockResolvedValue([
      {
        category: "flooring",
        itemName: "Vinyl Flooring",
        unitCost: 4,
        unit: "sqft",
        description: null,
      },
    ]);
    quoteCreateMock.mockResolvedValue({ id: "quote-123" });

    const response = await POST(
      new Request("http://localhost/api/quotes/generate", {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-1",
          rooms: [room],
        }),
      })
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(quoteCreateMock).toHaveBeenCalledTimes(1);
    expect(payload.quoteId).toBe("quote-123");
  });
});
