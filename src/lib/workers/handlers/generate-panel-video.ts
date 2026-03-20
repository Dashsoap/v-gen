import { withTaskLifecycle } from "../shared";

export const handleGeneratePanelVideo = withTaskLifecycle(async (payload, ctx) => {
  // TODO: Implement panel video generation
  await ctx.reportProgress(100);
  return { status: "completed" };
});
