import { afterEach, describe, expect, it } from 'vitest';
import { createTargetSelector } from '../adapters/next-postgres-target';
import { registry, type Role } from './fixtures';

// Adapter tests. This file is copied in only with `--adapter next-postgres`, alongside the adapter
// it exercises, so a core-only copy never pulls in a reference to an adapter that isn't there.

describe('next-postgres adapter', () => {
  const liveKeys = (n: string) => (n === 'SCW_SECRET_KEY' ? 'k' : undefined);
  let stored: string | undefined;
  const make = (opts: Partial<Parameters<typeof createTargetSelector<Role>>[0]> = {}) =>
    createTargetSelector<Role>({
      registry,
      readSetting: async () => stored,
      writeSetting: async (id) => { stored = id; },
      secrets: liveKeys,
      isProd: () => false,
      envVar: 'TEST_INFERENCE_TARGET',
      cacheMs: 0, // read fresh each time, so stored changes are visible in the test
      ...opts,
    });

  afterEach(() => { stored = undefined; delete process.env.TEST_INFERENCE_TARGET; });

  it('effectiveTarget honours a configured stored choice, else downgrades', async () => {
    const sel = make();
    stored = 'scaleway'; // configured (key present) and not prod → honoured
    expect((await sel.effectiveTarget()).id).toBe('scaleway');
    stored = 'ghost';
    expect((await sel.effectiveTarget()).id).toBe('gateway-eu');
  });

  it('env override beats the stored value', async () => {
    const sel = make();
    stored = 'gateway-eu';
    process.env.TEST_INFERENCE_TARGET = 'scaleway';
    expect((await sel.effectiveTarget()).id).toBe('scaleway');
  });

  it('downgrades a prod-disabled target even if stored', async () => {
    const sel = make({ isProd: () => true });
    stored = 'scaleway'; // enabled:false → not allowed in prod
    expect((await sel.effectiveTarget()).id).toBe('gateway-eu');
  });

  it('saveTarget refuses unknown, key-less, and prod-disabled choices; accepts a valid one', async () => {
    const sel = make();
    await expect(sel.saveTarget('ghost')).rejects.toThrow(/unknown/);
    const noKey = make({ secrets: () => undefined });
    await expect(noKey.saveTarget('scaleway')).rejects.toThrow(/not configured/);
    const prod = make({ isProd: () => true });
    await expect(prod.saveTarget('scaleway')).rejects.toThrow(/not enabled in production/);
    await sel.saveTarget('scaleway');
    expect(stored).toBe('scaleway');
  });

  it('invalidates the cache on save, so a change is live immediately', async () => {
    const sel = make({ cacheMs: 60_000 }); // long cache
    stored = 'gateway-eu';
    expect((await sel.effectiveTarget()).id).toBe('gateway-eu'); // warms the cache
    await sel.saveTarget('scaleway'); // writes + clears cache
    expect((await sel.effectiveTarget()).id).toBe('scaleway');
  });
});
