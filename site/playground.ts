import { Painter, validatePainting, capabilities, resolveMaterial } from '../src/index.js';
import type { PaintingDocument, Material } from '../src/types.generated.js';
// @ts-ignore Shared authored JavaScript scene fixtures.
import { createScene } from '../examples/scenes.mjs';
// @ts-ignore Procedural score grammar is authored as dependency-free JavaScript.
import { createGenerativeLandscape, isGenerativeName } from './landscapes.mjs';
// @ts-ignore ESM utility is plain JavaScript and tested with Node.
import { checkSiteBudget, parseScore, validSeed } from './budget.mjs';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing playground element: ' + id);
  return element as T;
};

export async function mountPlayground(): Promise<{ selectScene: (name: string) => Promise<void> }> {
  const canvas = $<HTMLCanvasElement>('play-canvas');
  if (!canvas.getContext('2d')) throw new Error('Canvas2D is not available.');
  const painter = new Painter(canvas, { historyLimit: 4 });
  const editor = $<HTMLTextAreaElement>('score-editor');
  const status = $('play-status');
  const issuesBox = $('validation-box');
  const issuesList = $('validation-list');
  const sceneSelect = $<HTMLSelectElement>('scene-select');
  const seed = $<HTMLInputElement>('seed-input');
  const materialSelect = $<HTMLSelectElement>('material-select');
  const medium = $<HTMLSelectElement>('medium-select');
  const color = $<HTMLInputElement>('material-color');
  const size = $<HTMLInputElement>('material-size');
  const wetness = $<HTMLInputElement>('material-wetness');
  const progress = $<HTMLProgressElement>('play-progress');
  const overlay = $('play-render-overlay');
  let controller: AbortController | null = null;
  let busy = false;
  let committed = false;

  function setMessage(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }
  function clearIssues() {
    issuesList.replaceChildren();
    issuesBox.hidden = true;
    editor.setAttribute('aria-invalid', 'false');
  }
  function showIssues(errors: Array<{ path: string; code: string; message: string; suggestion: string }>) {
    issuesList.replaceChildren();
    errors.slice(0, 8).forEach(issue => {
      const li = document.createElement('li');
      const path = document.createElement('code');
      path.textContent = issue.path;
      li.append(path, document.createTextNode(': ' + issue.message + '. ' + issue.suggestion));
      issuesList.append(li);
    });
    $('validation-note').textContent = errors.length + ' issue(s) to repair. The completed painting is unchanged.';
    issuesBox.hidden = false;
    editor.setAttribute('aria-invalid', 'true');
  }
  function updateDraftLabel() {
    const changed = committed && editor.value.trim() !== painter.serialize(true).trim();
    $('draft-indicator').textContent = changed ? 'Unrendered edits' : 'Ready';
    $('score-count').textContent = editor.value.length.toLocaleString() + ' characters';
  }
  function readDraft(): PaintingDocument | null {
    const parsed = parseScore(editor.value);
    if (!parsed.ok) {
      showIssues(parsed.errors);
      setMessage('JSON syntax error. Repair the score and try again.', true);
      return null;
    }
    const result = validatePainting(parsed.value);
    if (!result.valid) {
      showIssues(result.errors);
      setMessage('Schema or score validation failed. See the repair suggestions.', true);
      return null;
    }
    const errors = checkSiteBudget(parsed.value, result.workload, editor.value.length);
    if (errors.length) {
      showIssues(errors);
      setMessage('This score exceeds the smaller playground budget.', true);
      return null;
    }
    clearIssues();
    return parsed.value as PaintingDocument;
  }
  function setBusy(value: boolean) {
    busy = value;
    for (const id of ['render-button', 'reset-button', 'variation-button', 'validate-button', 'format-score', 'apply-seed', 'download-png', 'download-score']) {
      $<HTMLButtonElement>(id).disabled = value || (id === 'variation-button' && !isGenerativeName(sceneSelect.value)) || ((id === 'download-png' || id === 'download-score') && !committed);
    }
    for (const select of [sceneSelect, materialSelect, medium]) select.disabled = value;
    for (const input of [seed, size, wetness, color, editor]) input.disabled = value;
    $('cancel-render').hidden = !value;
    overlay.hidden = !value;
    progress.hidden = !value;
    $('workbench').setAttribute('aria-busy', String(value));
    if (value) { progress.value = 0; progress.max = 1; $('render-task').textContent = 'Depositing pigment…'; }
  }
  function syncMaterialControls(document: PaintingDocument) {
    const previous = materialSelect.value;
    materialSelect.replaceChildren();
    Object.keys(document.materials).forEach(name => {
      const option = window.document.createElement('option');
      option.value = name; option.textContent = name;
      materialSelect.append(option);
    });
    if (Object.hasOwn(document.materials, previous)) materialSelect.value = previous;
    showSelectedMaterial(document);
    seed.value = String(document.seed);
  }
  function showSelectedMaterial(document: PaintingDocument) {
    const recipe = document.materials[materialSelect.value];
    if (!recipe) return;
    const resolved = resolveMaterial(recipe);
    medium.value = recipe.medium;
    color.value = recipe.color;
    size.value = String(Math.min(Number(size.max), Math.max(Number(size.min), recipe.size)));
    wetness.value = String(resolved.wetness);
    $('size-output').textContent = recipe.size.toFixed(3);
    $('wetness-output').textContent = resolved.wetness.toFixed(2);
  }
  function writeDraft(document: PaintingDocument) {
    editor.value = JSON.stringify(document, null, 2);
    clearIssues();
    syncMaterialControls(document);
    updateDraftLabel();
  }
  async function renderScore() {
    if (busy) return;
    const document = readDraft();
    if (!document) return;
    controller = new AbortController();
    setBusy(true);
    setMessage('Rendering locally…');
    try {
      const report = await painter.render(document, {
        signal: controller.signal,
        yieldEvery: 10,
        onProgress: value => {
          progress.max = Math.max(1, value.total);
          progress.value = value.completed;
          $('render-task').textContent = value.total === 0 ? 'Compositing…' :
            value.layerId + ' / ' + value.completed + ' of ' + value.total + ' commands';
        }
      });
      committed = true;
      canvas.style.aspectRatio = String(document.width) + ' / ' + String(document.height);
      $('play-dimensions').textContent = document.width + ' × ' + document.height;
      editor.value = painter.serialize(true);
      syncMaterialControls(document);
      updateDraftLabel();
      setMessage('Rendered ' + report.commands + ' commands · ' + capabilities().backend + ' · same-score repeatable on this backend.');
    } catch (error) {
      const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      setMessage(canceled ? 'Render cancelled. The previous painting is intact.' : 'Render failed: ' + (error instanceof Error ? error.message : String(error)), !canceled);
    } finally {
      controller = null;
      setBusy(false);
    }
  }
  async function selectScene(name: string, chosenSeed?: number) {
    if (busy) return;
    const generated = isGenerativeName(name);
    if (!generated && !['landscape', 'ink', 'watercolor', 'oil', 'studies'].includes(name)) {
      setMessage('Unknown study: select an example from the gallery.', true); return;
    }
    sceneSelect.value = name;
    const next = generated
      ? createGenerativeLandscape(name, 480, 320, chosenSeed)
      : createScene(name, 480, 320);
    writeDraft(next as PaintingDocument);
    await renderScore();
  }
  function editMaterial(field: keyof Material, value: string | number) {
    if (busy) return;
    const document = readDraft();
    if (!document) return;
    const selected = materialSelect.value;
    if (!Object.hasOwn(document.materials, selected)) {
      setMessage('Select a material ID from this score.', true); return;
    }
    // A material is an explicit schema recipe. The UI does not inject JS or unknown keys.
    (document.materials[selected] as unknown as Record<string, string | number>)[field] = value;
    writeDraft(document);
    setMessage('Material updated in draft. Render score to apply the change.');
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link);
    link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  $('backend-label').textContent = capabilities().backend + ' / local CPU';
  $('render-button').addEventListener('click', () => { void renderScore(); });
  $('reset-button').addEventListener('click', () => { void selectScene(sceneSelect.value); });
  $('variation-button').addEventListener('click', () => {
    if (busy || !committed || !isGenerativeName(sceneSelect.value)) return;
    // Variations derive from the last committed seed and deliberately replace a draft.
    const previous = painter.document;
    if (!previous) return;
    void selectScene(sceneSelect.value, (previous.seed + 1) >>> 0);
  });
  sceneSelect.addEventListener('change', () => { void selectScene(sceneSelect.value); });
  $('validate-button').addEventListener('click', () => {
    if (readDraft()) setMessage('Score validated. Render to see your changes.');
  });
  $('format-score').addEventListener('click', () => {
    const parsed = parseScore(editor.value);
    if (!parsed.ok) { showIssues(parsed.errors); setMessage('JSON cannot be formatted until its syntax is repaired.', true); return; }
    editor.value = JSON.stringify(parsed.value, null, 2);
    updateDraftLabel();
    if (readDraft()) setMessage('JSON formatted and validated.');
  });
  editor.addEventListener('input', () => { clearIssues(); updateDraftLabel(); });
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); void renderScore();
    }
  });
  $('apply-seed').addEventListener('click', () => {
    const document = readDraft();
    if (!document) return;
    const value = Number(seed.value);
    if (!validSeed(value) || seed.value.trim() === '') {
      showIssues([{ path: '/seed', code: 'seed-range', message: 'Seed must be an integer between 0 and 4294967295', suggestion: 'Enter a valid 32-bit unsigned integer.' }]);
      setMessage('Seed is invalid. The previous painting is intact.', true);
      return;
    }
    // In generated scenes, the seed controls the composition as well as pigment noise.
    // The UI explains that regenerating replaces any unrendered score edits.
    const seeded = isGenerativeName(sceneSelect.value)
      ? createGenerativeLandscape(sceneSelect.value, document.width, document.height, value)
      : { ...document, seed: value };
    writeDraft(seeded as PaintingDocument);
    void renderScore();
  });
  materialSelect.addEventListener('change', () => {
    const document = readDraft(); if (document) showSelectedMaterial(document);
  });
  medium.addEventListener('change', () => editMaterial('medium', medium.value));
  color.addEventListener('change', () => editMaterial('color', color.value));
  size.addEventListener('input', () => { $('size-output').textContent = Number(size.value).toFixed(3); });
  size.addEventListener('change', () => editMaterial('size', Number(size.value)));
  wetness.addEventListener('input', () => { $('wetness-output').textContent = Number(wetness.value).toFixed(2); });
  wetness.addEventListener('change', () => editMaterial('wetness', Number(wetness.value)));
  $('cancel-render').addEventListener('click', () => { controller?.abort(); setMessage('Cancellation requested…'); });
  $('download-png').addEventListener('click', () => {
    if (!committed || busy) return;
    canvas.toBlob(blob => {
      if (!blob) { setMessage('The browser could not encode PNG.', true); return; }
      const last = painter.document!;
      download(blob, 'poiesis-' + last.seed + '.png');
    }, 'image/png');
  });
  $('download-score').addEventListener('click', () => {
    if (!committed || busy) return;
    const last = painter.document!;
    download(new Blob([painter.serialize(true) + '\n'], { type: 'application/json' }), 'poiesis-' + last.seed + '.json');
  });
  window.addEventListener('pagehide', () => painter.dispose(), { once: true });
  await selectScene('landscape');
  return { selectScene };
}
