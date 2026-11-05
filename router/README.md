# router

Decide which model should answer a query. You describe tiers (e.g. `light | standard | deep`) and a
small set of **rules**; the router tries them in order (fast, free, deterministic), and only if none
matches does it consult an optional **LLM classifier** — then a safe **default**. Spend a few cheap
tokens (or none) to avoid sending an easy question to an expensive model. Provider-free core; the
classifier is injected.

## Usage

```ts
import { createRouter, byMaxLength, byKeywords, byContext } from './lib/router/src';
import { aiClassifier } from './lib/router/adapters/ai-classifier'; // optional

type Tier = 'light' | 'standard' | 'deep';

const router = createRouter<Tier, { vip?: boolean }>({
  tiers: ['light', 'standard', 'deep'],
  default: 'standard',
  rules: [
    // Order matters — first match wins. Put specific signals before broad ones, or a short
    // "why…" / "compare…" query would be caught by the length rule before the keyword rule.
    byContext('deep', (c) => !!c.vip, 'vip'),          // a context flag
    byKeywords('deep', ['compare', 'why', 'analyze']), // reasoning words → deep (before length)
    byMaxLength('light', 20),                          // otherwise, short → cheap
  ],
  classifier: aiClassifier<Tier>({                  // only runs when no rule matches
    model: 'anthropic/claude-haiku-5.5',
    tiers: ['light', 'standard', 'deep'],
    describe: { light: 'a trivial lookup', standard: 'a normal question', deep: 'multi-step reasoning' },
  }),
});

const { tier, via, reason } = await router.route(query, { vip: user.vip });
const model = inferenceModel(tier); // hand the tier to the inference block
```

- `createRouter<Tier, Ctx>({ tiers, default, rules?, classifier? })` → `{ route(query, ctx) }`. Validates that `default` and every rule tier are in `tiers`.
- `route` returns `{ tier, via: 'rule' | 'classifier' | 'default', reason }` — `via`/`reason` are handy to log how each query was routed.
- Rule builders: `byMaxLength`, `byMinLength`, `byKeywords` (whole-word, case-insensitive), `byContext` (predicate over your context). A rule is just `{ tier, when(query, ctx), reason? }` — write your own.
- `aiClassifier({ model, tiers, describe, instructions?, providerOptions? })` (adapter) builds a classifier from an AI SDK model; it returns `null` for an unrecognised reply so the router falls through.

## Fail-safe

Rules are pure and can't fail. If the classifier **throws** or returns a tier **not in `tiers`**, the
router ignores it and uses the default — a flaky or misconfigured classifier degrades routing to the
safe default, it never takes a request down or routes somewhere invalid.

## Scope

Routing picks a *tier*; mapping a tier to an actual model/provider is the `inference` block's job.
Keep the classifier model small — if classification costs as much as just answering, route by rules
only (omit the classifier) or widen the rules.
