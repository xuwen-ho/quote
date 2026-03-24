import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const defaultRates = await prisma.defaultRate.findMany({
      orderBy: [{ category: "asc" }, { itemName: "asc" }],
    });

    return Response.json({ rates: defaultRates });
  } catch (error) {
    console.error("Rates fetch error:", error);
    return Response.json(
      { error: "Failed to fetch rates" },
      { status: 500 }
    );
  }
}
