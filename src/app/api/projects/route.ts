import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

export async function POST(req: Request) {
  const userId = await getUserId();
  const body = await req.json();
  const { name, furniture } = body;

  const project = await prisma.project.create({
    data: {
      userId: userId ?? undefined,
      name: name || "Untitled Project",
      roomData: Array.isArray(furniture) ? furniture : undefined,
    },
  });

  return NextResponse.json({ id: project.id, name: project.name });
}
