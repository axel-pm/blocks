// OPTIONAL adapter. An in-memory CapStore for development and tests. Single-process only, so it is
// NOT suitable for production behind multiple instances — use an atomic store (Upstash INCR with
// EXPIRE, or Postgres) there. The sketch below shows the contract a real store must meet.
//
// Upstash sketch:
//   const store: CapStore = {
//     async incrBy(key, amount, ttl) {
//       const v = await redis.incrby(key, amount);
//       if (v === amount) await redis.expire(key, ttl); // set the window on first write
//       return v;
//     },
//   };

import type { CapStore } from '../src/types';

/**
 * In-memory CapStore with per-key expiry. Reference/dev only. Sweeps expired entries when the map
 * grows past `maxKeys` so an attacker-influenced principal (an IP, say) can't grow it without bound.
 */
export function memoryStore(now: () => number = Date.now, maxKeys = 100_000): CapStore {
  const data = new Map<string, { total: number; expiresAt: number }>();
  return {
    async incrBy(key, amount, ttlSeconds) {
      const t = now();
      if (data.size >= maxKeys) for (const [k, v] of data) if (v.expiresAt <= t) data.delete(k);
      const existing = data.get(key);
      if (!existing || existing.expiresAt <= t) {
        const fresh = { total: amount, expiresAt: t + ttlSeconds * 1000 };
        data.set(key, fresh);
        return fresh.total;
      }
      existing.total += amount;
      return existing.total;
    },
  };
}
