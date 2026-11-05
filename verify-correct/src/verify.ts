// Verify: run the injected judge over an answer + its sources and decide whether it passed. The
// verdict contract is enforced HERE, not trusted from the judge: a non-object verdict or a missing
// claims array THROWS (the loop turns that into verified:false), a claim's `supported` counts only
// when it is exactly `true`, and the default pass requires at least one claim AND all supported — so
// an empty or malformed verdict can never be reported as verified. Override `pass` only to make the
// bar stricter.

import type { ClaimVerdict, Judge, Verdict, VerifyResult } from './types';

export type VerifierConfig<Src> = {
  judge: Judge<Src>;
  /** Decide pass/fail from the (normalised) verdict. Default: ≥1 claim and every claim supported. */
  pass?: (verdict: Verdict) => boolean;
};

export type Verifier<Src> = {
  verify: (answer: string, sources: Src[], signal?: AbortSignal) => Promise<VerifyResult>;
};

const NEVER_ABORT = new AbortController().signal; // non-aborting default when no timeout is supplied

export function createVerifier<Src>(config: VerifierConfig<Src>): Verifier<Src> {
  const passed = config.pass ?? defaultPass;

  async function verify(answer: string, sources: Src[], signal: AbortSignal = NEVER_ABORT): Promise<VerifyResult> {
    const verdict = await config.judge(answer, sources, signal);
    if (typeof verdict !== 'object' || verdict === null || !Array.isArray((verdict as Verdict).claims)) {
      throw new Error('verify: judge returned a malformed verdict (expected { claims: [...] })');
    }
    const claims: ClaimVerdict[] = (verdict as Verdict).claims.map((c, i) => {
      if (typeof c !== 'object' || c === null) throw new Error(`verify: claim ${i} is not an object`);
      const o = c as Record<string, unknown>;
      return {
        claim: String(o.claim ?? ''),
        supported: o.supported === true, // anything but exactly true is unsupported (fail-safe)
        ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
      };
    });
    const note = (verdict as Verdict).note;
    const safeVerdict: Verdict = { claims, ...(typeof note === 'string' ? { note } : {}) };
    const unsupported = claims.filter((c) => !c.supported);
    return { verified: passed(safeVerdict) === true, verdict: safeVerdict, unsupported };
  }

  return { verify };
}

/** Default pass policy: at least one claim, and every claim supported. An empty verdict does NOT pass. */
function defaultPass(verdict: Verdict): boolean {
  return verdict.claims.length > 0 && verdict.claims.every((c) => c.supported);
}
