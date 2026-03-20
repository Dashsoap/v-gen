import { NextRequest, NextResponse } from "next/server";
import { requireProjectAuth, isErrorResponse } from "@/lib/api-auth";
import { createTask } from "@/lib/task/service";
import { TaskType } from "@/lib/task/types";
import { apiHandler } from "@/lib/api-errors";

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { projectId } = await ctx.params;
  const auth = await requireProjectAuth(projectId);
  if (isErrorResponse(auth)) return auth;

  const taskId = await createTask({
    userId: auth.session.user.id,
    projectId,
    type: TaskType.GENERATE_STORYBOARD,
    data: { projectId },
  });

  return NextResponse.json({ taskId }, { status: 201 });
});
