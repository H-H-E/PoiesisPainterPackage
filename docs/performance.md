# Reproducible performance measurement

This suite measures the actual `Painter` API using **`@napi-rs/canvas` native Skia Canvas2D** in Node. It is a **CPU/native-canvas benchmark, not a browser, WebGL, GPU or upstream-engine comparison**. There are no paid APIs, inference services, or servers. All numbers are per-machine observations; the benchmark has no universal speed target.

## Exact commands

From the repository root, on Node 22+ (the CI job uses Node 24):

```sh
npm ci
npm run check
node --test benchmarks/*.test.mjs
npm run benchmark -- --smoke --out evidence/benchmarks/smoke.json
npm run benchmark -- --out evidence/benchmarks/full.json
# To measure a fresh build explicitly rather than reuse dist:
npm run benchmark -- --rebuild --out evidence/benchmarks/full-with-build.json
# Actual browser integration and screenshot checks (requires Chromium):
npx playwright install chromium
npm run test:browser
```

The benchmark creates the output's parent directory and writes **raw JSON** for each run, including failures. Omitting `--out` writes to `evidence/benchmarks/smoke.json` for `--smoke` and `evidence/benchmarks/full.json` otherwise. The runner builds automatically if `dist/index.js` or `dist/bundle-size.json` is absent; it reports whether the build was measured or an existing build was reused. For a clean repeat, run `npm ci && npm run check` first. `--rebuild` times `npm run build` as a **separate** field, not as render time. Build duration is `null` if the existing build was reused.

GitHub Actions runs the smoke command after `npm run check` and stores `evidence/benchmarks/smoke.json` with other CI evidence as a downloadable workflow artifact. A successful PR smoke check is not evidence that the default three-fixture benchmark was run.

## Fixed fixtures (v1)

Definitions and deterministic score construction are in [`benchmarks/fixtures.mjs`](../benchmarks/fixtures.mjs). They use the package's unmodified v1.0 JSON score, two layers, a filled ground, an explicit wait on the ground layer, and individually numbered strokes on the second layer. The second layer's `stroke-0` gets a `speed: 1.2` revision. The control has identical material settings and commands except that the wait is removed. No random generator external to the document seed is used.

| Mode | Fixture(s) / medium | Size | Strokes + fill | Wait steps | Warmups | Timed trials |
| --- | --- | --- | --- | --- | --- | --- |
| `--smoke` | `watercolor-wash` / watercolor | 160 × 112 | 3 + 1 | 2 | 1 | 3 |
| Default | `ink-lines` / ink, `watercolor-wash` / watercolor, `oil-strokes` / oil | 384 × 256 each | 7 + 1 each | 3 each | 2 per fixture | 5 per fixture |

The suite rejects altered fixture definitions exceeding 384 × 256 pixels, seven strokes, or three explicit wait steps. It also validates every document with `validatePainting` and checks strict workload bounds before rendering. **There is no 8K default** and no extrapolation from these small scores to large documents. Exact fixture metadata, a score SHA-256, engine workload estimates, per-layer reports (commands, marks, cache hits and material statistics), and revised PNG SHA-256 hashes are recorded.

Each repetition starts with new `Painter` and native Canvas instances. The full baseline includes explicit wait steps. The same trial also performs a full no-wait control, an exact-cache rerender, the single-stroke revision (reusing the unchanged ground layer), a full fresh render of the *identical revised score*, and synchronous PNG encoding. Trials alternate whether the with-wait or no-wait rendering runs first. The suite verifies cache hit counts, checks that fresh and cache-revised PNG hashes are equal, and checks hash stability across repeated trials. These assertions turn correctness regressions into failures rather than misleading speed observations.

## Reading the JSON

- `environment`: Git commit, Node/V8/native architecture, OS/kernel release, CPU model/count, system RAM and CI flag. Samples in `processMemoryAfterBytes` are **whole-Node-process** RSS, heap, external and array-buffer memory, **not GPU, renderer-only, or canvas allocation measurements**. They are not a claim of VRAM usage.
- `build`: measured `npm run build` wall time only if the runner builds or `--rebuild` is supplied; otherwise `durationMs: null`. `bundle` reads the existing minified browser-core size, gzip size, standalone HTML size and runtime dependency count from `dist/bundle-size.json`. Bundle sizes are not inference/runtime speeds.
- `coldStartup`: a **new child Node process** for each fixture, with its outside-process total wall time, inside-process dynamic module import time, and its first complete `Painter.render`. Process boot/import/render costs are kept separate from warm trial aggregates. They must not be added as independently nonoverlapping components of child wall time.
- `warmups` and `trials`: raw individual, ordered repetitions, with wall-clock durations (`performance.now()`), layer-level `Painter` reports, PNG hashes/bytes, and observed timer-delay histograms. Warmups are **not** included in summary statistics.
- `summary`: median, interpolated p95, min/max, mean, sample standard deviation, median absolute deviation (MAD), interquartile range (IQR), and sample count over timed trials. No fastest-run-only headline is reported. The `pairedWaitDifference` is `fullWithWait - fullWithoutWait` within each trial: it estimates **explicit wait overhead but also includes JIT, GC and scheduling variability**. Negative differences are retained rather than silently clamped.
- `eventLoopTimerDelay`: Node's observed 10 ms timer-delay histogram around each operation (plus 15 ms before and after). This is not a complete long-task trace, frame-time percentile, GPU completion time, or a measurement of per-mark blocking. Values can be null when sampling is unavailable.

## Baselines and competitor status

**Do not interpret blank/unmeasured cells as zero or parity.** Read an actual run's JSON and its recorded machine metadata before reporting any number. The table intentionally refrains from inventing observations. CI's pinned hardware is not a reliable universal performance baseline, and different upstream APIs need an equivalent visual-workload normalization before timing comparisons.

| Engine / audit reference | Full render median/p95 | Cached revision median/p95 | PNG encode median/p95 | Status |
| --- | --- | --- | --- | --- |
| Poiesis Painter v0.1.0 / native Skia Canvas2D | Read generated run JSON | Read generated run JSON | Read generated run JSON | Measured by the script when executed; no committed cross-machine constant |
| `p5.brush` (`054f2feb`) | **Not yet measured** | **Not yet measured** | **Not yet measured** | Pinned audit input only |
| `oil-paint-agents` (`09a2750b`) | **Not yet measured** | **Not yet measured** | **Not yet measured** | Pinned audit input only |
| `washes-js` (`14e485b6`) | **Not yet measured** | **Not yet measured** | **Not yet measured** | Pinned audit input only |
| `sho` (`ffcb4caf`) | **Not yet measured** | **Not yet measured** | **Not yet measured** | Pinned audit input only |
| `wet-edge` (`e4ce2ec7`) | **Not yet measured** | **Not yet measured** | **Not yet measured** | Pinned audit input only |

The upstream source pins and license notes live in [`references.lock.json`](../references.lock.json) and are read-only for this workstream. No upstream project is installed, run, or included in the performance results. No claims of speedups, realism, visual parity, perceptual quality, browser frame rate, or GPU utilization follow from this native test.

## Evidence and limitations

Performance output is raw `evidence/benchmarks/*.json`, uploaded by GitHub Actions; the existing `npm run test:browser` runs real Chromium integration checks and saves separate screenshots and its own report. A native PNG hash proves stable bytes under a given backend, **not** high-quality painting or consistency across GPU/browser backends. Use [`scripts/render.mjs`](../scripts/render.mjs) for actual native-resolution scene PNGs, 100% crops, and nearest-neighbor enlarged crops; this benchmark does not substitute for visual review.

The default benchmark is deliberately a small, deterministic regression diagnostic. For a meaningful release performance comparison, keep the JSON score and native backend version fixed, run on a characterized machine with controlled system load, include several machines, and report the raw file with all metadata. Re-run after any rendering-engine change. Browser engine/frame-time or GPU timings remain **not measured by this suite**.
