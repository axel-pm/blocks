// Shared types for the guardrails block. Pure; no env, no framework, no provider.

/** A detected span of sensitive text in a document. */
export type PiiSpan = { start: number; end: number; type: string; value: string };

/** The result of masking: the redacted text, and a token→original map for unmasking later. */
export type MaskResult = { text: string; map: Record<string, string> };

/** A custom detector: a type label and a (non-sticky, non-global is fine — it's cloned) pattern. */
export type PiiPattern = { type: string; pattern: RegExp };

export type MaskOptions = {
  /** Mask email addresses. Default true. */
  email?: boolean;
  /** Mask phone numbers (7–15 digits). Default true. Conservative; see SECURITY for false +/−. */
  phone?: boolean;
  /** Exact names to mask (case-insensitive, word-boundary). */
  names?: string[];
  /** Extra detectors, applied in addition to the built-ins. */
  patterns?: PiiPattern[];
  /**
   * Generates the per-call token nonce. Defaults to a Math.random-based string (a guess barrier,
   * not cryptographic). For hostile input where an attacker must not predict tokens, inject a
   * crypto-strong generator, e.g. `() => crypto.randomUUID()`.
   */
  nonce?: () => string;
};

/**
 * A store the spend-cap uses. YOU provide it (Upstash, Postgres, memory). `incrBy` MUST be atomic
 * (increment-and-return) for the cap to hold under concurrency — see SECURITY. `ttlSeconds` sets the
 * window on first write.
 */
export type CapStore = {
  incrBy: (key: string, amount: number, ttlSeconds: number) => Promise<number>;
};

/** The verdict of a cap check. `used` is the running total after this request was counted. */
export type CapVerdict = { allowed: boolean; used: number; limit: number; remaining: number };
