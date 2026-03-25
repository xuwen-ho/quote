import Anthropic from "@anthropic-ai/sdk";
import { GoogleAuth } from "google-auth-library";
import { readFile } from "fs/promises";
import { join } from "path";
import type { AnalysisResult, DetectedRoom } from "@/lib/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LEGACY_ANALYSIS_PROMPT = `You are an expert architectural floor plan analyzer. Analyze this floor plan image and extract the following information for each room:

1. Room type (e.g., "bedroom", "kitchen", "bathroom", "living_room", "dining_room", "study", "storage", "balcony", "corridor")
2. A descriptive name (e.g., "Master Bedroom", "Kitchen", "Bathroom 1")
3. Approximate dimensions in feet (width x length)
4. Approximate area in square feet

Respond ONLY with valid JSON in this exact format:
{
  "rooms": [
    {
      "type": "bedroom",
      "name": "Master Bedroom",
      "areaSqft": 150,
      "dimensions": { "width": 12, "length": 12.5, "unit": "ft" }
    }
  ],
  "totalAreaSqft": 850,
  "confidence": 0.85
}`;

const GEMINI_OVERLAY_PROMPT = `Analyze this floor plan and return EXACTLY one JSON object with this schema:
{
  "rooms": [
    {
      "id": "string",
      "type": "bedroom|kitchen|bathroom|living_room|dining_room|study|storage|balcony|corridor|other",
      "name": "string",
      "areaSqft": number,
      "confidence": number,
      "dimensions": { "width": number, "length": number, "unit": "ft" },
      "polygon": [{ "x": number, "y": number }],
      "bbox": { "x": number, "y": number, "width": number, "height": number }
    }
  ],
  "totalAreaSqft": number,
  "confidence": number
}
Rules:
- polygon must have at least 3 points in original image coordinates.
- bbox must tightly bound polygon.
- confidence fields are 0..1.
- Return only JSON, no markdown.`;

class ConfigError extends Error {}

type GeminiAuthConfig = {
  endpoint: string;
  model: string;
  headers: Record<string, string>;
};

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function parseJsonObject(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(match[0]) as Record<string, unknown>;
}

function guessMimeFromUrl(fileUrl: string) {
  const ext = fileUrl.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "pdf") return "application/pdf";
  return "image/png";
}

async function readUpload(fileUrl: string) {
  if (!fileUrl.startsWith("/uploads/")) {
    throw new Error("fileUrl must point to /uploads/");
  }

  const relativePath = fileUrl.replace(/^\/+/, "");
  const filePath = join(process.cwd(), "public", relativePath);
  const fileBuffer = await readFile(filePath);

  return { fileBuffer, mimeType: guessMimeFromUrl(fileUrl) };
}

function normalizePoint(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const source = item as { x?: unknown; y?: unknown };
  const x = Number(source.x);
  const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeRoom(index: number, room: unknown, sourceModel: string): DetectedRoom | null {
  if (!room || typeof room !== "object") return null;

  const source = room as {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    areaSqft?: unknown;
    confidence?: unknown;
    dimensions?: { width?: unknown; length?: unknown; unit?: unknown };
    polygon?: unknown[];
    bbox?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  };

  const polygon = Array.isArray(source.polygon)
    ? source.polygon.map(normalizePoint).filter((point): point is NonNullable<typeof point> => Boolean(point))
    : [];

  if (polygon.length < 3) return null;

  const bbox = source.bbox && typeof source.bbox === "object"
    ? {
        x: Number(source.bbox.x),
        y: Number(source.bbox.y),
        width: Number(source.bbox.width),
        height: Number(source.bbox.height),
      }
    : null;

  return {
    id: typeof source.id === "string" && source.id ? source.id : `room_${index + 1}`,
    type: typeof source.type === "string" && source.type ? source.type.toLowerCase().replace(/\s+/g, "_") : "other",
    name: typeof source.name === "string" && source.name ? source.name : `Room ${index + 1}`,
    areaSqft: Number.isFinite(Number(source.areaSqft)) ? Math.max(0, Number(source.areaSqft)) : 0,
    confidence: Number.isFinite(Number(source.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : 0,
    polygon,
    bbox: bbox && Number.isFinite(bbox.x) && Number.isFinite(bbox.y) && Number.isFinite(bbox.width) && Number.isFinite(bbox.height)
      ? bbox
      : undefined,
    sourceModel,
    dimensions: {
      width: Number.isFinite(Number(source.dimensions?.width)) ? Number(source.dimensions?.width) : 0,
      length: Number.isFinite(Number(source.dimensions?.length)) ? Number(source.dimensions?.length) : 0,
      unit: source.dimensions?.unit === "m" ? "m" : "ft",
    },
  };
}

async function resolveGeminiAuthConfig(): Promise<GeminiAuthConfig> {
  const model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  const authMode = process.env.GEMINI_AUTH_MODE ?? "api_key";
  const endpointOverride = process.env.VERTEX_GEMINI_ENDPOINT;

  if (authMode === "google_sdk") {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
    if (!projectId) {
      throw new ConfigError("GOOGLE_CLOUD_PROJECT is required for GEMINI_AUTH_MODE=google_sdk");
    }

    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : undefined;
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
    if (!token) {
      throw new ConfigError("Failed to obtain Google access token via SDK auth");
    }

    const endpoint =
      endpointOverride ??
      `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    return {
      endpoint,
      model,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ConfigError("GEMINI_API_KEY is required for GEMINI_AUTH_MODE=api_key");
  }
  const endpoint = endpointOverride
    ? endpointOverride.includes("key=")
      ? endpointOverride
      : `${endpointOverride}${endpointOverride.includes("?") ? "&" : "?"}key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return {
    endpoint,
    model,
    headers: { "Content-Type": "application/json" },
  };
}

async function analyzeWithGeminiVertex(fileBuffer: Buffer, mimeType: string): Promise<AnalysisResult> {
  if (!mimeType.startsWith("image/")) {
    throw new Error("Gemini overlay workflow currently supports PNG/JPG only. Please upload an image file.");
  }

  const { endpoint, model, headers } = await resolveGeminiAuthConfig();

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: GEMINI_OVERLAY_PROMPT },
            {
              inlineData: {
                mimeType,
                data: fileBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          required: ["rooms", "totalAreaSqft", "confidence"],
          properties: {
            rooms: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "type", "name", "areaSqft", "confidence", "dimensions", "polygon", "bbox"],
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  name: { type: "string" },
                  areaSqft: { type: "number" },
                  confidence: { type: "number" },
                  dimensions: {
                    type: "object",
                    required: ["width", "length", "unit"],
                    properties: {
                      width: { type: "number" },
                      length: { type: "number" },
                      unit: { type: "string", enum: ["ft", "m"] },
                    },
                  },
                  polygon: {
                    type: "array",
                    minItems: 3,
                    items: {
                      type: "object",
                      required: ["x", "y"],
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                    },
                  },
                  bbox: {
                    type: "object",
                    required: ["x", "y", "width", "height"],
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                      width: { type: "number" },
                      height: { type: "number" },
                    },
                  },
                },
              },
            },
            totalAreaSqft: { type: "number" },
            confidence: { type: "number" },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini Vertex request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as
    | {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      }
    | Array<{
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      }>;

  const chunks = Array.isArray(payload) ? payload : [payload];
  const text = chunks
    .flatMap((chunk) => chunk.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
  const parsed = parseJsonObject(text) as {
    rooms?: unknown[];
    totalAreaSqft?: unknown;
    confidence?: unknown;
  };

  const rooms = Array.isArray(parsed.rooms)
    ? parsed.rooms
        .map((room, index) => normalizeRoom(index, room, model))
        .filter((room): room is DetectedRoom => Boolean(room))
    : [];

  const totalAreaSqft = Number(parsed.totalAreaSqft);
  const confidence = Number(parsed.confidence);

  return {
    rooms,
    totalAreaSqft: Number.isFinite(totalAreaSqft) ? totalAreaSqft : rooms.reduce((sum, room) => sum + room.areaSqft, 0),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : rooms.length
        ? rooms.reduce((sum, room) => sum + (room.confidence ?? 0), 0) / rooms.length
        : 0,
  };
}

async function analyzeLegacyWithClaude(fileBuffer: Buffer, mimeType: string): Promise<AnalysisResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ConfigError("ANTHROPIC_API_KEY is not configured for legacy fallback");
  }

  const contentBlock =
    mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: fileBuffer.toString("base64"),
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mimeType === "image/jpeg" ? ("image/jpeg" as const) : ("image/png" as const),
            data: fileBuffer.toString("base64"),
          },
        };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 2048,
    messages: [{ role: "user", content: [contentBlock, { type: "text", text: LEGACY_ANALYSIS_PROMPT }] }],
  });

  const responseText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const parsed = parseJsonObject(responseText) as {
    rooms?: unknown[];
    totalAreaSqft?: unknown;
    confidence?: unknown;
  };

  const rooms = Array.isArray(parsed.rooms) ? (parsed.rooms as DetectedRoom[]) : [];

  return {
    rooms: rooms.map((room, index) => ({
      ...room,
      id: room.id ?? `legacy_${index + 1}`,
      sourceModel: "claude-sonnet-4-6-20250514",
    })),
    totalAreaSqft: Number.isFinite(Number(parsed.totalAreaSqft)) ? Number(parsed.totalAreaSqft) : 0,
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fileUrl?: string };
    if (!body.fileUrl) {
      return Response.json({ error: "fileUrl is required" }, { status: 400 });
    }

    const { fileBuffer, mimeType } = await readUpload(body.fileUrl);
    const mode = process.env.ANALYZE_PIPELINE_MODE ?? "gemini_vertex";

    let result: AnalysisResult;
    if (mode === "legacy_claude") {
      result = await analyzeLegacyWithClaude(fileBuffer, mimeType);
    } else {
      try {
        result = await analyzeWithGeminiVertex(fileBuffer, mimeType);
      } catch (error) {
        if (error instanceof ConfigError && isEnabled(process.env.ANALYZE_ALLOW_LEGACY_FALLBACK)) {
          result = await analyzeLegacyWithClaude(fileBuffer, mimeType);
        } else {
          throw error;
        }
      }
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Floor plan analysis failed";
    const status = message === "fileUrl must point to /uploads/" ? 400 : 500;

    console.error("Analysis error:", error);
    return Response.json({ error: message }, { status });
  }
}
