import { prisma } from "@/lib/prisma";
import { buildQuotationSummary } from "@/lib/quotation";
import type { GenerateQuoteRequest, GenerateQuoteResponse, RateItem } from "@/lib/types";

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
    if (!Array.isArray(body.rooms) || body.rooms.length === 0) {
      return Response.json(
        { error: "rooms array is required" },
        { status: 400 }
      );
    }

    const rates = await resolveRates(body.rates);
    const summary = buildQuotationSummary({
      rooms: body.rooms,
      rates,
      margin: body.margin,
    });

    let quoteId: string | undefined;
    if (body.projectId) {
      const quote = await prisma.quote.create({
        data: {
          projectId: body.projectId,
          rooms: JSON.parse(JSON.stringify(body.rooms)),
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
