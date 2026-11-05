// Structure-aware chunking. Splits a document into passages at paragraph boundaries (blank lines),
// packing paragraphs up to `maxChars`, then carrying a small `overlap` tail from the previous
// passage into the next so a passage that straddles a boundary still has context. A single
// paragraph longer than maxChars is hard-split into contiguous (non-overlapping) windows; the
// overlap is applied uniformly afterwards, so no window gets it twice. Character-based on purpose:
// no tokenizer dependency keeps the core portable.
//
// Guarantees: no input text is dropped; a chunk is at most `maxChars + overlap + 2` characters
// (the "+2" is the "\n\n" joiner); windows never split a UTF-16 surrogate pair. Known limitation:
// a fenced code block containing blank lines may be split mid-fence (see README).

import type { Chunk, ChunkOptions, Document } from './types';

const DEFAULTS = { maxChars: 1200, overlap: 150 } as const;

/** Split one document into ordered chunks. Returns [] for empty/whitespace text. Throws on bad options. */
export function chunkDocument(doc: Document, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = intOption(opts.maxChars, DEFAULTS.maxChars, 'maxChars', 1);
  const overlap = intOption(opts.overlap, DEFAULTS.overlap, 'overlap', 0);
  if (overlap >= maxChars) throw new Error(`rag: overlap (${overlap}) must be smaller than maxChars (${maxChars})`);

  const pieces: string[] = [];
  let buf = '';
  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) pieces.push(trimmed);
    buf = '';
  };

  for (const para of splitParagraphs(doc.text)) {
    if (para.length > maxChars) {
      flush();
      for (const part of hardSplit(para, maxChars)) pieces.push(part);
      continue;
    }
    if (buf && buf.length + 2 + para.length > maxChars) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();

  const withOverlap = overlap > 0 ? applyOverlap(pieces, overlap) : pieces;
  return withOverlap.map((text, ordinal) => ({
    docId: doc.id,
    ordinal,
    text,
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.meta ? { meta: doc.meta } : {}),
  }));
}

function intOption(v: number | undefined, def: number, name: string, min: number): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    throw new Error(`rag: ${name} must be an integer ≥ ${min}`);
  }
  return v;
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Split a too-long paragraph into contiguous windows of up to maxChars, never cutting a surrogate pair. */
function hardSplit(para: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < para.length; ) {
    let end = Math.min(i + maxChars, para.length);
    // If the boundary falls between a surrogate pair, step back so the pair stays whole (unless that
    // would make no progress, which can only happen at maxChars=1).
    if (end < para.length && end - 1 > i) {
      const c = para.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end -= 1;
    }
    out.push(para.slice(i, end));
    i = end;
  }
  return out;
}

/** Prepend the previous piece's last `overlap` characters to each piece (from the 2nd on). No truncation. */
function applyOverlap(pieces: string[], overlap: number): string[] {
  return pieces.map((piece, i) => (i === 0 ? piece : `${tailOf(pieces[i - 1]!, overlap)}\n\n${piece}`));
}

/** The last `overlap` characters of `s`, not starting inside a surrogate pair. */
function tailOf(s: string, overlap: number): string {
  let start = Math.max(0, s.length - overlap);
  if (start > 0) {
    const c = s.charCodeAt(start);
    if (c >= 0xdc00 && c <= 0xdfff) start -= 1; // low surrogate at the cut → include its high half
  }
  return s.slice(start);
}
