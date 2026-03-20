/**
 * Video prompt builder — simplified for v-gen (no asset system).
 */

export interface ReferenceImage {
  url: string;
  type: "keyframe";
  name: string;
}

/**
 * Build video generation prompt with panel metadata.
 */
export function buildVideoPromptWithReferences(
  panelImageUrl: string,
  originalPrompt: string,
  panel: {
    shotType?: string | null;
    cameraAngle?: string | null;
    cameraMove?: string | null;
  },
): string {
  const parts: string[] = [];

  // Reference: keyframe image
  parts.push("图1是关键帧。");

  // Scene content
  if (originalPrompt) {
    parts.push(originalPrompt);
  }

  // Technical: shot type, camera angle, camera movement
  const tech: string[] = [];
  if (panel.shotType) tech.push(panel.shotType);
  if (panel.cameraAngle) tech.push(panel.cameraAngle);
  if (panel.cameraMove) tech.push(panel.cameraMove);
  if (tech.length > 0) {
    parts.push(tech.join("，"));
  }

  // Cap at 490 chars (API limits)
  let prompt = parts.join("，");
  if (prompt.length > 490) {
    prompt = prompt.substring(0, 490) + "...";
  }

  return prompt;
}
