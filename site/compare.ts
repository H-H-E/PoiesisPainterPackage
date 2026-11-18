import { Painter, validatePainting } from '../src/index.js';
import {
  PaintingOrchestrator, createPoiesisAdapter, createCanvasReferenceAdapter, comparisonScore,
} from '../orchestrator/index.mjs';

const score = comparisonScore();
const result = validatePainting(score);
if (!result.valid) throw new Error('The checked-in comparison score is invalid: ' + JSON.stringify(result.errors));

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return canvas;
};
const native = createPoiesisAdapter({ Painter, canvasFactory: makeCanvas });
const reference = createCanvasReferenceAdapter();
const orchestrator = new PaintingOrchestrator({
  adapters: [native, reference], validatePainting, canvasFactory: makeCanvas,
});
const referenceOnly = new PaintingOrchestrator({
  adapters: [reference], validatePainting, canvasFactory: makeCanvas,
});
const $ = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing element: ' + id);
  return element;
};
const canvas = (id: string) => $(id) as HTMLCanvasElement;
const time = (ms: number) => ms.toFixed(1) + ' ms (single local run)';
const status = $('status');
const button = $('run') as HTMLButtonElement;
const lineEngine = $('linework-engine') as HTMLSelectElement;
const log = $('routing-log');

async function panel(id: string, job: () => Promise<unknown>): Promise<unknown | null> {
  const node = $(id + '-result');
  node.textContent = 'Rendering real browser pixels…';
  node.classList.remove('error');
  try {
    const start = performance.now();
    const report = await job();
    node.textContent = 'Completed in ' + time(performance.now() - start);
    return report;
  } catch (error) {
    node.classList.add('error');
    node.textContent = 'Failed: ' + (error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function run() {
  button.disabled = true;
  lineEngine.disabled = true;
  status.textContent = 'Rendering one validated score on three independent surfaces…';
  log.textContent = 'Render in progress';
  try {
    await panel('poiesis', async () => {
      const painter = new Painter(canvas('poiesis'), { historyLimit: 0 });
      try { return await painter.render(score); }
      finally { painter.dispose(); }
    });
    await panel('reference', () => referenceOnly.render(score, canvas('reference')));
    const pins: Record<string, string> = lineEngine.value === 'poiesis' ? {} : { linework: 'canvas2d-reference' };
    const hybrid = await panel('hybrid', () => orchestrator.render(score, canvas('hybrid'), { pins })) as { plan: { layers: Array<{ id: string; engine: string; warnings: string[]; reason: string; candidates: Array<{ id: string; eligible: boolean; failed: string[] }> }> } } | null;
    if (hybrid) {
      const decision = hybrid.plan;
      log.textContent = JSON.stringify({
        score: 'Poiesis JSON v1.0 · same geometry/dimensions/seed in all views',
        selected: decision.layers.map(layer => ({
          layer: layer.id, renderer: layer.engine, reason: layer.reason,
          compromises: layer.warnings,
          otherChoices: layer.candidates.filter(c => c.id !== layer.engine).map(c => ({ engine: c.id, eligible: c.eligible, problems: c.failed })),
        })),
        installed: orchestrator.capabilities().map(entry => ({ engine: entry.id, available: entry.available })),
        thirdPartyEnginesExecuted: [],
      }, null, 2);
    } else log.textContent = 'The mixed render did not complete. See the output error.';
    status.textContent = 'Comparison complete. Timings are illustrative, not a benchmark; inspect the differences at native pixels.';
  } finally {
    button.disabled = false;
    lineEngine.disabled = false;
  }
}

button.addEventListener('click', () => { void run(); });
($('zoom') as HTMLInputElement).addEventListener('change', event => {
  document.querySelector('.paintings')?.classList.toggle('is-zoom', (event.target as HTMLInputElement).checked);
});
void run();
