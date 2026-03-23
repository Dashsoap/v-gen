import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProjectAuth, isErrorResponse } from "@/lib/api-auth";
import { createTask } from "@/lib/task/service";
import { TaskType } from "@/lib/task/types";
import { apiHandler } from "@/lib/api-errors";

export const POST = apiHandler(async (req: NextRequest, ctx) => {
  const { projectId } = await ctx.params;
  const auth = await requireProjectAuth(projectId);
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const { type, panelId, candidateCount, imageModel, videoModel } = body;

  if (panelId) {
    // Single panel generation
    const taskType = type === "video" ? TaskType.GENERATE_PANEL_VIDEO : TaskType.GENERATE_PANEL_IMAGE;
    const taskId = await createTask({
      userId: auth.session.user.id,
      projectId,
      type: taskType,
      data: { projectId, panelId, candidateCount, imageModel, videoModel },
    });
    return NextResponse.json({ taskId }, { status: 201 });
  }

  // Batch generation — create a task for each panel
  const panels = await prisma.panel.findMany({
    where: {
      clip: {
        episode: { projectId },
      },
    },
    select: { id: true, imageUrl: true, videoUrl: true },
    orderBy: { sortOrder: "asc" },
  });

  const taskIds: string[] = [];

  if (type === "video") {
    // Generate video for panels that have images but no video
    const targetPanels = panels.filter((p) => p.imageUrl && !p.videoUrl);
    for (const panel of targetPanels) {
      const taskId = await createTask({
        userId: auth.session.user.id,
        projectId,
        type: TaskType.GENERATE_PANEL_VIDEO,
        data: { projectId, panelId: panel.id, videoModel },
      });
      taskIds.push(taskId);
    }
  } else if (type === "voice") {
    // Generate voice lines for all panels that have voice lines
    const panelsWithVoice = await prisma.panel.findMany({
      where: {
        clip: { episode: { projectId } },
        voiceLines: { some: { audioUrl: null } },
      },
      select: { id: true },
    });
    for (const panel of panelsWithVoice) {
      const taskId = await createTask({
        userId: auth.session.user.id,
        projectId,
        type: TaskType.GENERATE_VOICE_LINE,
        data: { projectId, panelId: panel.id },
      });
      taskIds.push(taskId);
    }
  } else {
    // Generate images for panels that don't have images
    const targetPanels = panels.filter((p) => !p.imageUrl);
    for (const panel of targetPanels) {
      const taskId = await createTask({
        userId: auth.session.user.id,
        projectId,
        type: TaskType.GENERATE_PANEL_IMAGE,
        data: { projectId, panelId: panel.id, candidateCount, imageModel },
      });
      taskIds.push(taskId);
    }
  }

  return NextResponse.json({ taskIds, count: taskIds.length }, { status: 201 });
});
