import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, furnitureData: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    projectId: project.id,
    name: project.name,
    furniture: project.furnitureData,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { furniture } = body;

  if (!Array.isArray(furniture)) {
    return NextResponse.json(
      { error: "furniture must be an array" },
      { status: 400 }
    );
  }

  const project = await prisma.project.update({
    where: { id },
    data: { furnitureData: furniture },
    select: { id: true, name: true, updatedAt: true },
  });

  return NextResponse.json({
    projectId: project.id,
    name: project.name,
    savedAt: project.updatedAt,
  });
}
