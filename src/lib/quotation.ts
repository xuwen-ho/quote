import type {
  DetectedRoom,
  QuotationLineItem,
  QuotationSummary,
  RateItem,
} from "@/lib/types";

const DEFAULT_MARGIN = 0.1;

const ROOM_KEYWORDS: Record<string, string[]> = {
  bedroom: ["wardrobe", "door (bedroom)"],
  bathroom: ["toilet", "basin", "shower", "waterproofing", "door (bathroom)"],
  kitchen: ["kitchen cabinet", "kitchen sink", "waterproofing"],
  living_room: ["tv console"],
  study: ["desk", "study"],
};

function normalizeMargin(input?: number): number {
  if (typeof input !== "number" || Number.isNaN(input)) {
    return DEFAULT_MARGIN;
  }

  if (input < 0) return 0;
  if (input > 1) return 1;
  return input;
}

function estimateLinearFeet(areaSqft: number): number {
  if (areaSqft <= 0) return 0;

  // Approximate a near-square perimeter then apply a 75% factor for usable run length.
  const side = Math.sqrt(areaSqft);
  return Number((side * 4 * 0.75).toFixed(2));
}

function isRateApplicable(room: DetectedRoom, rate: RateItem): boolean {
  const roomType = room.type.toLowerCase();
  const itemName = rate.itemName.toLowerCase();
  const category = rate.category.toLowerCase();

  if (category === "general") return false;

  if (roomType in ROOM_KEYWORDS) {
    const keywords = ROOM_KEYWORDS[roomType];
    if (keywords.some((keyword) => itemName.includes(keyword))) {
      return true;
    }
  }

  if (["flooring", "painting", "electrical"].includes(category)) return true;
  if (category === "plumbing") return ["kitchen", "bathroom"].includes(roomType);

  return !["bathroom", "kitchen"].includes(roomType);
}

function quantityFromRate(room: DetectedRoom, rate: RateItem): number {
  const roomType = room.type.toLowerCase();
  const itemName = rate.itemName.toLowerCase();
  const area = room.areaSqft;

  switch (rate.unit) {
    case "sqft":
      return area;
    case "ft":
      return estimateLinearFeet(area);
    case "point":
      if (itemName.includes("light")) return Math.max(1, Math.ceil(area / 120));
      if (itemName.includes("power")) return Math.max(1, Math.ceil(area / 80));
      if (itemName.includes("fan")) {
        return ["bedroom", "living_room"].includes(roomType) ? 1 : 0;
      }
      if (itemName.includes("water") || itemName.includes("drainage")) {
        return ["kitchen", "bathroom"].includes(roomType) ? 1 : 0;
      }
      return 1;
    case "unit":
      if (itemName.includes("toilet")) return roomType === "bathroom" ? 1 : 0;
      if (itemName.includes("basin")) return roomType === "bathroom" ? 1 : 0;
      if (itemName.includes("shower")) return roomType === "bathroom" ? 1 : 0;
      if (itemName.includes("kitchen sink")) return roomType === "kitchen" ? 1 : 0;
      if (itemName.includes("door (bathroom)")) return roomType === "bathroom" ? 1 : 0;
      if (itemName.includes("door (bedroom)")) return roomType === "bedroom" ? 1 : 0;
      if (itemName.includes("downlight")) return Math.max(1, Math.ceil(area / 60));
      return 1;
    default:
      return 0;
  }
}

export function buildQuotationSummary(args: {
  rooms: DetectedRoom[];
  rates: RateItem[];
  margin?: number;
}): QuotationSummary {
  const { rooms, rates } = args;
  const margin = normalizeMargin(args.margin);
  const lineItems: QuotationLineItem[] = [];
  const totalArea = rooms.reduce((sum, room) => sum + room.areaSqft, 0);

  for (const room of rooms) {
    for (const rate of rates) {
      if (!isRateApplicable(room, rate)) continue;
      if (rate.unit === "trip") continue;

      const quantity = quantityFromRate(room, rate);
      if (quantity <= 0) continue;

      const totalCost = Number((quantity * rate.unitCost).toFixed(2));
      lineItems.push({
        category: rate.category,
        itemName: rate.itemName,
        quantity: Number(quantity.toFixed(2)),
        unit: rate.unit,
        unitCost: rate.unitCost,
        totalCost,
        room: room.name,
      });
    }
  }

  const debrisRate = rates.find((rate) => rate.unit === "trip");
  if (debrisRate) {
    const trips = Math.max(1, Math.ceil(totalArea / 1500));
    lineItems.push({
      category: debrisRate.category,
      itemName: debrisRate.itemName,
      quantity: trips,
      unit: debrisRate.unit,
      unitCost: debrisRate.unitCost,
      totalCost: Number((trips * debrisRate.unitCost).toFixed(2)),
    });
  }

  const subtotal = Number(
    lineItems.reduce((sum, lineItem) => sum + lineItem.totalCost, 0).toFixed(2)
  );
  const marginAmount = Number((subtotal * margin).toFixed(2));
  const grandTotal = Number((subtotal + marginAmount).toFixed(2));

  return {
    lineItems,
    subtotal,
    margin,
    marginAmount,
    grandTotal,
  };
}
