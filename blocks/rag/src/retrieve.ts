// Retrieval over a built index: embed the query, score every chunk by cosine similarity (a dot
// product, since vectors are normalised), and return the top-k as cited passages. The embedder is
// injected and MUST match the one that built the index — the index records its id and dimension,
// and the retriever refuses a mismatch (querying with the wrong embedder silently returns garbage).
// A degenerate query embedding (wrong dim, non-finite, or zero) throws rather than returning
// arbitrary chunks.

import type { Citation, Embedder, RagIndex, Retrieval } from './types';
import { dot, isFiniteVector, isZero, normalize } from './vector';

export type RetrieveOptions = {
  /** How many passages to return. Default 5. */
  k?: number;
  /** Drop results scoring at or below this cosine similarity. Default 0 (keep any positive score). */
  minScore?: number;
};

export type Retriever = {
  retrieve: (query: string, opts?: RetrieveOptions) => Promise<Retrieval[]>;
};

/** Build a retriever bound to an index + embedder. Throws now (not per-query) on an embedder mismatch. */
export function createRetriever(index: RagIndex, embedder: Embedder): Retriever {
  if (index.embeddingModel !== embedder.id) {
    throw new Error(
      `rag: index was built with embedder "${index.embeddingModel}" but you passed "${embedder.id}" — ` +
        `querying with a different embedder returns meaningless results. Rebuild the index or use the matching embedder.`,
    );
  }

  async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<Retrieval[]> {
    const k = Math.max(1, Math.trunc(opts.k ?? 5));
    const minScore = Number.isFinite(opts.minScore) ? (opts.minScore as number) : 0;

    const [raw] = await embedder.embed([query]);
    if (!raw) throw new Error('rag: embedder returned no vector for the query');
    if (raw.length !== index.dim) throw new Error(`rag: query embedding dim ${raw.length} ≠ index dim ${index.dim}`);
    if (!isFiniteVector(raw)) throw new Error('rag: query embedding is non-finite (NaN/Infinity)');
    if (isZero(raw)) throw new Error('rag: query embedding is a zero vector — the embedder produced nothing usable');
    const q = normalize(raw);

    const scored = index.chunks.map((c) => ({ c, score: dot(q, c.embedding) }));
    scored.sort((a, b) => b.score - a.score);

    const out: Retrieval[] = [];
    for (const { c, score } of scored) {
      if (!(score > minScore)) break; // sorted desc; NaN-safe (NaN > x is false). minScore default 0 drops non-positive.
      const citation: Citation = {
        docId: c.docId,
        ordinal: c.ordinal,
        ...(c.title ? { title: c.title } : {}),
        ...(c.meta ? { meta: { ...c.meta } } : {}), // shallow copy so a caller can't mutate the index
      };
      out.push({ text: c.text, score, citation });
      if (out.length >= k) break;
    }
    return out;
  }

  return { retrieve };
}
