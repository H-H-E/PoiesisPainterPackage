# Meta-rendering in Poiesis Painter (issue #16)

## What changes

Poiesis remains an original browser-native painter and an unchanged JSON v1.0 score language. A separate **agent-facing meta package** maps the same inspectable score to one or more rendering engines, preserving the native engine as the default reliable backend. Choosing an engine and painting a scene are different tasks: a small model designs the marks, while deterministic, local code validates the score and selects a compatible engine. No model call is required during rendering.

`@poiesis/painter/orchestrator` is an optional exported entry point. The original `@poiesis/painter` API, schema, material solver, tests and sidecar AI Gateway remain independently usable. This is an incremental architectural pivot, **not** a claim that all upstream engines are integrated.

## Capability contract

An adapter supplies `id`, `capabilities` (media, operations, gesture features, transparent RGBA), an optional synchronous `available()` check, and `renderLayer({score,layer,canvas,signal,canvasFactory})`. Capability levels are `native`, `approximate` and `none`. `native` means the adapter can express that particular operation, not pixel equivalence to another engine, scientific fidelity, or measured image quality. The `priority` is a documented declaration for tie-breaking, **not a measured speed/fidelity score**.

The router requests capabilities from *actual commands* (medium, operation, presence of pressure/tilt/rotation/speed/intent). It rejects missing operations, missing media, missing gesture controls and unavailable engines at the chosen minimum. An `approximate` match is allowed only with warnings. `minimum:'native'` rejects approximations. The caller can explicitly pin supported layers to an engine. The returned route explains every selection, warning and rejected choice. This makes an agent's assumptions inspectable.

Each engine renders one isolated layer onto a clear RGBA canvas; the compositor reapplies that layer's opacity, blend (`normal`, `multiply`, `screen`) and original order exactly once. It allocates temporary surfaces and copies the final composition only after every layer and callback succeeds. A render error or abort before commit keeps the previous image. Native engine render options now accept `transparentBackground:true` for this composition path; absent that option the prior opaque output behavior is unchanged.

### Quick use

```js
import { Painter, validatePainting } from '@poiesis/painter';
import {
  PaintingOrchestrator, createPoiesisAdapter,
  createCanvasReferenceAdapter, createPerfectFreehandAdapter,
} from '@poiesis/painter/orchestrator';

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h; return c;
};
const painter = createPoiesisAdapter({ Painter, canvasFactory: makeCanvas });
const simpleReference = createCanvasReferenceAdapter();
// If installed: import getStroke from 'perfect-freehand'; then inject it.
// const freehand = createPerfectFreehandAdapter({ getStroke });
const orchestration = new PaintingOrchestrator({
  adapters: [painter, simpleReference], validatePainting, canvasFactory: makeCanvas,
});
const plan = orchestration.plan(score, {
  pins: { linework: 'canvas2d-reference' },
});
console.log(plan.layers.map(({ id, engine, warnings }) => ({ id, engine, warnings })));
await orchestration.render(score, document.querySelector('canvas'), {
  pins: { linework: 'canvas2d-reference' },
});
```

`score` is a normal validated JSON v1.0 document, not a separate meta schema. `pins` live outside it so playback and compatibility with existing scores are unaffected. A fully native route can simply use `Painter.render(score)` and is generally cheaper than splitting it into isolated layers. Pinning is an *engineering choice* and must be disclosed in the plan.

## What can share a brush?

| Integration | Actual compatibility | Caveat |
| --- | --- | --- |
| Poiesis + Poiesis | Identical score commands, material recipes and engine | Current physical wetness is layer-local; compositor blends finished RGBA |
| Poiesis + plain Canvas2D | Coordinates, colors, path/polygon shapes and final RGBA | Reference drops real drying, pigment pickup, irregular bristles; pressure averaged, `wait` ignored |
| Poiesis + **p5.brush standalone** | Optional injected adapter for ink/graphite `stroke` only | Requires WebGL2 and original module; polyline approximation does not preserve pressure/tilt/speed; no bundled dependency |
| Poiesis + **perfect-freehand** | Optional injected function converts ink/marker/graphite pressure paths into fillable outlines | Geometry-only; no paper/paint physics; no bundled dependency |
| p5.brush + webgpu-brush | The latter retains the former's high-level drawing vocabulary | Shader/backend differences, WebGPU availability and texture ownership still matter |
| Poiesis + Washes / wet-edge / oil-paint-agents / sho | Conceptual mapping of paths, paints and RGBA possible | Their internal water/height/brush states are **not** interoperable; no adapters yet |
| MyPaint-compatible `.myb` engines | Brush presets can be shared *inside engines that implement MyPaint brush settings* | No Poiesis `.myb` loader; a file extension is not an import promise |

Source audits and exact pinned revisions: [`docs/references/README.md`](references/README.md), [`docs/parity-matrix.md`](parity-matrix.md), [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Other documentation: [p5.brush standalone API](https://github.com/acamposuribe/p5.brush/blob/main/docs/standalone.md), [perfect-freehand](https://github.com/steveruizok/perfect-freehand), [webgpu-brush llms.txt](https://github.com/lklyne/webgpu-brush/blob/main/llms.txt), [Washes engine](https://github.com/castavridis/washes-js/tree/main/engine), [MyPaint brush engine](https://github.com/mypaint/libmypaint).

## Comparison lab

Build with `node site/build.mjs` and visit `/compare/` on the existing local site. It uses the *same* validated 480×320 score, seed and command list for three views:

1. Direct `Painter.render()` — the existing single Poiesis engine.
2. Routed into a deliberately simplified Canvas2D reference — **not** an upstream painting framework.
3. Routed by layer: Poiesis for material-sensitive layers; either Poiesis or the reference for graphite outlines.

The page reports actual completion times from the browser and a machine-readable route with compromises. It can magnify images to 200% using nearest-neighbor filtering, so 100% raster artifacts are not concealed by interpolation. It does not fetch third-party libraries, execute a live model, compute a quality score, or claim which result is artistically superior. These are demonstrations of *routing and compositing*, not calibrated third-party renderer benchmarks.

### Honest benchmark plan (not executed by this document)

For each available external backend and exact version: implement only supported operations; choose shared representative scenes and independent source-native quality scenes; run 5 warmup + 20 timed trials on the same hardware/browser at fixed dimensions; record input score, source adapter translation, pixel PNGs, full-res crops, render initialization, CPU/GPU accounting, p50/p95, memory and browser flags. A blinded human preference study must score composition, edge behavior, surface fidelity and visible artifacts separately. Do not compare e.g. a water simulation to a flat-line library and then declare global superiority. Native Poiesis-only versus routed Poiesis+backend is a valid overhead/capability comparison; cross-engine pixels are not expected to match.

## Known limits and correctness boundaries

- Adapter capabilities are declarations, **not an adversarial sandbox**. An adapter is trusted application code; arbitrary model-provided JS or remote URLs must not be evaluated.
- The compositor uses HTML Canvas2D `drawImage`; reading/presenting a WebGPU or WebGL2 canvas may vary by browser. An external adapter must test that the output surface actually carries alpha; never quietly provide opaque black/white frames.
- It works per layer, not per stroke within a wet shared layer. Physics *across* engines, bristle state transfers, pigment K/S equivalence, color management and model-specific brush files are not implemented. Cross-layer wetness did not exist in original Poiesis either.
- The p5.brush adapter is minimal, injectable and intentionally restricted to simple paths. Its custom tip, stencil, fill, pressure curves, flow-field and lifecycle semantics are not ported.
- The Canvas2D reference's approximate operation labels explicitly include a no-op `wait`. It is **not a physical benchmark baseline**.
- Native duplicate alpha composition can incur rounding differences and overhead; CI/native test compares bounded pixel difference rather than promising byte-identical output.
- Priority numbers are policy tie-breakers, not measured throughput or artistic quality. The planner cannot infer aesthetic preferences or compensate for poor composition.
- This branch does not merge, deploy, publish packages, change secrets or vendor upstream sources.

## Verification

```sh
npm ci
npm run check
node --test tests/orchestrator.test.mjs
node site/build.mjs
npx tsc --project site/tsconfig.json
node site/serve.mjs     # open /compare/ in a real browser
```

The pure unit tests exercise route selection, incompatibility rejection, cancellation, atomic staging, third-party injection and core adapter arguments. Native pixel tests additionally require built `dist/` and `@napi-rs/canvas`. Check actual CI artifacts before asserting site screenshot or image parity. A future acceptance gate should run the third-party adapters under real WebGL2/Canvas2D browsers and save head-to-head outputs.
