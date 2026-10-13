export interface AiMessage { role: 'user' | 'assistant'; content: string; }
export interface AiOptions { systemInstruction?: string; temperature?: number; maxOutputTokens?: number }
export interface AiResult {
  text: string; provider: string; model: string;
  latencyMs?: number; tokens?: number;
  /** Provider the request was first routed to, when a fallback produced this answer. */
  fallbackFrom?: string;
}
export type AurexModelId = 'kimi' | 'qwen' | 'deepseek' | 'grok' | 'gemini' | 'groq';
