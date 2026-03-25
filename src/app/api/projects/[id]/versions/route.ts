import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const versions = await prisma.layoutVersion.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json(versions);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, furniture } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }
  if (!Array.isArray(furniture)) {
    return NextResponse.json(
      { error: "furniture must be an array" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const version = await prisma.layoutVersion.create({
    data: {
      projectId: id,
      name,
      data: furniture,
    },
  });

  // Also save as current layout
  await prisma.project.update({
    where: { id },
    data: { roomData: furniture },
  });

  return NextResponse.json({
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
  });
}
