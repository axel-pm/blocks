// PII masking: redact emails, phone numbers, and caller-supplied names/patterns from text before it
// leaves your trust boundary (e.g. before sending to a model or logging), with a reversible map so
// you can restore the originals in the model's output.
//
// Security properties:
//  - Overlapping detections are MERGED, never dropped — a detected value is never left partly
//    unmasked (so an email abutting a phone can't leak its domain).
//  - Tokens carry a per-call random nonce, so an attacker who controls input can't guess a token to
//    smuggle a masked value back out through `unmask`. (Within one call, a repeated value still
//    reuses its token; across calls, tokens differ — determinism is per-call, not global.)
//  - `unmask` is single-pass and replaces ONLY tokens present in the map, so a token-lookalike in
//    the source is never corrupted, and values can't chain into each other.
//
// Masking is BEST-EFFORT, not a guarantee — see SECURITY.md for the false-positive/negative caveats.

import type { MaskOptions, MaskResult, PiiSpan } from './types';

// Bounded quantifiers keep matching linear (no catastrophic backtracking) on hostile input; a
// leading negative lookbehind pins the start so the local part isn't matched mid-word (and so a long
// local part still matches rather than being skipped by a `\b` that can't retry). Unicode letters
// (\p{L}) so accented locals/domains like müller@… are caught. The 128/255 caps cover real
// addresses; a pathologically longer one is documented as out of scope.
const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,128}@[\p{L}\p{N}.-]{1,255}\.[\p{L}]{2,24}/gu;
// A run of digits (ASCII or full-width) and phone punctuation (incl. Unicode hyphens and slashes);
// post-filtered on digit count (≥7). No upper bound: a long run that CONTAINS a phone is masked
// whole rather than skipped (over-mask is the safe direction).
const PHONE_CANDIDATE = /[+＋]?[\d０-９][\d０-９\s().\-‐-―−/／]{5,}[\d０-９]/gu;
const PHONE_DIGIT = /[\d０-９]/gu;
const TOKEN_SHAPE = /⟦[^⟦⟧]*⟧/g;
const NONCE_OK = /^[A-Za-z0-9_-]+$/;

/** Mask sensitive spans in `text`. Returns the redacted text and a token→original map. */
export function mask(text: string, opts: MaskOptions = {}): MaskResult {
  if (typeof text !== 'string') throw new TypeError('mask: text must be a string');
  const nonce = (opts.nonce ?? defaultNonce)();
  if (!NONCE_OK.test(nonce)) throw new Error('mask: nonce must match /^[A-Za-z0-9_-]+$/ (it goes inside the token)');

  const spans: PiiSpan[] = [];
  if (opts.email !== false) collect(spans, text, EMAIL, 'EMAIL');
  if (opts.phone !== false) collectPhones(spans, text);
  for (const name of opts.names ?? []) collectName(spans, text, name);
  for (const p of opts.patterns ?? []) collect(spans, text, clone(p.pattern), p.type.toUpperCase());

  // Merge overlapping spans into union spans, so a detected value is never left partly unmasked.
  const merged = mergeSpans(spans, text);

  const map: Record<string, string> = {};
  const tokenFor = new Map<string, string>(); // `${type}\0${value}` → token
  const counters = new Map<string, number>();
  let out = '';
  let cursor = 0;
  for (const s of merged) {
    const vkey = `${s.type}\u0000${s.value}`;
    let token = tokenFor.get(vkey);
    if (!token) {
      const n = (counters.get(s.type) ?? 0) + 1;
      counters.set(s.type, n);
      token = `⟦${nonce}:${s.type}_${n}⟧`;
      tokenFor.set(vkey, token);
      map[token] = s.value;
    }
    out += text.slice(cursor, s.start) + token;
    cursor = s.end;
  }
  out += text.slice(cursor);
  return { text: out, map };
}

/** Restore originals in `text` using a map from `mask`. Single pass; only real tokens are replaced. */
export function unmask(text: string, map: Record<string, string>): string {
  if (typeof text !== 'string') throw new TypeError('unmask: text must be a string');
  return text.replace(TOKEN_SHAPE, (m) => (Object.hasOwn(map, m) ? map[m]! : m));
}

/** Merge overlapping spans (sorted by start, longest-first) into non-overlapping union spans. */
function mergeSpans(spans: PiiSpan[], text: string): PiiSpan[] {
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: PiiSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      // Overlaps the current union → extend it; mixed types collapse to the generic "PII".
      if (s.end > last.end) {
        last.end = s.end;
        last.value = text.slice(last.start, last.end);
      }
      if (last.type !== s.type) last.type = 'PII';
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

function collect(spans: PiiSpan[], text: string, re: RegExp, type: string): void {
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue; // ignore empty matches from a user pattern like /x*/
    spans.push({ start: m.index!, end: m.index! + m[0].length, type, value: m[0] });
  }
}

function collectPhones(spans: PiiSpan[], text: string): void {
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    if ((m[0].match(PHONE_DIGIT) ?? []).length >= 7) spans.push({ start: m.index!, end: m.index! + m[0].length, type: 'PHONE', value: m[0] });
  }
}

function collectName(spans: PiiSpan[], text: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Each whitespace run in the name matches any whitespace in the text; combining marks (\p{M}) count
  // as part of a word so an accented neighbour isn't treated as a boundary.
  const body = escapeRegExp(trimmed).replace(/\s+/g, '\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${body}(?![\\p{L}\\p{N}\\p{M}])`, 'giu');
  for (const m of text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length, type: 'NAME', value: m[0] });
}

/** Default per-call nonce. Not cryptographic — it's a guess/collision barrier; inject `nonce` for a stronger one. */
function defaultNonce(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

/** Clone a user RegExp with the global flag (and without sticky) so matchAll works and isn't stateful. */
function clone(re: RegExp): RegExp {
  return new RegExp(re.source, `${re.flags.replace(/[gy]/g, '')}g`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
