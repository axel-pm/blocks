// The resolution seam: turn an active target + a role into what a model call passes
// (`model`, `providerOptions`, and an `id` for logging). Build one resolver with your shared
// gateway options and a secret reader injected, then call `resolve(target, role)` at every
// generation call site instead of hard-coding a model string.
//
// For a gateway target this returns the exact model string and the exact gateway options you
// injected (or the target's own override), so a request is byte-identical to a hand-written
// gateway call (lock this with a test in the consuming app). For an off-gateway target it
// returns a constructed provider instance and empty provider options (no gateway/Anthropic-only
// keys).
//
// The core never reads process.env: API keys come from the injected `secrets` reader. An
// off-gateway target whose key resolves empty throws (fail-closed) rather than sending an
// unauthenticated request or letting a provider SDK silently read its own env var.

import { createMistral } from '@ai-sdk/mistral';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { GatewayOptions, Resolved, ResolveOpts, SecretReader, Target } from './types';

export type ResolverConfig = {
  /**
   * Your app's shared gateway provider options — the SAME object you pass today on a
   * hand-written gateway call (tags, inferenceRegion, zeroDataRetention, models, …). The
   * resolver returns it by reference for a gateway target so behaviour is unchanged (a target
   * may override it per-target via its own `gatewayOptions`). Injected, never imported, so the
   * block has no project coupling. Treat the returned object as read-only — it is shared.
   */
  gatewayOptions: GatewayOptions;
  /** Reads an API key by env name. Injected so the core stays free of process.env. */
  secrets: SecretReader;
};

export type Resolver<Role extends string> = {
  resolve: (t: Target<Role>, role: Role, opts?: ResolveOpts) => Resolved;
  /** The display/analytics id for a role under a target (raw gateway string, or provider-prefixed). */
  modelIdOf: (t: Target<Role>, role: Role) => string;
  /** The effort to pass as `reasoning` for a role under a target (gateway tiers carry it; off-gateway usually undefined). */
  effortOf: (t: Target<Role>, role: Role) => 'low' | 'medium' | 'high' | undefined;
};

export function createResolver<Role extends string>(config: ResolverConfig): Resolver<Role> {
  // One provider instance per (id, baseURL). The current key is stored alongside it: if the key
  // rotates, the entry is rebuilt and the old instance (holding the old key) is dropped, so a
  // rotated key is picked up AND stale keys don't accumulate in memory. Bounded to one entry per
  // endpoint.
  type Cached<P> = { apiKey: string; provider: P };
  const mistralProviders = new Map<string, Cached<ReturnType<typeof createMistral>>>();
  const oaiProviders = new Map<string, Cached<ReturnType<typeof createOpenAICompatible>>>();

  /** The API key for an off-gateway target, or throw fail-closed if it's missing. */
  function requireKey(t: Target<Role>): string {
    const key = config.secrets(t.apiKeyEnv);
    if (!key) {
      throw new Error(
        `inference: target "${t.id}" needs an API key in ${t.apiKeyEnv || '(unset apiKeyEnv)'}, but none was provided`,
      );
    }
    return key;
  }

  // Endpoint cache key: a separator that can't appear in an id/URL by accident. The API key is
  // NOT part of it (it would keep rotated keys as map keys in memory); it's stored in the value.
  const endpointKey = (t: Target<Role>) => `${t.id}\u0000${t.baseURL ?? ''}`;

  function cached<P>(map: Map<string, Cached<P>>, t: Target<Role>, apiKey: string, build: () => P): P {
    const k = endpointKey(t);
    const hit = map.get(k);
    if (hit && hit.apiKey === apiKey) return hit.provider;
    const provider = build(); // first use, or the key rotated → rebuild and overwrite (drops the old)
    map.set(k, { apiKey, provider });
    return provider;
  }

  function mistralProvider(t: Target<Role>) {
    const apiKey = requireKey(t);
    return cached(mistralProviders, t, apiKey, () => createMistral({ baseURL: t.baseURL, apiKey }));
  }

  function oaiProvider(t: Target<Role>) {
    const apiKey = requireKey(t);
    if (!t.baseURL) throw new Error(`inference: openai-compatible target "${t.id}" needs a baseURL`);
    // includeUsage: without it an OpenAI-compatible stream reports no token counts, so cost
    // can't be estimated downstream.
    return cached(oaiProviders, t, apiKey, () =>
      createOpenAICompatible({ name: t.id, apiKey, baseURL: t.baseURL!, includeUsage: true }),
    );
  }

  function modelIdOf(t: Target<Role>, role: Role): string {
    const id = t.models[role].model;
    return t.mode === 'gateway' ? id : t.mode === 'mistral' ? `mistral/${id}` : `${t.id}/${id}`;
  }

  function effortOf(t: Target<Role>, role: Role) {
    return t.models[role].effort;
  }

  function resolve(t: Target<Role>, role: Role, opts?: ResolveOpts): Resolved {
    const modelId = t.models[role].model;

    if (t.mode === 'gateway') {
      // A target may carry its own gateway options (e.g. a US vs an EU gateway with different
      // regions); otherwise the resolver's shared options apply. Returned by reference so the
      // path is byte-identical; copied only to add opt-in caching, never mutating the shared one.
      const base = t.gatewayOptions ?? config.gatewayOptions;
      const gateway = opts?.caching ? { ...base.gateway, caching: 'auto' as const } : base.gateway;
      // `thinking` is Anthropic-shaped, so only attach it for an Anthropic gateway model.
      const wantThinking = opts?.thinking && modelId.startsWith('anthropic/');
      const providerOptions = wantThinking
        ? { gateway, anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } }
        : { gateway };
      return { model: modelId, id: modelId, providerOptions };
    }

    // Off-gateway: a constructed provider instance + no gateway/Anthropic-only options. The AI SDK
    // provider packages may bundle a newer @ai-sdk/provider than `ai` (a superset finish-reason
    // union), so the instance is cast to `ai`'s LanguageModel here, once, where the mismatch is
    // understood — the runtime shape is the same v4 spec. Align versions when enabling a target.
    if (t.mode === 'mistral') {
      return { model: mistralProvider(t)(modelId) as unknown as LanguageModel, id: `mistral/${modelId}`, providerOptions: {} };
    }
    return { model: oaiProvider(t).chatModel(modelId) as unknown as LanguageModel, id: `${t.id}/${modelId}`, providerOptions: {} };
  }

  return { resolve, modelIdOf, effortOf };
}
