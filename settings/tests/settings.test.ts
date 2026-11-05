import { describe, expect, it, vi } from 'vitest';
import { memoryStore } from '../adapters/memory-store';
import { createSettings, defineSetting, enumCodec, stringCodec } from '../src/index';

const FLAG = defineSetting<boolean>({ key: 'feature_x', default: false });
const MODE = defineSetting<'a' | 'b' | 'c'>({ key: 'mode', default: 'a', envVar: 'APP_MODE', codec: enumCodec(['a', 'b', 'c']) });
const LABEL = defineSetting<string>({ key: 'label', default: 'default', codec: stringCodec, validate: (v) => v.length <= 10 });

describe('createSettings — precedence and caching', () => {
  it('returns the default when nothing is stored', async () => {
    const s = createSettings({ store: memoryStore() });
    expect(await s.get(FLAG)).toBe(false);
  });

  it('reads a stored value and applies set immediately (cache invalidated)', async () => {
    const s = createSettings({ store: memoryStore(), cacheMs: 60_000 });
    expect(await s.get(FLAG)).toBe(false);
    await s.set(FLAG, true);
    expect(await s.get(FLAG)).toBe(true); // visible despite the long cache, because set() invalidated
  });

  it('env override beats the stored value and bypasses the cache', async () => {
    const env = vi.fn((n: string) => (n === 'APP_MODE' ? 'c' : undefined));
    const s = createSettings({ store: memoryStore({ mode: '"b"' }), env, cacheMs: 60_000 });
    expect(await s.get(MODE)).toBe('c');
  });

  it('caches within the window and refreshes after it', async () => {
    const store = memoryStore({ feature_x: 'true' });
    const read = vi.spyOn(store, 'read');
    const s = createSettings({ store, cacheMs: 1000 });
    expect(await s.get(FLAG)).toBe(true);
    expect(await s.get(FLAG)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1); // second call served from cache
    s.invalidate('feature_x');
    expect(await s.get(FLAG)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('createSettings — fail-safe', () => {
  it('falls back to default (and reports) when a stored value is unparseable', async () => {
    const onError = vi.fn();
    const s = createSettings({ store: memoryStore({ feature_x: 'not-json' }), onError });
    expect(await s.get(FLAG)).toBe(false);
    expect(onError).toHaveBeenCalledWith('feature_x', 'store', expect.anything());
  });

  it('falls back to default when an env override is invalid for the codec', async () => {
    const onError = vi.fn();
    const s = createSettings({ store: memoryStore(), env: () => 'z', onError });
    expect(await s.get(MODE)).toBe('a'); // 'z' not in enum → default
    expect(onError).toHaveBeenCalledWith('mode', 'env', expect.anything());
  });

  it('REFUSES to persist an invalid value (writes validate strictly)', async () => {
    const s = createSettings({ store: memoryStore() });
    await expect(s.set(LABEL, 'this label is way too long')).rejects.toThrow(/invalid value/);
    expect(await s.get(LABEL)).toBe('default'); // nothing stored
  });

  it('ignores an invalid stored value on read but keeps serving the default', async () => {
    const s = createSettings({ store: memoryStore({ label: 'way-too-long-value' }) });
    expect(await s.get(LABEL)).toBe('default');
  });
});

describe('createSettings — review fixes', () => {
  it('rejects two different Setting objects sharing a key (H1 collision)', async () => {
    const A = defineSetting<number>({ key: 'dup', default: 1 });
    const B = defineSetting<string>({ key: 'dup', default: 'x', codec: stringCodec });
    const s = createSettings({ store: memoryStore() });
    await s.get(A);
    await expect(s.get(B)).rejects.toThrow(/already used by a different Setting/);
  });

  it('enforces the value type against the default when no validate is given (H4)', async () => {
    const NUM = defineSetting<number>({ key: 'num', default: 0 });
    const onError = vi.fn();
    const s = createSettings({ store: memoryStore({ num: '"hi"' }), onError }); // a string where a number is expected
    expect(await s.get(NUM)).toBe(0); // falls back to default, not the string "hi"
    expect(onError).toHaveBeenCalledWith('num', 'store', expect.anything());
  });

  it('a throwing onError does not break the read (H3)', async () => {
    const s = createSettings({ store: memoryStore({ feature_x: 'bad' }), onError: () => { throw new Error('boom'); } });
    expect(await s.get(FLAG)).toBe(false); // still returns the default
  });

  it('falls back to the default (and does not cache) when the store read throws (M3)', async () => {
    let fail = true;
    const store = { read: async () => { if (fail) throw new Error('db down'); return 'true'; }, write: async () => {} };
    const onError = vi.fn();
    const s = createSettings({ store, cacheMs: 60_000, onError });
    expect(await s.get(FLAG)).toBe(false); // outage → default
    expect(onError).toHaveBeenCalledWith('feature_x', 'store', expect.anything());
    fail = false;
    expect(await s.get(FLAG)).toBe(true); // recovers (the outage result was NOT cached)
  });

  it('treats an empty env var as unset and ignores an invalid override, keeping the stored value (M4)', async () => {
    const empty = createSettings({ store: memoryStore({ feature_x: 'true' }), env: () => '' });
    expect(await empty.get(FLAG)).toBe(true); // '' = unset → stored true, not the default
    const invalid = createSettings({ store: memoryStore({ mode: 'b' }), env: () => 'z', onError: vi.fn() });
    expect(await invalid.get(MODE)).toBe('b'); // invalid env falls THROUGH to the stored value (enumCodec stores the bare literal)
  });

  it('refuses to persist a value that would not round-trip (M1)', async () => {
    const NUM = defineSetting<number>({ key: 'num', default: 0 });
    const s = createSettings({ store: memoryStore() });
    await expect(s.set(NUM, Number.NaN)).rejects.toThrow(); // JSON.stringify(NaN)='null' → wrong type on read-back
  });

  it('does not cache a stale value when set() races an in-flight get (H2)', async () => {
    let release!: (v: string | undefined) => void;
    const gate = new Promise<string | undefined>((r) => { release = r; });
    let reads = 0;
    const store = { read: async () => (++reads === 1 ? gate : 'new'), write: async () => {} };
    const S = defineSetting<string>({ key: 'r', default: 'd', codec: stringCodec });
    const s = createSettings({ store, cacheMs: 60_000 });
    const inflight = s.get(S); // read #1 — pending on the gate
    await s.set(S, 'new'); // bumps generation, clears cache
    release('old'); // the slow read resolves with the stale value
    expect(await inflight).toBe('old'); // this call sees stale (acceptable)…
    expect(await s.get(S)).toBe('new'); // …but it was NOT cached, so the next read is fresh
  });
});
