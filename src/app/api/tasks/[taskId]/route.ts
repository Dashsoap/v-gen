import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { cancelTask } from "@/lib/task/service";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const { taskId } = await ctx.params;
  const task = await prisma.task.findFirst({
    where: { id: taskId, userId: auth.user.id },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
});

export const DELETE = apiHandler(async (req: NextRequest, ctx) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const { taskId } = await ctx.params;
  const result = await cancelTask(taskId, auth.user.id);
  if (!result.cancelled) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ cancelled: true });
});
