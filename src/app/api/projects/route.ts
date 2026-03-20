import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async () => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const projects = await prisma.project.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { episodes: true, tasks: true } },
    },
  });

  return NextResponse.json(projects);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const { title, aspectRatio, style } = await req.json();

  const project = await prisma.project.create({
    data: {
      userId: auth.user.id,
      title: title || "Untitled Project",
      aspectRatio: aspectRatio || "16:9",
      style: style || "realistic",
    },
  });

  return NextResponse.json(project, { status: 201 });
});
