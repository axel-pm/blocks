import { describe, expect, it } from 'vitest';
import { buildIndex, chunkDocument, createRetriever, normalize, parseIndex, serializeIndex } from '../src/index';
import type { Document, RagIndex } from '../src/index';
import { DOCS, fakeEmbedder } from './fixtures';

describe('chunkDocument', () => {
  it('returns no chunks for empty/whitespace text', () => {
    expect(chunkDocument({ id: 'a', text: '   \n\n ' })).toEqual([]);
  });

  it('keeps a short document as a single chunk carrying doc metadata', () => {
    const chunks = chunkDocument({ id: 'a', title: 'A', text: 'one paragraph', meta: { path: 'a' } });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ docId: 'a', title: 'A', ordinal: 0, meta: { path: 'a' } });
  });

  it('splits a long document into sequential chunks within the size budget (+overlap)', () => {
    const para = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with some filler words here.`).join('\n\n');
    const chunks = chunkDocument({ id: 'long', text: para }, { maxChars: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200 + 40);
  });

  it('hard-splits a single paragraph longer than maxChars', () => {
    const chunks = chunkDocument({ id: 'big', text: 'x'.repeat(1000) }, { maxChars: 300, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });

  it('never drops the end of a document (H1) and never exceeds maxChars+overlap+2', () => {
    const text = `${'a'.repeat(100)}\n\n${'b'.repeat(118)}ZZ`; // distinctive trailing "ZZ"
    const chunks = chunkDocument({ id: 'd', text }, { maxChars: 120, overlap: 20 });
    expect(chunks.some((c) => c.text.endsWith('ZZ'))).toBe(true); // the tail survived
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(120 + 20 + 2);
  });

  it('reconstructs a hard-split document exactly, with no doubled overlap (H2)', () => {
    const src = Array.from({ length: 300 }, (_, i) => String.fromCharCode(33 + (i % 90))).join(''); // one long line
    const chunks = chunkDocument({ id: 'line', text: src }, { maxChars: 40, overlap: 10 });
    // chunk 0 is window 0; each later chunk is tail + "\n\n" + its window → take the part after the first "\n\n".
    const windows = chunks.map((c, i) => (i === 0 ? c.text : c.text.slice(c.text.indexOf('\n\n') + 2)));
    expect(windows.join('')).toBe(src); // contiguous, no loss, no duplication
  });

  it('throws on invalid chunk options instead of silently losing data (M2)', () => {
    expect(() => chunkDocument({ id: 'd', text: 'hi' }, { maxChars: Number.NaN })).toThrow(/maxChars/);
    expect(() => chunkDocument({ id: 'd', text: 'hi' }, { overlap: Number.NaN })).toThrow(/overlap/);
    expect(() => chunkDocument({ id: 'd', text: 'hi' }, { maxChars: 10, overlap: 10 })).toThrow(/smaller than maxChars/);
  });
});

describe('buildIndex', () => {
  it('records dim + embedding model, one chunk per source chunk, unit-normalised vectors', async () => {
    const index = await buildIndex(DOCS, fakeEmbedder(64, 'fake/bow'), { maxChars: 1000 });
    expect(index.version).toBe(1);
    expect(index.dim).toBe(64);
    expect(index.embeddingModel).toBe('fake/bow');
    expect(index.chunks.length).toBeGreaterThanOrEqual(DOCS.length);
    for (const c of index.chunks) {
      const norm = Math.sqrt(c.embedding.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 5); // normalised (a chunk with ≥1 known token is non-zero)
    }
  });

  it('batches without changing the result', async () => {
    const a = await buildIndex(DOCS, fakeEmbedder(), { batchSize: 1 });
    const b = await buildIndex(DOCS, fakeEmbedder(), { batchSize: 100 });
    expect(a.chunks.map((c) => c.text)).toEqual(b.chunks.map((c) => c.text));
  });

  it('refuses empty input and duplicate document ids (L3)', async () => {
    await expect(buildIndex([], fakeEmbedder())).rejects.toThrow(/nothing to index/);
    const dup = [DOCS[0]!, { ...DOCS[0]! }];
    await expect(buildIndex(dup, fakeEmbedder())).rejects.toThrow(/duplicate document id/);
  });

  it('rejects non-finite and zero embedding vectors (H4/H5)', async () => {
    const nan = { id: 'bad', embed: async (t: string[]) => t.map(() => [Number.NaN, 1]) };
    await expect(buildIndex([DOCS[0]!], nan)).rejects.toThrow(/non-finite/);
    const zero = { id: 'z', embed: async (t: string[]) => t.map(() => [0, 0]) };
    await expect(buildIndex([DOCS[0]!], zero)).rejects.toThrow(/zero vector/);
  });

  it('normalises an extreme-magnitude vector to unit length without overflowing (confirm-pass fix)', async () => {
    const huge = { id: 'huge', embed: async (t: string[]) => t.map(() => [1.7e308, 1.7e308]) };
    const index = await buildIndex([DOCS[0]!], huge);
    const norm = Math.sqrt(index.chunks[0]!.embedding.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6); // finite + unit, so it also survives serialize/parse
    expect(() => parseIndex(serializeIndex(index))).not.toThrow();
  });
});

describe('normalize (overflow safety)', () => {
  it('returns a finite unit vector for near-MAX_VALUE components', () => {
    const v = normalize([1.7e308, 1.7e308]);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
  });
});

describe('createRetriever', () => {
  it('refuses an embedder whose id differs from the index (wrong space → garbage)', async () => {
    const index = await buildIndex(DOCS, fakeEmbedder(64, 'fake/bow'));
    expect(() => createRetriever(index, fakeEmbedder(64, 'other/embedder'))).toThrow(/different embedder/);
  });

  it('retrieves the most relevant document for a distinctive query word', async () => {
    const embedder = fakeEmbedder(64, 'fake/bow');
    const index = await buildIndex(DOCS, embedder);
    const hits = await createRetriever(index, embedder).retrieve('clever fox', { k: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.citation.docId).toBe('animals/fox.md');
    expect(hits[0]!.citation.title).toBe('The Fox');
  });

  it('returns results sorted by descending score and honours k + minScore', async () => {
    const embedder = fakeEmbedder(64, 'fake/bow');
    const index = await buildIndex(DOCS, embedder);
    const r = createRetriever(index, embedder);
    const top3 = await r.retrieve('whale database fox', { k: 3 });
    expect(top3.length).toBeLessThanOrEqual(3);
    const scores = top3.map((h) => h.score);
    expect([...scores]).toEqual([...scores].sort((a, b) => b - a));
    // minScore filters: a threshold above the max possible cosine (1) removes everything.
    expect(await r.retrieve('whale', { minScore: 1.01 })).toEqual([]);
  });

  it('throws on a query-embedding dimension mismatch', async () => {
    const index = await buildIndex(DOCS, fakeEmbedder(64, 'fake/bow'));
    // Same id so the id-guard passes, but a different dim → the per-query dim check must fire.
    const wrongDim = { id: 'fake/bow', embed: async (t: string[]) => t.map(() => new Array(32).fill(0.1)) };
    await expect(createRetriever(index, wrongDim).retrieve('x')).rejects.toThrow(/dim/);
  });

  it('throws on a zero or non-finite query embedding instead of returning arbitrary chunks (H4)', async () => {
    const embedder = fakeEmbedder(64, 'fake/bow');
    const index = await buildIndex(DOCS, embedder);
    // The bag-of-words fake maps a token-free query to a zero vector.
    await expect(createRetriever(index, embedder).retrieve('.;,!')).rejects.toThrow(/zero vector/);
  });
});

describe('serialize / parse', () => {
  it('round-trips an index exactly', async () => {
    const index = await buildIndex(DOCS, fakeEmbedder());
    expect(parseIndex(serializeIndex(index))).toEqual(index);
  });

  it('rejects malformed indexes with a specific reason (H5/L4)', () => {
    expect(() => parseIndex('not json')).toThrow(/not valid JSON/);
    expect(() => parseIndex(JSON.stringify({ version: 2 }))).toThrow(/version/);
    expect(() => parseIndex(JSON.stringify({ version: 1, dim: 0, embeddingModel: 'm', chunks: [] }))).toThrow(/dim/);
    const mk = (embedding: number[], extra: Record<string, unknown> = {}) =>
      JSON.stringify({ version: 1, dim: embedding.length, embeddingModel: 'm', chunks: [{ docId: 'a', text: 't', ordinal: 0, embedding, ...extra }] });
    expect(() => parseIndex(JSON.stringify({ version: 1, dim: 3, embeddingModel: 'm', chunks: [{ docId: 'a', text: 't', ordinal: 0, embedding: [1, 2] }] }))).toThrow(/embedding must be 3 numbers/);
    expect(() => parseIndex('{"version":1,"dim":2,"embeddingModel":"m","chunks":[{"docId":"a","text":"t","ordinal":0,"embedding":[1e999,0]}]}')).toThrow(/non-finite/);
    expect(() => parseIndex(mk([2, 0]))).toThrow(/not unit-length/); // ‖[2,0]‖ = 2
    expect(() => parseIndex(mk([1, 0], { ordinal: -1 }))).toThrow(/non-negative integer/);
    expect(() => parseIndex(mk([1, 0], { text: '' }))).toThrow(/empty text/);
    // Duplicate (docId, ordinal):
    const dup = JSON.stringify({ version: 1, dim: 1, embeddingModel: 'm', chunks: [{ docId: 'a', text: 't', ordinal: 0, embedding: [1] }, { docId: 'a', text: 'u', ordinal: 0, embedding: [1] }] });
    expect(() => parseIndex(dup)).toThrow(/duplicate chunk/);
  });

  it('a parsed index still retrieves correctly (end-to-end through disk shape)', async () => {
    const embedder = fakeEmbedder(64, 'fake/bow');
    const onDisk = serializeIndex(await buildIndex(DOCS, embedder));
    const hits = await createRetriever(parseIndex(onDisk), embedder).retrieve('relational database SQL', { k: 1 });
    expect(hits[0]!.citation.docId).toBe('tech/postgres.md');
  });
});

// A no-op reference so an unused Document import can't drift the fixture types silently.
const _typecheck: Document = DOCS[0]!;
void _typecheck;
