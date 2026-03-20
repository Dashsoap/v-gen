import type { DetectedLanguage } from "@/lib/llm/language-detect";
import { getCulturalContext } from "@/lib/llm/language-detect";

// ─── Legacy LLM-based prompt generation (fallback for panels without Stage 3 data) ───

export const GENERATE_IMAGE_PROMPT_SYSTEM = (language: DetectedLanguage = "en") => {
  const cultural = getCulturalContext(language);
  const culturalSection = cultural ? `\n\n${cultural}` : "";

  return `You are an expert at crafting prompts for AI image generation models. Convert scene descriptions into optimized image generation prompts.

Respond with a single image prompt string (no JSON wrapper). The prompt should:
- Start with the main subject/action
- Include composition/camera angle
- Describe lighting, atmosphere, and mood
- Include art style keywords
- Be concise but detailed (50-150 words)
- NOT include any text/words to be rendered in the image
- Do NOT include character names — describe their appearance instead (age, gender, build, hair, clothing)${culturalSection}`;
};

export const GENERATE_IMAGE_PROMPT_USER = (
  sceneDescription: string,
  cameraAngle: string,
  style: string,
  characterDescriptions: string,
) =>
  `Convert this storyboard panel into an image generation prompt:

Scene: ${sceneDescription}
Camera: ${cameraAngle}
Art Style: ${style}
Characters in scene: ${characterDescriptions}`;

// ─── Structured prompt builder (for panels WITH Stage 3 data) ───

interface PanelPromptContext {
  sceneDescription: string;
  cameraAngle?: string;
  shotType?: string;
  cameraMove?: string;
  photographyRules?: string; // JSON string
  actingNotes?: string;      // JSON string
  videoPrompt?: string;
  sceneType?: string;
}

interface CharacterInfo {
  name: string;
  description?: string;
}

interface LocationInfo {
  name: string;
  description?: string;
}

/**
 * Build a structured image prompt from Stage 3 data without additional LLM call.
 * If panel has photographyRules and actingNotes, assembles prompt directly.
 * Returns null if insufficient data (caller should fall back to LLM generation).
 */
export function buildImagePromptFromContext(
  panel: PanelPromptContext,
  characters: CharacterInfo[],
  locations: LocationInfo[],
  style: string,
  language: DetectedLanguage = "en",
): string | null {
  if (!panel.photographyRules && !panel.actingNotes) {
    return null; // No Stage 3 data, need LLM fallback
  }

  const parts: string[] = [];

  // 1. Shot type and camera
  if (panel.shotType) {
    parts.push(`${panel.shotType}`);
  }
  if (panel.cameraAngle) {
    parts.push(`${panel.cameraAngle} angle`);
  }

  // 2. Scene description (core visual)
  parts.push(panel.sceneDescription);

  // 3. Photography rules
  if (panel.photographyRules) {
    try {
      const rules = JSON.parse(panel.photographyRules);
      if (rules.lighting) {
        const lighting = typeof rules.lighting === "string"
          ? rules.lighting
          : `${rules.lighting.direction || ""}, ${rules.lighting.quality || ""}`.trim();
        if (lighting) parts.push(`Lighting: ${lighting}`);
      }
      if (rules.depth_of_field) {
        parts.push(`Depth of field: ${rules.depth_of_field}`);
      }
      if (rules.color_tone) {
        parts.push(`Color tone: ${rules.color_tone}`);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 4. Acting notes (visible character actions)
  if (panel.actingNotes) {
    try {
      const notes = JSON.parse(panel.actingNotes);
      if (Array.isArray(notes)) {
        const actingDescs = notes
          .map((n: { name: string; acting: string }) => {
            // Replace character name with appearance description
            const char = characters.find((c) => c.name === n.name);
            const label = char?.description
              ? describeCharacterBriefly(char.description, language)
              : n.name;
            return `${label}: ${n.acting}`;
          })
          .join(". ");
        if (actingDescs) parts.push(actingDescs);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 5. Character appearance (for characters in scene without acting notes)
  const mentionedInNotes = new Set<string>();
  if (panel.actingNotes) {
    try {
      const notes = JSON.parse(panel.actingNotes);
      if (Array.isArray(notes)) {
        notes.forEach((n: { name: string }) => mentionedInNotes.add(n.name));
      }
    } catch { /* ignore */ }
  }

  // 6. Cultural context
  const cultural = getCulturalContext(language);
  if (cultural) {
    // Extract just the key appearance instruction
    if (language === "zh") {
      parts.push("East Asian / Chinese appearance");
    }
  }

  // 7. Style
  parts.push(`Style: ${style}`);

  return parts.filter(Boolean).join(". ") + ".";
}

/**
 * Extract a brief visual descriptor from a full character description.
 * Uses age+gender category instead of name (for image generation).
 */
function describeCharacterBriefly(description: string, language: DetectedLanguage): string {
  // Try to extract age/gender from description
  const ageGenderPatterns = {
    zh: [
      { pattern: /少年|男孩|小男孩/, label: "少年" },
      { pattern: /少女|女孩|小女孩/, label: "少女" },
      { pattern: /年轻.*男|青年男|小伙/, label: "年轻男子" },
      { pattern: /年轻.*女|青年女|姑娘/, label: "年轻女子" },
      { pattern: /中年.*男/, label: "中年男子" },
      { pattern: /中年.*女/, label: "中年女子" },
      { pattern: /老.*男|老头|老者/, label: "老年男子" },
      { pattern: /老.*女|老太|老妇/, label: "老年女子" },
    ],
    en: [
      { pattern: /\bboy\b|teenage boy|young boy/i, label: "teenage boy" },
      { pattern: /\bgirl\b|teenage girl|young girl/i, label: "teenage girl" },
      { pattern: /young man|young male/i, label: "young man" },
      { pattern: /young woman|young female/i, label: "young woman" },
      { pattern: /middle.?aged man/i, label: "middle-aged man" },
      { pattern: /middle.?aged woman/i, label: "middle-aged woman" },
      { pattern: /elderly man|old man/i, label: "elderly man" },
      { pattern: /elderly woman|old woman/i, label: "elderly woman" },
    ],
  };

  const patterns = ageGenderPatterns[language] || ageGenderPatterns.en;
  for (const { pattern, label } of patterns) {
    if (pattern.test(description)) {
      return label;
    }
  }

  // Fallback: extract first ~30 chars of description
  return description.slice(0, 30).trim();
}
