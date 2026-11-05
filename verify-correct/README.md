# verify-correct

Check that a generated answer is actually grounded in its sources, and — if not — correct it, in a
bounded loop. This is the "don't ship a hallucination" seam: generate → verify → (correct →
re-verify)\* → return, with a hard cap on attempts. Provider-free core; the generator, judge, and
corrector are injected, so it works with any model (or a deterministic fake in tests) and composes
with `rag` (its retrievals are the sources) and `inference` (which models do the work).

## Usage

```ts
import { createVerifiedAnswer } from './lib/verify-correct/src';
import { aiJudge, aiCorrector } from './lib/verify-correct/adapters/ai-verify';

const answerer = createVerifiedAnswer<Query, Passage>({
  generate: async (q) => {                    // your RAG answer step
    const sources = await retrieve(q);
    return { answer: await draft(q, sources), sources };
  },
  judge: aiJudge({ model: 'anthropic/claude-haiku-5.5', renderSource: (p) => p.text }),
  correct: aiCorrector({ model: 'anthropic/claude-sonnet-5.5', renderSource: (p) => p.text }),
  maxAttempts: 2,                             // first pass + one correction
});

const { answer, verified, attempts, error } = await answerer.run(query);
// Show `answer`; if !verified, flag it ("couldn't fully verify") rather than presenting it as checked.
```

- `createVerifier({ judge, pass? })` → `verify(answer, sources)` → `{ verified, verdict, unsupported }`. Default pass = every claim supported; override `pass` (e.g. require ≥1 grounded claim).
- `createVerifiedAnswer({ generate, judge, correct, maxAttempts?, pass? })` → `run(input)` → `{ answer, verified, attempts, error? }`. `attempts` records each answer + its verdict + whether it was corrected, for auditing.
- `aiJudge` / `aiCorrector` (adapter) build a Judge/Corrector from AI SDK models; `renderSource` turns your source type into the text the model checks against.

## Fail-safe

- If the **judge** or **corrector** throws, the loop stops and returns the current answer with
  `verified: false` and an `error` — a broken verifier never crashes answering and never silently
  reports an answer as verified.
- The `aiJudge` parse is strict: an unparseable reply throws (→ unverified), and any `supported`
  value that isn't exactly `true` counts as unsupported. The failure direction is always "not
  verified", never a false "verified".
- `generate` throwing is re-thrown — that's the caller's own error, not a verification failure.

## Scope

This block decides *whether* an answer is grounded and runs the correction loop; it does not write
the prompts' domain specifics for you (the adapter's prompts are a sane default — tune them for your
claims and languages). Claim extraction quality is the judge model's job; keep it capable enough to
catch real ungrounded statements, and gate shipping a sovereign/cheap judge on an eval.
