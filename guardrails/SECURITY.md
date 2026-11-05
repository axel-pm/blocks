# guardrails — threat model

## PII masking is best-effort, not a guarantee

- **False negatives:** the built-in detectors cover emails and phone numbers (7–15 digits) and the
  names/patterns you supply. They will NOT catch everything — addresses, national IDs, account
  numbers, unusual phone formats, or a name you didn't list all pass through. Add `patterns` for the
  identifiers that matter to you, and do not represent masking as full de-identification.
- **Over-masking is deliberate.** The phone detector masks any run of ≥7 digits with no upper bound,
  so a phone abutting a date/number is masked whole rather than slipping through. Expect it to redact
  some long non-phone numbers (order ids, account numbers) — that is the safe direction for PII.
  Overlapping detections are merged into one span, so a value is never left partly unmasked.
- **Token-guessing exfiltration is defended.** Tokens carry a per-call random nonce, so they are not
  guessable across calls, and `unmask` restores ONLY the exact token strings present in `map` (a
  single pass). An attacker who plants a token-lookalike in a document or in model output cannot make
  `unmask` reveal a masked value, and a source string that merely resembles a token is never
  corrupted. For adversarial input, inject a cryptographic `nonce` (`() => crypto.randomUUID()`); the
  default is `Math.random`-based (a guess barrier, not a secret).
- **The map is sensitive.** `mask` returns `{ text, map }` where `map` holds the ORIGINAL values
  keyed by token. Keep it in memory for the lifetime of the request; never log it, persist it, or
  send it to the model. Send only `text`; call `unmask` locally on the model's response if you need
  the originals back.
- **Unicode names:** name matching is whitespace-flexible and combining-mark aware, but a name in a
  different Unicode normalization form (NFC vs NFD) than the text may not match. Normalize both to
  NFC upstream if your corpus mixes forms.
- Masking reduces exposure when sending text to a third-party model or into logs; it is a
  data-minimisation control, not a substitute for a provider data-processing agreement.

## Spend caps hold only if the store is atomic

- `createSpendCap` is correct only when `CapStore.incrBy` is an **atomic increment-and-return**
  (e.g. Redis/Upstash `INCRBY` + `EXPIRE`, or a Postgres `UPDATE … RETURNING`). The bundled
  `memoryStore` is single-process; behind multiple instances it under-counts and the cap leaks.
- The cap counts the increment **before** deciding, so a burst over-counts rather than over-admits —
  the safe direction. A caller that keeps sending while blocked stays blocked (its spend keeps
  accruing within the window).
- Fail-closed on store errors: if `incrBy` throws, `check` propagates the error — treat a failed cap
  check as "not allowed", don't swallow it and proceed.
- The window is a fixed TTL set on first write, not a sliding window; bursts at a window boundary can
  briefly allow up to ~2× the limit across the seam. Use a shorter window if that matters.

## Untrusted content

- `fenceText` stops a passage from closing its own fence, but fencing is only half the control — the
  model must be TOLD (via `SYSTEM_RULE` or your own instruction) to treat fenced text as data. Fencing
  without that instruction does nothing.
- `looksInjected` is a monitoring heuristic over a fixed phrase list. A novel or obfuscated injection
  will not match. **Never** use it as a gate that admits/blocks requests — treat a non-match as "no
  signal", not "safe".

## What this block does NOT do

No authentication/authorization, no output moderation or toxicity classification, no secret vaulting,
no network egress control. It is a set of input/accounting primitives, not a complete security layer.
