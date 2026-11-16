# Continuous-bristle mark fidelity (issue #3)

Scope: src/rasterizer.ts, src/geometry.ts, tests/geometry.test.mjs, tests/rasterizer.test.mjs, scripts/mark-studies.mjs and this note. The JSON v1.0 score, painting/material solver, and studio interface are unchanged.

## Implementation

- **Common physical arc-length phase.** Previously, contact runs were decided at Sample.t values supplied by the path sampler. Removing or inserting samples could change where dry bristles touched and create one-sample paint fragments. A shared centerline trace now advances on an absolute ~1.25-native-pixel grid (at most 16,385 samples). Continuous bands and contact gates are evaluated at this trace; noise is keyed to absolute Sample.distance and the seed. Chunked oil/knife paths retain the distance origin provided by painter.ts.
- **Bristle bundles, not stamps.** Every hair follows a connected swept polygon. Groups of four share a slow transverse drift; individual hairs add smaller drift, with no random draws during vertex traversal. Dry graphite, low-load brushes, and oil strands use correlated contact strength instead of random sample-by-sample omissions. Runs shorter than 1.25 native pixels are omitted to avoid isolated dabs.
- **Pressure, ends, and bends.** Hair footprints shrink with pressure; zero pressure yields no mask. Connected ribbons use quadratic round tips at their true endpoints. A genuinely stationary touch is a single dab. The centripetal Catmull–Rom sampler increases bounded subdivision around turns, uses a one-sided tangent when opposing tangents cancel, and rejects nonfinite/empty geometry before allocating Canvas buffers. Polygon filling and family/hatch algorithms retain their existing behavior.
- **Bounded work.** The extra trace is shared by all bristles and capped at 16,385 samples; bristles are capped at 128. No per-bristle vertex arrays or full-page intermediate buffers. The Rasterizer.stroke(samples, material, command, width, height, seed, widthScale) signature remains unchanged.

## Reproducible native-pixel fixtures

Run in the repository after checking out this PR:

    npm ci
    npm run check
    node scripts/mark-studies.mjs evidence/renders/mark-studies
    npm run test:browser

The generator is also invoked by tests/rasterizer.test.mjs during npm run check. The existing CI workflow uploads evidence/renders/ as a downloadable artifact. It writes fixture.json with a fixed gesture and seed, manifest.json with input lengths, mask hashes, native PNG hashes and observational render times, plus:

- contact-sheet-native.png — original 900×760 native-pixel contact sheet.
- {watercolor,ink,graphite,oil,knife}-{loaded,dry}-native.png — ten 420×142 native-pixel paint-surface images.
- *-100pct.png — unscaled 148×88 crops at x=155,y=28 within each cell.
- *-4x-nearest.png — 592×352 nearest-neighbor duplicates, with image smoothing disabled.

The ten marks share identical gesture, pressure, seed, dimensions, roughness, bristle count, and paper. Only medium, color, and load (0.95/0.18) vary. Each cell uses the owned rasterizer and the existing read-only MaterialSurface; it is isolated from other cells. This script does not represent painter.ts oil/knife segment chunking.

## Actual before/after mask inspection

A separate controlled mask study was executed against main baseline 8665223329eedb138d90e81e1e8254fdc92cc99d and the modified renderer, using TypeScript compiled to JS and real headless Chromium Canvas2D at device scale 1. Identical 410×145-pixel gesture cells for five media, two loads, and seed 120 were rendered in both versions. The images use an opaque paper and white *geometry masks*; these are NOT the material solver's final pigment colors. Native PNGs and 4x nearest-neighbor crops were saved as separate task evidence, not checked-in assets.

| Measured native-mask statistic | Baseline | Revised |
| --- | ---: | ---: |
| 900×790 pixels in diagnostic contact sheet | Actual Canvas2D | Actual Canvas2D |
| Pixels different between images | — | 55,990 / 711,000 (7.88%) |
| Loaded ink pixels lighter than paper by >10 in R and G channels | 5,603 | 5,215 |
| Loaded graphite pixels meeting same threshold | 3,473 | 3,799 |
| Dry ink pixels meeting same threshold | 312 | 215 |

The counts describe a mask diagnostic, not opacity, pigment mass, realism, user preference, or performance. Visual inspection found coherent loaded bodies with greater strand separation around bends; dry strokes show intermittent, grouped longitudinal traces rather than a solid uniform band. A straight 184-pixel stroke produced exactly identical masks with 2, 9 and 185 input samples in Chromium. Uniform pressures of 0.2, 0.5 and 0.9 produced strictly increasing total alpha coverage. The committed Node regression tests repeat these properties with @napi-rs/canvas, including off-page bounds, tiny strokes, NaNs, and repeatability.

## Still approximate and follow-ups

- Bands with correlated 1D noise are not simulated real fibers. This does not model stiffness, twist, brush-to-brush interactions, deposition dynamics, or pigment pickup.
- **Required future interface in src/painter.ts (read-only in this PR):** paintStroke() splits oil and knife gestures into successive chunks, each calling Rasterizer.stroke independently with a fresh input slice. Globally anchored noise does not prevent each slice from drawing its own round end cap. Suppressing interior caps requires neighboring samples/halo and explicit start/end continuation metadata at the interface. Coordinate a follow-up after the other workstreams land; do not edit painter.ts in parallel.
- The materials worker owns diffusion, reservoir and physical texture. No claims of watercolor/oil realism, upstream engine parity, faster execution, or visual preference are made by this PR. The single-run rasterMs values in manifest.json provide reproducible diagnostic instrumentation, NOT a controlled benchmark.
- Rendering is deterministic within a Canvas implementation, but antialiasing and contact-sheet text can vary between Skia versions. Regression tests compare repeated results within the same backend rather than using brittle cross-platform image hashes.
