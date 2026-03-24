import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const defaultRates = [
  // Flooring
  { category: "flooring", itemName: "Vinyl Flooring", unitCost: 8, unit: "sqft", description: "Standard vinyl plank installation" },
  { category: "flooring", itemName: "Ceramic Tiles", unitCost: 12, unit: "sqft", description: "Standard ceramic tile with grout" },
  { category: "flooring", itemName: "Hardwood Flooring", unitCost: 18, unit: "sqft", description: "Engineered hardwood installation" },
  { category: "flooring", itemName: "Laminate Flooring", unitCost: 6, unit: "sqft", description: "Laminate plank installation" },

  // Painting
  { category: "painting", itemName: "Wall Paint (Standard)", unitCost: 3.5, unit: "sqft", description: "Two coats of emulsion paint" },
  { category: "painting", itemName: "Ceiling Paint", unitCost: 4, unit: "sqft", description: "White ceiling paint, two coats" },
  { category: "painting", itemName: "Feature Wall", unitCost: 6, unit: "sqft", description: "Accent wall with premium paint" },

  // Electrical
  { category: "electrical", itemName: "Power Point", unitCost: 85, unit: "point", description: "Standard power outlet installation" },
  { category: "electrical", itemName: "Light Point", unitCost: 75, unit: "point", description: "Ceiling light point with wiring" },
  { category: "electrical", itemName: "Ceiling Fan Point", unitCost: 120, unit: "point", description: "Fan point with bracket and wiring" },
  { category: "electrical", itemName: "LED Downlight", unitCost: 45, unit: "unit", description: "Recessed LED downlight" },

  // Plumbing
  { category: "plumbing", itemName: "Water Point", unitCost: 150, unit: "point", description: "Hot/cold water point" },
  { category: "plumbing", itemName: "Drainage Point", unitCost: 180, unit: "point", description: "Floor trap or drainage installation" },
  { category: "plumbing", itemName: "Toilet Bowl", unitCost: 350, unit: "unit", description: "Standard toilet bowl supply and install" },
  { category: "plumbing", itemName: "Basin + Tap", unitCost: 280, unit: "unit", description: "Wash basin with mixer tap" },

  // Carpentry
  { category: "carpentry", itemName: "Built-in Wardrobe", unitCost: 180, unit: "sqft", description: "Floor-to-ceiling wardrobe with doors" },
  { category: "carpentry", itemName: "Kitchen Cabinet (Top)", unitCost: 150, unit: "ft", description: "Wall-mounted kitchen cabinet per running foot" },
  { category: "carpentry", itemName: "Kitchen Cabinet (Bottom)", unitCost: 200, unit: "ft", description: "Base kitchen cabinet per running foot" },
  { category: "carpentry", itemName: "Shoe Cabinet", unitCost: 120, unit: "sqft", description: "Entryway shoe cabinet" },
  { category: "carpentry", itemName: "TV Console", unitCost: 160, unit: "sqft", description: "Custom TV console unit" },

  // Fixtures
  { category: "fixtures", itemName: "Shower Set", unitCost: 250, unit: "unit", description: "Rain shower with mixer" },
  { category: "fixtures", itemName: "Kitchen Sink", unitCost: 320, unit: "unit", description: "Stainless steel sink with tap" },
  { category: "fixtures", itemName: "Door (Bedroom)", unitCost: 280, unit: "unit", description: "Solid core bedroom door" },
  { category: "fixtures", itemName: "Door (Bathroom)", unitCost: 220, unit: "unit", description: "Aluminium bathroom door" },

  // General
  { category: "general", itemName: "Hacking (Wall)", unitCost: 5, unit: "sqft", description: "Wall tile or plaster hacking" },
  { category: "general", itemName: "Hacking (Floor)", unitCost: 6, unit: "sqft", description: "Floor tile hacking and disposal" },
  { category: "general", itemName: "Waterproofing", unitCost: 8, unit: "sqft", description: "Bathroom/kitchen waterproofing membrane" },
  { category: "general", itemName: "Debris Disposal", unitCost: 300, unit: "trip", description: "Debris removal per truck load" },
];

async function main() {
  console.log("Seeding default rates...");

  for (const rate of defaultRates) {
    await prisma.defaultRate.upsert({
      where: { category_itemName: { category: rate.category, itemName: rate.itemName } },
      update: { unitCost: rate.unitCost, unit: rate.unit, description: rate.description },
      create: rate,
    });
  }

  console.log(`Seeded ${defaultRates.length} default rates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
