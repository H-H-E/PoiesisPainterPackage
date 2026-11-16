# Pinned source audit: scope and evidence

This is the read-only research portion of [workstream #2](https://github.com/H-H-E/PoiesisPainterPackage/issues/2). It documents reference implementations; it **does not** import, vendor, or imply pixel parity with them. Use [the feature ledger](../parity-matrix.md), [architecture decision](../architecture.md), and [reproduction protocols](probes.md) together. The actual package remains an original Canvas2D/CPU implementation.

## Verified input revisions

The exact SHA for each item below was obtained from the corresponding pinned GitHub commit endpoint; its recursive tree was successfully read with `truncated=false`. A file from the pinned revision, including the named license, was separately read. This is **GitHub-hosted source inspection**, not a successful local git clone or a runtime test. The SHA ledger is [references.lock.json](../../references.lock.json); do not silently advance it.

| Source | Inspected commit | License file read at that revision | Audit |
| --- | --- | --- | --- |
| [p5.brush](https://github.com/acamposuribe/p5.brush) | [054f2feb2ec8f98bd6dbb7d676d0335323180d83](https://github.com/acamposuribe/p5.brush/tree/054f2feb2ec8f98bd6dbb7d676d0335323180d83) | [LICENSE.md](https://github.com/acamposuribe/p5.brush/blob/054f2feb2ec8f98bd6dbb7d676d0335323180d83/LICENSE.md), MIT, Alejandro Campos Uribe | [p5.brush.md](p5.brush.md) |
| [oil-paint-agents](https://github.com/halfprice06/oil-paint-agents) | [09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3](https://github.com/halfprice06/oil-paint-agents/tree/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3) | [LICENSE](https://github.com/halfprice06/oil-paint-agents/blob/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3/LICENSE), MIT, Daniel Price | [oil-paint-agents.md](oil-paint-agents.md) |
| [washes-js](https://github.com/castavridis/washes-js) | [14e485b6e83dba1b5d02c987ae2ddd2222c60063](https://github.com/castavridis/washes-js/tree/14e485b6e83dba1b5d02c987ae2ddd2222c60063) | [engine/LICENSE](https://github.com/castavridis/washes-js/blob/14e485b6e83dba1b5d02c987ae2ddd2222c60063/engine/LICENSE), MIT, Stephanie | [washes-js.md](washes-js.md) |
| [sho](https://github.com/enpts/sho) | [ffcb4cafb28c710a2b32a21fcef8819d57854780](https://github.com/enpts/sho/tree/ffcb4cafb28c710a2b32a21fcef8819d57854780) | [LICENSE](https://github.com/enpts/sho/blob/ffcb4cafb28c710a2b32a21fcef8819d57854780/LICENSE), MIT, enpitsu | [sho.md](sho.md) |
| [wet-edge](https://github.com/lambentLogic/wet-edge) | [e4ce2ec7a37d85c17ad16bb3006959bb88a19a73](https://github.com/lambentLogic/wet-edge/tree/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73) | [LICENSE](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/LICENSE), MIT, lambentLogic; [paintings/LICENSE.md](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/paintings/LICENSE.md), CC0 for image outputs | [wet-edge.md](wet-edge.md) |

## What the evidence labels mean

- **Inspected:** source code, README, build/config or license was read at a pinned commit; the claim follows from that source. Not an execution claim.
- **Upstream-reported:** upstream's own published benchmark, screenshot, test, or qualitative description; not independently reproduced.
- **Executed:** an actual command and its exit/outcome recorded in the same document or the PR checks.
- **Visually observed:** a human or tool actually reviewed pixels of a render and identified the observation; screenshots existing in a repository are *not* independent observation.
- **Measured:** generated timings/bytes under a stated host, input and procedure; source code estimates and another project's performance table are not our measurements.
- **Not verified:** not run, not observed, or insufficient source to make a claim.

The **parity status** (verified, implemented-unverified, approximate, missing, unsupported, inapplicable) is a separate field: it compares Poiesis to a *particular upstream feature*, not to a marketing claim about that medium. Do not promote an upstream README screenshot, compile success, or vaguely similar sample into verified parity.

## Constraints and non-goals

No upstream scripts, shader contents, image files, brushes, paper images, pigment datasets, or build artifacts have been copied. All links are source citations. The licensing ledger in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) records *reference-only* usage and what to do if future work vendors any portion. The MIT licenses do not automatically license external photos, scientific measurements, fonts, or third-party vendor files.

Source discovery used GitHub's pinned commit, repository tree, and file read APIs. Local `git clone` / `git ls-remote` was blocked by DNS resolution of github.com in the test container at audit time. Therefore **reference runtime tests and numerical/visual comparisons were not performed**. The existing Poiesis renderer, source tests and browser scripts were inspected at the baseline commit; their existence is not a claim that they passed. See [probes.md](probes.md) for concrete test commands, expected observations and specific evidence required before upgrading the statuses.

## Reproduction sequence

1. On an environment with network access, run `npm run references`; [scripts/fetch-references.mjs](../../scripts/fetch-references.mjs) fetches and checks out every locked commit and fails on mismatched HEAD or dirty checkouts. Report each resulting `git rev-parse HEAD`, not merely a branch name.
2. Run `npm ci && npm run check`, `npm run test:browser`, and `npm run render` from the package root. Check the CI artifact manifest and actual PNGs; do not call a native @napi-rs/canvas result a Chromium render.
3. Execute the targeted upstream commands in each source audit and the minimal comparator protocols in [probes.md](probes.md). Retain scripts, OS/GPU, software versions, dimensions, seed, PNGs, raw hashes, timings and review notes. Compare like media **only where the mechanisms and inputs genuinely align**.
4. Update statuses only after retaining the evidence, without changing other workstreams' source or test files.

## Audit decisions

The current common denominator is a deterministic data-only mark score and CPU-resident material surfaces. The five references are *complementary*, not five interchangeable benchmark baselines: p5.brush uses shader-based appearance, oil-paint-agents runs a CPU oil bristle/height simulation, washes-js has a CPU fluid simulation with an optional WebGL2 backend, sho is a specialized calligraphic bristle model, and wet-edge is a WebGPU watercolor simulator. No single test can establish all-engine parity.

Audit prepared from source inspection on 2026-11-15; baseline Poiesis commit: [8665223329eedb138d90e81e1e8254fdc92cc99d](https://github.com/H-H-E/PoiesisPainterPackage/tree/8665223329eedb138d90e81e1e8254fdc92cc99d).
