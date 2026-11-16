# Material field physics and reproducible evidence

Scope: issue #4, workstream 03, original CPU material-field solver. The public `MaterialSurface` and `createReservoir` signatures remain unchanged; no schema, painter orchestration, geometry, preset, or studio files are modified.

## State and equations

The solver allocates seven Float32 arrays per pixel (red/green/blue optical absorbance totals, pigment mass, carrier/water, relief, and mobile pigment) plus one Uint8 tag. This is **29 bytes/pixel** before first presentation, **33 bytes/pixel** with the single reusable RGBA cache. The 33,554,432-pixel constructor cap remains, and the caller must budget roughly 33 bytes/pixel **per material layer** plus external Canvas, raster masks, cached composites and JS overhead. A 1024×1536 material surface has 43.5 MiB of fields and 6 MiB of presentation cache (49.5 MiB total); this is not a whole-render process-memory guarantee.

All media retain the six existing names: watercolor, ink, oil, knife, graphite and marker. This is not a fluid dynamics or full bristle solver.

1. Watercolor and ink move *mobile* pigment with carrier exchange between adjacent cells. Pair fluxes subtract from source and add to destination, capped by the available mobile pigment, source pigment, and destination 32-unit capacity.
2. When both neighboring cells are wet, watercolor with nonzero granulation can additionally exchange mobile pigment downhill in a fixed, seed-dependent substrate-tooth field. The tooth is tied to canvas coordinates; no temporary noise image or new array is allocated. This exchanges **pigment mass and its optical absorbance together**, rather than altering the rendered pixels after the fact. Ink does not use this term.
3. Carrier evaporates each solver step. Mobile pigment becomes fixed faster at a drying front and in lower paper tooth. `dry()` forces both carrier and mobile pigment to zero and releases the active simulation footprint. Dry pigment remains optically visible.
4. Oil and knife deposit paint from a finite, gesture-ordered reservoir. Contact with existing **wet** oil can remove a bounded quantity from the surface, mixing its absorbance into the reservoir before subsequent deposition. A near-empty reservoir makes discontinuous substrate contact. A fresh reservoir is a new loaded gesture; short sequential masks with the same reservoir model pigment travel, not individual bristle reservoirs.
5. Oil and knife relief fields shade via local height gradients, paper-tooth microrelief, and the wet binder's gloss. A `dry()` call invalidates any cached wet highlight region. Relief and gloss are illustrations of thickness, not validated rheology.

### Conservation and numerical tolerances

- **Watercolor/ink step:** the total pigment mass `sum(surface.pigment)` must remain within absolute **0.005 pixel-coverage mass units** of the pre-step total for the specified bounded test scenes. Evaporation *does* intentionally reduce `sum(carrier)`; pigment is neither evaporated nor created.
- **Oil pickup and deposit:** after the underpainting, `sum(surface.pigment) + reservoir.remaining` must remain within **0.005** across sequential masks. Initial added underpaint is a distinct input, not included in that budget. The reservoir is always finite in the quantitative experiments.
- Float32 field storage means equality is *not* mathematically exact after many transfers. The documented absolute tolerance applies to our fixed-size tests and experiments, not an error bound for arbitrarily many saturated or maximum-sized operations. Repeated saturated deposition is capped to avoid overflows.
- No negative field below `-1e-6`, NaN, or infinity is permitted. `mobile[i] <= pigment[i]+1e-5` is checked after stress updates. `rgba()` must allocate at most one presentation buffer regardless of repeated calls.
- Local conservation does not imply spectral accuracy; RGB absorbance accumulation and sRGB presentation are a simple transparent-color approximation.

### What the scenes actually measure

`scripts/material-studies.mjs` produces a machine-readable `manifest.json` with input parameters, field extrema and sums, initial/final mass budgets, RGB hashes, changed-channel counts, and SHA-256 of actual native PNGs. The same fixed masks and seed are passed to the pre-change solver and current solver where the pinned baseline source is available.

| Experiment | Controlled comparison |
| --- | --- |
| `water-wet` / `water-dry` | Same horizontal mask and color; only binder wetness differs. Wet mobile pigment can travel; dry pigment cannot. |
| `wet-cross` / `dry-cross` | Same two crossing colored masks; the first passage remains wet or is explicitly dried before the second. |
| `oil-depletion` | A single ordered, finite-capacity oil reservoir is moved through 15 contiguous short masks across existing wet blue paint. |
| `knife-relief` | Same sequence and loading conditions using the knife relief multiplier. |

Each experiment exports `*-native.png` at **240×180**, a **130×100 native 100% crop**, and a **390×300 nearest-neighbor 3× crop**. They are produced by `@napi-rs/canvas` with Canvas2D smoothing disabled, without super-resolution or synthetic replacement pixels. A separate 960×720 six-media contact sheet passes through the complete `Painter` raster path; six native 100% and nearest-neighbor 3× crops accompany it.

The pinned baseline is `8665223329eedb138d90e81e1e8254fdc92cc99d:src/materials.ts`. Baseline source is read via `git show`; shallow CI checkouts may need a bounded Git fetch, and the script attempts this **only** for evidence in CI. When unavailable, the manifest marks the before source unavailable and produces **after-only** evidence; it never mislabels current output as baseline output. Set `MATERIAL_BASELINE_SOURCE=/path/to/original/materials.ts` to compare offline. No application execution requires Git or network access.

To reproduce from a local checkout with Node ≥22:

```sh
npm ci
npm run check
RUN_MATERIAL_STUDIES=1 node --test tests/materials.test.mjs
node scripts/material-studies.mjs evidence/renders/material-studies
npm run test:browser  # requires a real Playwright Chromium executable
```

GitHub CI also executes the material tests and the native evidence script, depositing outputs under `evidence/renders/material-studies` so the existing verification artifact includes them. The user-facing studio browser suite is a separate actual Chromium test and is never replaced by a simulated browser.

### Before/after interpretation and known limitations

The raw per-scene `changedChannels` and image hashes are **observations**, not perceptual quality scores. An unchanged `water-dry` control is expected when only wet transport changes. Look at the paired native exports and matching enlarged crops before concluding whether the wet edge, substrate granulation or oil gloss improved in appearance. No benchmark, photorealism score or visual approval is inferred from a passing conservation test.

Material physics remains isolated **per layer**. Water flowing across two painter layers cannot bleed between them, and an oil reservoir cannot pick up pigment painted in another layer. Doing so accurately would require altering read-only `src/painter.ts` and defining cross-layer ordering/compositing behavior in a separate future PR. This PR does not claim spectral mixing, actual water depth, paint chemistry, per-hair transport, or consistent light across all surface scales.

All solver changes are original and do not copy reference-engine implementations. Source licensing work remains with issue #2.
