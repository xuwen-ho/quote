import Anthropic from "@anthropic-ai/sdk";
import { GoogleAuth } from "google-auth-library";
import { readFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import type { AnalysisResult, DetectedRoom } from "@/lib/types";
import { prisma } from "@/lib/prisma";

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

const SAM_SEGMENT_PROMPT = `Identify each distinct room region in this floor plan and return polygons in image coordinates.
Rules:
- Each room polygon must be closed and have at least 3 points.
- Polygons should follow wall boundaries as tightly as possible.
- Return only JSON.`;

const GEMINI_ROOM_CLASSIFICATION_PROMPT = `You are classifying one room crop from a floor plan.
Use the room crop as primary evidence and the full plan as context.
Return EXACTLY one JSON object with:
{
  "type": "bedroom|kitchen|bathroom|living_room|dining_room|study|storage|balcony|corridor|other",
  "name": "string",
  "areaSqft": number,
  "confidence": number,
  "dimensions": { "width": number, "length": number, "unit": "ft" }
}
Rules:
- confidence is 0..1.
- If uncertain, use type "other".
- Return only JSON, no markdown.`;

class ConfigError extends Error {}

type GeminiAuthConfig = {
  endpoint: string;
  model: string;
  headers: Record<string, string>;
};

type SamAuthConfig = {
  endpoint: string;
  model: string;
  headers: Record<string, string>;
};

type SegmentedRoom = {
  id: string;
  polygon: Array<{ x: number; y: number }>;
  bbox: { x: number; y: number; width: number; height: number };
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

function polygonToBbox(points: Array<{ x: number; y: number }>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  return {
    x: Math.floor(xMin),
    y: Math.floor(yMin),
    width: Math.max(1, Math.ceil(xMax - xMin)),
    height: Math.max(1, Math.ceil(yMax - yMin)),
  };
}

function normalizeSegmentedRoom(index: number, room: unknown): SegmentedRoom | null {
  if (!room || typeof room !== "object") return null;

  const source = room as {
    id?: unknown;
    polygon?: unknown[];
    points?: unknown[];
    bbox?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  };

  const rawPolygon = Array.isArray(source.polygon)
    ? source.polygon
    : Array.isArray(source.points)
      ? source.points
      : [];

  const polygon = rawPolygon
    .map(normalizePoint)
    .filter((point): point is NonNullable<typeof point> => Boolean(point));

  if (polygon.length < 3) return null;

  const computedBbox = polygonToBbox(polygon);
  const bbox = source.bbox && typeof source.bbox === "object"
    ? {
        x: Number(source.bbox.x),
        y: Number(source.bbox.y),
        width: Number(source.bbox.width),
        height: Number(source.bbox.height),
      }
    : computedBbox;

  const hasValidBbox =
    Number.isFinite(bbox.x) &&
    Number.isFinite(bbox.y) &&
    Number.isFinite(bbox.width) &&
    Number.isFinite(bbox.height) &&
    bbox.width > 0 &&
    bbox.height > 0;

  return {
    id: typeof source.id === "string" && source.id ? source.id : `room_${index + 1}`,
    polygon,
    bbox: hasValidBbox ? bbox : computedBbox,
  };
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

async function resolveGeminiAuthConfig(modelOverride?: string): Promise<GeminiAuthConfig> {
  const model = modelOverride ?? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
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

function resolveSamAuthConfig(): SamAuthConfig {
  const endpoint = process.env.SAM3_ENDPOINT;
  const model = process.env.SAM3_MODEL ?? "sam-3";
  const apiKey = process.env.SAM3_API_KEY;

  if (!endpoint) {
    throw new ConfigError("SAM3_ENDPOINT is required for ANALYZE_PIPELINE_MODE=sam_gemini");
  }

  return {
    endpoint,
    model,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

async function extractRoomsWithSam(fileBuffer: Buffer, mimeType: string): Promise<{ model: string; rooms: SegmentedRoom[] }> {
  if (!mimeType.startsWith("image/")) {
    throw new Error("SAM workflow supports PNG/JPG only. Please upload an image file.");
  }

  const { endpoint, model, headers } = resolveSamAuthConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt: SAM_SEGMENT_PROMPT,
      image: {
        mimeType,
        data: fileBuffer.toString("base64"),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SAM request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    rooms?: unknown[];
    polygons?: unknown[];
    segments?: unknown[];
    floorPlan?: { rooms?: unknown[] };
  };

  const candidates = Array.isArray(payload.rooms)
    ? payload.rooms
    : Array.isArray(payload.polygons)
      ? payload.polygons
      : Array.isArray(payload.segments)
        ? payload.segments
        : Array.isArray(payload.floorPlan?.rooms)
          ? payload.floorPlan.rooms
          : [];

  const rooms = candidates
    .map((room, index) => normalizeSegmentedRoom(index, room))
    .filter((room): room is SegmentedRoom => Boolean(room));

  if (rooms.length === 0) {
    throw new Error("SAM segmentation returned no valid room polygons");
  }

  return { model, rooms };
}

async function cropPolygon(fileBuffer: Buffer, polygon: Array<{ x: number; y: number }>) {
  const bbox = polygonToBbox(polygon);
  const shifted = polygon.map((point) => ({ x: point.x - bbox.x, y: point.y - bbox.y }));
  const points = shifted.map((point) => `${point.x},${point.y}`).join(" ");
  const svgMask = Buffer.from(
    `<svg width="${bbox.width}" height="${bbox.height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${points}" fill="white"/></svg>`,
    "utf8"
  );

  const buffer = await sharp(fileBuffer)
    .extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height })
    .ensureAlpha()
    .composite([{ input: svgMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return { buffer, bbox };
}

async function classifyRoomWithGemini(args: {
  fullPlanBuffer: Buffer;
  fullPlanMimeType: string;
  roomCropBuffer: Buffer;
  roomId: string;
  roomIndex: number;
  bbox: { x: number; y: number; width: number; height: number };
}) {
  const model = process.env.GEMINI_CLASSIFIER_MODEL ?? "gemini-3.1-pro";
  const { endpoint, headers } = await resolveGeminiAuthConfig(model);

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${GEMINI_ROOM_CLASSIFICATION_PROMPT}
Room metadata:
- roomId: ${args.roomId}
- roomIndex: ${args.roomIndex}
- roomBBox: x=${args.bbox.x}, y=${args.bbox.y}, width=${args.bbox.width}, height=${args.bbox.height}`,
            },
            {
              inlineData: {
                mimeType: args.roomCropBuffer.length > 0 ? "image/png" : args.fullPlanMimeType,
                data: (args.roomCropBuffer.length > 0 ? args.roomCropBuffer : args.fullPlanBuffer).toString("base64"),
              },
            },
            {
              inlineData: {
                mimeType: args.fullPlanMimeType,
                data: args.fullPlanBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          required: ["type", "name", "areaSqft", "confidence", "dimensions"],
          properties: {
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
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini room classification failed (${response.status}): ${body.slice(0, 500)}`);
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
    type?: unknown;
    name?: unknown;
    areaSqft?: unknown;
    confidence?: unknown;
    dimensions?: { width?: unknown; length?: unknown; unit?: unknown };
  };

  return {
    model,
    type: typeof parsed.type === "string" ? parsed.type.toLowerCase().replace(/\s+/g, "_") : "other",
    name: typeof parsed.name === "string" && parsed.name ? parsed.name : `Room ${args.roomIndex + 1}`,
    areaSqft: Number.isFinite(Number(parsed.areaSqft)) ? Math.max(0, Number(parsed.areaSqft)) : 0,
    confidence: Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0,
    dimensions: {
      width: Number.isFinite(Number(parsed.dimensions?.width)) ? Number(parsed.dimensions?.width) : 0,
      length: Number.isFinite(Number(parsed.dimensions?.length)) ? Number(parsed.dimensions?.length) : 0,
      unit: parsed.dimensions?.unit === "m" ? ("m" as const) : ("ft" as const),
    },
  };
}

async function analyzeWithSamGemini(fileBuffer: Buffer, mimeType: string): Promise<AnalysisResult> {
  const { model: samModel, rooms: segmentedRooms } = await extractRoomsWithSam(fileBuffer, mimeType);
  const detectedRooms: DetectedRoom[] = [];

  for (let index = 0; index < segmentedRooms.length; index += 1) {
    const segmented = segmentedRooms[index];
    const crop = await cropPolygon(fileBuffer, segmented.polygon);
    const classified = await classifyRoomWithGemini({
      fullPlanBuffer: fileBuffer,
      fullPlanMimeType: mimeType,
      roomCropBuffer: crop.buffer,
      roomId: segmented.id,
      roomIndex: index,
      bbox: segmented.bbox,
    });

    detectedRooms.push({
      id: segmented.id,
      type: classified.type,
      name: classified.name,
      areaSqft: classified.areaSqft,
      confidence: classified.confidence,
      dimensions: classified.dimensions,
      polygon: segmented.polygon,
      bbox: segmented.bbox,
      sourceModel: `${samModel}+${classified.model}`,
    });
  }

  const totalAreaSqft = detectedRooms.reduce((sum, room) => sum + room.areaSqft, 0);
  const confidence = detectedRooms.length
    ? detectedRooms.reduce((sum, room) => sum + (room.confidence ?? 0), 0) / detectedRooms.length
    : 0;

  return {
    rooms: detectedRooms,
    totalAreaSqft,
    confidence,
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
    const body = (await request.json()) as { fileUrl?: string; projectId?: string };
    if (!body.fileUrl) {
      return Response.json({ error: "fileUrl is required" }, { status: 400 });
    }

    const { fileBuffer, mimeType } = await readUpload(body.fileUrl);
    const mode = process.env.ANALYZE_PIPELINE_MODE ?? "sam_gemini";

    let result: AnalysisResult;
    if (mode === "legacy_claude") {
      result = await analyzeLegacyWithClaude(fileBuffer, mimeType);
    } else if (mode === "sam_gemini") {
      try {
        result = await analyzeWithSamGemini(fileBuffer, mimeType);
      } catch (error) {
        if (error instanceof ConfigError && isEnabled(process.env.ANALYZE_ALLOW_LEGACY_FALLBACK)) {
          result = await analyzeLegacyWithClaude(fileBuffer, mimeType);
        } else {
          throw error;
        }
      }
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

    // Persist rooms to DB if projectId provided
    if (body.projectId) {
      try {
        await prisma.room.deleteMany({ where: { projectId: body.projectId } });
        await prisma.room.createMany({
          data: result.rooms.map((room, i) => ({
            projectId: body.projectId!,
            label: room.name,
            roomType: room.type,
            boundingBox: room.boundingBox ?? room.bbox ?? undefined,
            areaSqft: room.areaSqft,
            dimensions: room.dimensions ?? undefined,
            sortOrder: i,
          })),
        });
      } catch (e) {
        console.error("Failed to persist rooms:", e);
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
