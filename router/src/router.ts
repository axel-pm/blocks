// The router: rules first (fast, free, deterministic), then an optional injected classifier bounded
// by a timeout, then a default. Fail-safe end to end: a rule whose predicate throws is skipped; a
// classifier that throws, times out, or returns an out-of-set tier is ignored; and the result is
// always a tier from `tiers`. route() never throws for a bad query or a misbehaving rule/classifier.

import type { Classifier, Rule, RouteResult, RouterConfig } from './types';

export type Router<Tier extends string, Ctx> = {
  route: (query: string, ctx: Ctx) => Promise<RouteResult<Tier>>;
};

export function createRouter<Tier extends string, Ctx = void>(config: RouterConfig<Tier, Ctx>): Router<Tier, Ctx> {
  if (!Array.isArray(config.tiers) || config.tiers.length === 0) throw new Error('router: tiers must be a non-empty array');
  if (new Set(config.tiers).size !== config.tiers.length) throw new Error('router: tiers must be unique');
  const tiers = new Set<string>(config.tiers);
  const def = config.default; // snapshot so a later cfg.default mutation can't change routing
  if (!tiers.has(def)) throw new Error(`router: default tier "${def}" is not in tiers`);
  // Deep-copy the rules so post-construction mutation of the array OR a rule object can't introduce
  // an unknown-tier route.
  const rules: Rule<Tier, Ctx>[] = (config.rules ?? []).map((r) => ({ ...r }));
  for (const r of rules) if (!tiers.has(r.tier)) throw new Error(`router: rule routes to unknown tier "${r.tier}"`);
  const classifier: Classifier<Tier, Ctx> | undefined = config.classifier;
  const configuredTimeout = config.classifierTimeoutMs;
  const timeoutMs = Math.max(1, Number.isFinite(configuredTimeout) ? Math.trunc(configuredTimeout as number) : 3000);

  async function route(query: string, ctx: Ctx): Promise<RouteResult<Tier>> {
    let q: string;
    try {
      q = typeof query === 'string' ? query : String(query ?? '');
    } catch {
      q = ''; // a query whose toString throws (e.g. a null-proto object) must not break routing
    }

    for (const r of rules) {
      let hit = false;
      try {
        const res: unknown = r.when(q, ctx);
        if (res && typeof (res as { then?: unknown }).then === 'function') {
          (res as Promise<unknown>).catch(() => {}); // an async rule: swallow its rejection, treat as non-match
          hit = false;
        } else {
          hit = res === true; // strict: a truthy non-boolean does not count
        }
      } catch {
        hit = false; // a throwing rule predicate is skipped, never fatal
      }
      if (hit) return { tier: r.tier, via: 'rule', reason: r.reason ?? `rule:${r.tier}` };
    }

    if (classifier) {
      const picked = await classifyWithTimeout(classifier, q, ctx, timeoutMs);
      if (picked !== null && tiers.has(picked)) return { tier: picked, via: 'classifier', reason: 'classifier' };
    }
    return { tier: def, via: 'default', reason: 'default' };
  }

  return { route };
}

/** Run the classifier with an abort+timeout; any error, timeout, or non-tier result resolves to null. */
async function classifyWithTimeout<Tier extends string, Ctx>(
  classifier: Classifier<Tier, Ctx>,
  query: string,
  ctx: Ctx,
  timeoutMs: number,
): Promise<Tier | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve(classifier(query, ctx, ac.signal)),
      new Promise<null>((resolve) => {
        ac.signal.addEventListener('abort', () => resolve(null), { once: true });
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ac.abort(); // ensure the signal is settled so a listener/provider can clean up
  }
}
