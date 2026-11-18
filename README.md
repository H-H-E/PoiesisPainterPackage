# Poiesis Painter — agent-directed meta-renderer

[Comparison lab](site/compare/index.html) · [Meta-orchestrator guide](docs/meta-orchestration.md) · [Agent routing contract](orchestrator/llms.txt) · [Original painting score](llms.txt)

Poiesis Painter is an original browser Canvas2D/CPU painting instrument **and** an optional agent-facing orchestration layer that selects compatible rendering adapters for each layer of the same validated JSON v1.0 score. The existing `Painter` remains the default and works without a server, model, or external rendering framework.

The optional `@poiesis/painter/orchestrator` export provides deterministic capability discovery, rejection of unsupported features, explicit per-layer pins, warnings for approximations, transparent layer compositing, cancellation and staged output commits. It includes the native Poiesis adapter, a deliberately reduced Canvas2D reference, and **injected, not bundled** initial adapters for p5.brush standalone and perfect-freehand. It does not pretend their brush files, fluid fields or GPU surfaces are interchangeable.

```js
import { Painter, validatePainting } from '@poiesis/painter';
import { PaintingOrchestrator, createPoiesisAdapter } from '@poiesis/painter/orchestrator';
const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const orchestrator = new PaintingOrchestrator({
  adapters: [createPoiesisAdapter({ Painter, canvasFactory: makeCanvas })],
  validatePainting, canvasFactory: makeCanvas,
});
console.log(orchestrator.plan(score));
await orchestrator.render(score, document.querySelector('canvas'));
```

Build and verify: `npm ci && npm run check`, `node --test tests/orchestrator.test.mjs`, `node site/build.mjs`; run `node site/serve.mjs` and visit `/compare/`. The lab makes **actual browser renders** of an unchanged score through Poiesis only, simplified Canvas2D only and mixed execution, with transparent per-layer routing and disclosed limitations. It does **not** claim to beat other frameworks without real head-to-head tests.

The original research brief is at [docs/brief/original-brief.txt](docs/brief/original-brief.txt), five pinned source audits at [docs/references/](docs/references/), and source licensing at [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No external engine code has been copied.
