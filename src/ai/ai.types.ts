export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export interface AiResult {
  text: string;
  provider: 'groq';
  model: string;
  latencyMs?: number;
  tokens?: number;
}

export type AurexModelId = 'groq';
