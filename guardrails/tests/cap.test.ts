import { describe, expect, it } from 'vitest';
import { memoryStore } from '../adapters/memory-store';
import { createSpendCap, evaluate } from '../src/cap';

describe('evaluate', () => {
  it('allows at or below the limit, blocks above', () => {
    expect(evaluate(5, 10)).toEqual({ allowed: true, used: 5, limit: 10, remaining: 5 });
    expect(evaluate(10, 10).allowed).toBe(true);
    expect(evaluate(11, 10)).toEqual({ allowed: false, used: 11, limit: 10, remaining: 0 });
  });
});

describe('createSpendCap', () => {
  it('counts per principal and blocks once the limit is crossed; blocked spend stays counted', async () => {
    const cap = createSpendCap({ store: memoryStore(), limit: 3, windowSeconds: 60 });
    expect((await cap.check('u1')).allowed).toBe(true); // 1
    expect((await cap.check('u1')).allowed).toBe(true); // 2
    expect((await cap.check('u1')).allowed).toBe(true); // 3
    const over = await cap.check('u1'); // 4
    expect(over).toMatchObject({ allowed: false, used: 4, remaining: 0 });
    expect((await cap.check('u1')).used).toBe(5); // still counted while blocked
    expect((await cap.check('u2')).allowed).toBe(true); // separate principal
  });

  it('resets after the window expires', async () => {
    let t = 0;
    const cap = createSpendCap({ store: memoryStore(() => t), limit: 1, windowSeconds: 10 });
    expect((await cap.check('u')).allowed).toBe(true);
    expect((await cap.check('u')).allowed).toBe(false);
    t += 11_000; // past the 10s window
    expect((await cap.check('u')).allowed).toBe(true);
  });

  it('supports weighted amounts (e.g. dollars) and validates them', async () => {
    const cap = createSpendCap({ store: memoryStore(), limit: 5, windowSeconds: 60 });
    expect((await cap.check('u', 4)).allowed).toBe(true);
    expect((await cap.check('u', 2)).allowed).toBe(false); // 6 > 5
    await expect(cap.check('u', Number.NaN)).rejects.toThrow(/finite/);
    await expect(cap.check('u', -1)).rejects.toThrow(/≥ 0/);
  });

  it('validates its own configuration, including Infinity', () => {
    expect(() => createSpendCap({ store: memoryStore(), limit: 0, windowSeconds: 60 })).toThrow(/limit/);
    expect(() => createSpendCap({ store: memoryStore(), limit: 1, windowSeconds: 0 })).toThrow(/windowSeconds/);
    expect(() => createSpendCap({ store: memoryStore(), limit: Infinity, windowSeconds: 60 })).toThrow(/limit/);
    expect(() => createSpendCap({ store: memoryStore(), limit: 1, windowSeconds: Infinity })).toThrow(/windowSeconds/);
  });

  it('fails CLOSED when the store returns a non-numeric total (M2)', async () => {
    const badStore = { incrBy: async () => null as unknown as number };
    const cap = createSpendCap({ store: badStore, limit: 5, windowSeconds: 60 });
    await expect(cap.check('u')).rejects.toThrow(/invalid total/); // never silently allowed
  });

  it('keeps separate principals from colliding on the key', async () => {
    const cap = createSpendCap({ store: memoryStore(), limit: 1, windowSeconds: 60 });
    expect((await cap.check('a:b')).allowed).toBe(true);
    expect((await cap.check('a')).allowed).toBe(true); // 'a:b' and 'a' must not share a bucket
  });
});
