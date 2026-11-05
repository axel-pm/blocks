// Serialise / parse a RagIndex as a portable JSON file. Parsing VALIDATES the shape, the vector
// dimensions, that every embedding is finite and (approximately) unit-length, that ordinals are
// non-negative integers, that text is non-empty, and that (docId, ordinal) pairs are unique — so a
// truncated or hand-edited index fails loudly at load instead of returning wrong results, or
// letting a NaN/Infinity/over-long vector corrupt ranking. The core does no file IO — a caller
// passes the string in/out.

import type { IndexedChunk, RagIndex } from './types';

const UNIT_TOLERANCE = 1e-3; // |‖v‖ − 1| must be within this; build normalises, so genuine vectors pass.

/** Serialise an index to a JSON string. */
export function serializeIndex(index: RagIndex): string {
  return JSON.stringify(index);
}

/** Parse + validate a JSON string into a RagIndex. Throws with a specific reason on any inconsistency. */
export function parseIndex(json: string): RagIndex {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`rag: index is not valid JSON (${(e as Error).message})`);
  }
  if (!isRecord(data)) throw new Error('rag: index must be an object');
  if (data.version !== 1) throw new Error(`rag: unsupported index version ${String(data.version)} (expected 1)`);
  if (typeof data.dim !== 'number' || !Number.isInteger(data.dim) || data.dim <= 0) {
    throw new Error('rag: index.dim must be a positive integer');
  }
  if (typeof data.embeddingModel !== 'string' || !data.embeddingModel) {
    throw new Error('rag: index.embeddingModel must be a non-empty string');
  }
  if (!Array.isArray(data.chunks)) throw new Error('rag: index.chunks must be an array');

  const keys = new Set<string>();
  const chunks: IndexedChunk[] = data.chunks.map((c, i) => validateChunk(c, i, data.dim as number, keys));
  return { version: 1, dim: data.dim, embeddingModel: data.embeddingModel, chunks };
}

function validateChunk(c: unknown, i: number, dim: number, keys: Set<string>): IndexedChunk {
  if (!isRecord(c)) throw new Error(`rag: chunk ${i} is not an object`);
  if (typeof c.docId !== 'string' || !c.docId) throw new Error(`rag: chunk ${i} missing docId`);
  if (typeof c.text !== 'string' || !c.text) throw new Error(`rag: chunk ${i} has empty text`);
  if (typeof c.ordinal !== 'number' || !Number.isInteger(c.ordinal) || c.ordinal < 0) {
    throw new Error(`rag: chunk ${i} ordinal must be a non-negative integer`);
  }
  const key = `${c.docId}\u0000${c.ordinal}`;
  if (keys.has(key)) throw new Error(`rag: duplicate chunk (docId "${c.docId}", ordinal ${c.ordinal})`);
  keys.add(key);

  if (!Array.isArray(c.embedding) || c.embedding.length !== dim) {
    throw new Error(`rag: chunk ${i} embedding must be ${dim} numbers`);
  }
  let sumSq = 0;
  for (const x of c.embedding) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`rag: chunk ${i} embedding has a non-finite value`);
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  if (Math.abs(norm - 1) > UNIT_TOLERANCE) {
    throw new Error(`rag: chunk ${i} embedding is not unit-length (‖v‖=${norm.toFixed(4)}); it must come from buildIndex`);
  }

  return {
    docId: c.docId,
    text: c.text,
    ordinal: c.ordinal,
    embedding: c.embedding as number[],
    ...(typeof c.title === 'string' ? { title: c.title } : {}),
    ...(isRecord(c.meta) ? { meta: c.meta } : {}),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
