/** Optional opt-in AI panel. It never sees Gateway credentials. */
export async function mountPromptUI(applyScore: (score: unknown) => Promise<boolean>) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = $<HTMLFormElement>('ai-form');
  const prompt = $<HTMLTextAreaElement>('ai-description');
  const seed = $<HTMLInputElement>('ai-seed');
  const submit = $<HTMLButtonElement>('ai-submit');
  const cancel = $<HTMLButtonElement>('ai-cancel');
  const repaint = $<HTMLButtonElement>('ai-repaint');
  const status = $('ai-status');
  let controller: AbortController | null = null;
  let lastPlan: unknown = null;
  let lastSeed = 0;
  const message = (value: string, failure = false) => {
    status.textContent = value;
    status.setAttribute('role', failure ? 'alert' : 'status');
    status.classList.toggle('is-error', failure);
  };
  const busy = (value: boolean) => {
    submit.disabled = value;
    prompt.disabled = value;
    seed.disabled = value;
    cancel.hidden = !value;
    repaint.disabled = value || lastPlan === null;
    form.setAttribute('aria-busy', String(value));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-ai-example]').forEach(button => button.addEventListener('click', () => {
    prompt.value = button.dataset.aiExample || '';
    prompt.focus();
  }));
  cancel.addEventListener('click', () => controller?.abort());

  submit.disabled = true;
  message('Checking whether the optional AI experiment is enabled…');
  let enabled = false;
  try {
    const reply = await fetch('/api/paint', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!reply.ok) throw new Error('The endpoint is not configured.');
    const info = await reply.json();
    enabled = info.enabled === true;
    message(enabled
      ? 'Optional NVIDIA trial model is available. Prompts may be retained by NVIDIA. Submit only public, non-sensitive descriptions.'
      : 'AI generation is disabled on this deployment. The manual painting editor still works.');
  } catch {
    message('The AI endpoint is unavailable here. You can still use the manual painting editor.');
  }
  submit.disabled = !enabled;

  repaint.addEventListener('click', async () => {
    if (!lastPlan || controller) return;
    repaint.disabled = true;
    message('Reusing the previous composition with a new seed—no Gateway call…');
    try {
      const nextSeed = (lastSeed + 1) >>> 0;
      // @ts-ignore The plan compiler is a dependency-free authored ESM module.
      const { compilePlan } = await import('./ai-plan.mjs');
      const score = compilePlan(lastPlan, nextSeed);
      const applied = await applyScore(score);
      if (!applied) throw new Error('This variation could not be rendered. The previous painting remains.');
      seed.value = String(nextSeed);
      lastSeed = nextSeed;
      message('New variation painted locally, without calling AI Gateway. Edit or export the score below.');
      document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) { message(error instanceof Error ? error.message : 'Could not repaint locally.', true); }
    finally { repaint.disabled = lastPlan === null; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!enabled || controller) return;
    const text = prompt.value.trim().replace(/\s+/g, ' ');
    const value = Number(seed.value);
    if (text.length < 8 || text.length > 420) { message('Describe a scene in 8–420 characters.', true); return; }
    if (seed.value.trim() === '' || !Number.isInteger(value) || value < 0 || value > 4294967295) {
      message('Seed must be a whole number from 0 to 4294967295.', true); return;
    }
    controller = new AbortController();
    busy(true);
    message('Choosing the composition with Nemotron, then compiling paint marks…');
    try {
      const result = await fetch('/api/paint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ prompt: text, seed: value }),
        signal: controller.signal,
        cache: 'no-store'
      });
      const body = await result.json();
      if (!result.ok) throw new Error(body?.error?.message || 'Scene generation was unavailable.');
      const applied = await applyScore(body.score);
      if (!applied) throw new Error('The generated score failed local validation or rendering. The previous painting remains available.');
      lastPlan = body.plan;
      lastSeed = value;
      repaint.disabled = false;
      message('Scene painted with ' + body.model + ' · ' + (body.attempts === 2 ? 'repaired plan' : 'first-pass plan') + '. You can edit and export the exact JSON below.');
      document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      message(controller.signal.aborted ? 'Generation cancelled. Existing painting retained.'
        : error instanceof Error ? error.message : 'Could not generate a scene.', true);
    } finally {
      controller = null;
      busy(false);
      submit.disabled = !enabled;
    }
  });
}
