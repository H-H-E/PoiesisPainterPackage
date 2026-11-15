import { Painter, capabilities } from '../src/index.js';
import type { PaintingDocument } from '../src/types.generated.js';
// The same data-only scene fixture is used by Node rendering and this studio.
// @ts-ignore -- authored JavaScript fixture deliberately has no runtime dependency.
import { createScene, sceneInfo } from '../examples/scenes.mjs';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('painting');
const painter = new Painter(canvas);
const editor = $<HTMLTextAreaElement>('score');
const sceneSelect = $<HTMLSelectElement>('scene-select');
const resolution = $<HTMLSelectElement>('resolution');
const status = $('status');
const progress = $<HTMLProgressElement>('progress');
const overlay = $('render-overlay');
const cropCanvas = $<HTMLCanvasElement>('crop-canvas');
const commandSelect = $<HTMLSelectElement>('command-id');
let controller: AbortController | null = null;
let rendering = false;
let cropEnabled = false;
let cropCenter = { x: 0.22, y: 0.86 };

function message(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
  status.setAttribute('role', error ? 'alert' : 'status');
}

function setBusy(busy: boolean) {
  rendering = busy;
  for (const id of ['apply', 'undo', 'redo', 'reset', 'revise', 'export-png', 'export-json']) $<HTMLButtonElement>(id).disabled = busy;
  sceneSelect.disabled = busy;
  resolution.disabled = busy;
  $('cancel').hidden = !busy;
  progress.hidden = !busy;
  overlay.hidden = !busy;
  if (busy) { progress.value = 0; progress.max = 1; $('render-label').textContent = 'Laying down the score'; }
}

function updateDocumentUI(syncEditor = true) {
  const score = painter.document;
  if (!score) return;
  if (syncEditor) editor.value = painter.serialize();
  const selected = commandSelect.value;
  commandSelect.replaceChildren();
  for (const layer of score.layers) for (const command of layer.commands) {
    const option = document.createElement('option');
    option.value = command.id;
    option.textContent = `${command.id} · ${command.op}`;
    commandSelect.append(option);
  }
  if ([...commandSelect.options].some(option => option.value === selected)) commandSelect.value = selected;
  else {
    const commands = score.layers.flatMap(layer => layer.commands);
    commandSelect.value = commands.find(command => command.id === 'reeds-left')?.id ?? commands.find(command => command.op === 'stroke' || command.op === 'family')?.id ?? commands[0]?.id ?? '';
    updatePatch();
  }
  const state = painter.inspect();
  $('state').textContent = JSON.stringify(state, null, 2);
  $('surface-info').textContent = `${score.width} × ${score.height} · native render`;
  const duration = state.lastRender?.durationMs;
  $('render-info').textContent = typeof duration === 'number' ? `${(duration / 1000).toFixed(2)} s · ${state.commandCount} commands` : `${state.commandCount} commands`;
  $<HTMLButtonElement>('undo').disabled = !state.history?.canUndo;
  $<HTMLButtonElement>('redo').disabled = !state.history?.canRedo;
  if (cropEnabled) updateCrop();
}

async function run(action: () => Promise<unknown>, success: string) {
  if (rendering) return;
  controller = new AbortController();
  setBusy(true);
  message('Rendering locally…');
  try {
    await action();
    setBusy(false);
    updateDocumentUI();
    message(success);
  } catch (error) {
    setBusy(false);
    updateDocumentUI(false);
    const canceled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    message(canceled ? 'Rendering canceled. The last completed painting remains available.' : error instanceof Error ? error.message : String(error), !canceled);
  } finally { controller = null; }
}

function renderOptions() {
  return {
    signal: controller?.signal,
    onProgress: (value: { completed: number; total: number; layerId: string; commandId: string; elapsedMs: number }) => {
      progress.max = Math.max(1, value.total);
      progress.value = value.completed;
      $('render-label').textContent = `${value.layerId} / ${value.completed} of ${value.total}`;
    },
  };
}

function loadExample() {
  const name = sceneSelect.value;
  const [width, height] = resolution.value.split(',').map(Number);
  const score = createScene(name, width, height) as PaintingDocument;
  const info = sceneInfo[name];
  $('medium').textContent = info.medium;
  $('scene-title').textContent = info.title;
  $('scene-description').textContent = info.description;
  editor.value = JSON.stringify(score, null, 2);
  void run(() => painter.render(score, renderOptions()), 'Score rendered. Every mark is local and editable.');
}

function applyEditor() {
  let score: PaintingDocument;
  try { score = JSON.parse(editor.value); }
  catch (error) { message(`JSON could not be read: ${error instanceof Error ? error.message : String(error)}`, true); return; }
  void run(() => painter.render(score, renderOptions()), 'Score applied. The complete batch passed validation.');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadCanvas(source: HTMLCanvasElement, suffix = '') {
  source.toBlob(blob => {
    if (!blob) { message('The browser could not encode this PNG.', true); return; }
    downloadBlob(blob, `poiesis-${sceneSelect.value}${suffix}.png`);
  }, 'image/png');
}

function updateCrop() {
  if (!painter.document || rendering) return;
  const width = Math.min(160, canvas.width);
  const height = Math.min(160, canvas.height);
  const x = Math.max(0, Math.min(canvas.width - width, Math.round(cropCenter.x * canvas.width - width / 2)));
  const y = Math.max(0, Math.min(canvas.height - height, Math.round(cropCenter.y * canvas.height - height / 2)));
  const source = painter.crop({ x, y, width, height, scale: 2 });
  cropCanvas.width = width * 2;
  cropCanvas.height = height * 2;
  const context = cropCanvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  context.drawImage(source as CanvasImageSource, 0, 0);
  $('crop-position').textContent = `x ${x}, y ${y} · ${width} × ${height} px → 2×`;
}

$('apply').addEventListener('click', applyEditor);
$('reset').addEventListener('click', loadExample);
sceneSelect.addEventListener('change', loadExample);
resolution.addEventListener('change', () => {
  if (rendering) return;
  let score: PaintingDocument;
  try { score = JSON.parse(editor.value); } catch { loadExample(); return; }
  [score.width, score.height] = resolution.value.split(',').map(Number);
  editor.value = JSON.stringify(score, null, 2);
  void run(() => painter.render(score, renderOptions()), 'Re-rendered at the requested dimensions. Geometry and material fields were rebuilt.');
});
$('cancel').addEventListener('click', () => { controller?.abort(); message('Cancel requested…'); });
$('undo').addEventListener('click', () => { void run(() => painter.undo(renderOptions()), 'Previous document revision restored.'); });
$('redo').addEventListener('click', () => { void run(() => painter.redo(renderOptions()), 'Document revision reapplied.'); });
$('revise').addEventListener('click', () => {
  let patch: Record<string, unknown>;
  try { patch = JSON.parse($<HTMLTextAreaElement>('patch').value); } catch (error) { message(`Invalid patch JSON: ${String(error)}`, true); return; }
  void run(() => painter.revise(commandSelect.value, patch, renderOptions()), `Revised ${commandSelect.value} in place.`);
});
function updatePatch() {
  const score = painter.document;
  const command = score?.layers.flatMap(layer => layer.commands).find(item => item.id === commandSelect.value);
  const patch = command?.op === 'wait' ? { steps: 12 } : command?.op === 'stroke' || command?.op === 'family' ? { intent: { restraint: 0.65 } } : { material: command?.material };
  $<HTMLTextAreaElement>('patch').value = JSON.stringify(patch);
}
commandSelect.addEventListener('change', updatePatch);
$('export-png').addEventListener('click', () => downloadCanvas(canvas));
$('export-json').addEventListener('click', () => downloadBlob(new Blob([painter.serialize()], { type: 'application/json' }), `poiesis-${sceneSelect.value}.json`));
$('export-crop').addEventListener('click', () => downloadCanvas(cropCanvas, '-crop-2x'));
$('crop-toggle').addEventListener('click', () => {
  cropEnabled = !cropEnabled;
  $('crop-panel').hidden = !cropEnabled;
  $('crop-toggle').setAttribute('aria-pressed', String(cropEnabled));
  $('crop-toggle').textContent = cropEnabled ? 'Close crop' : 'Inspect a crop';
  canvas.parentElement!.classList.toggle('inspecting', cropEnabled);
  if (cropEnabled) updateCrop();
});
canvas.addEventListener('click', event => {
  if (!cropEnabled || rendering) return;
  const bounds = canvas.getBoundingClientRect();
  cropCenter = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  updateCrop();
});
editor.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); applyEditor(); }
});
window.addEventListener('beforeunload', () => painter.dispose());
$('backend-label').textContent = `${capabilities().backend} · no hosted service`;
loadExample();
