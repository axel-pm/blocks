# rag

A portable retrieval pipeline you copy into a project: turn documents (a repo, a docs folder, a
knowledge base) into an embedded, serialisable index, then retrieve top-k passages **with
citations** for a query. The core is pure and **provider-free** — you inject the embedder — so the
same code runs with any provider or a deterministic fake in tests. It composes with the `inference`
block (use the same gateway options for an EU-pinned embedder) but doesn't depend on it.

## The one-command experience

With the `cli` adapter copied in and `tsx` available:

```bash
# point at a repo/docs folder → a queryable index
npx tsx lib/rag/cli/rag.ts build ./my-repo --out kb.json --model openai/text-embedding-3-small [--ext md,txt] [--overlap 150]

# ask it something → cited passages
npx tsx lib/rag/cli/rag.ts query kb.json "how do I configure retries?" --k 5
```

`build` ingests text files (skipping secrets, `node_modules`, binaries — see SECURITY), chunks,
embeds, and writes a JSON index. `query` embeds the question and prints the best passages with their
source and score. The embedding step needs AI credentials (e.g. `AI_GATEWAY_API_KEY`, or OIDC on
Vercel); nothing else touches the network.

## Programmatic API (`lib/rag/src/index.ts`)

```ts
import { buildIndex, createRetriever, serializeIndex, parseIndex, type Embedder } from './lib/rag/src';

// Inject any embedder. Here, the AI SDK adapter (or bring your own { id, embed }).
import { aiEmbedder } from './lib/rag/adapters/ai-embedder';
const embedder: Embedder = aiEmbedder({ model: 'openai/text-embedding-3-small' });

// Build (docs can come from the fs-ingest adapter, a DB, anywhere):
const index = await buildIndex(docs, embedder, { maxChars: 1200, overlap: 150 });
writeFileSync('kb.json', serializeIndex(index));

// Query:
const retriever = createRetriever(parseIndex(readFileSync('kb.json', 'utf8')), embedder);
const hits = await retriever.retrieve('my question', { k: 5, minScore: 0.2 });
// hits[i] = { text, score, citation: { docId, title?, ordinal, meta? } }
```

- `chunkDocument(doc, { maxChars, overlap })` — structure-aware, paragraph-boundary chunking (characters, no tokenizer dep).
- `buildIndex(docs, embedder, opts)` — chunk + embed (batched) → a normalised, serialisable `RagIndex`.
- `createRetriever(index, embedder)` — cosine top-k with citations; **refuses an embedder whose `id` ≠ the index's** (querying in the wrong vector space returns garbage).
- `serializeIndex` / `parseIndex` — JSON file IO; `parseIndex` validates shape, vector dimensions, finiteness, unit-length, ordinals, and uniqueness, and throws on any mismatch.
- `fencePassages(retrievals, opts?)` — render retrievals as labelled, injection-resistant fences for a prompt (see SECURITY). Titles/meta are untrusted too.

Chunks are at most `maxChars + overlap + 2` characters; no input text is dropped, and UTF-16
surrogate pairs are never split. Degenerate embeddings fail loudly: `buildIndex` rejects non-finite
or zero vectors, and `retrieve` throws on a non-finite/zero/wrong-dimension query embedding rather
than returning arbitrary passages.

### Embedder contract

```ts
type Embedder = { id: string; embed: (texts: string[]) => Promise<number[][]> };
```

`id` is stored in the index and checked at query time. `embed` returns one vector per input, in
order, all the same length. The core normalises vectors, so you don't have to.

## Adapters

- **fs-ingest** — `ingestDir(root, opts)` → `Document[]`. Security-defaulted (see SECURITY): skips
  credential dirs + secret file shapes + files whose **content** matches a secret signature, plus
  binaries and files over 1 MiB; enforces `maxFiles`/`maxTotalBytes` caps; reports exclusions via an
  `onSkip` callback. Ids are forward-slash repo-relative; order is deterministic (reproducible index).
  Known limitation: a fenced code block containing blank lines may be split mid-fence (chunking is
  paragraph-based); `.gitignore` is not consulted (use `skipDirs`).
- **ai-embedder** — `aiEmbedder({ model, id?, providerOptions? })` wraps an AI SDK embedding model
  (a gateway string like `openai/text-embedding-3-small`, or an instance). Pass `providerOptions`
  to carry gateway residency / zero-retention.
- **cli** — the `rag` command above (pulls in fs-ingest + ai-embedder).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` (or provider key / OIDC) | only for ai-embedder / cli | credentials for the embedding call |

The core and the fs ingester read **no** environment.

## Scope (v1)

In: ingest → chunk → embed → JSON index → cosine retrieval with citations. Out (compose separately):
reranking, a vector-DB store (the index is an in-memory/JSON structure; swap `serialize` for a
pgvector adapter when a corpus outgrows a file), incremental re-indexing, and query-time generation
(feed the retrieved passages to the `inference` block). Embeddings are a build-time concern: changing
the embedder means rebuilding the index.
