import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import { join } from "path";
import type { AnalysisResult } from "@/lib/types";

const anthropic = new Anthropic();

const ANALYSIS_PROMPT = `You are an expert architectural floor plan analyzer. Analyze this floor plan image and extract the following information for each room:

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
}

Be as accurate as possible with dimensions. If you cannot determine exact dimensions, provide your best estimate and lower the confidence score. Include ALL visible rooms.`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fileUrl } = body as { fileUrl?: string };

    if (!fileUrl) {
      return Response.json({ error: "fileUrl is required" }, { status: 400 });
    }

    // Read the uploaded file
    const filePath = join(process.cwd(), "public", fileUrl);
    const fileBuffer = await readFile(filePath);
    const base64 = fileBuffer.toString("base64");

    // Determine media type
    const ext = fileUrl.split(".").pop()?.toLowerCase();
    let mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" =
      "image/png";
    if (ext === "jpg" || ext === "jpeg") mediaType = "image/jpeg";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    });

    // Extract JSON from response
    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return Response.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const result: AnalysisResult = JSON.parse(jsonMatch[0]);

    return Response.json(result);
  } catch (error) {
    console.error("Analysis error:", error);
    return Response.json(
      { error: "Floor plan analysis failed" },
      { status: 500 }
    );
  }
}
