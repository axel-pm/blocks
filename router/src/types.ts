// Types for the router block: classify a query into a tier (e.g. light | standard | deep) so you can
// pick which model answers it. Pure core — rules are plain predicates; an optional LLM classifier is
// injected, so the core imports no provider.

/** A rule: when `when` matches, route to `tier`. Rules are tried in order; the first match wins. */
export type Rule<Tier extends string, Ctx> = {
  tier: Tier;
  when: (query: string, ctx: Ctx) => boolean;
  /** Human reason recorded on the result. Defaults to `rule:<tier>`. */
  reason?: string;
};

/**
 * An injected classifier (typically an LLM call) used when no rule matches. Returns a tier or null
 * (null → the router uses its default). Receives an AbortSignal the router aborts on timeout; a
 * well-behaved classifier should forward it to its underlying call.
 */
export type Classifier<Tier extends string, Ctx> = (query: string, ctx: Ctx, signal: AbortSignal) => Promise<Tier | null>;

/** Where the decision came from. */
export type RouteVia = 'rule' | 'classifier' | 'default';

export type RouteResult<Tier extends string> = { tier: Tier; via: RouteVia; reason: string };

export type RouterConfig<Tier extends string, Ctx> = {
  /** All valid tiers. A classifier result not in this set is ignored (→ falls through to default). */
  tiers: readonly Tier[];
  /** The tier used when no rule matches and the classifier declines (or is absent). Must be in `tiers`. */
  default: Tier;
  /** Ordered rules tried before the classifier; first match short-circuits (no model call). */
  rules?: Rule<Tier, Ctx>[];
  /** Optional model-based classifier for queries no rule settles. Injected — the core calls no provider. */
  classifier?: Classifier<Tier, Ctx>;
  /** Abort the classifier and fall through to default after this many ms. Default 3000. */
  classifierTimeoutMs?: number;
};
