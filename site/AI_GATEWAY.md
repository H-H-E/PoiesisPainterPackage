# Optional prompt-to-paint pipeline — Nemotron 3.5 Lightning Free

This is an **experimental, opt-in** natural-language frontend for the Poiesis Painter v1.0 score. It is not an unconstrained image generator. The model translates a user description into a small **8-field scene plan**, and deterministic source code generates the actual editable painting score. No arbitrary model-generated JavaScript runs.

The endpoint is **disabled by default**. The free NVIDIA endpoint is offered under trial terms and explicitly not for production or business-critical systems. NVIDIA may retain prompts and outputs to improve its products. Do not send private or sensitive information. Check [the provider's current terms](https://vercel.com/ai-gateway/models/nemotron-3.5-lightning-free) before enabling. This repository does not configure Gateway credentials or spend money.

## Why a compact compiler pipeline?

Asking a small model for a full painting score can create hundreds of numeric coordinates and fragile references, far beyond the semantic decision the model needs to make. Instead:

1. A 420-character-or-less user description is sent to the server only after an explicit click. It is treated as untrusted **scene data**.
2. The server calls **nvidia/nemotron-3.5-lightning-free** through the AI Gateway's OpenAI-compatible Chat Completions API, requesting JSON Schema output. The system prompt contains one compact few-shot example. Temperature 0.2 and output limit 1,024 tokens favor predictable plan selection.
3. The model returns eight enum fields: landscape, lighting, weather, palette, focal subject, placement, accent color family and mark density. No model-written paths, IDs or executable JS. The server checks every enum and rejects extra fields.
4. If a response is malformed, a **single bounded repair call** receives concise errors. Network/authentication failures do not trigger costly speculative retries.
5. The deterministic compiler reuses six real hand-worked landscape grammars, applies restrained color shifts and composes focal ink/watercolor/oil geometry. It emits normal PaintingDocument v1.0 with stable IDs.
6. The server runs the **authoritative package validator** and the stricter site workload budget. The browser validates once more, then renders with the actual Painter. The JSON is editable and both JSON/PNG exports use the committed score.

This approach reduces generated tokens and avoids schema hallucinations. The chosen scene may only approximate requests outside supported landscape subjects. It is **not** a demonstrated improvement in subjective aesthetics, inference speed or production reliability; those require real model evaluation.

## Contract

GET /api/paint returns a small status object with enabled, experimental and privacy fields. POST /api/paint accepts JSON:

    {"prompt":"A quiet misty inlet with a small boat at dawn","seed":42}

Seed is optional and defaults to 11; valid range is unsigned 32-bit. The response on success contains:

    {"score":{...PaintingDocument...},"plan":{...8 enum fields...},"model":"nvidia/nemotron-3.5-lightning-free","attempts":1}

The complete plan schema and generator are in site/ai-plan.mjs; the actual serverless endpoint is api/paint.ts. Unsupported subjects, extra keys, malformed bodies, bad origins, oversized descriptions, or schema failures return an error with a stable code. The frontend never interprets response code with eval, never receives credentials, and preserves the previous painting if generation or rendering fails.

### Art direction vocabulary

- Landscape: estuary, valley, headland, alpine, marsh, desert
- Lighting: dawn, day, sunset, night
- Weather: clear, mist, rain
- Palette: cool, warm, earth, muted
- Focal subject: none, tree, cottage, boat, lighthouse, sun
- Placement: left, center, right
- Accent: rust, ochre, cream, blue, green
- Mark density: sparse, balanced, textured

Example prompt: "A rust-colored cottage beside a quiet alpine lake at dusk, with snow on the peaks."

## Vercel setup (manual, not performed here)

The existing Vercel project can retain **Other / no framework**, repository root, npm ci, node site/build.mjs, site/dist. The Node function in root api/paint.ts is discovered by Vercel without switching to Next.js. vercel.json configures a bounded maxDuration for the endpoint.

Only if the experiment's trial and privacy limitations are acceptable:

1. Enable Vercel AI Gateway for the intended Vercel project.
2. Set POIESIS_AI_ENABLED=true as a **server-side** environment variable.
3. On Vercel, a valid VERCEL_OIDC_TOKEN can be supplied automatically if your project has appropriate Gateway access. For local server development, configure AI_GATEWAY_API_KEY **privately** through your development environment. Never put credentials in site/ files or client-side variables.
4. Configure restrictive usage/budget policies, firewall protections, and platform-level rate limits **before any public exposure**. The built-in six-request/minute throttle is only per server instance and is **not globally enforceable**; browser origins are not an authentication mechanism. Do not assume this prevents abuse or spending.
5. Use a properly licensed production-suitable model and review its privacy policies before operating a public service. Do not treat the free NVIDIA trial model as production-ready merely because Gateway labels it free.

With the plain static site server (node site/serve.mjs), no serverless route runs and the prompt panel gracefully reports unavailable; all manual painting features continue to work. Test real Gateway calls only after securely configuring access in a private environment. This PR does not deploy, create secrets, modify billing or call live models.

## Tests and evidence

From repository root with Node >=22:

    npm ci
    npm run check
    node site/build.mjs
    npx tsc --project site/tsconfig.json
    node --test site/prompt.test.mjs
    node site/browser.test.mjs

The prompt unit tests cover schema validation, 36 terrain/focal combinations, bounded workloads, deterministic real native Canvas2D pixels, a mocked Gateway single call, one repair call, malformed inputs, disabled state and upstream failures. The browser test stubs only the /api/paint network route and proves that a returned score is actually edited, rerendered and exported; it does not claim a live NVIDIA request. Check the PR's concluded CI and evidence before claiming success.

## References

- [NVIDIA model and trial retention warning](https://vercel.com/ai-gateway/models/nemotron-3.5-lightning-free)
- [AI Gateway Chat Completions structured outputs](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs)
- [AI Gateway authentication and OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok)
- [Vercel Node.js Functions /api convention](https://vercel.com/docs/functions/runtimes/node-js)

### Why direct REST rather than adding the AI SDK?

The supplied AI SDK example and this implementation use the **same Gateway model ID**. The site deliberately uses the documented OpenAI-compatible Chat Completions REST endpoint via native fetch: it eliminates any additional runtime npm dependency, preserves the library's package exports/release workflow and keeps the serverless function small. Switching the private request helper to AI SDK generateText/Output.object is possible later without changing the public score API or the validator.
