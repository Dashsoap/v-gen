import { prisma } from "@/lib/prisma";
import { createLLMClient, chatCompletion } from "@/lib/llm/client";
import {
  STORYBOARD_PLAN_SYSTEM,
  STORYBOARD_PLAN_USER,
  CINEMATOGRAPHY_SYSTEM,
  CINEMATOGRAPHY_USER,
  ACTING_DIRECTION_SYSTEM,
  ACTING_DIRECTION_USER,
  STORYBOARD_DETAIL_SYSTEM,
  STORYBOARD_DETAIL_USER,
  VOICE_EXTRACT_SYSTEM,
  VOICE_EXTRACT_USER,
} from "@/lib/llm/prompts/generate-storyboard-text";
import { detectLanguage } from "@/lib/llm/language-detect";
import type { DetectedLanguage } from "@/lib/llm/language-detect";
import { resolveLlmConfig } from "@/lib/providers/resolve";
import { withTaskLifecycle } from "../shared";
import type { TaskPayload } from "@/lib/task/types";
import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "generate-storyboard" });

// ─── Interfaces ──────────────────────────────────────────────────────────

interface PlanPanel {
  panelNumber: number;
  description: string;
  characters?: Array<{ name: string; appearance?: string }>;
  location?: string;
  sceneType?: string;
  sourceText?: string;
  shotType?: string;
  cameraAngle?: string;
  cameraMove?: string;
  durationMs?: number;
}

interface PhotographyRule {
  panelNumber: number;
  lighting?: { direction?: string; quality?: string } | string;
  characters?: Array<{
    name: string;
    screenPosition?: string;
    posture?: string;
    facing?: string;
  }>;
  depthOfField?: string;
  colorTone?: string;
}

interface ActingDirection {
  panelNumber: number;
  characters?: Array<{ name: string; acting: string }>;
}

interface DetailPanel {
  panelNumber: number;
  description?: string;
  shotType?: string;
  cameraAngle?: string;
  cameraMove?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  durationMs?: number;
}

interface VoiceLineData {
  panelNumber: number;
  speaker: string;
  text: string;
  emotion?: string;
}

// ─── JSON parsing with retry ─────────────────────────────────────────────

async function parseJsonWithRetry<T>(
  raw: string,
  retryFn: () => Promise<string>,
): Promise<T> {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    logger.warn("JSON parse failed, retrying LLM call");
    const retryRaw = await retryFn();
    let retryCleaned = retryRaw.trim();
    retryCleaned = retryCleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
    return JSON.parse(retryCleaned);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────

export const handleGenerateStoryboard = withTaskLifecycle(async (payload: TaskPayload, ctx) => {
  const { userId, projectId } = payload;

  const llmCfg = await resolveLlmConfig(userId);
  const client = createLLMClient(llmCfg);
  const model = llmCfg.model;

  // Get all clips for the project
  const episodes = await prisma.episode.findMany({
    where: { projectId },
    include: { clips: { orderBy: { sortOrder: "asc" } } },
    orderBy: { sortOrder: "asc" },
  });

  // Detect language from project text
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const sampleText = episodes[0]?.clips[0]?.description || project?.rewrittenText || project?.analyzedText || "";
  const language: DetectedLanguage = detectLanguage(sampleText);
  logger.info("Detected language", { language });

  // Count total clips for progress tracking
  let totalClips = 0;
  for (const ep of episodes) totalClips += ep.clips.length;
  const totalSteps = totalClips * 4;
  let completedSteps = 0;

  await ctx.reportProgress(0, totalSteps);

  let totalPanelsCreated = 0;
  let totalVoiceLinesCreated = 0;

  for (const episode of episodes) {
    for (const clip of episode.clips) {
      const clipContent = clip.description || clip.title || "";
      const screenplay = clip.screenplay || null;

      // ── Phase 1: Storyboard Planning ─────────────────────
      logger.info("Phase 1: Planning storyboard", { clipId: clip.id });

      const callPlan = () =>
        chatCompletion(client, {
          model,
          systemPrompt: STORYBOARD_PLAN_SYSTEM(language),
          userPrompt: STORYBOARD_PLAN_USER(clipContent, screenplay, "", ""),
          responseFormat: "json",
        });

      const planResult = await callPlan();
      const planParsed = await parseJsonWithRetry<{ panels?: PlanPanel[] }>(planResult, callPlan);
      const planPanels: PlanPanel[] = (planParsed.panels || []).filter((p) => p.description);

      completedSteps++;
      await ctx.reportProgress(completedSteps, totalSteps);

      if (planPanels.length === 0) {
        logger.warn("Phase 1 produced no panels, skipping clip", { clipId: clip.id });
        completedSteps += 3;
        await ctx.reportProgress(completedSteps, totalSteps);
        continue;
      }

      const planPanelsJson = JSON.stringify(planPanels, null, 2);
      const panelCount = planPanels.length;

      // ── Phase 2a + 2b: Cinematography + Acting (parallel) ──
      logger.info("Phase 2: Cinematography + Acting (parallel)", { clipId: clip.id, panelCount });

      const callCinematography = () =>
        chatCompletion(client, {
          model,
          systemPrompt: CINEMATOGRAPHY_SYSTEM(language),
          userPrompt: CINEMATOGRAPHY_USER(planPanelsJson, "", "", panelCount),
          responseFormat: "json",
        });

      const callActing = () =>
        chatCompletion(client, {
          model,
          systemPrompt: ACTING_DIRECTION_SYSTEM(language),
          userPrompt: ACTING_DIRECTION_USER(planPanelsJson, "", panelCount),
          responseFormat: "json",
        });

      const [cinematographyResult, actingResult] = await Promise.all([
        callCinematography().then((raw) =>
          parseJsonWithRetry<{ rules?: PhotographyRule[] }>(raw, callCinematography),
        ),
        callActing().then((raw) =>
          parseJsonWithRetry<{ directions?: ActingDirection[] }>(raw, callActing),
        ),
      ]);

      const photographyRules: PhotographyRule[] = cinematographyResult.rules || [];
      const actingDirections: ActingDirection[] = actingResult.directions || [];

      completedSteps++;
      await ctx.reportProgress(completedSteps, totalSteps);

      // ── Phase 3: Detail Refinement + video_prompt ─────────
      logger.info("Phase 3: Detail refinement", { clipId: clip.id });

      const photographyJson = JSON.stringify(photographyRules, null, 2);
      const actingJson = JSON.stringify(actingDirections, null, 2);

      const callDetail = () =>
        chatCompletion(client, {
          model,
          systemPrompt: STORYBOARD_DETAIL_SYSTEM(language),
          userPrompt: STORYBOARD_DETAIL_USER(planPanelsJson, photographyJson, actingJson, "", ""),
          responseFormat: "json",
        });

      const detailResult = await callDetail();
      const detailParsed = await parseJsonWithRetry<{ panels?: DetailPanel[] }>(detailResult, callDetail);
      const detailPanels: DetailPanel[] = detailParsed.panels || [];

      // Merge all phases and save panels
      const savedPanels: Array<{ id: string; panelNumber: number }> = [];
      for (let i = 0; i < planPanels.length; i++) {
        const plan = planPanels[i];
        const detail = detailPanels.find((d) => d.panelNumber === plan.panelNumber) || ({} as DetailPanel);
        const photoRule = photographyRules.find((r) => r.panelNumber === plan.panelNumber) || null;
        const actingDir = actingDirections.find((d) => d.panelNumber === plan.panelNumber) || null;

        const panel = await prisma.panel.create({
          data: {
            clipId: clip.id,
            sceneDescription: detail.description || plan.description,
            cameraAngle: detail.cameraAngle || plan.cameraAngle,
            shotType: detail.shotType || plan.shotType,
            cameraMove: detail.cameraMove || plan.cameraMove,
            imagePrompt: detail.imagePrompt || null,
            durationMs: detail.durationMs || plan.durationMs || 3000,
            sortOrder: i,
            sceneType: plan.sceneType || null,
            videoPrompt: detail.videoPrompt || null,
            sourceText: plan.sourceText || null,
            photographyRules: photoRule ? JSON.stringify(photoRule) : null,
            actingNotes: actingDir?.characters ? JSON.stringify(actingDir.characters) : null,
          },
        });
        savedPanels.push({ id: panel.id, panelNumber: plan.panelNumber });
        totalPanelsCreated++;
      }

      completedSteps++;
      await ctx.reportProgress(completedSteps, totalSteps);

      // ── Phase 4: Voice Line Extraction ───────────────────
      const hasDialogue = clip.dialogue || (screenplay && screenplay.includes('"dialogue"'));
      if (hasDialogue && savedPanels.length > 0) {
        logger.info("Phase 4: Extracting voice lines", { clipId: clip.id });

        const voiceResult = await chatCompletion(client, {
          model,
          systemPrompt: VOICE_EXTRACT_SYSTEM,
          userPrompt: VOICE_EXTRACT_USER(
            clipContent,
            screenplay,
            JSON.stringify(
              planPanels.map((p) => ({
                panelNumber: p.panelNumber,
                description: p.description,
                characters: p.characters,
              })),
              null,
              2,
            ),
          ),
          responseFormat: "json",
        });

        let voiceParsed: { voiceLines?: VoiceLineData[] };
        try {
          let cleaned = voiceResult.trim();
          cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
          voiceParsed = JSON.parse(cleaned);
        } catch {
          voiceParsed = { voiceLines: [] };
        }
        const voiceLines: VoiceLineData[] = voiceParsed.voiceLines || [];

        for (const vl of voiceLines) {
          const matchedPanel = savedPanels.find((sp) => sp.panelNumber === vl.panelNumber);
          if (!matchedPanel || !vl.text) continue;

          await prisma.voiceLine.create({
            data: {
              panelId: matchedPanel.id,
              text: vl.text,
              speaker: vl.speaker || null,
              emotion: vl.emotion || null,
            },
          });
          totalVoiceLinesCreated++;
        }
      }

      completedSteps++;
      await ctx.reportProgress(completedSteps, totalSteps);
    }

    await prisma.episode.update({
      where: { id: episode.id },
      data: { status: "storyboarded" },
    });
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: "storyboarding" },
  });

  logger.info("Storyboard generation complete (4-phase pipeline)", {
    totalClips,
    totalPanelsCreated,
    totalVoiceLinesCreated,
    language,
  });

  return { totalClips, totalPanels: totalPanelsCreated, totalVoiceLines: totalVoiceLinesCreated };
});
