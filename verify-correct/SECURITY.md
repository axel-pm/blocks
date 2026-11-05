# verify-correct — threat model

## Fail-safe: the failure direction is always "not verified"

The whole point of this block is to avoid presenting an ungrounded answer as checked. Every failure
path is biased accordingly:

- A judge or corrector that throws → the loop returns the current answer with `verified: false` and
  an `error`. It never crashes answering, and never returns `verified: true` by default.
- The `aiJudge` adapter treats any `supported` value that isn't exactly `true` — and any reply it
  can't parse as JSON with a `claims` array — as unsupported / unverified.
- Act on the flag: when `verified` is false, surface the answer as unverified (or withhold it), don't
  present it as fact-checked. The block gives you the signal; honouring it is the caller's job.

## Untrusted sources and injection

Sources (and the answer, if it echoes user input) are untrusted. The adapter prompts fence the
sources and instruct the model not to follow instructions inside them, but prompt injection against
a judge/corrector is still possible — a malicious source could try to coerce a "supported" verdict
or steer the correction. Mitigations: keep the judge's only job returning a verdict (no tools, no
authority); treat a suspicious verdict conservatively; and remember a mis-verdict's blast radius is a
wrongly-shipped or wrongly-flagged answer, never a privileged action. Compose with `guardrails`
(`fenceText`) if you build your own judge prompt.

## Cost and loops

Each attempt is one judge call, and each correction adds a corrector + another judge call.
`maxAttempts` bounds this (default 2 = at most two judge calls + one correction). Don't raise it far:
an answer that won't verify in one or two corrections usually won't, and each round costs tokens.
Pair with the `guardrails` spend cap when answer volume is untrusted.

## Not a correctness guarantee

Verification is only as good as the judge model and its prompt. A weak judge misses ungrounded
claims (false "verified") or flags grounded ones (false "unverified"). This block structures and
bounds the check; it does not make a small model a reliable fact-checker. Gate a cheap/sovereign
judge on an eval before trusting its verdicts.
