import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { dismissFailedTasks } from "@/lib/task/service";
import { apiHandler } from "@/lib/api-errors";

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const { taskIds } = await req.json();
  if (!Array.isArray(taskIds)) {
    return NextResponse.json({ error: "taskIds must be an array" }, { status: 400 });
  }

  const count = await dismissFailedTasks(taskIds, auth.user.id);
  return NextResponse.json({ dismissed: count });
});
