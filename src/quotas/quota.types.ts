<<<<<<< LOCAL (Your changes)
export type FeatureId =
  | 'document_analysis'
  | 'image_analysis'
  | 'exercise_photo_analysis'
  | 'math_compute'
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
    | 'INVALID_OPERATION_STATUS'
    | (string & {});
  errorMessage?: string;
}

=======
export type FeatureId =
  | 'document_analysis'
  | 'image_analysis'
  | 'exercise_photo_analysis'
  | 'math_compute'
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
  errorCode?: 'FEATURE_LIMIT_REACHED' | 'FEATURE_TEMPORARILY_BLOCKED' | 'FEATURE_DISABLED';
  errorMessage?: string;
}

>>>>>>> REMOTE (Changes from GitHub)
