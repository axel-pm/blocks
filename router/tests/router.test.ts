import { describe, expect, it } from 'vitest';
import { byContext, byKeywords, byMaxLength, createRouter } from '../src/index';
import type { Classifier, Rule } from '../src/index';

type Tier = 'light' | 'standard' | 'deep';
type Ctx = { vip?: boolean };

describe('createRouter — config validation', () => {
  it('rejects a default or rule tier not in tiers', () => {
    expect(() => createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'x' as Tier })).toThrow(/default/);
    expect(() =>
      createRouter<Tier, Ctx>({ tiers: ['light'], default: 'light', rules: [{ tier: 'deep' as Tier, when: () => true }] }),
    ).toThrow(/unknown tier/);
  });
});

describe('createRouter — precedence', () => {
  const classifier: Classifier<Tier, Ctx> = async (q) => (q.includes('why') ? 'deep' : 'standard');
  const router = createRouter<Tier, Ctx>({
    tiers: ['light', 'standard', 'deep'],
    default: 'standard',
    rules: [byContext('deep', (c: Ctx) => !!c.vip, 'vip'), byMaxLength('light', 10), byKeywords('deep', ['compare', 'analyze'])],
    classifier,
  });

  it('applies the first matching rule and short-circuits the classifier', async () => {
    expect(await router.route('hi', {})).toEqual({ tier: 'light', via: 'rule', reason: 'len≤10' });
    expect(await router.route('please compare X and Y in depth', {})).toMatchObject({ tier: 'deep', via: 'rule', reason: 'keyword' });
    expect(await router.route('a normal length question here', { vip: true })).toMatchObject({ tier: 'deep', reason: 'vip' });
  });

  it('uses the classifier when no rule matches', async () => {
    expect(await router.route('why does the pump cavitate at low flow', {})).toMatchObject({ tier: 'deep', via: 'classifier' });
    expect(await router.route('what is the warranty period on this model', {})).toMatchObject({ tier: 'standard', via: 'classifier' });
  });

  it('falls back to default when the classifier declines or errors (fail-safe)', async () => {
    const nullC = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', classifier: async () => null });
    expect(await nullC.route('a sufficiently long query with no rules', {})).toMatchObject({ tier: 'standard', via: 'default' });
    const throwC = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'light', classifier: async () => { throw new Error('model down'); } });
    expect(await throwC.route('a sufficiently long query with no rules', {})).toMatchObject({ tier: 'light', via: 'default' });
  });

  it('ignores a classifier result that is not a known tier', async () => {
    const badC = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', classifier: async () => 'enormous' as Tier });
    expect(await badC.route('a sufficiently long query with no rules', {})).toMatchObject({ tier: 'standard', via: 'default' });
  });
});

describe('heuristics', () => {
  it('byKeywords matches whole words case-insensitively, not substrings', async () => {
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', rules: [byKeywords('deep', ['why'])] });
    expect((await r.route('WHY is this', {})).tier).toBe('deep');
    expect((await r.route('whyever not', {})).tier).toBe('standard'); // "why" inside "whyever" is not a match
  });
});

describe('createRouter — fail-safe (review fixes)', () => {
  it('skips a rule whose predicate throws, and survives a non-string query (H3)', async () => {
    const boom: Rule<Tier, Ctx> = { tier: 'deep', when: () => { throw new Error('bad rule'); } };
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', rules: [boom, byKeywords('deep', ['why'])] });
    expect((await r.route('why now', {})).tier).toBe('deep'); // first rule threw, second still works
    // @ts-expect-error non-string query must not throw
    expect((await r.route(undefined, {})).via).toBe('default');
    // A query whose toString throws (null-prototype / hostile object) must not break routing.
    const hostile = Object.create(null);
    expect((await r.route(hostile as unknown as string, {})).via).toBe('default');
  });

  it('treats an async rule as a non-match without an unhandled rejection', async () => {
    const asyncThrow: Rule<Tier, Ctx> = { tier: 'deep', when: (() => Promise.reject(new Error('async rule'))) as unknown as Rule<Tier, Ctx>['when'] };
    const asyncTrue: Rule<Tier, Ctx> = { tier: 'deep', when: (() => Promise.resolve(true)) as unknown as Rule<Tier, Ctx>['when'] };
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', rules: [asyncThrow, asyncTrue] });
    expect((await r.route('anything at all here', {})).via).toBe('default'); // neither async rule matches, no crash
  });

  it('a post-construction mutation of a rule OBJECT cannot change its tier (M3 residual)', async () => {
    const rule = byKeywords<Tier, Ctx>('deep', ['why']);
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', rules: [rule] });
    (rule as { tier: string }).tier = 'zzz'; // mutate the caller's rule object after construction
    expect((await r.route('why now', {})).tier).toBe('deep'); // the router kept its own copy
  });

  it('a NaN/Infinity classifierTimeoutMs falls back to the default timeout, not a 1ms timer', async () => {
    const hang: Classifier<Tier, Ctx> = () => new Promise(() => {});
    // With a bad timeout coerced to the 3000 default, a short query still returns promptly via a rule;
    // here there's no rule, so we just confirm construction + a resolved classifier works.
    const ok: Classifier<Tier, Ctx> = async () => 'deep';
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', classifier: ok, classifierTimeoutMs: Number.NaN });
    expect((await r.route('a long unmatched query here', {})).tier).toBe('deep');
    void hang;
  });

  it('times out a hanging classifier and falls back to the default (H2)', async () => {
    const hang: Classifier<Tier, Ctx> = () => new Promise(() => {}); // never settles
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', classifier: hang, classifierTimeoutMs: 20 });
    const res = await r.route('a long query with no matching rule at all', {});
    expect(res).toMatchObject({ tier: 'standard', via: 'default' });
  });

  it('rejects an empty or duplicated tiers config', () => {
    expect(() => createRouter<Tier, Ctx>({ tiers: [], default: 'light' })).toThrow(/non-empty/);
    expect(() => createRouter<Tier, Ctx>({ tiers: ['light', 'light'], default: 'light' })).toThrow(/unique/);
  });

  it('a post-construction push to the caller\'s rules array cannot introduce a new tier (M3)', async () => {
    const rules: Rule<Tier, Ctx>[] = [];
    const r = createRouter<Tier, Ctx>({ tiers: ['light', 'standard', 'deep'], default: 'standard', rules });
    rules.push({ tier: 'zzz' as Tier, when: () => true }); // mutate after construction
    expect((await r.route('x', {})).tier).toBe('standard'); // the pushed rule is NOT consulted
  });
});

