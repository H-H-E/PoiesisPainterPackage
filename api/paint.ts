import { validatePainting } from '../src/index.js';
// @ts-ignore Site budget is a plain ESM helper shared with the editor.
import { checkSiteBudget } from '../site/budget.mjs';
// @ts-ignore Small-model contract intentionally uses dependency-free ESM.
import { MODEL, SYSTEM_PROMPT, PLAN_SCHEMA, validatePrompt, parsePlan, repairMessages, compilePlan } from '../site/ai-plan.mjs';

// The Vercel Node runtime supplies process; this server-only declaration avoids
// adding Node typings or dependencies to the browser-first library.
declare const process: { env: Record<string, string | undefined> };

type Deps = {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  now?: () => number;
};

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MAX_BODY_BYTES = 2048;
const THROTTLE_MS = 60_000;
const hits = new Map<string, { window: number; count: number }>();

function response(status: number, data: unknown) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function errorResponse(status: number, code: string, message: string) {
  return response(status, { error: { code, message } });
}
function configured(env: Record<string, string | undefined>) {
  return env.POIESIS_AI_ENABLED === 'true' && !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}
function sameOrigin(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
async function smallJson(request: Request) {
  // Limit actual bytes, not just Content-Length; send no untrusted content to logs.
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, message: 'Request body is required.' };
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, message: 'Request must be below 2 KB.' };
      }
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of parts) { bytes.set(chunk, at); at += chunk.length; }
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400, message: 'Request must contain valid JSON.' };
  } finally { reader.releaseLock(); }
}
function limited(request: Request, now: number) {
  // Best-effort per-instance throttle, NOT a globally consistent security control.
  // Public deployments need Vercel Firewall/budget protections in addition.
  if (hits.size > 500) hits.clear();
  const identity = (request.headers.get('x-vercel-forwarded-for') || 'unidentified').slice(0, 80);
  const item = hits.get(identity);
  const entry = item && now - item.window < THROTTLE_MS ? item : { window: now, count: 0 };
  entry.count++;
  hits.set(identity, entry);
  return entry.count > 6;
}

async function callGateway(
  messages: Array<{ role: string; content: string }>,
  key: string,
  request: Request,
  fetcher: typeof fetch
) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(22_000)]);
  let result: Response;
  try {
    result = await fetcher(GATEWAY_URL, {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, stream: false,
        messages, temperature: 0.2, max_tokens: 1024,
        response_format: { type: 'json_schema', json_schema: { name: 'poiesis_scene_plan', schema: PLAN_SCHEMA } }
      })
    });
  } catch (error) {
    if (request.signal.aborted) throw new Error('Request cancelled.');
    throw new Error('Model request timed out or could not reach AI Gateway.');
  }
  if (!result.ok) {
    // Do not reflect upstream bodies, tokens, prompts, or provider details.
    if (result.status === 429) throw new Error('The model is rate-limited. Try again later.');
    if (result.status === 401 || result.status === 403) throw new Error('Gateway authentication failed. Contact the site administrator.');
    throw new Error('AI Gateway request failed (status ' + result.status + ').');
  }
  const raw = await result.text();
  if (raw.length > 16_000) throw new Error('Gateway response exceeded the size budget.');
  let body: any;
  try { body = JSON.parse(raw); }
  catch { throw new Error('Gateway returned an invalid response envelope.'); }
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return { text: '', usage: body?.usage };
  return { text, usage: body?.usage };
}

/** Testable Web-standard handler: the default export is the Vercel Node function. */
export async function handlePaint(request: Request, deps: Deps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const enabled = configured(env);
  if (request.method === 'GET') {
    return response(200, { enabled, model: MODEL, experimental: true,
      privacy: 'NVIDIA trial endpoint may retain prompts and outputs for training. Do not include sensitive information.' });
  }
  if (request.method !== 'POST') return errorResponse(405, 'method', 'Use POST for scene generation.');
  if (!enabled) return errorResponse(503, 'disabled', 'Text-to-paint is not enabled on this deployment.');
  if (!sameOrigin(request)) return errorResponse(403, 'origin', 'Cross-origin generation is not permitted.');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return errorResponse(415, 'type', 'Send application/json.');
  const posted = await smallJson(request);
  if (!posted.ok) return errorResponse(posted.status ?? 400, 'body', posted.message || 'Invalid body.');
  const object = posted.value;
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k => !['prompt','seed'].includes(k)))
    return errorResponse(400, 'shape', 'Supply only prompt and optional seed.');
  const validated = validatePrompt(object.prompt);
  if (!validated.ok) return errorResponse(400, 'prompt', validated.message);
  const seed = object.seed ?? 11;
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    return errorResponse(400, 'seed', 'Seed must be an unsigned 32-bit integer.');
  if (limited(request, deps.now?.() ?? Date.now()))
    return errorResponse(429, 'rate', 'This instance received too many requests. Try again shortly.');

  const token = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  const fetcher = deps.fetcher ?? fetch;
  let messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: validated.value }];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: { text: string; usage: any };
    try { result = await callGateway(messages, token!, request, fetcher); }
    catch (error) {
      return errorResponse(request.signal.aborted ? 499 : 502, 'gateway', error instanceof Error ? error.message : 'Gateway unavailable.');
    }
    const plan = parsePlan(result.text);
    if (!plan.ok) {
      if (attempt === 2) return errorResponse(422, 'model-output', 'The model could not produce a valid scene plan after repair.');
      messages = repairMessages(validated.value, result.text, plan.errors);
      continue;
    }
    try {
      const score = compilePlan(plan.value, seed);
      const result = validatePainting(score);
      if (!result.valid) throw new Error('Painting score schema rejected the compiled plan.');
      if (checkSiteBudget(score, result.workload, JSON.stringify(score).length).length)
        throw new Error('Compiled score exceeded the site resource budget.');
      return response(200, { score, plan: plan.value, model: MODEL, attempts: attempt });
    } catch {
      // Compiler failure is not solved by asking the model for executable code.
      return errorResponse(422, 'compiler', 'Unable to create a bounded painting score from this plan.');
    }
  }
  return errorResponse(422, 'model-output', 'No valid scene plan could be created.');
}
export default { fetch: handlePaint };
