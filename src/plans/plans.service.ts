import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PlanName = 'free'|'plus'|'pro';
export interface PlanLimits { dailyMessages: number; monthlyMessages: number; maxFileBytes: number; }

@Injectable()
export class PlansService {
  constructor(private readonly config: ConfigService) {}
  private parse<T>(key: string, fallback: T): T {
    try { return JSON.parse(this.config.get<string>(key) ?? '') as T; } catch { return fallback; }
  }
  getPrices(): Record<PlanName, number> {
    return this.parse('PLAN_PRICES_JSON', { free: 0, plus: 1500, pro: 3000 });
  }
  getLimits(): Record<PlanName, PlanLimits> {
    return this.parse('PLAN_LIMITS_JSON', {
      free: { dailyMessages: 20, monthlyMessages: 300, maxFileBytes: 5_000_000 },
      plus: { dailyMessages: 100, monthlyMessages: 3000, maxFileBytes: 25_000_000 },
      pro: { dailyMessages: 300, monthlyMessages: 10000, maxFileBytes: 100_000_000 },
    });
  }
  list() {
    const prices = this.getPrices(); const limits = this.getLimits();
    return (['free','plus','pro'] as PlanName[]).map(id => ({ id, priceXofPerMonth: prices[id], limits: limits[id] }));
  }
}
