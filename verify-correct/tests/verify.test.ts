import { describe, expect, it, vi } from 'vitest';
import { createVerifiedAnswer, createVerifier } from '../src/index';
import type { Corrector, Generate, Judge, Verdict } from '../src/index';

type Src = string;
const sources: Src[] = ['the sky is blue', 'water is wet'];

const judgeFor = (unsupported: string[]): Judge<Src> => async (answer) => ({
  claims: answer
    .split('. ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((claim) => ({ claim, supported: !unsupported.some((u) => claim.includes(u)) })),
});

describe('createVerifier', () => {
  it('passes when every claim is supported, fails and lists the unsupported ones otherwise', async () => {
    const v = createVerifier<Src>({ judge: judgeFor(['green']) });
    expect(await v.verify('the sky is blue', sources)).toMatchObject({ verified: true, unsupported: [] });
    const bad = await v.verify('the sky is green', sources);
    expect(bad.verified).toBe(false);
    expect(bad.unsupported.map((c) => c.claim)).toEqual(['the sky is green']);
  });

  it('honours a custom pass() predicate', async () => {
    const v = createVerifier<Src>({ judge: async () => ({ claims: [] }), pass: (vd: Verdict) => vd.claims.length > 0 });
    expect((await v.verify('no claims', sources)).verified).toBe(false); // empty → fails under this policy
  });
});

describe('createVerifiedAnswer loop', () => {
  const generate = (answer: string): Generate<string, Src> => async () => ({ answer, sources });

  it('returns a first-pass answer that verifies, with one attempt', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: generate('the sky is blue'), judge: judgeFor([]), correct: async (a) => a });
    const r = await run.run('q');
    expect(r).toMatchObject({ verified: true });
    expect(r.attempts).toHaveLength(1);
  });

  it('corrects once and re-verifies when the first answer fails', async () => {
    const correct: Corrector<Src> = async () => 'the sky is blue'; // the fix makes it supported
    const run = createVerifiedAnswer<string, Src>({ generate: generate('the sky is green'), judge: judgeFor(['green']), correct, maxAttempts: 2 });
    const r = await run.run('q');
    expect(r.verified).toBe(true);
    expect(r.answer).toBe('the sky is blue');
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0]).toMatchObject({ corrected: true });
  });

  it('stops at maxAttempts and returns the best answer marked not-verified', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: generate('the sky is green'), judge: judgeFor(['green']), correct: async (a) => a, maxAttempts: 2 });
    const r = await run.run('q');
    expect(r.verified).toBe(false);
    expect(r.attempts).toHaveLength(2);
  });

  it('is fail-safe: a judge that throws returns the answer ungated with an error, never crashes', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: generate('x'), judge: async () => { throw new Error('judge down'); }, correct: async (a) => a });
    const r = await run.run('q');
    expect(r).toMatchObject({ verified: false });
    expect(r.error).toMatch(/verify failed: judge down/);
  });

  it('is fail-safe: a corrector that throws stops with the current answer and an error', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: generate('the sky is green'), judge: judgeFor(['green']), correct: async () => { throw new Error('corr down'); }, maxAttempts: 2 });
    const r = await run.run('q');
    expect(r).toMatchObject({ verified: false });
    expect(r.error).toMatch(/correct failed: corr down/);
  });

  it('re-throws a generation failure (that is the caller\'s error)', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: async () => { throw new Error('gen down'); }, judge: judgeFor([]), correct: async (a) => a });
    await expect(run.run('q')).rejects.toThrow(/gen down/);
  });
});

describe('no false "verified" (critical contract)', () => {
  const gen: Generate<string, Src> = async () => ({ answer: 'A wrong claim.', sources });

  it('a malformed verdict is NOT verified — it is treated as a failure (C1)', async () => {
    for (const bad of [null, {}, { claims: { a: 1 } }, { claims: 'x' }]) {
      const run = createVerifiedAnswer<string, Src>({ generate: gen, judge: (async () => bad) as unknown as Judge<Src>, correct: async (a) => a });
      const r = await run.run('q');
      expect(r.verified, JSON.stringify(bad)).toBe(false);
    }
  });

  it('a non-boolean "supported" counts as unsupported (C2)', async () => {
    const judge: Judge<Src> = (async () => ({ claims: [{ claim: 'x', supported: 'true' }] })) as unknown as Judge<Src>;
    const r = await createVerifiedAnswer<string, Src>({ generate: gen, judge, correct: async (a) => a }).run('q');
    expect(r.verified).toBe(false);
  });

  it('an empty claims verdict is NOT verified by default (C3)', async () => {
    const judge: Judge<Src> = async () => ({ claims: [] });
    const r = await createVerifiedAnswer<string, Src>({ generate: gen, judge, correct: async (a) => a }).run('q');
    expect(r.verified).toBe(false);
  });

  it('an empty corrected answer does not become a verified answer (C5)', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: gen, judge: judgeFor(['wrong']), correct: async () => '', maxAttempts: 2 });
    const r = await run.run('q');
    expect(r.verified).toBe(false);
    expect(r.error).toMatch(/empty answer/);
  });

  it('an async (truthy-Promise) custom pass does not pass (C6)', async () => {
    const run = createVerifiedAnswer<string, Src>({
      generate: gen,
      judge: judgeFor([]),
      correct: async (a) => a,
      pass: (() => Promise.resolve(false)) as unknown as (v: Verdict) => boolean,
    });
    expect((await run.run('q')).verified).toBe(false);
  });

  it('times out a hung judge and returns not-verified (H1)', async () => {
    const run = createVerifiedAnswer<string, Src>({ generate: gen, judge: () => new Promise(() => {}), correct: async (a) => a, timeoutMs: 20 });
    const r = await run.run('q');
    expect(r).toMatchObject({ verified: false });
    expect(r.error).toMatch(/timed out/);
  });

  it('clamps maxAttempts (Infinity/NaN) so the loop is always bounded and runs (H2)', async () => {
    const inf = await createVerifiedAnswer<string, Src>({ generate: gen, judge: judgeFor(['wrong']), correct: async (a) => a, maxAttempts: Infinity }).run('q');
    expect(inf.attempts.length).toBeLessThanOrEqual(10); // clamped, not unbounded
    const nan = await createVerifiedAnswer<string, Src>({ generate: gen, judge: judgeFor([]), correct: async (a) => a, maxAttempts: Number.NaN }).run('q');
    expect(nan.attempts.length).toBeGreaterThanOrEqual(1); // NaN → default, loop still runs
  });
});
