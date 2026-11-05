// Small vector helpers. Vectors are unit-normalised at index time, so retrieval similarity is a
// plain dot product (cosine). Pure, dependency-free. Hardened against degenerate input: normalise
// scales by the max absolute component first, so a large-magnitude vector (e.g. 1e200) can't
// overflow to Infinity/NaN, and callers can detect a zero vector via `isZero`.

/** L2-normalise to unit length, overflow-safe. A zero (or all-zero-after-scaling) vector is returned as-is. */
export function normalize(v: number[]): number[] {
  let max = 0;
  for (const x of v) {
    const a = Math.abs(x);
    if (a > max) max = a;
  }
  if (max === 0) return v.slice(); // zero vector → leave as zeros (score will be 0)
  // Scale by max first (so each term is in [-1,1] and sumSq can't overflow), then divide by the
  // scaled norm. Never multiply the norm back up — that would overflow for max near Number.MAX_VALUE.
  let sumSq = 0;
  for (const x of v) {
    const s = x / max;
    sumSq += s * s;
  }
  const scaledNorm = Math.sqrt(sumSq); // in (0, sqrt(n)] — always finite and > 0 since max > 0
  return v.map((x) => x / max / scaledNorm);
}

/** Dot product of two equal-length vectors. Throws on a length mismatch (a dimension bug, caught loudly). */
export function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`vector: dimension mismatch (${a.length} vs ${b.length})`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** True if every component is finite (no NaN/Infinity). */
export function isFiniteVector(v: number[]): boolean {
  for (const x of v) if (!Number.isFinite(x)) return false;
  return true;
}

/** True if the vector has zero magnitude (all components 0). */
export function isZero(v: number[]): boolean {
  for (const x of v) if (x !== 0) return false;
  return true;
}
