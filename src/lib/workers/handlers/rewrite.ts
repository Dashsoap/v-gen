import { prisma } from "@/lib/prisma";
import { createLLMClient, chatCompletion } from "@/lib/llm/client";
import { resolveLlmConfig } from "@/lib/providers/resolve";
import { detectLanguage } from "@/lib/llm/language-detect";
import { REWRITE_SYSTEM, REWRITE_USER } from "@/lib/llm/prompts/rewrite";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "rewrite" });

export const handleRewrite = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, projectId } = payload;

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  if (!project.analyzedText) {
    throw new Error("Project has no analyzed text — run video analysis first");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "rewriting" },
  });

  await ctx.reportProgress(10);

  const language = detectLanguage(project.analyzedText);
  const llmCfg = await resolveLlmConfig(userId);
  const client = createLLMClient(llmCfg);

  await ctx.reportProgress(20);

  const rewrittenText = await chatCompletion(client, {
    model: llmCfg.model,
    systemPrompt: REWRITE_SYSTEM(language),
    userPrompt: REWRITE_USER(project.analyzedText, project.style),
  });

  await ctx.reportProgress(80);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      rewrittenText,
      status: "rewritten",
    },
  });

  logger.info("Rewrite complete", { projectId, textLength: rewrittenText.length });
  return { projectId, textLength: rewrittenText.length };
});
