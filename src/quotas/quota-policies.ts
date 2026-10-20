import { PlanName } from '../plans/plans.service';
import { FeatureId, QuotaPolicy } from './quota.types';

export const DEFAULT_QUOTA_POLICIES: Record<PlanName, Record<string, QuotaPolicy>> = {
  free: {
    document_analysis: {
      limit: 10,
      window: 'day',
      baseBlockSeconds: 300, // 5 min
      maxBlockSeconds: 86400, // 24h
      adaptiveAdjustment: true,
      enabled: true,
    },
    image_analysis: {
      limit: 10,
      window: 'day',
      baseBlockSeconds: 300,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    exercise_photo_analysis: {
      limit: 10,
      window: 'day',
      baseBlockSeconds: 300,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    math_compute: {
      limit: 100,
      window: 'day',
      baseBlockSeconds: 300,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
  },
  plus: {
    document_analysis: {
      limit: 50,
      window: 'day',
      baseBlockSeconds: 180,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    image_analysis: {
      limit: 50,
      window: 'day',
      baseBlockSeconds: 180,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    exercise_photo_analysis: {
      limit: 50,
      window: 'day',
      baseBlockSeconds: 180,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    math_compute: {
      limit: 500,
      window: 'day',
      baseBlockSeconds: 180,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
  },
  pro: {
    document_analysis: {
      limit: 200,
      window: 'day',
      baseBlockSeconds: 60,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    image_analysis: {
      limit: 200,
      window: 'day',
      baseBlockSeconds: 60,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    exercise_photo_analysis: {
      limit: 200,
      window: 'day',
      baseBlockSeconds: 60,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
    math_compute: {
      limit: 2000,
      window: 'day',
      baseBlockSeconds: 60,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    },
  },
};
