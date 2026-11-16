# Resumable project checkpoint

**Repository:** [H-H-E/PoiesisPainterPackage](https://github.com/H-H-E/PoiesisPainterPackage).  
**Current reviewed baseline:** `main` at [8665223329eedb138d90e81e1e8254fdc92cc99d](https://github.com/H-H-E/PoiesisPainterPackage/commit/8665223329eedb138d90e81e1e8254fdc92cc99d) (checked 2026-11-15).  
**Active audit issue:** [#2 — source audit, parity matrix and licensing](https://github.com/H-H-E/PoiesisPainterPackage/issues/2), independent branch `feat/reference-audit-parity`; **never merge from this workstream**. Issues #3–#6 are separately assigned.  
**State:** Repository is **not empty**. It contains a versioned agent-oriented painting score, Canvas2D-CPU renderer, material solver, studio, native/Chromium test scripts and CI workflow. This replaces the stale “repo empty” checkpoint written before the implementation existed.

## What exists on main (inspected, not a runtime claim)

- [src/schema.json](../src/schema.json) and [src/validate.ts](../src/validate.ts): bounded JSON v1 commands `stroke`, `fill`, `hatch`, `family`, `wait`, strict input/work estimates.
- [src/painter.ts](../src/painter.ts): validated asynchronous staged rendering, per-layer material fields, layer caching, progress/cancellation, undo/redo, JSON score serialization, crop and true-dimension raster rerender. The reported backend is `canvas2d-cpu`.
- [src/rasterizer.ts](../src/rasterizer.ts) and [src/geometry.ts](../src/geometry.ts): continuous sampled gestures, geometry-derived bristle strokes, polygon fills, hatch/family generation and intent controls. This is **not** a GPU bristle shader or a per-bristle pigment reservoir.
- [src/materials.ts](../src/materials.ts): seven float fields and byte tag per pixel, local conservative pigment/water movement, drying, ordered oil gesture reservoir and simplified height shading. No fluid velocity, WebGPU, spectral K/S or cross-layer material transport.
- [studio/](../studio), [tests/](../tests), [scripts/render.mjs](../scripts/render.mjs), [.github/workflows/ci.yml](../.github/workflows/ci.yml): browser UI, unit tests, real Chromium test, native render harness and a CI job that runs `npm ci`, `npm run check`, `npm run test:browser` and `npm run render`. Their source was inspected; running checks and reviewing pixels are separate activities.
- [references.lock.json](../references.lock.json) and [scripts/fetch-references.mjs](../scripts/fetch-references.mjs) pin and fetch five reference engines; the lock was left read-only in workstream #2.

## Workstream #2 audit deliverables

Read [docs/references/README.md](references/README.md) for lock verification and evidence definitions. The five per-source audits live in `docs/references/`; [probes.md](references/probes.md) gives falsifiable, unexecuted experiment instructions; [parity-matrix.md](parity-matrix.md) records structural comparisons with explicit parity statuses; [architecture.md](architecture.md) records the CPU-vs-WebGL2-vs-WebGPU-vs-worker-vs-WASM tradeoffs and current decision. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) distinguishes MIT reference software from separately licensed imagery, data and optional vendor files.

**Inputs examined:** exact pinned commits and license files read via GitHub connector. All five commit/tree SHAs matched lock, recursive trees were not truncated. **Scope:** documentation and notices only. No upstream source was copied; no changes to `src/**`, `tests/**`, `studio/**`, `examples/**`, scripts, manifests, lock, `LICENSE` or workflows.

## Verification and evidence register

| Check | State / evidence | What cannot be claimed |
| --- | --- | --- |
| Main/PR/branch snapshot | GitHub `main` commit `8665223` and no open PRs at branch creation; audit branch from that commit | This state can change as #3–#6 begin; refresh before PR |
| Five source locks/licenses | **Inspected** pinned commits/trees and actual MIT license text; asset caveats in notice | Not local git clone, not runtime validation, not license counsel |
| Source feature/architecture analysis | **Inspected** concrete APIs, shaders/fields and pipeline paths, linked at pins | Not cross-engine pixel fidelity, speed or memory measurement |
| Local reference runtime | **Blocked**: test container could not resolve `github.com` during `git ls-remote`; no locked clones were run there | No claims that source benchmarks, browser screenshots or demos passed |
| Poiesis build, unit/browser tests, native renders | **Not yet reported in this checkpoint.** PR checks use [.github/workflows/ci.yml](../.github/workflows/ci.yml); inspect their concluded jobs/artifacts | Inspecting scripts is not a test pass. Do not infer pixels visually reviewed from artifacts alone |
| Real visual/performance evidence | **Not verified** by this docs-only audit; [probes.md](references/probes.md) explains how to capture it | No fabricated benchmarks, screenshots, independent visual claims or AI token counts |

## Next safe steps for a reviewer

1. Verify PR diff touches only `docs/references/**`, `docs/parity-matrix.md`, `docs/architecture.md`, this checkpoint and `THIRD_PARTY_NOTICES.md`. Do not edit or merge other workstreams' files.
2. Check CI with `npm ci && npm run check`, actual Chromium `npm run test:browser`, native `npm run render`, preserving output hashes and screenshots. The project's CI workflow already invokes these.
3. On a network-enabled host, run `npm run references`, confirm five detached HEAD commits, then execute the targeted source/comparator probes. Record source-specific outcomes in [probes.md](references/probes.md) before upgrading parity statuses.
4. Keep release priorities limited to empirically justified missing controls and quality improvements; an accelerator or a schema change requires its own issue/owner and a separate PR.

## Evidence policy

Always distinguish (1) inspected code and license, (2) actually executed command with exit status, (3) **visually reviewed** pixels, and (4) measured time/memory under a stated workload. Preserve raw evidence and its provenance. Do not equate unit-test passing with visual parity, and do not claim arbitrary small-model compatibility or engine parity without observing it. This is a project checkpoint, not an authorization to merge, deploy, publish or change settings.
