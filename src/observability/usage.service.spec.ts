import { UsageService } from './usage.service';

describe('UsageService - Cost and Observability Tracking', () => {
  let service: UsageService;
  let usageRecords: any[];

  beforeEach(() => {
    usageRecords = [];

    const dbMock = {
      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation((val) => {
          usageRecords.push(val);
          return Promise.resolve();
        }),
      })),

      select: jest.fn().mockImplementation((cols) => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => ({
            groupBy: jest.fn().mockImplementation(() => {
              return Promise.resolve([
                {
                  kind: 'llm_call',
                  provider: 'gemini',
                  totalUnits: 15000,
                  callCount: 10,
                  avgLatencyMs: 450,
                },
                {
                  kind: 'math_call',
                  provider: 'wolfram',
                  totalUnits: 5,
                  callCount: 5,
                  avgLatencyMs: 320,
                },
              ]);
            }),
            then: (resolve: any) => resolve([{ total: 15000, totalUnits: 15000 }]),
          })),
        })),
      })),
    };

    service = new UsageService(dbMock);
  });

  describe('estimateCost', () => {
    it('estimates cost accurately for known unit rates', () => {
      const est = service.estimateCost({ kind: 'llm_call', units: 10000 });
      expect(est.isEstimated).toBe(true);
      expect(est.isUnknown).toBe(false);
      expect(est.costUsd).toBe(0.005);
      expect(est.currency).toBe('USD');
    });

    it('estimates cost for math_call correctly', () => {
      const est = service.estimateCost({ kind: 'math_call', units: 1000 });
      expect(est.costUsd).toBe(2);
      expect(est.isEstimated).toBe(true);
    });
  });

  describe('getUserUsageSummary', () => {
    it('aggregates usage across providers and attaches estimated costs', async () => {
      const summary = await service.getUserUsageSummary('user_obs_1');
      expect(summary.length).toBe(2);

      const llmItem = summary.find(s => s.kind === 'llm_call');
      expect(llmItem).toBeDefined();
      expect(llmItem?.totalUnits).toBe(15000);
      expect(llmItem?.estimatedCostUsd).toBe(0.0075);
    });
  });

  describe('detectAbnormalConsumption', () => {
    it('flags an alert when consumed units exceed the safety threshold', async () => {
      const alert = await service.detectAbnormalConsumption('user_obs_1', 10000);
      expect(alert.isAbnormal).toBe(true);
      expect(alert.consumedUnits).toBe(15000);
    });

    it('does not flag an alert when usage is below safety threshold', async () => {
      const alert = await service.detectAbnormalConsumption('user_obs_1', 50000);
      expect(alert.isAbnormal).toBe(false);
    });
  });
});
