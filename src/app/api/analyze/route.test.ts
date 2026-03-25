import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: readFileMock,
}));

import { POST } from "./route";

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.VERTEX_GEMINI_ENDPOINT;
    delete process.env.ANALYZE_ALLOW_LEGACY_FALLBACK;
    process.env.ANALYZE_PIPELINE_MODE = "gemini_vertex";
  });

  it("returns 400 when fileUrl is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "fileUrl is required" });
  });

  it("returns 400 when fileUrl is outside uploads", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ fileUrl: "/foo/bar.png" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "fileUrl must point to /uploads/",
    });
  });

  it("returns 500 when Gemini API key is not configured", async () => {
    readFileMock.mockResolvedValue(Buffer.from([1, 2, 3]));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ fileUrl: "/uploads/blueprint_sample1.png" }),
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "GEMINI_API_KEY is required for GEMINI_AUTH_MODE=api_key",
    });
  });
});
