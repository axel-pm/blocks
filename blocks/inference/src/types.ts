// Types for the inference block. A `Target` describes WHERE and HOW the app runs inference;
// a registry is a set of targets; the resolver turns (target, role) into what a model call
// passes. Roles are a type parameter: your app names its own (e.g. 'router' | 'answer' |
// 'verify'), and the registry/resolver are typed to them.
//
// Nothing here reads the environment. The only import is a type from `ai` (a peer dependency),
// used to type the resolved model so call sites don't need an unchecked cast. See resolve.ts
// for the seam and adapters/ for environment/DB wiring.

import type { LanguageModel } from 'ai';

/** Reasoning effort, where a provider honours it (Anthropic-shaped). Undefined = provider default. */
export type Effort = 'low' | 'medium' | 'high';

/** The model (and optional effort) a target uses for one role. */
export type RoleModel = { model: string; effort?: Effort };

/** How a target is reached. Extend the union if you add a provider mode (and handle it in resolve.ts). */
export type Mode = 'gateway' | 'mistral' | 'openai-compatible';

/** Fields shared by every target, whatever its mode. `Role` is your app's role union. */
export type TargetBase<Role extends string> = {
  /** Stable id, used in settings/env and as the provider cache key. */
  id: string;
  /** Human label for an admin UI. */
  label: string;
  /** One honest line about who runs this and what it means for data residency. Do not overstate. */
  residency: string;
  /**
   * Name of the env var holding this target's API key. '' for a gateway authenticated by the
   * platform (e.g. Vercel OIDC). The core never reads it — an adapter passes a `secrets` reader
   * to the resolver, and the selector uses this name to check a key is present before offering
   * the target.
   */
  apiKeyEnv: string;
  /** Base URL for off-gateway HTTP providers. */
  baseURL?: string;
  /** The model + effort for each of your roles. NB: `effort` is reported by effortOf for you to pass
   *  to `streamText` as `reasoning`; `resolve` does NOT apply it for you. */
  models: Record<Role, RoleModel>;
  /**
   * ADVISORY METADATA — the block does not enforce any of the following. They exist for your
   * admin UI, cost code, and enable-eval to read; resolution ignores them.
   *
   * embedding: which embedder this target implies, and whether switching needs a rebuilt index.
   *   Embeddings are a build-time concern (dimensions differ per model), never a live switch.
   */
  embedding?: { model: string; dimensions: number; needsPrebuiltIndex: boolean };
  /** Whether this target can be selected in production. Keep unproven targets `false` behind an eval gate. */
  enabled: boolean;
  /**
   * Off-gateway list prices per served model id, `[inputUSD, outputUSD]` per 1e6 tokens, for your
   * OWN cost estimation where the provider doesn't bill through a gateway. The block doesn't read it.
   */
  prices?: Record<string, [number, number]>;
};

/**
 * The gateway provider-options wrapper the resolver injects. Only the `gateway` block is carried
 * onto a call's `providerOptions` (the resolver adds an `anthropic` block itself when thinking is
 * on). Deliberately NOT an open bag: if you need another always-on provider key, add it at the
 * call site — don't expect an extra top-level key here to be forwarded.
 */
export type GatewayOptions = { gateway: Record<string, unknown> };

export type GatewayTarget<Role extends string> = TargetBase<Role> & {
  mode: 'gateway';
  /**
   * Per-target gateway options. If set, `resolve` uses THESE instead of the resolver's shared
   * `gatewayOptions` — so two gateway targets can pin different regions / retention, and a
   * target's `residency` label reflects what it actually sends. If unset, the shared options apply.
   */
  gatewayOptions?: GatewayOptions;
};
export type MistralTarget<Role extends string> = TargetBase<Role> & {
  mode: 'mistral';
};
export type OpenAICompatTarget<Role extends string> = TargetBase<Role> & {
  mode: 'openai-compatible';
  /** ADVISORY: models here that honour structured output (`Output.object`). Enforce in your enable-eval; the block doesn't. */
  structuredOutputModels?: string[];
};

export type Target<Role extends string = string> =
  | GatewayTarget<Role>
  | MistralTarget<Role>
  | OpenAICompatTarget<Role>;

/** What a resolved role is: pass `model` + `providerOptions` to streamText/generateText; use `id` for logs. */
export type Resolved = {
  /** A gateway model string or a constructed provider instance — typed as `ai`'s LanguageModel so no cast is needed. */
  model: LanguageModel;
  /** Stable id for traces/cost/analytics — the raw gateway string, or provider-prefixed off-gateway. */
  id: string;
  /** Pass as `providerOptions`: the gateway block for a gateway target, `{}` otherwise. */
  providerOptions: Record<string, unknown>;
};

/** Per-call toggles. `caching` adds gateway auto prompt caching; `thinking` adds Anthropic summarized thinking. */
export type ResolveOpts = { caching?: boolean; thinking?: boolean };

/** Reads a named secret. Injected so the core never touches process.env (portability + testability + security). */
export type SecretReader = (envName: string) => string | undefined;
