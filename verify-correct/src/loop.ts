// The verify/correct loop: generate an answer, verify it, and while it fails and attempts remain,
// correct it and re-verify. Bounded by `maxAttempts` (clamped to [1,10]) and by a per-call
// `timeoutMs` on the judge and corrector. Fail-safe: a judge/corrector that throws, times out, or
// (for the corrector) returns an empty answer stops the loop and returns the best answer so far
// marked `verified: false` with an `error`. A broken verifier never crashes answering, never hangs
// it, and never reports a false "verified".

import { createVerifier } from './verify';
import type { Attempt, Corrector, Generate, Judge, Verdict, VerifiedAnswer } from './types';

export type VerifiedAnswerConfig<Input, Src> = {
  generate: Generate<Input, Src>;
  judge: Judge<Src>;
  correct: Corrector<Src>;
  /** Max verification rounds (first pass + corrections), clamped to [1,10]. Default 2 (one correction). */
  maxAttempts?: number;
  /** Abort a judge/corrector call and count it as a failure after this many ms. Default 30000. */
  timeoutMs?: number;
  pass?: (verdict: Verdict) => boolean;
};

export type VerifiedAnswerer<Input> = { run: (input: Input) => Promise<VerifiedAnswer> };

export function createVerifiedAnswer<Input, Src>(config: VerifiedAnswerConfig<Input, Src>): VerifiedAnswerer<Input> {
  const maxAttempts = clamp(config.maxAttempts, 2, 1, 10);
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(1, Math.trunc(config.timeoutMs as number)) : 30_000;
  const verifier = createVerifier<Src>({ judge: config.judge, ...(config.pass ? { pass: config.pass } : {}) });

  async function run(input: Input): Promise<VerifiedAnswer> {
    const attempts: Attempt[] = [];
    // Generation failing is the caller's error — re-throw it (not a verification failure).
    const generated = await config.generate(input);
    let answer = generated.answer;
    const sources = generated.sources;

    for (let round = 0; round < maxAttempts; round++) {
      let result;
      try {
        result = await withTimeout(timeoutMs, (sig) => verifier.verify(answer, sources, sig));
      } catch (e) {
        return { answer, verified: false, attempts, error: `verify failed: ${msg(e)}` };
      }
      const willCorrect = !result.verified && round < maxAttempts - 1;
      attempts.push({ answer, result, corrected: willCorrect });
      if (result.verified) return { answer, verified: true, attempts };
      if (!willCorrect) return { answer, verified: false, attempts };

      let corrected: string;
      try {
        corrected = await withTimeout(timeoutMs, (sig) => config.correct(answer, result.verdict, sources, sig));
      } catch (e) {
        return { answer, verified: false, attempts, error: `correct failed: ${msg(e)}` };
      }
      if (typeof corrected !== 'string' || !corrected.trim()) {
        return { answer, verified: false, attempts, error: 'correct returned an empty answer' };
      }
      answer = corrected;
    }
    return { answer, verified: false, attempts };
  }

  return { run };
}

/** Run `fn` with an abort signal, rejecting if it doesn't settle within `ms`. No dangling rejections. */
async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  timeout.catch(() => {}); // never an unhandled rejection
  const work = Promise.resolve().then(() => fn(ac.signal));
  work.catch(() => {}); // if the timeout wins, a later work rejection is already handled
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function clamp(v: number | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Math.trunc(v as number) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
