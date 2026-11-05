// Public surface of the rag block's pure core. Copy `src/` in, import from here.
export type {
  Chunk,
  ChunkOptions,
  Citation,
  Document,
  Embedder,
  IndexedChunk,
  RagIndex,
  Retrieval,
} from './types';
export { chunkDocument } from './chunk';
export { buildIndex } from './build';
export type { BuildOptions } from './build';
export { createRetriever } from './retrieve';
export type { Retriever, RetrieveOptions } from './retrieve';
export { parseIndex, serializeIndex } from './serialize';
export { fencePassages } from './format';
export type { FenceOptions } from './format';
export { dot, isFiniteVector, isZero, normalize } from './vector';
