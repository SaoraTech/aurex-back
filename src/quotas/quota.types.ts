export type FeatureId =
  | 'daily_messages'
  | 'monthly_messages'
  | 'web_search'
  | 'deep_research'
  | 'math_compute'
  | 'stt_transcription'
  | 'tts_speech'
  | 'document_analysis'
  | 'image_analysis'
  | 'exercise_photo_analysis'
  | (string & {});

export type QuotaWindow = 'day' | 'month';

export interface QuotaPolicy {
  limit: number;
  window: QuotaWindow;
  baseBlockSeconds: number;
  maxBlockSeconds: number;
  adaptiveAdjustment: boolean;
  enabled: boolean;
}

export interface QuotaStatus {
  feature: string;
  limit: number;
  used: number;
  remaining: number;
  isBlocked: boolean;
  blockedUntil?: string | null;
  resetAt: string;
  retryAfterSeconds?: number;
}

export interface ReservationResult {
  allowed: boolean;
  operationId: string;
  feature: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  blockedUntil?: string;
  retryAfterSeconds?: number;
  errorCode?:
    | 'FEATURE_LIMIT_REACHED'
    | 'FEATURE_TEMPORARILY_BLOCKED'
    | 'FEATURE_DISABLED'
    | 'OPERATION_ID_CONFLICT'
    | 'OPERATION_ALREADY_REFUNDED'
    | 'OPERATION_EXPIRED'
    | 'INVALID_OPERATION_STATUS';
  errorMessage?: string;
}
