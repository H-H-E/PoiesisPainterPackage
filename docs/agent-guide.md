# Small-model painting score guide (JSON v1.0)

The input is **data, not executable code**. A small model selects visual decisions, emits one bounded score, reads structured validation errors, and changes stable IDs. The browser paints with Canvas2D; neither the score nor the renderer needs inference credits or a server. The current authority is [src/schema.json](../src/schema.json); [llms.txt](../llms.txt) is the compact copy-friendly contract.

## One-screen quick reference

```text
document: {version:"1.0", width:16..8192, height:16..8192, seed:0..2^32-1,
           background:"#rrggbb", paper?:{texture?,absorbency?},
           materials:{ID:{medium,color,size,...}}, layers:[{id,opacity?,blend?,commands:[...]}]}
IDs:       unique across all layers and commands (not material-key namespace);
           first character A-Z/a-z, then A-Z/a-z/0-9/_/./:/-, length 1..64
material:  medium=ink|watercolor|oil|graphite|marker|knife; color="#rrggbb";
           size=0.0001..0.5 of shorter canvas edge;
           optional opacity/load/wetness/roughness/granulation/viscosity=0..1, bristles=1..128
stroke:    {id,op:"stroke",material,path:[[x,y,pressure?],...],intent?,tilt?,rotation?,speed?}
fill:      {id,op:"fill",material,polygon:[[x,y],...]}
hatch:     {id,op:"hatch",material,polygon:[[x,y],...],spacing,angle}
family:    {id,op:"family",material,path:[[x,y,pressure?],...],count,spread:[dx,dy],jitter,intent?}
wait:      {id,op:"wait",steps}
limits:    x/y=-1..2 (0..1 is the canvas), pressure=0..1; path 2..4096,
           polygon 3..2048, count 1..2000, spacing 0.001..0.2, jitter 0..0.5,
           spread components -2..2, steps 1..200; rotation/angle -360..360,
           speed 0.01..10, tilt and intent components 0..1.
layer:     1..32 layers; each <=10,000 commands; blend=normal|multiply|screen;
           opacity=0..1. Every non-wait command must name an existing material.
```

Use unquoted JSON numerics, quoted strings and keys, no comments/trailing commas. Overscan coordinates outside 0..1 are allowed up to -1..2; they can produce off-canvas content. Each command has a required `id`. `wait` has no `material`. `fill` and `hatch` take an unpressured polygon, whereas `stroke` and `family` take an optional-pressure path. `intent` (force, hesitation, restraint) belongs only on strokes/families. `family` translates repeated strokes progressively by `spread`, with seeded `jitter`; it does **not** rotate or scale them. For edits, retain IDs, not array indexes.

## Three complete, distinct scores

### A. Watercolor shoreline — translucent wash and explicit settling

<!-- score-example -->
```json
{"version":"1.0","width":480,"height":320,"seed":14,"background":"#f1ede3","paper":{"texture":0.5,"absorbency":0.8},"materials":{"wash":{"medium":"watercolor","color":"#638c9a","size":0.08,"wetness":0.85},"shore":{"medium":"ink","color":"#364557","size":0.01}},"layers":[{"id":"sky","commands":[{"id":"horizon-glaze","op":"fill","material":"wash","polygon":[[0,0.42],[1,0.4],[1,0.63],[0,0.61]]},{"id":"dry-sky","op":"wait","steps":4}]},{"id":"near","commands":[{"id":"bank","op":"stroke","material":"shore","path":[[0.02,0.73,0.3],[0.38,0.69,0.8],[0.87,0.86,0.3]],"intent":{"restraint":0.4}}]}]}
```

### B. Graphite construction — clipped hatching and deliberate line pressure

<!-- score-example -->
```json
{"version":"1.0","width":400,"height":400,"seed":5,"background":"#f3f0e9","materials":{"pencil":{"medium":"graphite","color":"#343b40","size":0.006,"roughness":0.75}},"layers":[{"id":"study","commands":[{"id":"shadow","op":"hatch","material":"pencil","polygon":[[0.2,0.2],[0.8,0.25],[0.7,0.8],[0.25,0.75]],"spacing":0.045,"angle":45},{"id":"contour","op":"stroke","material":"pencil","path":[[0.16,0.82,0.1],[0.22,0.18,1],[0.82,0.22,0.6],[0.76,0.83,0.1]],"intent":{"force":0.7}}]}]}
```

### C. Oil and knife nocturne — dense ground and ordered repeated glints

<!-- score-example -->
```json
{"version":"1.0","width":400,"height":256,"seed":18,"background":"#081d2d","materials":{"night":{"medium":"oil","color":"#1f3e61","size":0.07},"ember":{"medium":"knife","color":"#e6a35c","size":0.05}},"layers":[{"id":"pigment","commands":[{"id":"underpaint","op":"fill","material":"night","polygon":[[0,0.45],[1,0.44],[1,1],[0,1]]},{"id":"glints","op":"family","material":"ember","path":[[0.12,0.68,0.05],[0.24,0.66,0.8]],"count":8,"spread":[0.65,0.12],"jitter":0.01,"intent":{"force":0.4}}]}]}
```

These are real v1.0 commands, **not** promised physical-material parity. Renderer behavior and defaults are specified in `src/presets.ts` and `src/painter.ts`. For a larger composition see [agent-challenge.json](../examples/agent-challenge.json), [landscape.json](../examples/landscape.json), and [watercolor.json](../examples/watercolor.json).

## Validate, repair, paint, revise

```ts
import { Painter, validatePainting, capabilities } from '@poiesis/painter';

const score = JSON.parse(modelOutput);                 // catch SyntaxError separately
const result = validatePainting(score);
if (!result.valid) {
  console.table(result.errors);                       // {path,code,message,suggestion}
  throw new Error('Repair the score before rendering');
}
const canvas = document.querySelector('canvas')!;
const painter = new Painter(canvas);
await painter.render(score);                          // validated and staged atomically
await painter.revise('bank', { path: [[0.02,0.72,0.2],[0.8,0.84,0.6]] });
await painter.apply('near', [{ id:'new-reed', op:'stroke', material:'shore', path:[[0.4,0.93],[0.42,0.6]] }]);
await painter.remove('new-reed');
await painter.undo();
const committed = painter.serialize(true);
console.log(painter.inspect(), capabilities());
```

`revise(id, patch)` shallowly patches a command or layer, so replace the **whole** nested `path` or `intent` when changing it. IDs cannot be renamed by `revise`; remove and add instead. `apply(layerId, commands)` appends. `remove(id)` deletes a command or layer but the document must retain at least one layer. All operations revalidate. Invalid edits, failed renders, or cancellations do not commit a partial new painting. `undo`/`redo` replay committed scores; `inspect()` lists active layer/command IDs. This API needs a Canvas2D-backed surface; `Painter` is not an image-generation model.

## What actionable errors look like

A rejected score returns `{valid:false,errors:[{path,code,message,suggestion},...]}`. Each `path` is a JSON Pointer into the original score; `~1` escapes a slash and `~0` escapes a tilde. For example:

| Error path and code | Exact repair |
| --- | --- |
| `/layers/0/commands/1/op` — `discriminator` | Use one of `stroke`, `fill`, `hatch`, `family`, `wait`; add the correct operation-specific required fields. |
| `/layers/0/commands/1/material` — `missing-material` | Use a key already in `/materials` or define that recipe. |
| `/layers/0/commands/1/id` — `duplicate-id` | Rename the second occurrence; its message identifies the original path. |
| `/layers/0/commands/0/path/1/2` — `minimum` | Set pressure to at least 0; it must be between 0 and 1. |
| `/layers/0/commands/0/path/0` — `maxItems` | Use two coordinates or three with pressure, not four. |
| `/materials/bad~1name` — `propertyNames` | Rename the material key to a valid ID; then update references. |
| `/layers` — `workload-expandedPoints` | Lower `family.count` or path point count; budgets are document-wide. |

Missing required properties point to the missing field. Unknown properties point to the extra field. Schema error reports are capped at 40 items; fix them and revalidate. Semantic errors (duplicate IDs, missing materials) are checked only after structural validity. The global workload estimator runs after reference validation. For huge command lists, a cheap command-count gate rejects before geometric estimation.

## Workload and rendering limits

Global caps include 24,000,000 image pixels, 64,000,000 aggregate layer pixels, 10,000 commands across layers, 20,000 expanded marks, 1,000,000 expanded points, 2,000 wait steps, 1,000,000,000 pixel-steps, 80,000,000 estimated ribbon vertices, and 2,000,000,000 estimated raster pixels. `estimateWorkload(score)` is a conservative **budget estimate**, not measured render duration or a proof of exact memory consumption. Values are checked before allocating rendering surfaces. Use `validatePainting` rather than relying on schema-only validation: JSON Schema cannot test dynamic material references, cross-command ID uniqueness, or the aggregate work budget.

The renderer is deterministic for the same score, dimensions, implementation and Canvas backend; different Canvas backends can differ in antialiasing. Its media are stylized, not calibrated physical simulation. Material physics is isolated to each layer, while layer blends are visual. `tilt` is approximated by contact width, `rotation` by nib orientation, `speed` by deposition, and `wait` advances local material state. No SVG export, GPU pipeline, worker pool, bitmap-tip support, spectral pigment mixing, shallow-water solver, or per-bristle pigment reservoirs are implemented. There is no promise of SVG speed, photographic realism or equivalence to other painting engines.

## Small-agent challenge and size accounting

Use [agent-challenge-prompt.txt](../examples/agent-challenge-prompt.txt) as the full user instruction and [agent-challenge.json](../examples/agent-challenge.json) as a reference response. The actual scene/layout remains an artistic choice, not a prescribed template. The response uses at least 240 seeded family marks (100 water + 140 reeds) plus the ridge and accent.

**Explicit counted setup + command:** `llms.txt` (2350 UTF-8 bytes / 2348 characters) + one newline separator + the full prompt (983 bytes / characters) = **3334 UTF-8 bytes / 3332 characters**. Including a second newline and the reference response JSON (854 bytes / characters) gives **4189 UTF-8 bytes / 4187 characters** for the full worked example. These are *not* token counts and exclude any unseen model system message or tool wrapper. No tokenizer is installed or used; do not infer tokens from character counts. A future evaluation should name a tokenizer/model and measure actual responses, schema-repair success and renders rather than claiming small-model compliance from prompt length.

## Reproducing checks

```sh
npm ci
npm run generate
node scripts/generate-schema.mjs --check
npm run check
npm run test:browser  # requires an actual Chromium/Playwright runtime
npm pack --dry-run --json  # confirm llms.txt is actually included
```

Generated `src/types.generated.ts` and `src/validator.generated.ts` are derived from `src/schema.json`; never edit either manually. `npm run generate` must leave their content in sync. The code examples above are automatically parsed and checked by `tests/validation.test.mjs`.
