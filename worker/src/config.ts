export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const COUNCIL_MODELS = [
  "openai/gpt-5.1",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-4"
];

export const CHAIRMAN_MODEL = "openai/gpt-5.1";
export const CHAIRMAN_FALLBACKS = [
  "openai/gpt-4o-mini",
  "google/gemini-3-pro-preview"
];
export const TITLE_MODEL = "google/gemini-2.5-flash";

export const DEFAULT_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];
