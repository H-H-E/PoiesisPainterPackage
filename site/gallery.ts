import { Painter, validatePainting } from '../src/index.js';
// @ts-ignore Existing authored JavaScript examples are consumed by studio and site.
import { createScene } from '../examples/scenes.mjs';
// @ts-ignore The original procedural landscape grammar is intentionally dependency-free JS.
import { createGenerativeLandscape, isGenerativeName } from './landscapes.mjs';

let queue: Promise<void> = Promise.resolve();

/** One small native painting at a time; each Painter is disposed after its image commits. */
export function paintPreview(canvas: HTMLCanvasElement): Promise<void> {
  const task = async () => {
    const placeholder = document.querySelector<HTMLElement>('[data-for="' + canvas.id + '"]');
    try {
      const name = canvas.dataset.preview || 'landscape';
      const document = isGenerativeName(name)
        ? createGenerativeLandscape(name, canvas.width, canvas.height)
        : createScene(name, canvas.width, canvas.height);
      const validation = validatePainting(document);
      if (!validation.valid) throw new Error('Example failed validation: ' + validation.errors[0].message);
      const painter = new Painter(canvas, { historyLimit: 0 });
      try { await painter.render(document, { yieldEvery: 12 }); }
      finally { painter.dispose(); }
      if (placeholder) placeholder.hidden = true;
      canvas.dataset.rendered = 'true';
    } catch (error) {
      if (placeholder) {
        placeholder.textContent = 'Preview unavailable. Try the playground.';
        placeholder.classList.add('failed');
      }
      canvas.dataset.rendered = 'error';
      console.warn('Poiesis preview failed', error);
    }
  };
  queue = queue.then(task, task);
  return queue;
}
