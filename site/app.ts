const loading = document.getElementById('playground-loading')!;
const workbench = document.getElementById('workbench')!;
let playground: { selectScene: (name: string) => Promise<void>; applyScore: (score: unknown) => Promise<boolean> } | null = null;
let loadingPromise: Promise<void> | null = null;

function supported(): boolean {
  const canvas = document.createElement('canvas');
  return typeof canvas.getContext === 'function' &&
    !!canvas.getContext('2d') && typeof structuredClone === 'function' &&
    typeof AbortController !== 'undefined' && typeof Blob !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.toBlob === 'function';
}
function showLoadFailure(error: unknown) {
  loading.replaceChildren();
  const label = document.createElement('p');
  label.textContent = 'The workbench could not start on this browser. ' + (error instanceof Error ? error.message : String(error));
  const retry = document.createElement('button');
  retry.textContent = 'Retry loading';
  retry.className = 'button button-outline';
  retry.addEventListener('click', () => { void loadPlayground(); });
  loading.append(label, retry);
  loading.hidden = false;
}
async function loadPlayground(): Promise<void> {
  if (playground) return;
  if (!loadingPromise) {
    if (!supported()) {
      showLoadFailure(new Error('Canvas2D, structuredClone, AbortController and canvas PNG encoding are required.'));
      return;
    }
    loading.querySelector('span:nth-child(2)')?.replaceChildren('Loading the local renderer…');
    loadingPromise = import('./playground.ts').then(async module => {
      playground = await module.mountPlayground();
      workbench.hidden = false;
      loading.hidden = true;
    }).catch(error => {
      loadingPromise = null;
      showLoadFailure(error);
    });
  }
  await loadingPromise;
}
let aiLoading: Promise<void> | null = null;
function loadAi() {
  if (!aiLoading) aiLoading = import('./prompt-ui.ts').then(module => module.mountPromptUI(async score => {
    await loadPlayground();
    return playground ? playground.applyScore(score) : false;
  })).catch(error => {
    const node = document.getElementById('ai-status');
    if (node) node.textContent = 'Prompt controls are unavailable. Manual painting still works.';
    console.warn('AI panel could not load:', error);
  });
  return aiLoading;
}
const promptSection = document.getElementById('prompt-to-paint');
if (promptSection) {
  if (typeof IntersectionObserver === 'undefined') void loadAi();
  else {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void loadAi(); }
    }, { rootMargin: '160px 0px' });
    observer.observe(promptSection);
  }
}
document.getElementById('load-playground')?.addEventListener('click', () => { void loadPlayground(); });
document.querySelectorAll<HTMLAnchorElement>('[data-open-playground]').forEach(link => link.addEventListener('click', () => { void loadPlayground(); }));
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => button.addEventListener('click', async () => {
  document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' });
  await loadPlayground();
  if (playground) await playground.selectScene(button.dataset.scene || 'landscape');
}));
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  const source = document.getElementById(button.dataset.copy || '');
  const status = document.getElementById('copy-status');
  if (!source || !status) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable; select the example text instead.');
    await navigator.clipboard.writeText(source.textContent || '');
    status.textContent = 'Copied example to clipboard.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
}));
if (typeof IntersectionObserver !== 'undefined') {
  const previewObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target as HTMLCanvasElement;
      previewObserver.unobserve(canvas);
      void import('./gallery.ts').then(module => module.paintPreview(canvas)).catch(error => {
        const placeholder = document.querySelector<HTMLElement>('[data-for="' + canvas.id + '"]');
        if (placeholder) { placeholder.textContent = 'Preview unavailable'; placeholder.classList.add('failed'); }
        console.warn('Could not load painting preview', error);
      });
    }
  }, { rootMargin: '120px 0px' });
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]').forEach(canvas => previewObserver.observe(canvas));
  const labObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { labObserver.disconnect(); void loadPlayground(); }
  }, { rootMargin: '150px 0px' });
  labObserver.observe(document.getElementById('playground')!);
} else {
  // Older browsers still get a usable explicit workbench button.
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-preview]').forEach(canvas => {
    void import('./gallery.ts').then(module => module.paintPreview(canvas)).catch(() => {});
  });
}
