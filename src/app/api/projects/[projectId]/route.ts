import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProjectAuth, isErrorResponse } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const { projectId } = await ctx.params;
  const auth = await requireProjectAuth(projectId);
  if (isErrorResponse(auth)) return auth;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      episodes: {
        orderBy: { sortOrder: "asc" },
        include: {
          clips: {
            orderBy: { sortOrder: "asc" },
            include: {
              panels: {
                orderBy: { sortOrder: "asc" },
                include: { voiceLines: true },
              },
            },
          },
          composition: true,
        },
      },
    },
  });

  return NextResponse.json(project);
});

export const PATCH = apiHandler(async (req: NextRequest, ctx) => {
  const { projectId } = await ctx.params;
  const auth = await requireProjectAuth(projectId);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const allowed = ["title", "description", "sourceVideoUrl", "analyzedText", "rewrittenText", "style", "aspectRatio", "status"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data,
  });

  return NextResponse.json(project);
});

export const DELETE = apiHandler(async (req: NextRequest, ctx) => {
  const { projectId } = await ctx.params;
  const auth = await requireProjectAuth(projectId);
  if (isErrorResponse(auth)) return auth;

  await prisma.project.delete({ where: { id: projectId } });
  return NextResponse.json({ deleted: true });
});
