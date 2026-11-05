// Types for the rag block — a portable retrieval pipeline: documents → chunks → an embedded index
// → cited retrievals. The core is pure and framework-free: it reads no files and calls no network.
// It takes an injected `Embedder`, so the same code works with any provider (or a fake, in tests),
// and file reading lives in adapters/.

/** A source document to index. `id` must be stable across rebuilds (e.g. the repo-relative path). */
export type Document = {
  id: string;
  /** Human title for citations (e.g. a heading or the file name). Falls back to `id` if absent. */
  title?: string;
  /** The full text. */
  text: string;
  /** Anything you want carried onto every chunk/citation (path, url, product line, …). Not indexed. */
  meta?: Record<string, unknown>;
};

/** A passage of a document, before embedding. */
export type Chunk = {
  docId: string;
  title?: string;
  /** 0-based position of this chunk within its document. */
  ordinal: number;
  text: string;
  meta?: Record<string, unknown>;
};

/** A chunk plus its (unit-normalised) embedding vector. */
export type IndexedChunk = Chunk & { embedding: number[] };

/** A built, serialisable index. `dim` and `embeddingModel` guard against querying with a mismatched embedder. */
export type RagIndex = {
  version: 1;
  /** Vector dimensionality every embedding must share. */
  dim: number;
  /** Identifier of the embedder used to build it (e.g. "openai/text-embedding-3-small"), for a mismatch guard. */
  embeddingModel: string;
  chunks: IndexedChunk[];
};

/** A citation back to where a retrieved passage came from. */
export type Citation = {
  docId: string;
  title?: string;
  ordinal: number;
  meta?: Record<string, unknown>;
};

/** One retrieved passage: the text, where it came from, and its similarity score (1 = identical direction). */
export type Retrieval = { text: string; score: number; citation: Citation };

/**
 * Turns texts into embedding vectors. Injected, so the core never imports a provider or reads a key.
 * Must return one vector per input, in order, all the same length. See adapters/ai-embedder for a
 * concrete AI SDK implementation; tests pass a deterministic fake.
 */
export type Embedder = {
  /** A stable id for the embedder, stored in the index for the mismatch guard (e.g. the model string). */
  id: string;
  embed: (texts: string[]) => Promise<number[][]>;
};

/** Chunking options. Sizes are in characters (portable; no tokenizer dependency). */
export type ChunkOptions = {
  /** Target max characters per chunk. Default 1200. */
  maxChars?: number;
  /** Characters of overlap carried between adjacent chunks, for context continuity. Default 150. */
  overlap?: number;
};
