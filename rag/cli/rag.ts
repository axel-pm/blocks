// The one-command RAG CLI: point it at a repo / docs folder and get a queryable index.
//
//   rag build <dir> --out kb.json [--model openai/text-embedding-3-small] [--ext md,txt] [--max-chars 1200] [--overlap 150]
//   rag query kb.json "how do I configure X" [--k 5] [--min-score 0.2]
//
// Run with `tsx` (or your project's TS runner): `npx tsx rag.ts build ./docs --out kb.json`. The
// embedding step calls your AI provider through the AI SDK, so set the relevant credentials (e.g.
// AI_GATEWAY_API_KEY, or run on Vercel with OIDC). Nothing else here reaches the network.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { aiEmbedder } from '../adapters/ai-embedder';
import { ingestDir } from '../adapters/fs-ingest';
import { buildIndex } from '../src/build';
import { createRetriever } from '../src/retrieve';
import { parseIndex, serializeIndex } from '../src/serialize';

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Parse a flag as a finite number ≥ min; throw with a clear message otherwise (no silent NaN). */
function intFlag(v: string | undefined, name: string, min: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    die(`${name} must be an integer ≥ ${min}, got "${v}"`);
  }
  return n;
}

async function build(positionals: string[], values: Record<string, string | undefined>) {
  const dir = positionals[0];
  if (!dir) die('usage: rag build <dir> --out <file> [--model <id>] [--ext md,txt] [--max-chars N] [--overlap N]');
  const out = values.out ?? 'kb.json';
  const model = values.model ?? 'openai/text-embedding-3-small';
  const extensions = values.ext?.split(',').map((s) => s.trim()).filter(Boolean);
  const maxChars = intFlag(values['max-chars'], '--max-chars', 1);
  let overlap = intFlag(values.overlap, '--overlap', 0);
  // If the user shrank maxChars but didn't set overlap, keep overlap below it instead of erroring.
  if (overlap === undefined && maxChars !== undefined && maxChars <= 150) overlap = Math.max(0, maxChars - 1);

  const docs = ingestDir(dir, { ...(extensions ? { extensions } : {}) });
  if (docs.length === 0) die(`no text documents found under ${dir} (try --ext to widen the file types)`);
  console.error(`Indexing ${docs.length} document(s) from ${dir} with ${model}…`);

  const index = await buildIndex(docs, aiEmbedder({ model }), {
    ...(maxChars !== undefined ? { maxChars } : {}),
    ...(overlap !== undefined ? { overlap } : {}),
    onProgress: (done, total) => process.stderr.write(`\r  embedded ${done}/${total} chunks`),
  });
  process.stderr.write('\n');
  writeFileSync(out, serializeIndex(index));
  console.error(`✓ wrote ${out} — ${index.chunks.length} chunks, dim ${index.dim}, model ${index.embeddingModel}`);
}

async function query(positionals: string[], values: Record<string, string | undefined>) {
  const [file, q] = positionals;
  if (!file || !q) die('usage: rag query <index-file> "question" [--k N] [--min-score S]');
  const k = intFlag(values.k, '--k', 1);
  const minScore = values['min-score'] !== undefined ? Number(values['min-score']) : undefined;
  if (minScore !== undefined && !Number.isFinite(minScore)) die(`--min-score must be a number, got "${values['min-score']}"`);

  const index = parseIndex(readFileSync(file, 'utf8'));
  // Query with the SAME embedder the index was built with (its stored id), so dims/space match.
  const retriever = createRetriever(index, aiEmbedder({ model: index.embeddingModel }));
  const hits = await retriever.retrieve(q, {
    ...(k !== undefined ? { k } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
  });

  if (hits.length === 0) return console.log('(no passages matched)');
  for (const h of hits) {
    const where = h.citation.title ? `${h.citation.title} (${h.citation.docId}#${h.citation.ordinal})` : `${h.citation.docId}#${h.citation.ordinal}`;
    console.log(`\n[${h.score.toFixed(3)}] ${where}\n${h.text.trim()}`);
  }
}

function usage(): never {
  console.log('rag — build and query a local RAG index\n');
  console.log('  rag build <dir> --out kb.json [--model <id>] [--ext md,txt] [--max-chars N] [--overlap N]');
  console.log('  rag query kb.json "question" [--k N] [--min-score S]');
  process.exit(0);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
if (!cmd || cmd === 'help' || cmd === '--help') usage();
if (cmd !== 'build' && cmd !== 'query') die(`unknown command "${cmd}" (expected build or query)`);

let parsed: { values: Record<string, string | undefined>; positionals: string[] };
try {
  parsed = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      model: { type: 'string' },
      ext: { type: 'string' },
      'max-chars': { type: 'string' },
      overlap: { type: 'string' },
      k: { type: 'string' },
      'min-score': { type: 'string' },
    },
  }) as typeof parsed;
} catch (e) {
  die(e instanceof Error ? e.message : String(e));
}

const run = cmd === 'build' ? build : query;
run(parsed.positionals, parsed.values).catch((e) => die(e instanceof Error ? e.message : String(e)));
