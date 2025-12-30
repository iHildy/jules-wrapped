// Gemini token estimates: ~4 characters per token; images default to 258 tokens.
const GEMINI_CHARS_PER_TOKEN = 4;
const GEMINI_IMAGE_TOKENS = 258;

export function estimateGeminiTokensFromText(text?: string | null): number {
  if (typeof text !== "string") return 0;
  if (text.trim() === "") return 0;
  return Math.max(1, Math.ceil(text.length / GEMINI_CHARS_PER_TOKEN));
}

export function estimateGeminiTokensFromImage(): number {
  return GEMINI_IMAGE_TOKENS;
}
