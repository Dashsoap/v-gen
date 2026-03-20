import { withTaskLifecycle } from "../shared";

export const handleVideoAnalyze = withTaskLifecycle(async (payload, ctx) => {
  // TODO: Implement video analysis
  // 1. Download video from sourceVideoUrl
  // 2. Extract frames with FFmpeg
  // 3. Send frames to multimodal LLM for analysis
  // 4. Save analyzed text to project
  await ctx.reportProgress(100);
  return { status: "completed" };
});
