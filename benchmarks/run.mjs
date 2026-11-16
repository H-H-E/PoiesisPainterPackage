#!/usr/bin/env node
/** Reproducible CPU/Skia Canvas2D benchmark; no simulated measurements. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fixtureDefinitions, makeFixture } from './fixtures.mjs';
import { summarize } from './stats.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: npm run benchmark -- [--smoke] [--out path.json] [--rebuild] [--help]';

function parseOptions(args) {
  const options = { smoke: false, rebuild: false, out: undefined };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--smoke': options.smoke = true; break;
      case '--rebuild': options.rebuild = true; break;
      case '--out':
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--out requires a JSON file path');
        options.out = args[++i]; break;
      case '--help': console.log(usage); process.exit(0);
      default: throw new Error(`Unknown option ${args[i]}. ${usage}`);
    }
  }
  options.out = resolve(root, options.out ?? `evidence/benchmarks/${options.smoke ? 'smoke' : 'full'}.json`);
  return options;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return process.env.GITHUB_SHA ?? null; }
}
function snapshotMemory() {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, heapTotal, external, arrayBuffers };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function timed(action) {
  // This samples *host event-loop timer delay*, not GPU/frame completion or per-mark blocking.
  // The monitor is active for 15 ms on either side of the timed operation, but those
  // intervals are deliberately EXCLUDED from durationMs.
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let value, durationMs;
  try {
    await sleep(15);
    const start = performance.now();
    value = await action();
    durationMs = performance.now() - start;
    await sleep(15);
  } finally {
    delay.disable();
  }
  return {
    durationMs,
    eventLoopTimerDelay: {
      sampleCount: Number(delay.count),
      maxMs: delay.count ? delay.max / 1e6 : null,
      p95Ms: delay.count ? delay.percentile(95) / 1e6 : null,
      observationWindow: 'Operation plus 15 ms before and after; 10 ms timer resolution',
    },
    processMemoryAfterBytes: snapshotMemory(),
    value,
  };
}
function elapsed({ durationMs, eventLoopTimerDelay, processMemoryAfterBytes }) {
  return { durationMs, eventLoopTimerDelay, processMemoryAfterBytes };
}

function runBuild(rebuild) {
  const alreadyBuilt = existsSync(resolve(root, 'dist/index.js')) && existsSync(resolve(root, 'dist/bundle-size.json'));
  if (alreadyBuilt && !rebuild) {
    return { status: 'prebuilt-not-measured', durationMs: null, command: 'npm run build', exitCode: null };
  }
  const start = performance.now();
  const child = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 2_000_000,
  });
  const info = {
    status: child.status === 0 ? 'measured-build' : 'failed', durationMs: performance.now() - start,
    command: 'npm run build', exitCode: child.status, error: child.error?.message ?? null,
    logTail: `${child.stdout ?? ''}\n${child.stderr ?? ''}`.trim().slice(-1500),
  };
  if (child.status !== 0) throw Object.assign(new Error('Build failed; run npm ci and inspect build log'), { build: info });
  return info;
}

function coldProbe(spec, smoke) {
  const args = [resolve(root, 'benchmarks/cold.mjs'), spec.id, ...(smoke ? ['--smoke'] : [])];
  const start = performance.now();
  const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000 });
  const processWallMs = performance.now() - start;
  if (child.status !== 0) {
    throw new Error(`Cold startup probe failed (${child.status ?? child.error?.code}): ${child.stderr || child.error?.message || child.stdout}`);
  }
  return {
    processWallMs,
    ...JSON.parse(child.stdout),
    interpretation: 'Child wall includes Node startup, imports, first full CPU render and exit; dynamicImportMs and firstRenderMs are separately measured inside the child.',
  };
}

function environment() {
  return {
    commitSha: gitHead(), githubEventSha: process.env.GITHUB_SHA ?? null,
    node: process.version, v8: process.versions.v8, napi: process.versions.napi,
    platform: process.platform, architecture: process.arch,
    osType: os.type(), osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? null, logicalCpuCount: os.cpus().length,
    totalSystemMemoryBytes: os.totalmem(),
    ci: process.env.CI === 'true', githubActions: process.env.GITHUB_ACTIONS === 'true',
    processMemoryScope: 'Entire Node process RSS/heap/external/arrayBuffers, NOT renderer, texture or GPU memory',
  };
}

async function runOne(spec, index, Painter, createCanvas) {
  const document = makeFixture(spec);
  const noWait = makeFixture(spec, { withoutWait: true });
  const revised = makeFixture(spec, { revised: true });
  const canvas = createCanvas(spec.width, spec.height);
  const painter = new Painter(canvas, { canvasFactory: createCanvas, historyLimit: 0 });
  const extraCanvas = createCanvas(spec.width, spec.height);
  const extraPainter = new Painter(extraCanvas, { canvasFactory: createCanvas, historyLimit: 0 });
  let full, sansWait;
  try {
    // Alternate the first two full renders to reduce consistent cache/JIT ordering bias.
    const fresh = async () => { full = await timed(() => painter.render(document)); };
    const minusWait = async () => { sansWait = await timed(() => extraPainter.render(noWait)); };
    if (index % 2 === 0) { await fresh(); await minusWait(); }
    else { await minusWait(); await fresh(); }

    const exactCache = await timed(() => painter.render(document));
    const cacheRevision = await timed(() => painter.revise(spec.revision.commandId, spec.revision.patch));
    const png = await timed(() => canvas.toBuffer('image/png'));
    const freshRevisedCanvas = createCanvas(spec.width, spec.height);
    const freshRevisedPainter = new Painter(freshRevisedCanvas, { canvasFactory: createCanvas, historyLimit: 0 });
    let freshRevised, freshRevisedHash;
    try {
      freshRevised = await timed(() => freshRevisedPainter.render(revised));
      freshRevisedHash = sha256(freshRevisedCanvas.toBuffer('image/png'));
    } finally {
      freshRevisedPainter.dispose();
    }
    assert.equal(full.value.cacheHits, 0, 'Fresh render must not hit cache');
    assert.equal(exactCache.value.cacheHits, document.layers.length, 'Identical score should reuse all layers');
    assert.equal(cacheRevision.value.cacheHits, document.layers.length - 1, 'Revision must invalidate only its own layer');
    assert.equal(freshRevised.value.cacheHits, 0, 'Revised baseline must render without cache');
    const pngHash = sha256(png.value);
    assert.equal(pngHash, freshRevisedHash, 'Cached revision must produce identical native PNG to fresh revised score');
    return {
      iteration: index, phases: {
        fullWithWait: { ...elapsed(full), report: full.value },
        fullWithoutWait: { ...elapsed(sansWait), report: sansWait.value },
        fullRevised: { ...elapsed(freshRevised), report: freshRevised.value },
        exactCache: { ...elapsed(exactCache), report: exactCache.value },
        cachedRevision: { ...elapsed(cacheRevision), report: cacheRevision.value },
        pngExport: { ...elapsed(png), pngBytes: png.value.length, pngSha256: pngHash },
      },
      pairedWaitDifferenceMs: full.durationMs - sansWait.durationMs,
      revisedPngSha256: pngHash,
    };
  } finally {
    painter.dispose();
    extraPainter.dispose();
  }
}

function aggregate(trials) {
  const stages = ['fullWithWait', 'fullWithoutWait', 'fullRevised', 'exactCache', 'cachedRevision', 'pngExport'];
  return {
    ...Object.fromEntries(stages.map(stage => [stage, summarize(trials.map(t => t.phases[stage].durationMs))])),
    pairedWaitDifference: summarize(trials.map(t => t.pairedWaitDifferenceMs)),
    eventLoopTimerMax: Object.fromEntries(stages.map(stage => [stage, summarize(trials.map(t => t.phases[stage].eventLoopTimerDelay.maxMs).filter(x => x !== null))])),
    maximumObservedProcessRssBytes: Math.max(...trials.flatMap(t => stages.map(stage => t.phases[stage].processMemoryAfterBytes.rss))),
    pngSha256: [...new Set(trials.map(t => t.revisedPngSha256))],
  };
}

async function execute(options, result) {
  result.build = runBuild(options.rebuild);
  result.bundle = JSON.parse(await readFile(resolve(root, 'dist/bundle-size.json'), 'utf8'));
  const [{ createCanvas }, { Painter, validatePainting, capabilities }] = await Promise.all([
    import('@napi-rs/canvas'), import('../dist/index.js'),
  ]);
  result.backend = { name: '@napi-rs/canvas', technique: 'Native Skia Canvas2D CPU; not browser, WebGL or GPU timing', capabilities: capabilities() };
  const warmups = options.smoke ? 1 : 2;
  const timedTrials = options.smoke ? 3 : 5;
  result.configuration = { warmups, timedTrials, clock: 'performance.now() monotonic wall time',
    nativeCanvas: true, order: 'alternating original/no-wait first render; then exact cache, cached revision, PNG, fresh revised',
    note: 'Warmups are recorded but excluded from aggregates. Fixture coordinates, dimensions, seed, marks and wait steps remain constant within each fixture.' };
  for (const spec of fixtureDefinitions(options.smoke)) {
    const doc = makeFixture(spec);
    const validation = validatePainting(doc);
    if (!validation.valid) throw new Error(`${spec.id}: fixture rejected: ${JSON.stringify(validation.errors)}`);
    assert.ok(validation.workload.pixels <= 384 * 256 && validation.workload.expandedMarks <= 8 && validation.workload.simulationSteps <= 3,
      'Benchmark workload exceeds stricter suite bounds');
    const entry = { id: spec.id, definition: spec, workloadEstimate: validation.workload,
      fixtureScoreSha256: sha256(JSON.stringify(doc)), warmups: [], trials: [], summary: null,
      coldStartup: coldProbe(spec, options.smoke) };
    result.fixtures.push(entry);
    for (let i = 0; i < warmups + timedTrials; i++) {
      const sample = await runOne(spec, i, Painter, createCanvas);
      (i < warmups ? entry.warmups : entry.trials).push(sample);
    }
    entry.summary = aggregate(entry.trials);
    assert.equal(entry.summary.pngSha256.length, 1, `${spec.id}: per-trial native PNG hashes differ`);
    const s = entry.summary;
    console.log(`${spec.id.padEnd(17)} ${spec.width}x${spec.height}, ${spec.strokes + 1} marks, ` +
      `full ${s.fullWithWait.median.toFixed(1)} ms (p95 ${s.fullWithWait.p95.toFixed(1)}), ` +
      `revision ${s.cachedRevision.median.toFixed(1)} ms, PNG ${s.pngExport.median.toFixed(1)} ms`);
  }
}

let options;
try { options = parseOptions(process.argv.slice(2)); }
catch (error) { console.error(`${error.message}\n${usage}`); process.exit(2); }
const report = {
  schemaVersion: '1.0', createdAt: new Date().toISOString(), status: 'running',
  mode: options.smoke ? 'smoke' : 'representative', environment: environment(),
  measurementCaveats: [
    'Only @napi-rs/canvas native Skia Canvas2D CPU work is measured; this is not browser, GPU or upstream parity evidence.',
    'Per-process memory samples include all Node/runtime allocations, not just painting resources.',
    'Paired wait minus no-wait wall-clock differences include measurement/JIT/GC noise and are not isolated simulation-kernel timings.',
    'Event-loop delay is an observed timer histogram around each operation, not continuous long-task or frame-time profiling.',
    'Build time is null for a prebuilt dist unless --rebuild is explicitly requested.',
  ],
  build: null, bundle: null, backend: null, configuration: null, fixtures: [],
};
try {
  await execute(options, report);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { message: error.message, stack: error.stack?.split('\n').slice(0, 12).join('\n') };
  if (error.build) report.build = error.build;
  process.exitCode = 1;
  console.error(`Benchmark failed: ${error.message}`);
} finally {
  try {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, JSON.stringify(report, null, 2) + '\n');
    console.log(`Raw benchmark JSON: ${options.out} (${report.status})`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`Unable to write raw benchmark JSON: ${error.message}`);
  }
}
