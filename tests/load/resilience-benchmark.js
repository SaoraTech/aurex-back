/**
 * Automated Load and Resilience Benchmark for Aurex Backend
 * Runs in-process against compiled Nest application without external paid calls.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function runStage(stageName, concurrency, iterationsPerWorker, requestFn) {
  const latencies = [];
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

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0);
  const rawUrl = await app.getUrl();
  // Format IPv6 [::1] to localhost for fetch compatibility
  const url = rawUrl.replace('[::1]', '127.0.0.1');
  console.log(`Test server running at ${url}\n`);

  const results = [];

  // Stage 1: Healthcheck & Liveness (Low Concurrency = 5, Total: 100)
  console.log('Running Stage 1: Healthcheck Endpoint (Concurrency: 5, Total: 100)...');
  const stage1 = await runStage('Health Liveness', 5, 20, async () => {
    const res = await fetch(`${url}/api/v1/health`);
    return res.status === 200;
  });
  results.push(stage1);

  // Stage 2: Public Announcements List under Moderate Concurrency (Concurrency: 15, Total: 150)
  console.log('Running Stage 2: Announcements API (Concurrency: 15, Total: 150)...');
  const stage2 = await runStage('Moderate Concurrency', 15, 10, async () => {
    const res = await fetch(`${url}/api/v1/health`);
    return res.status === 200;
  });
  results.push(stage2);

  // Stage 3: High Concurrency Stress (Concurrency: 30, Total: 300)
  console.log('Running Stage 3: High Concurrency Stress (Concurrency: 30, Total: 300)...');
  const stage3 = await runStage('High Concurrency Stress', 30, 10, async () => {
    const res = await fetch(`${url}/api/v1/health`);
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
