# Poiesis Painter — static demonstration site

This is a Vercel-ready **experimental alpha** site that renders through the repository's real painting engine. It is isolated from the existing local studio and the package's public runtime API, exports and release paths.

## Local build, tests, and deployment settings

From repository root with Node >=22:

    npm ci
    npm run check
    node site/build.mjs
    npx tsc --project site/tsconfig.json
    node --test site/contract.test.mjs
    npx playwright install chromium
    node site/browser.test.mjs
    node site/serve.mjs

Visit http://127.0.0.1:4174 after building. In a Vercel project choose **Other / no framework**, Root Directory **repository root**, and use the checked-in vercel.json:

- Install command: npm ci
- Build command: node site/build.mjs
- Output directory: site/dist
- Environment variables: none

Do **not** deploy as part of this PR. Built output under site/dist/ is ignored by git. The site consumes src/index.ts using esbuild code-splitting and examples/scenes.mjs for gallery content; no new npm dependency, backend, database, telemetry, accounts, paid AI API or arbitrary-code evaluator is needed.

The static HTML shell loads before the painting engine. The engine loads on demand to create real gallery previews and when users open or scroll to the playground. Previews paint at small native sizes, release cached resources after completion and execute sequentially. Playground material controls modify a recipe in the JSON score; Render applies the draft only after package schema and site-budget validation. Ctrl/Command+Enter also renders. Work can be cancelled with the original committed score and pixels retained.

PNG and JSON downloads use the **last successfully rendered score**, not unrendered draft edits. Cross-browser antialiasing can differ; deterministic pixels are asserted on the same implementation and Canvas2D backend only. This package is experimental, not physically accurate fluid painting. SVG, GPU, Worker, bitmap-tip, spectral mixing and cross-layer wet simulation are unsupported. Mobile throughput and memory use are not guaranteed.

## Six original generative landscapes

The **Field notes** gallery now contains six live, seeded landscape families: estuary, valley, headland, alpine lake, marsh and desert. Each is a deliberately arranged original score grammar defined in `site/landscapes.mjs`, not a pre-rendered stock image, an AI model call, or a modification of the core library. Layered polygon silhouettes, partially transparent pigment deposits, small imperfect focal marks and pressure-tapered strokes provide coherent foreground/midground/background structure rather than uniform noise. Generated scores use the public `Painter` JSON v1.0 vocabulary and remain fully editable.

Select a landscape card to open its default seed in the workbench. **Generate another variation** increments the last committed seed, rebuilding the shapes and their local brush gestures. Typing a seed and selecting **Apply seed** does the same for a chosen value. Both actions intentionally replace unrendered JSON edits; the UI discloses this. **Reset example** returns to its curated default. With the same seed, dimensions, engine and Canvas2D backend, the generated score and render should reproduce; cross-browser rasterization still may differ. The workbench exports the exact committed score for independent reproduction.

The gallery uses the same lazy loaded local render path and sequential image queue as the existing studies, with native 320×213 previews. If a gallery score fails validation or a browser cannot paint it, an inline fallback appears. The site budget and existing supported media/operations still apply.

## Smaller site limits

These are stricter than the schema: canvas dimensions <=960, area <=640,000 pixels, total layer pixels <=2,600,000, <=240 commands, <=1,200 expanded marks, <=200,000 expanded points, <=160 simulation steps, <=60 million simulation cell-steps, <=12 million ribbon vertices, <=200 million estimated raster pixels and <=200,000 characters of JSON. See site/budget.mjs for the exact contract and repair suggestions. These are resource-work estimates, not measured speed or heap caps.

## Evidence

The native contract test checks all five real gallery compositions, limits, Canvas2D repeatable PNG bytes, and invalid-score recovery. The Chromium browser test runs the built site with desktop and touch/mobile viewports, screenshot capture, keyboard shortcut, seed and medium changes, JSON/schema/budget rejection and recovery, and real downloads. It writes evidence/site/ only if executed. CI runs the site verification workflow separately from the library's existing suite; check actual job results before claiming success.

This is an independent site integration, not a redesign of the core renderer.


## Browser history and bfcache regression

The workbench now preserves its live Painter when pagehide.persisted is true, retaining the last successful score and pixels while aborting in-flight work. A noncached page departure disposes resources and browser Back initializes a fresh document. The event listener intentionally is not once:true: a restored page can later exit again. A pageshow.persisted status indicates the existing score remains available.

The Chromium browser test includes (1) synthetic persisted pagehide/pageshow events checking exact pixel retention and successful rerender, and (2) real navigation to a same-origin away.html page and browser Back, followed by score editing, rerender and PNG/JSON downloads. The report explicitly records actual pageshow.persisted from real navigation. Synthetic events are not evidence of a genuine bfcache hit. Playwright automation may inhibit bfcache eligibility; when it does, the report says so.
