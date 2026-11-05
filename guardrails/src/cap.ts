// Spend / rate caps: keep one principal (a user, an API key, an IP) under a limit within a rolling
// window. The accounting store is injected — the core is the decision logic; the store (Upstash,
// Postgres, memory) is an adapter. Fail-closed: if the store throws, the caller should treat the
// request as not allowed (the cap function propagates the error rather than silently allowing).

import type { CapStore, CapVerdict } from './types';

/** Pure decision: given the running total and the limit, is this request allowed? */
export function evaluate(used: number, limit: number): CapVerdict {
  const allowed = used <= limit;
  return { allowed, used, limit, remaining: Math.max(0, limit - used) };
}

export type SpendCapConfig = {
  store: CapStore;
  /** The limit per window (e.g. dollars/day, or requests/minute). */
  limit: number;
  /** Window length in seconds (the store sets this TTL on first write of a key). */
  windowSeconds: number;
  /** Namespacing prefix for store keys. Default 'cap'. */
  prefix?: string;
};

export type SpendCap = {
  /**
   * Count `amount` against `principal` and decide. Increments FIRST (atomically, via the store) then
   * compares, so a race over-counts rather than over-admits — the safe direction for a cap. Returns
   * the verdict; when not allowed, the amount is still counted (so a caller spamming stays blocked).
   */
  check: (principal: string, amount?: number) => Promise<CapVerdict>;
};

export function createSpendCap(config: SpendCapConfig): SpendCap {
  const prefix = config.prefix ?? 'cap';
  if (!Number.isFinite(config.limit) || config.limit <= 0) throw new Error('createSpendCap: limit must be a finite number > 0');
  if (!Number.isFinite(config.windowSeconds) || config.windowSeconds <= 0) throw new Error('createSpendCap: windowSeconds must be a finite number > 0');

  return {
    async check(principal, amount = 1) {
      if (!Number.isFinite(amount) || amount < 0) throw new Error('cap: amount must be a finite number ≥ 0');
      // encodeURIComponent so a principal containing ':' can't collide with another key.
      const key = `${prefix}:${encodeURIComponent(principal)}`;
      const used = await config.store.incrBy(key, amount, config.windowSeconds);
      // Fail-closed on a malformed store result (null/NaN/negative from a misbehaving store): never admit.
      if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) {
        throw new Error(`cap: store returned an invalid total (${String(used)}) for ${key}`);
      }
      return evaluate(used, config.limit);
    },
  };
}
