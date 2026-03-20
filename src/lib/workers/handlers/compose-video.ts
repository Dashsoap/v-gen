import { withTaskLifecycle } from "../shared";

export const handleComposeVideo = withTaskLifecycle(async (payload, ctx) => {
  // TODO: Implement video composition with FFmpeg
  await ctx.reportProgress(100);
  return { status: "completed" };
});
