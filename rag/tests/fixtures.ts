// Test fixtures: a deterministic, offline embedder and a few documents. The fake embedder is a
// bag-of-words hash into a fixed-dim vector, so texts that share words get similar vectors and
// retrieval is actually meaningful in tests — no network, no provider.

import type { Document, Embedder } from '../src/index';

/** Deterministic bag-of-words embedder: each token bumps one dimension. Similar text → similar vector. */
export function fakeEmbedder(dim = 64, id = 'fake/bow'): Embedder {
  const vec = (text: string): number[] => {
    const v = new Array<number>(dim).fill(0);
    for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % dim]! += 1;
    }
    return v;
  };
  return { id, embed: async (texts) => texts.map(vec) };
}

export const DOCS: Document[] = [
  { id: 'animals/fox.md', title: 'The Fox', text: 'The quick brown fox jumps over the lazy dog. Foxes are clever animals.' },
  { id: 'animals/whale.md', title: 'The Whale', text: 'The blue whale is the largest animal ever known to have lived on Earth. Whales are marine mammals.' },
  { id: 'tech/postgres.md', title: 'Postgres', text: 'Postgres is a relational database. It supports transactions, indexes, and SQL queries.' },
];
