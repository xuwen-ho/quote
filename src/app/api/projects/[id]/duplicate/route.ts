import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const source = await prisma.project.findUnique({ where: { id } });

  if (!source) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const copy = await prisma.project.create({
    data: {
      userId: source.userId,
      name: `${source.name} (Copy)`,
      floorPlanUrl: source.floorPlanUrl,
      furnitureData: source.furnitureData ?? undefined,
    },
  });

  return NextResponse.json({
    id: copy.id,
    name: copy.name,
  });
}
