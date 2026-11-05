import { describe, expect, it } from 'vitest';
import { defineRegistry, isConfigured, lookupTarget, pickEffectiveTarget } from '../src/registry';
import { createResolver } from '../src/resolve';
import type { GatewayTarget, Target } from '../src/types';
import { GATEWAY, gatewayOptions, registry, type Role, SCALEWAY } from './fixtures';

describe('defineRegistry', () => {
  it('throws when the default id is not among the targets', () => {
    expect(() => defineRegistry<Role>([GATEWAY], 'nope')).toThrow(/defaultId/);
  });
  it('throws on a duplicate target id (no silent shadowing)', () => {
    expect(() => defineRegistry<Role>([GATEWAY, { ...GATEWAY }], 'gateway-eu')).toThrow(/duplicate/);
  });
  it('throws unless the default is an enabled gateway target', () => {
    // A disabled gateway as default: rejected.
    expect(() => defineRegistry<Role>([{ ...GATEWAY, enabled: false }], 'gateway-eu')).toThrow(/enabled gateway/);
    // An off-gateway default: rejected (the fallback must always be reachable).
    expect(() => defineRegistry<Role>([{ ...SCALEWAY, enabled: true }], 'scaleway')).toThrow(/enabled gateway/);
  });
});

describe('isConfigured', () => {
  it('a gateway is always configured; an off-gateway target needs its key present', () => {
    expect(isConfigured(GATEWAY, () => false)).toBe(true);
    expect(isConfigured(SCALEWAY, () => false)).toBe(false);
    expect(isConfigured(SCALEWAY, (n) => n === 'SCW_SECRET_KEY')).toBe(true);
  });
  it('treats an off-gateway target with an empty apiKeyEnv as unconfigured, not as "no auth"', () => {
    const noKeyEnv: Target<Role> = { ...SCALEWAY, apiKeyEnv: '' };
    expect(isConfigured(noKeyEnv, () => true)).toBe(false);
  });
});

describe('pickEffectiveTarget / lookupTarget — prototype keys cannot match (finding 2)', () => {
  const hasKey = () => true;
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    it(`"${key}" downgrades to the default instead of resolving a prototype member`, () => {
      expect(pickEffectiveTarget(key, registry, { isProd: false, hasKey }).id).toBe('gateway-eu');
      expect(lookupTarget(registry, key)).toBeUndefined();
    });
  }
});

describe('pickEffectiveTarget — fail-closed', () => {
  const hasKey = () => true;
  it('returns the default for an undefined or unknown choice', () => {
    expect(pickEffectiveTarget(undefined, registry, { isProd: false, hasKey }).id).toBe('gateway-eu');
    expect(pickEffectiveTarget('ghost', registry, { isProd: false, hasKey }).id).toBe('gateway-eu');
  });
  it('downgrades an off-gateway choice with no key', () => {
    expect(pickEffectiveTarget('scaleway', registry, { isProd: false, hasKey: () => false }).id).toBe('gateway-eu');
  });
  it('downgrades a not-enabled choice in production, but honours it off-production', () => {
    expect(pickEffectiveTarget('scaleway', registry, { isProd: true, hasKey }).id).toBe('gateway-eu');
    expect(pickEffectiveTarget('scaleway', registry, { isProd: false, hasKey }).id).toBe('scaleway');
  });
});

describe('createResolver — gateway target is byte-identical', () => {
  const { resolve, modelIdOf, effortOf } = createResolver<Role>({ gatewayOptions, secrets: () => undefined });

  it('returns the plain model string and the SAME gateway options object by reference', () => {
    const r = resolve(GATEWAY, 'answer');
    expect(typeof r.model).toBe('string');
    expect(r.model).toBe('anthropic/claude-sonnet-5.5');
    expect(r.id).toBe(r.model);
    expect(r.providerOptions).toEqual({ gateway: gatewayOptions.gateway });
    expect((r.providerOptions as { gateway: unknown }).gateway).toBe(gatewayOptions.gateway);
  });

  it('adds Anthropic summarized thinking only when asked, and only for an Anthropic model (finding 15)', () => {
    expect('anthropic' in resolve(GATEWAY, 'answer').providerOptions).toBe(false);
    const po = resolve(GATEWAY, 'answer', { thinking: true }).providerOptions as { anthropic?: unknown };
    expect(po.anthropic).toEqual({ thinking: { type: 'adaptive', display: 'summarized' } });
    // A non-Anthropic gateway model gets no anthropic block even with thinking:true.
    const nonAnthropic: Target<Role> = { ...GATEWAY, models: { ...GATEWAY.models, answer: { model: 'mistral/mistral-large' } } };
    expect('anthropic' in resolve(nonAnthropic, 'answer', { thinking: true }).providerOptions).toBe(false);
  });

  it('adds auto caching only when asked, without mutating the shared object', () => {
    const po = resolve(GATEWAY, 'answer', { caching: true }).providerOptions as { gateway: { caching?: string } };
    expect(po.gateway.caching).toBe('auto');
    expect('caching' in gatewayOptions.gateway).toBe(false);
  });

  it('combines caching + thinking', () => {
    const po = resolve(GATEWAY, 'answer', { caching: true, thinking: true }).providerOptions as {
      gateway: { caching?: string };
      anthropic?: unknown;
    };
    expect(po.gateway.caching).toBe('auto');
    expect(po.anthropic).toBeTruthy();
  });

  it('uses a target\'s own gatewayOptions when set, so two gateways can differ (finding 7)', () => {
    const usGateway = { gateway: { inferenceRegion: { scope: 'zone', geoRegion: 'us' }, models: [] as string[] } };
    const usTarget = { ...GATEWAY, id: 'gateway-us', gatewayOptions: usGateway } as GatewayTarget<Role>;
    const r = resolve(usTarget, 'answer');
    expect((r.providerOptions as { gateway: unknown }).gateway).toBe(usGateway.gateway);
    expect((r.providerOptions as { gateway: unknown }).gateway).not.toBe(gatewayOptions.gateway);
  });

  it('modelIdOf / effortOf read the gateway tier as-is', () => {
    expect(modelIdOf(GATEWAY, 'router')).toBe('anthropic/claude-haiku-5.5');
    expect(effortOf(GATEWAY, 'answer')).toBe('medium');
    expect(effortOf(GATEWAY, 'router')).toBeUndefined();
  });
});

describe('createResolver — off-gateway target', () => {
  const { resolve, modelIdOf } = createResolver<Role>({ gatewayOptions, secrets: () => 'test-key' });

  it('builds a provider instance and empty provider options, with a prefixed id', () => {
    const r = resolve(SCALEWAY, 'answer');
    expect(typeof r.model).toBe('object'); // a constructed LanguageModel, not a string
    expect(r.id).toBe('scaleway/gpt-oss-120b');
    expect(r.providerOptions).toEqual({});
  });

  it('builds the mistral branch too', () => {
    const MISTRAL: Target<Role> = {
      id: 'mistral-eu', label: 'Mistral', residency: 'EU', apiKeyEnv: 'MISTRAL_API_KEY',
      baseURL: 'https://api.eu.mistral.ai/v1', mode: 'mistral', enabled: false,
      models: { router: { model: 'mistral-small' }, answer: { model: 'mistral-large' }, verify: { model: 'mistral-small' } },
    };
    const r = resolve(MISTRAL, 'answer');
    expect(typeof r.model).toBe('object');
    expect(r.id).toBe('mistral/mistral-large');
    expect(modelIdOf(MISTRAL, 'router')).toBe('mistral/mistral-small');
  });

  it('modelIdOf prefixes off-gateway ids', () => {
    expect(modelIdOf(SCALEWAY, 'router')).toBe('scaleway/mistral-small');
  });
});

describe('createResolver — off-gateway with no key fails closed (findings 5, 12)', () => {
  const { resolve } = createResolver<Role>({ gatewayOptions, secrets: () => undefined });

  it('throws rather than send an unauthenticated request when the key is absent', () => {
    expect(() => resolve(SCALEWAY, 'answer')).toThrow(/needs an API key/);
  });

  it('reads the key only through the injected secrets reader, never process.env', () => {
    // The key is present in process.env but the injected reader returns nothing → still throws.
    process.env.SCW_SECRET_KEY = 'from-env';
    try {
      expect(() => resolve(SCALEWAY, 'answer')).toThrow(/needs an API key/);
    } finally {
      delete process.env.SCW_SECRET_KEY;
    }
  });
});

