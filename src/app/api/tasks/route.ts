import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const projectId = req.nextUrl.searchParams.get("projectId");

  const tasks = await prisma.task.findMany({
    where: {
      userId: auth.user.id,
      ...(projectId && { projectId }),
      status: { notIn: ["dismissed"] },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(tasks);
});
