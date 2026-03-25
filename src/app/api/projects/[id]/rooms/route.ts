import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rooms = await prisma.room.findMany({
    where: { projectId: id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(rooms);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { rooms } = body;

  if (!Array.isArray(rooms)) {
    return NextResponse.json(
      { error: "rooms must be an array" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Upsert: delete existing rooms and create new ones
  await prisma.room.deleteMany({ where: { projectId: id } });

  const data: Prisma.RoomCreateManyInput[] = rooms.map(
    (
      r: {
        label: string;
        roomType?: string;
        boundingBox?: Record<string, number>;
        areaSqft?: number;
        dimensions?: { width: number; length: number; unit: string };
      },
      i: number
    ) => {
      const entry: Prisma.RoomCreateManyInput = {
        projectId: id,
        label: r.label,
        sortOrder: i,
      };
      if (r.roomType) entry.roomType = r.roomType;
      if (r.boundingBox) entry.boundingBox = r.boundingBox;
      if (r.areaSqft != null) entry.areaSqft = r.areaSqft;
      if (r.dimensions) entry.dimensions = r.dimensions;
      return entry;
    }
  );

  await prisma.room.createMany({ data });

  const saved = await prisma.room.findMany({
    where: { projectId: id },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(saved, { status: 201 });
}
