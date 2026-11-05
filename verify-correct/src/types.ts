// Types for the verify-correct block: check that a generated answer is grounded in its sources, and
// (if not) correct it, up to a bounded number of attempts. Pure core — the judge, corrector, and
// generator are injected functions, so the core calls no model/provider.

/** One checkable claim in an answer and whether the sources support it. */
export type ClaimVerdict = { claim: string; supported: boolean; reason?: string };

/** A judge's assessment of an answer against its sources. */
export type Verdict = { claims: ClaimVerdict[]; note?: string };

/** Judges an answer against its sources (typically an LLM call). Injected. `signal` aborts on timeout. */
export type Judge<Src> = (answer: string, sources: Src[], signal: AbortSignal) => Promise<Verdict>;

/** Rewrites an answer to fix the unsupported claims, using only the sources (typically an LLM call). Injected. */
export type Corrector<Src> = (answer: string, verdict: Verdict, sources: Src[], signal: AbortSignal) => Promise<string>;

/** Produces an answer and the sources it was grounded in. Injected. */
export type Generate<Input, Src> = (input: Input) => Promise<{ answer: string; sources: Src[] }>;

/** The outcome of verifying one answer. */
export type VerifyResult = {
  verified: boolean;
  verdict: Verdict;
  /** The claims the judge marked unsupported (empty when verified). */
  unsupported: ClaimVerdict[];
};

/** One recorded attempt in the verify/correct loop (for auditing how an answer was arrived at). */
export type Attempt = { answer: string; result: VerifyResult; corrected: boolean };

/** The final result of the loop. */
export type VerifiedAnswer = {
  answer: string;
  verified: boolean;
  attempts: Attempt[];
  /** Set when verification itself could not run (judge/corrector threw); the answer is returned ungated. */
  error?: string;
};
