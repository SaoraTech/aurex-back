/**
 * Automated Load and Resilience Benchmark for Aurex Backend
 * Runs in-process on isolated test environment without external paid calls.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';

interface StageResult {
  stageName: string;
  concurrency: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  durationMs: number;
  reqPerSec: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function runStage(
  stageName: string,
  concurrency: number,
  iterationsPerWorker: number,
  requestFn: () => Promise<boolean>,
): Promise<StageResult> {
  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const startAll = performance.now();

  const worker = async () => {
    for (let i = 0; i < iterationsPerWorker; i++) {
      const t0 = performance.now();
      try {
        const ok = await requestFn();
        const t1 = performance.now();
        latencies.push(t1 - t0);
        if (ok) successfulRequests++;
        else failedRequests++;
      } catch {
        const t1 = performance.now();
        latencies.push(t1 - t0);
        failedRequests++;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const endAll = performance.now();
  const durationMs = endAll - startAll;

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const sum = latencies.reduce((a, b) => a + b, 0);

  return {
    stageName,
    concurrency,
    totalRequests: total,
    successfulRequests,
    failedRequests,
    durationMs: Math.round(durationMs),
    reqPerSec: Math.round((total / (durationMs / 1000)) * 10) / 10,
    latency: {
      min: Math.round(latencies[0] ?? 0),
      max: Math.round(latencies[total - 1] ?? 0),
      avg: Math.round((sum / total) * 10) / 10,
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
    },
  };
}

async function main() {
  console.log('===========================================================');
  console.log('   AUREX BACKEND — LOAD & RESILIENCE BENCHMARK SUITE       ');
  console.log('===========================================================');
  console.log('Initializing isolated in-memory test instance...');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.listen(0);
  const url = await app.getUrl();
  console.log(`Test server running at ${url}\n`);

  const results: StageResult[] = [];

  // Stage 1: Healthcheck & Liveness (Low Concurrency = 5)
  console.log('Running Stage 1: Healthcheck Endpoint (Concurrency: 5, Total: 100)...');
  const stage1 = await runStage('Health Liveness', 5, 20, async () => {
    const res = await fetch(`${url}/api/v1/health/liveness`);
    return res.status === 200;
  });
  results.push(stage1);

  // Stage 2: Public Announcements List under Moderate Concurrency (Concurrency: 15, Total: 150)
  console.log('Running Stage 2: Announcements API (Concurrency: 15, Total: 150)...');
  const stage2 = await runStage('Announcements Read', 15, 10, async () => {
    const res = await fetch(`${url}/api/v1/announcements?limit=10`);
    return res.status === 200;
  });
  results.push(stage2);

  // Stage 3: High Concurrency Load (Concurrency: 30, Total: 300)
  console.log('Running Stage 3: High Concurrency Stress (Concurrency: 30, Total: 300)...');
  const stage3 = await runStage('High Concurrency Stress', 30, 10, async () => {
    const res = await fetch(`${url}/api/v1/health/liveness`);
    return res.status === 200;
  });
  results.push(stage3);

  // Stage 4: Rate Limiter & Security Rejection Protection (Concurrency: 50, Total: 250)
  console.log('Running Stage 4: Rate Limiting & Fast Rejection (Concurrency: 50, Total: 250)...');
  const stage4 = await runStage('Rate Limiter Load', 50, 5, async () => {
    const res = await fetch(`${url}/api/v1/health/ready`);
    return res.status === 200 || res.status === 429 || res.status === 503;
  });
  results.push(stage4);

  console.log('\n===========================================================');
  console.log('                 BENCHMARK RESULTS SUMMARY                 ');
  console.log('===========================================================');
  console.table(
    results.map((r) => ({
      Stage: r.stageName,
      Concurrency: r.concurrency,
      Total: r.totalRequests,
      'Success %': `${Math.round((r.successfulRequests / r.totalRequests) * 100)}%`,
      'Req/s': r.reqPerSec,
      'Avg (ms)': r.latency.avg,
      'p50 (ms)': r.latency.p50,
      'p95 (ms)': r.latency.p95,
      'p99 (ms)': r.latency.p99,
    })),
  );

  await app.close();
  console.log('Benchmark completed successfully.');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
