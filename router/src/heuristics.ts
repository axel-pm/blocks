// Common rule builders for the router. Each returns a Rule you drop into `rules`. Pure and cheap —
// they short-circuit the (paid) classifier for the obvious cases.

import type { Rule } from './types';

/** Route short queries (≤ maxChars) to `tier` — e.g. one-liners to a light model. */
export function byMaxLength<Tier extends string, Ctx>(tier: Tier, maxChars: number): Rule<Tier, Ctx> {
  return { tier, reason: `len≤${maxChars}`, when: (q) => q.trim().length <= maxChars };
}

/** Route long queries (≥ minChars) to `tier`. */
export function byMinLength<Tier extends string, Ctx>(tier: Tier, minChars: number): Rule<Tier, Ctx> {
  return { tier, reason: `len≥${minChars}`, when: (q) => q.trim().length >= minChars };
}

/** Route queries containing any of `words` (whole word, case-insensitive) to `tier`. */
export function byKeywords<Tier extends string, Ctx>(tier: Tier, words: string[]): Rule<Tier, Ctx> {
  const escaped = words.filter(Boolean).map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  const re = escaped.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
  return { tier, reason: `keyword`, when: (q) => (re ? re.test(q) : false) };
}

/** Route when a caller-supplied predicate over the context is true (e.g. a flag, a user tier). */
export function byContext<Tier extends string, Ctx>(tier: Tier, pred: (ctx: Ctx) => boolean, reason = 'context'): Rule<Tier, Ctx> {
  return { tier, reason, when: (_q, ctx) => pred(ctx) };
}
