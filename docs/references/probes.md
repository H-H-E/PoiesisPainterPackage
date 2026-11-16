# Reference-to-Poiesis parity probes

**Status on 2026-11-15:** all reference-specific procedures below are **specified but NOT EXECUTED**. They are a falsifiable test plan, not test results or sample screenshots. Read the source-specific [audits](README.md) and [parity ledger](../parity-matrix.md) first. The source files, public API and license notices were **inspected**, not run. This directory does not ship upstream source or generated art.

## Reproducible baseline and evidence contract

From `H-H-E/PoiesisPainterPackage` at the PR head on a network-enabled host:

~~~bash
node --version; npm --version
npm ci
npm run check
npm run test:browser
npm run render
npm run references
for repo in ../references/*; do echo "$repo"; git -C "$repo" rev-parse HEAD; git -C "$repo" status --short; done
~~~

The reference installer uses [references.lock.json](../../references.lock.json). If the repository has different reference checkout paths, use `POIESIS_REFERENCE_DIR` consistently. A dirty or wrong pinned checkout invalidates comparisons.

Before each probe record: **audit ID**, source pin and git HEAD, input script/score verbatim, seed, canvas dimensions, iterations/step count, operating system/CPU/GPU/renderer and browser version, actual stdout/stderr and exit status, PNG/snapshot path plus SHA-256, measured values **with units**, whether pixels were *actually reviewed*, and reviewer observations. Negative claims require an attempted test, not an absence of a README mention. Where implementation does not offer the instrument, mark `unsupported`; do not fabricate an image.

Poiesis reference probes: [tests/geometry.test.mjs](../../tests/geometry.test.mjs), [tests/engine.test.mjs](../../tests/engine.test.mjs), [tests/materials.test.mjs](../../tests/materials.test.mjs), [tests/browser.mjs](../../tests/browser.mjs), [examples/scenes.mjs](../../examples/scenes.mjs), [scripts/render.mjs](../../scripts/render.mjs). Run `npm run render` to generate `evidence/renders`; inspect the manifest and original-size crops, never infer that a screenshot was reviewed merely because it was created. Check source file presence before using optional fixtures.

### Standard input family

Construct a 256×192 portrait-neutral canvas with background `#f4f0e8`. Use random seed 42 wherever available; for sho use paper 256×192 and the same coordinates in paper units. Paths: A = (24, 96) → (232, 96), B = (128, 24) → (128, 168), both pressure 1, and a 100×64 rectangle centered at (128, 96). Draw A in dark blue `#25466a` and B in yellow ochre `#ca9b43` with 16 px nominal width. Where APIs demand normalized coordinates, divide x by 256 and y by 192; for fractional brush radius divide by smaller side, 192. A source's built-in pigment recipe may not exactly match these colors: record the actual pigment, and compare **behavioral response** rather than RGB hashes across engines.

Each source operates in different units, simulation steps and render backends. Align the physical pixel footprint and order of operations *before* comparing. Do not treat file compression differences as pigment differences; decode RGBA for pixel comparison when appropriate.

## p5.brush — WebGL2, standalone or p5 adapter

At `../references/p5.brush`, run `npm install && npm test`, then `npm run serve` with a WebGL2-capable browser. Use the [standalone documented API](https://github.com/acamposuribe/p5.brush/blob/054f2feb2ec8f98bd6dbb7d676d0335323180d83/docs/standalone.md) (`createCanvas/load`, `set`, `line`, `hatch`, `fillBleed`, `render`); supply a centered-origin translation. Re-run seed 42, identical viewport/pixelDensity, screenshot or pixel dump after `render()`. For each parameter isolate one change. Do **not** presume custom tip and image tip have identical pixel paths.

| ID | Minimal independent experiment | Acceptance observation to capture |
| --- | --- | --- |
| PB01 | Draw A with stock brush, then register a simple 2D ellipse as custom tip via `brush.add`; draw A with that tip, same color/weight | Custom/stock tip footprints differ; record normalized alpha profile and custom-tip loading outcome |
| PB02 | A with many control points at constant color then A using `flowLine`; vary line length and brush weight | Long line joins and no isolated subsegment endpoints; flowLine follows field when enabled; crop path joins |
| PB03 | Repeat seeded dense dots and spray at the same seed; change seed, holding density fixed | Same backend/seed RGBA hash repeats; changed seed changes dot placement; compare alpha occupancy |
| PB04 | Fill the standard rectangle with two `fillBleed` softness values and two `fillTexture` settings | Rim width and feathering change without losing main shape; quantify edge-alpha falloff |
| PB05 | Draw touching wet blue and ochre fills before `render()`; repeat with a flush separating them | Wet-edge mixing only on unflushed series; compare boundary pixels before and after flush |
| PB06 | Hatch a *concave* polygon with spacing 8 and 16 and angle 0° and 45°; apply mass/scribble if supported | All hatch endpoints lie inside/on polygon, segment counts respond to spacing; mass has curved/dense strokes, not merely straight hatching |
| PB07 | `addField` one constant-angle field; activate, draw flowLine; change to perpendicular field | Tangent direction responds to chosen field with seed held fixed |
| PB08 | Render A, then a second canvas using `load`; render again on first, with matching flush operations | Target isolation and explicit flush verified; record WebGL2 support/fallback if context unavailable |
| PB09 | Overlay blue/ochre masked strokes and compare against same blue/blue case; sample central RGB | K/S mix differs from plain source-over; do not equate visual resemblance with physical reflectance correctness |
| PB10 | Repeat upstream `npm run measure:bench -- --angle=metal` only if that backend is available; otherwise record chosen supported ANGLE backend | Retain raw source timing/fixtures/hardware; compare only matched input/render backend, NOT upstream published ms to unrelated Poiesis runs |

## oil-paint-agents — CPU bristle oil model

At `../references/oil-paint-agents`, run the pinned [README command](https://github.com/halfprice06/oil-paint-agents/blob/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3/README.md#L35-L57) to generate an example, plus `--scale 3` on the same folder. For isolated tests author a *separate disposable painting folder* (not the source repository) with a `painting.json` pass list and a JavaScript pass file invoking `p.stroke`; this is an experiment, **not a copied sample**. See source's [SKILL.md](https://github.com/halfprice06/oil-paint-agents/blob/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3/.claude/skills/oil-painting/SKILL.md#L24-L50) for format.

| ID | Minimal independent experiment | Acceptance observation |
| --- | --- | --- |
| OA01 | Paint A once with flat brush, then with filbert, fan, knife, soft and double-load options one at a time | Changes in characteristic stroke silhouette and width, not just recoloring |
| OA02 | One stroke on unpainted weave, record 1x crop and height/gloss output (if exposed to caller) | Mark skips and relief correlate with weave; distinguish array values from screenshot judgments |
| OA03 | Lay wet blue A, then dry/empty brush (`load:0`) from center to blank right region; repeat with clean/wiped bristles | Pickup/migration and spatially nonuniform bristle color persist where brush drags |
| OA04 | Compare blue+yellow pigment name mix at stir 1 and 0.1, fixed seed; compare single-color baseline | Marbled color separation responds to stir; log components, sample channel variance |
| OA05 | Paint loaded opaque broad knife stroke, then thin scumble across dried/undried paint | Ridges, bow wave and dry-brush gaps change with `load`, `scumble` and prior wetness |
| OA06 | Same second paint stroke with preceding `p.dry()` versus not; preceding `p.wipe()` versus not | Wet pickup switches off after dry; residue switches off after wipe |
| OA07 | Render same pass sequence at scale 1 and scale 3, crop 3x; check PNG header width/height and image detail | Resimulation has finer bristles/relief; 3x is not nearest-neighbor enlargement |
| OA08 | Same painting seed/pass order twice; compare decoded RGBA; change order; try legacy ENGINE selector if present | Same engine version/seed equal hashes; order responds; legacy replay explicitly version-scoped |
| OA09 | Two source-separated pass folders, combine ordered passes in a disposable third folder and run render | Final order changes result; this checks a **workflow** and not an automated painter-agent runtime |

## washes-js — CPU watercolor plus optional WebGL2 sim

From `../references/washes-js/engine`: `npm install && npm test && npm run test:sim-core && npm run test:save-load && npm run test:seed`. Repeat optional `npm run test:gpu-sync`, `npm run test:texture-parity`, `npm run test:worker` and `npm run test:browser` only after installing their browser/GPU dependencies. In a browser import `Washes` via the documented ESM entry, create a same-size host, call normalized `stroke(nx,ny)` along A/B, `penUp()` between strokes, `saveState()`, `exportImage({mimeType:'image/png'})`.

| ID | Minimal independent experiment | Acceptance observation |
| --- | --- | --- |
| WA01 | Single stroke then 0, 10, 50 `simStep` calls on a same-size headless test instance | Wet and deposited pigment state evolve; no invented fps guarantee |
| WA02 | Same pair of strokes with default vs added `stir` velocity/gravity setting | Pigment transport depends on imposed flow, not just repeated brush masks |
| WA03 | One wet patch with edgeDarkening/granulation changed; step until dry, repeat seed | Edge/pigment profile and wetness change predictably; conserve pigment within documented tolerance |
| WA04 | Start one continuous stroke A, `penUp`, stamp crossing stroke B, `rewet` region, then `dry` | Stroke joins, pen lift, local rewet and dry separately alter states |
| WA05 | Repeat same input in CPU default and opt-in GPU sim on a WebGL2-capable host; run shipped gpu-sync tests | Compare field values and image with the upstream's declared tolerances; report unsupported GPU separately |
| WA06 | Roundtrip `packState`/`unpackState` across arrays; transfer to worker and back with upstream worker test | All field arrays bitwise equal where specified; typed buffers transferable |
| WA07 | `traceSVG` a rectangle path and paint a 2×2 pixel local image/text input | SVG is **ingested** and deposits pigment; this is not a vector export test |
| WA08 | Save `saveState()` and `getPreset()`; new matching instance `loadState()`/applyPreset; export PNG/Blob | Arrays and PNG pixel output agree under fixed size/backend; refuse mismatched grid |
| WA09 | `WashesTimeline` stroke A over 250 ms, wait 100 ms, pause then resume and cancel | Clock-based partial stroke/cancel observable, distinct from simulation dry steps |
| WA10 | Create default CPU instance on Canvas2D host, then `createAsync` second instance | Functional before/during init as documented; record no-WebGL and browser support honestly |
| WA11 | Run upstream seed/save-load/gpu-sync tests and preserve test logs | These are upstream test outcomes on local host, not proof of Poiesis/source pixel parity |

## sho — calligraphic Canvas2D

Serve `../references/sho` with `python3 -m http.server 8765`, open `examples/demo.html`. Constructor `new Sho.Engine(canvas, {width:256, height:192, paper:null, instant:true})`; `enqueue` an array or feed JSONL through `new Sho.StreamParser`. The standard A path in paper units is `[[24,96,1,42,1,0],[232,96,1,42,1,0]]`. Encode with `toDataURL()`. Record both dark and pale ink tones.

| ID | Minimal independent experiment | Acceptance observation |
| --- | --- | --- |
| SH01 | Draw A with per-point angle 0°, then 90°; insert one `"k"` sharp-corner into a three-point path | Tip/belly width/orientation and sharp corner respond; Poiesis lacks these inputs |
| SH02 | Two consecutive A/B strokes, `ink_load=0.5`, `speed=4`, compare `speed=1` | Later/faster portions show bristle gaps and depletion |
| SH03 | Insert `pause=1.5` at endpoint vs 0 with identical seed/path | Local pooling and rounded end width change |
| SH04 | Pale ink `bleed:'ring'` vs `'capillary'`, identical brush and path | Rim halo and jagged fiber edge differ; not whole-sheet transport |
| SH05 | `autoDip:false` vs `'stroke'`; `dip` manually before second stroke | Reload changes second stroke density in intended way |
| SH06 | `flush()` with instant mode vs queued animated mode on a real browser; call `destroy()` | Same completed frame at same settings, animation events / teardown distinguish modes |
| SH07 | Feed a JSONL stroke in three chunks that split at an arbitrary character; call `end()` | Only whole JSONL commands reach engine; complete output equals unsplit input |

## wet-edge — WebGPU watercolor field

In locked `../references/wet-edge`, run `npm install && npm run serve` and check `navigator.gpu`/adapter. A minimal external painting script can be run with `node tools/paint.mjs /tmp/minimal-wet-edge.mjs --shot /tmp/wet-edge.png --save /tmp/wet-edge.wcpaint --looks /tmp/wet-edge-looks`, following the documented [SCRIPT_API](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/src/actions.js#L106-L162). Do not assume `--enable-unsafe-webgpu` supplies a supported adapter. Use a fixed paper seed through `sim.headless.setPaper`, inspect `sim.sense` around standard strokes, record wetness/absorbance stage and screenshots at named points.

| ID | Minimal independent experiment | Acceptance observation |
| --- | --- | --- |
| WE01 | Deposit pigment plus water and advance fixed simulation frames; inspect suspended/deposited/saturation | Water and pigment transport and settling change over stages; conservation probe retained |
| WE02 | Run same script with/without adapter, measure dispatch time, record supported limits | WebGPU initialises or reports explicit unavailable failure; no CPU fallback assumption |
| WE03 | Use one pigment, then two-pigment mix with changed granulation/staining recipe | K/S color/glaze and settling vary; compare raw pigment profile and output, not RGB alone |
| WE04 | Paint A then mist/blot/rewet/tilt or mask a standard rectangle | Tool effect changes paper/paint as described and can be undone |
| WE05 | Call `sim.sense`, `M.mark` or `M.soften` on a known painted edge; compare pre/post readback | Behavior depends on actual sensed coverage, not canned mask |
| WE06 | Script one `sim.path`, `sim.look`, `sim.wash` and save PNG/layer in headless runner | Same action names callable from script; screenshot/PNG artifacts exist and are valid |
| WE07 | Save replay journal, undo, redo, replay in new session at same seed | Exact state hash repeated after replay on same engine/backend if source promises it |
| WE08 | Save .wcpaint and PNG/layer PNG, decode PNG signature and compare size | Raster/file state output exists; **not SVG vector export** |
| WE09 | Run `npm run measure` on idle system with fixed wet coverage, repeat >=5 times | Report median real-time ratio, per-step ms, GPU and state hash; source doc's M3 Pro ratios remain upstream-reported |

## Poiesis-specific bridge tests (required even if upstream runtime is blocked)

| Probe | Reproduction command or input | Outcome to record |
| --- | --- | --- |
| PP01 | `npm ci && npm run check` | TypeScript build, unit-test pass/fail, exit code, Node version, artifacts |
| PP02 | `npm run test:browser` with Chromium; if blocked, record launch/deps error and leave status not verified | Real DOM studio apply/revise/cancel, downloaded raster PNG, crop PNG, JSON, responsive screenshots and browser error log |
| PP03 | `npm run render`; retain `evidence/renders/manifest.json`, native 1x PNGs and crops | Original render fixtures for landscape/ink/watercolor/oil/studies, actual pixel hashes and sizes |
| PP04 | [tests/materials.test.mjs](../../tests/materials.test.mjs): watercolor pigment mass, dry freeze, oil reservoir pickup after wet paint, oil over dry | Compare assertions rather than impression: mass error, nonempty later segment and no wet diffusion of dry mark |
| PP05 | [tests/engine.test.mjs](../../tests/engine.test.mjs): same document replay; invalid edit, cancellation, undo/redo, resize export | Hash of committed pixels stable on failed edit/cancel; cache/cleanup records correct |
| PP06 | Use [studies()](../../examples/scenes.mjs#L90-L107) and compare raw cropped PNGs before claiming a visual edge/bristle/impasto improvement | Material-specific human visual notes, resolution and crop positions, negative observations included |

**Upgrade rule:** the matrix can say `verified` only for an individually executed and evidenced behavioral parity test; unit tests inside one engine do not establish cross-engine fidelity. `implemented-unverified` means the analogous Poiesis mechanism exists in inspected source but was not paired; `approximate` means a different/simpler algorithm is positively identified. Keep `unsupported` for an explicitly absent public capability and `inapplicable` for a technique outside that source's intended medium.
