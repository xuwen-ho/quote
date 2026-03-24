import { prisma } from "@/lib/prisma";
import { getUserId, getUserIdFromRequest } from "@/lib/auth";
import type { RateOverrideInput } from "@/lib/types";

function mergeRates(defaultRates: Awaited<ReturnType<typeof prisma.defaultRate.findMany>>, customRates: Awaited<ReturnType<typeof prisma.customRate.findMany>>) {
  const customMap = new Map(
    customRates.map((rate) => [`${rate.category}:${rate.itemName}`, rate])
  );

  return defaultRates.map((rate) => {
    const override = customMap.get(`${rate.category}:${rate.itemName}`);
    if (!override) return rate;

    return {
      ...rate,
      unitCost: override.unitCost,
      unit: override.unit,
      source: "custom" as const,
    };
  });
}

export async function GET(request: Request) {
  try {
    const userId = (await getUserId()) ?? getUserIdFromRequest(request);
    const defaultRates = await prisma.defaultRate.findMany({
      orderBy: [{ category: "asc" }, { itemName: "asc" }],
    });

    if (!userId) {
      return Response.json({ rates: defaultRates });
    }

    const customRates = await prisma.customRate.findMany({
      where: { userId },
      orderBy: [{ category: "asc" }, { itemName: "asc" }],
    });

    return Response.json({ rates: mergeRates(defaultRates, customRates) });
  } catch (error) {
    console.error("Rates fetch error:", error);
    return Response.json(
      { error: "Failed to fetch rates" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = (await getUserId()) ?? getUserIdFromRequest(request);
    if (!userId) {
      return Response.json(
        { error: "Authentication required. Sign in to save custom rates." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { rates?: RateOverrideInput[] };
    if (!Array.isArray(body.rates) || body.rates.length === 0) {
      return Response.json(
        { error: "rates array is required" },
        { status: 400 }
      );
    }

    for (const rate of body.rates) {
      if (
        !rate.category ||
        !rate.itemName ||
        typeof rate.unit !== "string" ||
        typeof rate.unitCost !== "number" ||
        Number.isNaN(rate.unitCost) ||
        rate.unitCost < 0
      ) {
        return Response.json(
          { error: "Each rate must include category, itemName, unit, unitCost" },
          { status: 400 }
        );
      }
    }

    const upserts = body.rates.map((rate) =>
      prisma.customRate.upsert({
        where: {
          userId_category_itemName: {
            userId,
            category: rate.category,
            itemName: rate.itemName,
          },
        },
        update: {
          unit: rate.unit,
          unitCost: rate.unitCost,
        },
        create: {
          userId,
          category: rate.category,
          itemName: rate.itemName,
          unit: rate.unit,
          unitCost: rate.unitCost,
        },
      })
    );

    await prisma.$transaction(upserts);

    const customRates = await prisma.customRate.findMany({
      where: { userId },
      orderBy: [{ category: "asc" }, { itemName: "asc" }],
    });

    return Response.json({ rates: customRates });
  } catch (error) {
    console.error("Rates update error:", error);
    return Response.json(
      { error: "Failed to update rates" },
      { status: 500 }
    );
  }
}
