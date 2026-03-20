import { withTaskLifecycle } from "../shared";

export const handleRewrite = withTaskLifecycle(async (payload, ctx) => {
  // TODO: Implement text rewrite
  // 1. Read analyzed text from project
  // 2. Send to LLM with rewrite prompt
  // 3. Save rewritten text to project
  await ctx.reportProgress(100);
  return { status: "completed" };
});
