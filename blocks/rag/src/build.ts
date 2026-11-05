// Build an index: documents → chunks → embeddings → a serialisable RagIndex. The embedder is
// injected; this module never reads a key or a file. Embeddings are validated (finite, non-zero)
// and unit-normalised here, so a degenerate vector is caught at build time rather than returning
// plausible-but-wrong results at query time.

import { chunkDocument } from './chunk';
import type { ChunkOptions, Document, Embedder, IndexedChunk, RagIndex } from './types';
import { isFiniteVector, isZero, normalize } from './vector';

export type BuildOptions = ChunkOptions & {
  /** How many chunk texts to embed per embedder call. Default 96. */
  batchSize?: number;
  /** Optional progress callback: (embedded, total). */
  onProgress?: (done: number, total: number) => void;
};

/** Chunk every document, embed all chunks (batched), and return a normalised, serialisable index. */
export async function buildIndex(docs: Document[], embedder: Embedder, opts: BuildOptions = {}): Promise<RagIndex> {
  const batchSize = Math.max(1, opts.batchSize ?? 96);

  // Reject duplicate document ids up front: two docs sharing an id would produce colliding citations
  // and overlapping (docId, ordinal) keys.
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.id)) throw new Error(`rag: duplicate document id "${d.id}"`);
    seen.add(d.id);
  }

  const chunks = docs.flatMap((d) => chunkDocument(d, opts));
  if (chunks.length === 0) throw new Error('rag: nothing to index (no documents, or all documents were empty)');

  const indexed: IndexedChunk[] = [];
  let dim = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedder.embed(batch.map((c) => c.text));
    if (vectors.length !== batch.length) {
      throw new Error(`rag: embedder returned ${vectors.length} vectors for ${batch.length} texts`);
    }
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j]!;
      if (dim === 0) dim = vec.length;
      else if (vec.length !== dim) throw new Error(`rag: embedder returned mixed dimensions (${dim} vs ${vec.length})`);
      if (!isFiniteVector(vec)) throw new Error(`rag: embedder returned a non-finite vector (NaN/Infinity) for chunk ${batch[j]!.docId}#${batch[j]!.ordinal}`);
      if (isZero(vec)) throw new Error(`rag: embedder returned a zero vector for chunk ${batch[j]!.docId}#${batch[j]!.ordinal}`);
      indexed.push({ ...batch[j]!, embedding: normalize(vec) });
    }
    opts.onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length);
  }

  return { version: 1, dim, embeddingModel: embedder.id, chunks: indexed };
}
