# inference

Provider-agnostic model resolution for an AI SDK 7 app. Instead of hard-coding a model string
and provider options at every `generateText`/`streamText` call, you describe **targets** (where
and how inference runs) once, and resolve `(role) → { model, providerOptions, id }` through one
seam. Switching target re-points the whole app — a different provider, region, or a sovereign
open-weights endpoint — without editing call sites.

Residency, zero-retention, and no-training are **operator-declared metadata** on a target (its
`residency` string and, for a gateway target, its injected `gatewayOptions`). The block does
**not** enforce them — enforcement lives in the gateway options you inject or the provider
endpoint you point at. What the block *does* guarantee is that an unvetted or misconfigured
target can never actually serve traffic (see **Safety**). Keep a `residency` label honest about
what the injected options / endpoint actually send; see [`SECURITY.md`](./SECURITY.md).

## Install the peer dependencies

```bash
npm i ai@^7 @ai-sdk/mistral@^4 @ai-sdk/openai-compatible@^3
```

(Drop the providers you don't use, and delete the matching branch in `resolve.ts`.)

## Public API (`lib/inference/index.ts`)

```ts
// 1. Describe your roles and targets.
type Role = 'router' | 'answer' | 'verify';

const registry = defineRegistry<Role>([
  { id: 'gateway-eu', label: 'Claude (EU)', residency: 'AI Gateway, EU-pinned, zero retention',
    apiKeyEnv: '', mode: 'gateway', enabled: true,
    models: { router: { model: 'anthropic/claude-haiku-5.5' },
              answer: { model: 'anthropic/claude-sonnet-5.5', effort: 'medium' },
              verify: { model: 'anthropic/claude-haiku-5.5' } } },
  { id: 'scaleway', label: 'Scaleway', residency: 'EU open weights',
    apiKeyEnv: 'SCW_SECRET_KEY', baseURL: 'https://api.scaleway.ai/v1',
    mode: 'openai-compatible', enabled: false,   // behind an eval gate
    models: { router: { model: 'mistral-small' }, answer: { model: 'gpt-oss-120b' },
              verify: { model: 'mistral-small' } } },
], 'gateway-eu');

// 2. Build one resolver with YOUR shared gateway options + a secret reader injected.
const { resolve, modelIdOf, effortOf } = createResolver<Role>({
  gatewayOptions,                         // the same object you pass today on a gateway call
  secrets: (name) => process.env[name],   // the one place env is read — your choice, not the core's
});

// 3. At a call site — m.model is typed as ai's LanguageModel, so no cast is needed:
const m = resolve(target, 'answer', { caching: true, thinking: true });
const res = streamText({ model: m.model, providerOptions: m.providerOptions, /* … */ });
audit.model = m.id;                       // raw gateway string, or provider-prefixed off-gateway
```

`providerOptions` is composed by the resolver as `{ gateway }` (plus an `anthropic` block when
`thinking` is on and the model is Anthropic). Only the `gateway` block of your injected options is
carried — if you need another always-on provider key, add it at the call site.

If you pass a custom `secrets` reader to `createResolver` (e.g. a vault, not `process.env`), pass
the **same** reader to the `next-postgres` adapter, or its "is this target configured?" check and
the resolver's key lookup can disagree (the resolver then fails closed and throws).

For a gateway target, `m.providerOptions.gateway` is the **shared** options object (returned by
reference so the path is byte-identical) — treat it as read-only; don't mutate it downstream.
`resolve` reports `effortOf(target, role)` for you to pass to `streamText` as `reasoning`; it does
**not** apply effort itself. `embedding`, `prices`, and `structuredOutputModels` on a target are
advisory metadata for your own UI/cost/eval code — the block doesn't act on them.

- `defineRegistry(targets, defaultId)` — validates the default exists; returns `{ targets, defaultId }`.
- `pickEffectiveTarget(chosenId, registry, { isProd, hasKey })` — the fail-closed chooser (see Safety).
- `isConfigured(target, hasKey)` — gateway always true; off-gateway needs its key present.
- `createResolver({ gatewayOptions, secrets })` → `{ resolve, modelIdOf, effortOf }`.

### Optional adapter: `next-postgres`

`createTargetSelector({ registry, readSetting, writeSetting })` gives you `effectiveTarget()`
(env override → cached DB setting → fail-closed downgrade) and a `saveTarget(id)` that refuses to
store a choice the core wouldn't honour. You supply `readSetting`/`writeSetting` for your DB.

## Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `INFERENCE_TARGET` | no | registry default | **adapter only** — overrides the stored target id |
| `<apiKeyEnv>` per target | only to use that target | unset | the off-gateway key you name on each target; read via your injected `secrets` reader |

The **core reads no environment at all.** Keys and the active-target override reach it only
through the values you pass. That's what makes it portable and unit-testable without global mocks.

## Safety

`pickEffectiveTarget` is fail-closed. A chosen target is honoured only when it (a) exists in the
registry as an own key — a prototype name like `constructor` never matches, (b) is configured — a
gateway, or an off-gateway target whose key is present, and (c) in production, is `enabled`.
Otherwise it falls back to the registry default. `defineRegistry` requires that default to be an
`enabled` **gateway** target, so the fallback is always reachable and vetted; and it rejects
duplicate ids. If `resolve` is ever handed an off-gateway target whose key resolves empty, it
**throws** rather than send an unauthenticated request. A bad setting, a missing key, or an
unvetted target can never route inference somewhere you didn't approve. See [`SECURITY.md`](./SECURITY.md).

## Keeping the gateway path byte-identical

For a gateway target, `resolve` returns your `gatewayOptions.gateway` object **by reference** and
the bare model string — identical to a hand-written gateway call. If you're migrating an existing
app onto this seam, lock that with a test asserting the same string and the same object reference,
so the refactor is provably a no-op for the path you already ship.
