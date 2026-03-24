import { prisma } from "@/lib/prisma";
import type {
  DetectedRoom,
  RateItem,
  QuotationLineItem,
  QuotationSummary,
} from "@/lib/types";

interface GenerateBody {
  rooms: DetectedRoom[];
  customRates?: RateItem[];
  margin?: number;
  projectId?: string;
}

// Maps room types to default renovation items
const ROOM_DEFAULTS: Record<string, { category: string; itemName: string; qtyMultiplier: string }[]> = {
  bedroom: [
    { category: "flooring", itemName: "Vinyl Flooring", qtyMultiplier: "area" },
    { category: "painting", itemName: "Wall Paint (Standard)", qtyMultiplier: "wallArea" },
    { category: "painting", itemName: "Ceiling Paint", qtyMultiplier: "area" },
    { category: "electrical", itemName: "Power Point", qtyMultiplier: "fixed:4" },
    { category: "electrical", itemName: "Light Point", qtyMultiplier: "fixed:2" },
    { category: "fixtures", itemName: "Door (Bedroom)", qtyMultiplier: "fixed:1" },
  ],
  kitchen: [
    { category: "flooring", itemName: "Ceramic Tiles", qtyMultiplier: "area" },
    { category: "painting", itemName: "Wall Paint (Standard)", qtyMultiplier: "wallArea" },
    { category: "plumbing", itemName: "Water Point", qtyMultiplier: "fixed:2" },
    { category: "plumbing", itemName: "Drainage Point", qtyMultiplier: "fixed:1" },
    { category: "electrical", itemName: "Power Point", qtyMultiplier: "fixed:6" },
    { category: "electrical", itemName: "LED Downlight", qtyMultiplier: "fixed:4" },
    { category: "carpentry", itemName: "Kitchen Cabinet (Top)", qtyMultiplier: "perimeter:0.4" },
    { category: "carpentry", itemName: "Kitchen Cabinet (Bottom)", qtyMultiplier: "perimeter:0.5" },
    { category: "fixtures", itemName: "Kitchen Sink", qtyMultiplier: "fixed:1" },
    { category: "general", itemName: "Waterproofing", qtyMultiplier: "area" },
  ],
  bathroom: [
    { category: "flooring", itemName: "Ceramic Tiles", qtyMultiplier: "area" },
    { category: "painting", itemName: "Ceiling Paint", qtyMultiplier: "area" },
    { category: "plumbing", itemName: "Water Point", qtyMultiplier: "fixed:2" },
    { category: "plumbing", itemName: "Drainage Point", qtyMultiplier: "fixed:1" },
    { category: "plumbing", itemName: "Toilet Bowl", qtyMultiplier: "fixed:1" },
    { category: "plumbing", itemName: "Basin + Tap", qtyMultiplier: "fixed:1" },
    { category: "electrical", itemName: "Light Point", qtyMultiplier: "fixed:1" },
    { category: "fixtures", itemName: "Shower Set", qtyMultiplier: "fixed:1" },
    { category: "fixtures", itemName: "Door (Bathroom)", qtyMultiplier: "fixed:1" },
    { category: "general", itemName: "Waterproofing", qtyMultiplier: "area" },
    { category: "general", itemName: "Hacking (Wall)", qtyMultiplier: "wallArea" },
    { category: "general", itemName: "Hacking (Floor)", qtyMultiplier: "area" },
  ],
  living_room: [
    { category: "flooring", itemName: "Vinyl Flooring", qtyMultiplier: "area" },
    { category: "painting", itemName: "Wall Paint (Standard)", qtyMultiplier: "wallArea" },
    { category: "painting", itemName: "Feature Wall", qtyMultiplier: "featureWall" },
    { category: "painting", itemName: "Ceiling Paint", qtyMultiplier: "area" },
    { category: "electrical", itemName: "Power Point", qtyMultiplier: "fixed:6" },
    { category: "electrical", itemName: "Light Point", qtyMultiplier: "fixed:3" },
    { category: "electrical", itemName: "Ceiling Fan Point", qtyMultiplier: "fixed:1" },
    { category: "carpentry", itemName: "TV Console", qtyMultiplier: "fixed:8" },
  ],
  dining_room: [
    { category: "flooring", itemName: "Vinyl Flooring", qtyMultiplier: "area" },
    { category: "painting", itemName: "Wall Paint (Standard)", qtyMultiplier: "wallArea" },
    { category: "painting", itemName: "Ceiling Paint", qtyMultiplier: "area" },
    { category: "electrical", itemName: "Power Point", qtyMultiplier: "fixed:3" },
    { category: "electrical", itemName: "Light Point", qtyMultiplier: "fixed:2" },
  ],
  study: [
    { category: "flooring", itemName: "Vinyl Flooring", qtyMultiplier: "area" },
    { category: "painting", itemName: "Wall Paint (Standard)", qtyMultiplier: "wallArea" },
    { category: "electrical", itemName: "Power Point", qtyMultiplier: "fixed:4" },
    { category: "electrical", itemName: "Light Point", qtyMultiplier: "fixed:2" },
    { category: "carpentry", itemName: "Built-in Wardrobe", qtyMultiplier: "fixed:12" },
  ],
};

function calculateQuantity(
  multiplier: string,
  room: DetectedRoom
): number {
  const { areaSqft, dimensions } = room;
  const perimeter = 2 * (dimensions.width + dimensions.length);
  const wallHeight = 9; // assume 9ft ceiling
  const wallArea = perimeter * wallHeight;

  if (multiplier === "area") return Math.ceil(areaSqft);
  if (multiplier === "wallArea") return Math.ceil(wallArea);
  if (multiplier === "featureWall") return Math.ceil(dimensions.length * wallHeight);
  if (multiplier.startsWith("fixed:")) return parseFloat(multiplier.split(":")[1]);
  if (multiplier.startsWith("perimeter:")) {
    const factor = parseFloat(multiplier.split(":")[1]);
    return Math.ceil(perimeter * factor);
  }
  return 1;
}

export async function POST(request: Request) {
  try {
    const body: GenerateBody = await request.json();
    const { rooms, customRates, margin = 0.1, projectId } = body;

    if (!rooms || rooms.length === 0) {
      return Response.json({ error: "rooms array is required" }, { status: 400 });
    }

    // Fetch default rates from DB
    const defaultRates = await prisma.defaultRate.findMany();
    const rateMap = new Map<string, RateItem>();
    for (const r of defaultRates) {
      rateMap.set(`${r.category}:${r.itemName}`, r);
    }

    // Apply custom rate overrides
    if (customRates) {
      for (const cr of customRates) {
        rateMap.set(`${cr.category}:${cr.itemName}`, cr);
      }
    }

    const lineItems: QuotationLineItem[] = [];

    for (const room of rooms) {
      const roomType = room.type.toLowerCase().replace(/\s+/g, "_");
      const items = ROOM_DEFAULTS[roomType] || ROOM_DEFAULTS["bedroom"] || [];

      for (const item of items) {
        const rate = rateMap.get(`${item.category}:${item.itemName}`);
        if (!rate) continue;

        const quantity = calculateQuantity(item.qtyMultiplier, room);
        const totalCost = quantity * rate.unitCost;

        lineItems.push({
          category: item.category,
          itemName: item.itemName,
          quantity,
          unit: rate.unit,
          unitCost: rate.unitCost,
          totalCost: Math.round(totalCost * 100) / 100,
          room: room.name,
        });
      }
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.totalCost, 0);
    const marginAmount = subtotal * margin;
    const grandTotal = subtotal + marginAmount;

    const summary: QuotationSummary = {
      lineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      margin,
      marginAmount: Math.round(marginAmount * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };

    // Persist quote if projectId provided
    if (projectId) {
      await prisma.quote.create({
        data: {
          projectId,
          rooms: JSON.parse(JSON.stringify(rooms)),
          rates: JSON.parse(JSON.stringify(Object.fromEntries(rateMap))),
          margin,
          totalAmount: summary.grandTotal,
        },
      });
    }

    return Response.json(summary);
  } catch (error) {
    console.error("Quote generation error:", error);
    return Response.json(
      { error: "Failed to generate quotation" },
      { status: 500 }
    );
  }
}
