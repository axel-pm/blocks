# guardrails

Security primitives for an AI app, as a zero-dependency pure core: redact PII before text leaves
your trust boundary, cap per-principal spend, and fence untrusted content against prompt injection.
Each piece is independent — use one without the others. Composes with every other block (mask the
input to `inference`, cap before you call it, fence `rag` passages).

## PII masking (`mask` / `unmask`)

```ts
import { mask, unmask } from './lib/guardrails/src';

const { text, map } = mask('Email jo@acme.com or call +1 415 555 2671', { names: ['Jo'] });
// text: "Email ⟦EMAIL_1⟧ or call ⟦PHONE_1⟧"  — send THIS to the model / logs
const answer = await llm(text);
const restored = unmask(answer, map); // put the originals back in the model's output, if needed
```

Reversible and safe-by-default: within one call a repeated value reuses its token, and `unmask`
restores only the exact tokens in the map. Tokens carry a **per-call random nonce**, so they differ
between calls and an attacker who controls input can't guess a token to smuggle a masked value back
out through `unmask` (inject a crypto-strong `nonce` for hostile input). Masks emails and phone-like
digit runs (≥7 digits — it **over-masks** an adjacent number rather than risk leaking a phone) by
default; add `names` (case-insensitive, word-boundary, whitespace-flexible) and `patterns`
(`{ type, pattern }`) for your own identifiers. Overlapping detections are **merged**, so a value is
never left partly unmasked. **Best-effort, not a guarantee** — see SECURITY.

## Spend / rate caps (`createSpendCap`, `evaluate`)

```ts
import { createSpendCap } from './lib/guardrails/src';
import { memoryStore } from './lib/guardrails/adapters/memory-store'; // or your Upstash/Postgres store

const cap = createSpendCap({ store: memoryStore(), limit: 5, windowSeconds: 86_400 }); // $5/day
const v = await cap.check(userId, estimatedCostUsd);
if (!v.allowed) return tooMany(`over the daily limit (${v.limit})`);
```

`check` increments first (atomically, in the store) then compares, so a race **over-counts rather
than over-admits** — the safe direction for a cap. You provide the store; `memoryStore` is for
dev/tests, and the adapter header sketches the atomic Upstash/Postgres contract a real one needs.
`evaluate(used, limit)` is the pure decision if you do your own accounting.

## Untrusted content (`fenceText`, `SYSTEM_RULE`, `looksInjected`)

```ts
import { fenceText, SYSTEM_RULE } from './lib/guardrails/src';

const prompt = `${SYSTEM_RULE}\n\n${fenceText(userDocument)}`; // the doc can't break out of the fence
```

`fenceText` wraps text in a fence that can't be closed early; pair it with `SYSTEM_RULE` in your
system prompt so the model treats fenced text as data, never commands. `looksInjected(text)` is an
**advisory** heuristic for logging/alerting — never a blocking security boundary.

## Environment

None. The core reads no environment and has no dependencies. (A real `CapStore` adapter will read
its own store's credentials — that lives in your adapter, not here.)

## Scope

In: masking, caps, untrusted fencing. Out (by design): a managed secrets vault, a WAF, output
moderation/classification, and authn/authz — compose those elsewhere.
