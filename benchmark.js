#!/usr/bin/env node

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Config
const ITERATIONS = 1000;
const CALENDAR_GRPC = 'localhost:50051';
const CALENDAR_REST = 'http://localhost:3002';
const STORAGE_GRPC = 'localhost:50052';
const STORAGE_REST = 'http://localhost:3003';

// Colors for terminal
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// Load protos
const calendarProto = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.join(__dirname, 'proto/calendar.proto'), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
).calendar;

const storageProto = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.join(__dirname, 'proto/storage.proto'), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
).storage;

// Create gRPC clients
const calendarClient = new calendarProto.CalendarService(
  CALENDAR_GRPC,
  grpc.credentials.createInsecure()
);

const storageClient = new storageProto.StorageService(
  STORAGE_GRPC,
  grpc.credentials.createInsecure()
);

// Benchmark utilities
async function runBenchmark(name, fn, iterations = ITERATIONS) {
  // Warmup
  for (let i = 0; i < 10; i++) await fn();

  const times = [];
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    const reqStart = process.hrtime.bigint();
    await fn();
    const reqEnd = process.hrtime.bigint();
    times.push(Number(reqEnd - reqStart) / 1e6); // ms
  }

  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1e6;

  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const rps = (iterations / totalMs) * 1000;

  return { name, avg, p50, p95, p99, rps, totalMs };
}

// gRPC calls
function grpcCreateEvent() {
  return new Promise((resolve, reject) => {
    calendarClient.CreateEvent(
      { title: 'Benchmark Event', description: 'Testing', date: '2026-01-26' },
      (err, response) => (err ? reject(err) : resolve(response))
    );
  });
}

function grpcGetEvents() {
  return new Promise((resolve, reject) => {
    calendarClient.GetEventsByDate({ date: '2026-01-26' }, (err, response) =>
      err ? reject(err) : resolve(response)
    );
  });
}

function grpcUploadFile(data) {
  return new Promise((resolve, reject) => {
    const call = storageClient.UploadFile((err, response) => {
      err ? reject(err) : resolve(response);
    });
    call.write({ data, filename: 'bench.txt', mimeType: 'text/plain' });
    call.end();
  });
}

// REST calls
async function restCreateEvent() {
  const response = await fetch(`${CALENDAR_REST}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Benchmark Event',
      description: 'Testing',
      date: '2026-01-26',
    }),
  });
  return response.json();
}

async function restGetEvents() {
  const response = await fetch(`${CALENDAR_REST}/events?date=2026-01-26`);
  return response.json();
}

async function restUploadFile(data) {
  const response = await fetch(`${STORAGE_REST}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data,
  });
  return response.json();
}

// Print results
function printResults(grpcResult, restResult) {
  const speedup = restResult.avg / grpcResult.avg;
  const rpsGain = ((grpcResult.rps - restResult.rps) / restResult.rps) * 100;

  console.log(`\n${colors.bold('┌─────────────────────────────────────────────────────────────────┐')}`);
  console.log(`${colors.bold('│')}  ${colors.cyan(grpcResult.name.padEnd(61))}${colors.bold('│')}`);
  console.log(`${colors.bold('├─────────────────────────────────────────────────────────────────┤')}`);
  console.log(`${colors.bold('│')}  ${'Metric'.padEnd(15)} ${'gRPC'.padStart(12)} ${'REST'.padStart(12)} ${'Winner'.padStart(16)}  ${colors.bold('│')}`);
  console.log(`${colors.bold('├─────────────────────────────────────────────────────────────────┤')}`);

  const metrics = [
    ['Avg Latency', `${grpcResult.avg.toFixed(2)}ms`, `${restResult.avg.toFixed(2)}ms`, grpcResult.avg < restResult.avg],
    ['P50 Latency', `${grpcResult.p50.toFixed(2)}ms`, `${restResult.p50.toFixed(2)}ms`, grpcResult.p50 < restResult.p50],
    ['P95 Latency', `${grpcResult.p95.toFixed(2)}ms`, `${restResult.p95.toFixed(2)}ms`, grpcResult.p95 < restResult.p95],
    ['P99 Latency', `${grpcResult.p99.toFixed(2)}ms`, `${restResult.p99.toFixed(2)}ms`, grpcResult.p99 < restResult.p99],
    ['Requests/sec', `${grpcResult.rps.toFixed(0)}`, `${restResult.rps.toFixed(0)}`, grpcResult.rps > restResult.rps],
  ];

  for (const [metric, grpcVal, restVal, grpcWins] of metrics) {
    const winner = grpcWins ? colors.green('gRPC 🚀') : colors.red('REST');
    console.log(`${colors.bold('│')}  ${metric.padEnd(15)} ${grpcVal.padStart(12)} ${restVal.padStart(12)} ${winner.padStart(25)}  ${colors.bold('│')}`);
  }

  console.log(`${colors.bold('├─────────────────────────────────────────────────────────────────┤')}`);
  console.log(`${colors.bold('│')}  ${colors.green(`⚡ gRPC is ${speedup.toFixed(1)}x faster with ${rpsGain.toFixed(0)}% more throughput`).padEnd(70)}${colors.bold('│')}`);
  console.log(`${colors.bold('└─────────────────────────────────────────────────────────────────┘')}`);
}

// Payload size comparison
function printPayloadComparison() {
  const jsonPayload = JSON.stringify({
    title: 'Benchmark Event',
    description: 'Testing',
    date: '2026-01-26',
  });

  // Approximate protobuf size (actual would require protobuf encoding)
  // string fields: 1 byte tag + 1 byte length + content
  const protoSize = 1 + 1 + 15 + 1 + 1 + 7 + 1 + 1 + 10; // ~38 bytes

  console.log(`\n${colors.bold('┌─────────────────────────────────────────────────────────────────┐')}`);
  console.log(`${colors.bold('│')}  ${colors.cyan('Payload Size Comparison'.padEnd(61))}${colors.bold('│')}`);
  console.log(`${colors.bold('├─────────────────────────────────────────────────────────────────┤')}`);
  console.log(`${colors.bold('│')}  JSON (REST):     ${colors.red(`${jsonPayload.length} bytes`).padEnd(50)}${colors.bold('│')}`);
  console.log(`${colors.bold('│')}  Protobuf (gRPC): ${colors.green(`~${protoSize} bytes`).padEnd(50)}${colors.bold('│')}`);
  console.log(`${colors.bold('│')}  ${colors.green(`⚡ Protobuf is ~${(jsonPayload.length / protoSize).toFixed(1)}x smaller`).padEnd(70)}${colors.bold('│')}`);
  console.log(`${colors.bold('└─────────────────────────────────────────────────────────────────┘')}`);
}

// Main
async function main() {
  console.log(colors.bold('\n🏁 gRPC vs REST Benchmark'));
  console.log(colors.yellow(`   Running ${ITERATIONS} iterations per test...\n`));

  try {
    // Test 1: Read operations (GetEvents)
    console.log(colors.cyan('📊 Running read benchmark (GetEvents)...'));
    const grpcRead = await runBenchmark('Read Operations (GetEvents)', grpcGetEvents);
    const restRead = await runBenchmark('Read Operations (GetEvents)', restGetEvents);
    printResults(grpcRead, restRead);

    // Test 2: Write operations (CreateEvent)
    console.log(colors.cyan('\n📊 Running write benchmark (CreateEvent)...'));
    const grpcWrite = await runBenchmark('Write Operations (CreateEvent)', grpcCreateEvent);
    const restWrite = await runBenchmark('Write Operations (CreateEvent)', restCreateEvent);
    printResults(grpcWrite, restWrite);

    // Test 3: Streaming upload (small file)
    console.log(colors.cyan('\n📊 Running streaming upload benchmark...'));
    const testData = Buffer.from('Hello benchmark world! '.repeat(100));
    const grpcUpload = await runBenchmark('Streaming Upload (2.3KB)', () => grpcUploadFile(testData), 500);
    const restUpload = await runBenchmark('Streaming Upload (2.3KB)', () => restUploadFile(testData), 500);
    printResults(grpcUpload, restUpload);

    // Payload comparison
    printPayloadComparison();

    // Summary
    console.log(colors.bold('\n📋 Summary'));
    console.log(colors.green('   ✅ gRPC uses binary protobuf (smaller payloads)'));
    console.log(colors.green('   ✅ gRPC uses HTTP/2 (multiplexed connections)'));
    console.log(colors.green('   ✅ gRPC has native streaming support'));
    console.log(colors.green('   ✅ gRPC has typed contracts (.proto files)'));
    console.log(colors.yellow('   ⚠️  REST is better for browser clients & debugging\n'));

  } catch (err) {
    console.error(colors.red('\n❌ Benchmark failed. Make sure all services are running:'));
    console.error(colors.yellow('   pnpm --filter calendar-service start'));
    console.error(colors.yellow('   pnpm --filter storage-service start\n'));
    console.error(err.message);
    process.exit(1);
  }
}

main();
