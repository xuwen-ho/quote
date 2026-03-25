import { prisma } from "@/lib/prisma";
import { buildQuotationSummary } from "@/lib/quotation";
import type { DetectedRoom, GenerateQuoteRequest, GenerateQuoteResponse, RateItem } from "@/lib/types";

async function resolveRates(inputRates?: RateItem[]): Promise<RateItem[]> {
  if (Array.isArray(inputRates) && inputRates.length > 0) {
    return inputRates;
  }

  const defaults = await prisma.defaultRate.findMany({
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  });

  return defaults.map((rate) => ({
    category: rate.category,
    itemName: rate.itemName,
    unitCost: rate.unitCost,
    unit: rate.unit,
    description: rate.description ?? undefined,
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateQuoteRequest;

    // Load persisted rooms from project if none provided
    let rooms = body.rooms;
    if ((!Array.isArray(rooms) || rooms.length === 0) && body.projectId) {
      const dbRooms = await prisma.room.findMany({
        where: { projectId: body.projectId },
        orderBy: { sortOrder: "asc" },
      });
      rooms = dbRooms.map((r): DetectedRoom => ({
        id: r.id,
        type: r.roomType ?? "other",
        name: r.label,
        areaSqft: r.areaSqft ?? 0,
        dimensions: (r.dimensions as { width: number; length: number; unit: "ft" | "m" }) ?? {
          width: 0,
          length: 0,
          unit: "ft",
        },
      }));
    }

    if (!Array.isArray(rooms) || rooms.length === 0) {
      return Response.json(
        { error: "rooms array is required (or provide projectId with persisted rooms)" },
        { status: 400 }
      );
    }

    const rates = await resolveRates(body.rates);
    const summary = buildQuotationSummary({
      rooms,
      rates,
      margin: body.margin,
    });

    let quoteId: string | undefined;
    if (body.projectId) {
      const quote = await prisma.quote.create({
        data: {
          projectId: body.projectId,
          rooms: JSON.parse(JSON.stringify(rooms)),
          rates: JSON.parse(JSON.stringify(rates)),
          margin: summary.margin,
          totalAmount: summary.grandTotal,
        },
      });
      quoteId = quote.id;
    }

    const response: GenerateQuoteResponse = { quoteId, summary };
    return Response.json(response);
  } catch (error) {
    console.error("Quote generation error:", error);
    return Response.json(
      { error: "Failed to generate quotation" },
      { status: 500 }
    );
  }
}
