#!/usr/bin/env node

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Config
const CONCURRENT_REQUESTS = 1000;
const TOTAL_REQUESTS = 10000;
const CALENDAR_GRPC = 'localhost:50051';
const CALENDAR_REST = 'http://localhost:3002';

// Colors
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// Load proto
const calendarProto = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.join(__dirname, 'proto/calendar.proto'), {
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true,
  })
).calendar;

// gRPC client with connection pooling behavior (HTTP/2 multiplexing)
const calendarClient = new calendarProto.CalendarService(
  CALENDAR_GRPC,
  grpc.credentials.createInsecure()
);

function grpcCreateEvent() {
  return new Promise((resolve, reject) => {
    calendarClient.CreateEvent(
      { title: 'Concurrent Test', description: 'Testing', date: '2026-01-26' },
      (err, response) => (err ? reject(err) : resolve(response))
    );
  });
}

async function restCreateEvent() {
  const response = await fetch(`${CALENDAR_REST}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Concurrent Test', description: 'Testing', date: '2026-01-26' }),
  });
  return response.json();
}

// Run N concurrent requests
async function runConcurrent(fn, total, concurrency) {
  const times = [];
  let completed = 0;
  let inFlight = 0;

  const start = process.hrtime.bigint();

  return new Promise((resolve) => {
    const runOne = async () => {
      if (completed >= total) return;

      inFlight++;
      const reqStart = process.hrtime.bigint();

      try {
        await fn();
        const reqEnd = process.hrtime.bigint();
        times.push(Number(reqEnd - reqStart) / 1e6);
      } catch (e) {
        // ignore errors
      }

      completed++;
      inFlight--;

      if (completed >= total) {
        const end = process.hrtime.bigint();
        const totalMs = Number(end - start) / 1e6;
        times.sort((a, b) => a - b);

        const safeGet = (arr, pct) => arr[Math.floor(arr.length * pct)] || 0;

        resolve({
          totalMs,
          rps: times.length > 0 ? (times.length / totalMs) * 1000 : 0,
          avg: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
          p50: safeGet(times, 0.5),
          p95: safeGet(times, 0.95),
          p99: safeGet(times, 0.99),
          successCount: times.length,
        });
      } else if (completed + inFlight < total) {
        runOne();
      }
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, total); i++) {
      runOne();
    }
  });
}

async function main() {
  console.log(colors.bold('\n🏁 gRPC vs REST - CONCURRENT Benchmark'));
  console.log(colors.yellow(`   ${TOTAL_REQUESTS} requests with ${CONCURRENT_REQUESTS} concurrent\n`));

  // Check services are running
  try {
    await fetch(`${CALENDAR_REST}/events`);
  } catch (e) {
    console.error(colors.red('\n❌ Services not running! Start them first:'));
    console.error(colors.yellow('   pnpm --filter calendar-service start'));
    console.error(colors.yellow('   pnpm --filter storage-service start\n'));
    process.exit(1);
  }

  // Warmup
  console.log(colors.cyan('🔥 Warming up...'));
  await Promise.all([
    runConcurrent(grpcCreateEvent, 50, 10),
    runConcurrent(restCreateEvent, 50, 10),
  ]);

  // gRPC test
  console.log(colors.cyan('\n📊 Running gRPC concurrent test...'));
  const grpcResult = await runConcurrent(grpcCreateEvent, TOTAL_REQUESTS, CONCURRENT_REQUESTS);

  // REST test
  console.log(colors.cyan('📊 Running REST concurrent test...'));
  const restResult = await runConcurrent(restCreateEvent, TOTAL_REQUESTS, CONCURRENT_REQUESTS);

  // Results
  const speedup = restResult.totalMs / grpcResult.totalMs;
  const rpsGain = ((grpcResult.rps - restResult.rps) / restResult.rps) * 100;

  console.log(`\n${colors.bold('┌───────────────────────────────────────────────────────────────────────┐')}`);
  console.log(`${colors.bold('│')}  ${colors.cyan(`Concurrent Test: ${TOTAL_REQUESTS} requests, ${CONCURRENT_REQUESTS} concurrent`.padEnd(67))}${colors.bold('│')}`);
  console.log(`${colors.bold('├───────────────────────────────────────────────────────────────────────┤')}`);
  console.log(`${colors.bold('│')}  ${'Metric'.padEnd(20)} ${'gRPC'.padStart(15)} ${'REST'.padStart(15)} ${'Winner'.padStart(12)}  ${colors.bold('│')}`);
  console.log(`${colors.bold('├───────────────────────────────────────────────────────────────────────┤')}`);

  const metrics = [
    ['Total Time', `${grpcResult.totalMs.toFixed(0)}ms`, `${restResult.totalMs.toFixed(0)}ms`, grpcResult.totalMs < restResult.totalMs],
    ['Requests/sec', grpcResult.rps.toFixed(0), restResult.rps.toFixed(0), grpcResult.rps > restResult.rps],
    ['Avg Latency', `${grpcResult.avg.toFixed(2)}ms`, `${restResult.avg.toFixed(2)}ms`, grpcResult.avg < restResult.avg],
    ['P50 Latency', `${grpcResult.p50.toFixed(2)}ms`, `${restResult.p50.toFixed(2)}ms`, grpcResult.p50 < restResult.p50],
    ['P95 Latency', `${grpcResult.p95.toFixed(2)}ms`, `${restResult.p95.toFixed(2)}ms`, grpcResult.p95 < restResult.p95],
    ['P99 Latency', `${grpcResult.p99.toFixed(2)}ms`, `${restResult.p99.toFixed(2)}ms`, grpcResult.p99 < restResult.p99],
  ];

  for (const [metric, grpcVal, restVal, grpcWins] of metrics) {
    const winner = grpcWins ? colors.green('gRPC 🚀') : colors.red('REST');
    console.log(`${colors.bold('│')}  ${metric.padEnd(20)} ${grpcVal.padStart(15)} ${restVal.padStart(15)} ${winner.padStart(21)}  ${colors.bold('│')}`);
  }

  console.log(`${colors.bold('├───────────────────────────────────────────────────────────────────────┤')}`);

  if (speedup > 1) {
    console.log(`${colors.bold('│')}  ${colors.green(`⚡ gRPC is ${speedup.toFixed(2)}x faster with ${rpsGain.toFixed(0)}% more throughput!`).padEnd(76)}${colors.bold('│')}`);
  } else {
    console.log(`${colors.bold('│')}  ${colors.yellow(`⚠️  REST won this round (${(1/speedup).toFixed(2)}x faster)`).padEnd(76)}${colors.bold('│')}`);
  }
  console.log(`${colors.bold('└───────────────────────────────────────────────────────────────────────┘')}`);

  console.log(colors.bold('\n💡 Why gRPC shines with concurrency:'));
  console.log(colors.green('   • HTTP/2 multiplexes ALL requests over ONE TCP connection'));
  console.log(colors.green('   • REST/HTTP/1.1 needs multiple connections (connection overhead)'));
  console.log(colors.green('   • gRPC streams avoid TCP handshake per request\n'));
}

main().catch(console.error);
