/**
 * Language detection based on CJK character ratio.
 * Used to inject cultural context into prompts for proper character appearance.
 */

export type DetectedLanguage = "zh" | "en";

/**
 * Detect primary language of text by CJK character ratio.
 * Returns 'zh' if CJK characters exceed 15% of total, otherwise 'en'.
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text) return "en";
  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f\uff00-\uffef]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return "en";
  return cjkCount / totalChars > 0.15 ? "zh" : "en";
}

/**
 * Returns cultural context instructions for character appearance in image generation.
 */
export function getCulturalContext(lang: DetectedLanguage): string {
  if (lang === "zh") {
    return `IMPORTANT Cultural Context:
- Characters are Chinese / East Asian by default unless the text explicitly specifies otherwise.
- Use "East Asian appearance", "Chinese features", "black hair" as default descriptors.
- Age/gender categories: 少年/少女 (10-16), 年轻男子/年轻女子 (17-30), 中年男子/中年女子 (31-50), 老年男子/老年女子 (50+).
- Traditional/modern Chinese clothing and settings as appropriate to the story period.`;
  }
  return "";
}

/**
 * Returns the character appearance default instruction for entity extraction.
 */
export function getCharacterAppearanceDefault(lang: DetectedLanguage): string {
  if (lang === "zh") {
    return "角色默认为中国人/东亚面孔，除非原文明确指定其他种族。描述中必须包含\"东亚面孔\"或\"中国人\"等种族特征。";
  }
  return "";
}
