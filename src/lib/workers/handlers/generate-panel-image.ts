import { withTaskLifecycle } from "../shared";

export const handleGeneratePanelImage = withTaskLifecycle(async (payload, ctx) => {
  // TODO: Implement panel image generation
  await ctx.reportProgress(100);
  return { status: "completed" };
});
