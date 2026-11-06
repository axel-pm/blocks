# rag

**Answer questions from your own documents — and show the sources, so the answer can be checked.**

![How rag works](../docs/img/rag.png)

## What it does, in plain terms

A general AI model doesn't know your handbook, your product manuals, or your knowledge base — and if
you ask it anyway, it may make things up. "RAG" (retrieval-augmented generation) fixes that: it finds
the relevant passages in *your* documents first, and gives the model those to answer from.

There are two phases:

- **Set up (once):** point it at a folder — a repo, a docs site, a knowledge base. It splits the
  documents into passages, turns them into a searchable form, and saves a single portable **index
  file**.
- **Ask (any time):** for a question, it finds the closest-matching passages and returns them
  **with their source and a relevance score**. You hand those passages to the model to write the
  answer, and the citations let you — or the [verify-correct](../verify-correct) block — check it.

There's a one-line command for the whole thing (build an index from a folder, then query it), or a
programmatic API if you're wiring it into an app.

## Why it's safe

The folder reader is cautious by default: it **skips passwords, keys, and credential files** — both
by filename *and* by scanning file contents for secret-looking patterns — and skips huge or binary
files, with caps on how much it reads. Retrieved passages are "fenced" before they reach the model,
so text hidden inside a document can't issue instructions to it. See [`SECURITY.md`](./SECURITY.md).

## Where it fits

The passages rag returns are the *sources* that [verify-correct](../verify-correct) checks the answer
against, and the model that writes the answer comes from [inference](../inference). rag composes with
them but doesn't depend on them.

<details>
<summary><b>For developers</b> — the one-command CLI, the API, and the contract</summary>

The CLI (needs the `cli` adapter copied in and `tsx` available):

```bash
# point at a repo/docs folder → a queryable index
npx tsx lib/rag/cli/rag.ts build ./my-repo --out kb.json --model openai/text-embedding-3-small [--ext md,txt] [--overlap 150]

# ask it something → cited passages
npx tsx lib/rag/cli/rag.ts query kb.json "how do I configure retries?" --k 5
```

The programmatic API (`lib/rag/src/index.ts`):

```ts
import { buildIndex, createRetriever, serializeIndex, parseIndex, type Embedder } from './lib/rag/src';
import { aiEmbedder } from './lib/rag/adapters/ai-embedder'; // or bring your own { id, embed }

const embedder: Embedder = aiEmbedder({ model: 'openai/text-embedding-3-small' });

// Build (docs can come from the fs-ingest adapter, a DB, anywhere):
const index = await buildIndex(docs, embedder, { maxChars: 1200, overlap: 150 });
writeFileSync('kb.json', serializeIndex(index));

// Query:
const retriever = createRetriever(parseIndex(readFileSync('kb.json', 'utf8')), embedder);
const hits = await retriever.retrieve('my question', { k: 5, minScore: 0.2 });
// hits[i] = { text, score, citation: { docId, title?, ordinal, meta? } }
```

- `chunkDocument(doc, { maxChars, overlap })` — structure-aware, paragraph-boundary chunking (no
  tokenizer dependency). No input text is dropped; UTF-16 surrogate pairs are never split.
- `buildIndex(docs, embedder, opts)` — chunk + embed (batched) → a normalised, serialisable index.
  Rejects non-finite or zero vectors rather than indexing garbage.
- `createRetriever(index, embedder)` — cosine top-k with citations; **refuses an embedder whose `id`
  differs from the index's** (querying in the wrong vector space returns nonsense), and throws on a
  degenerate query embedding.
- `serializeIndex` / `parseIndex` — JSON file IO; `parseIndex` validates shape, dimensions,
  finiteness, unit length, ordinals, and uniqueness.
- `fencePassages(retrievals, opts?)` — render retrievals as labelled, injection-resistant fences for
  a prompt (titles/meta are treated as untrusted too).

The embedder is just `{ id: string; embed: (texts: string[]) => Promise<number[][]> }` — inject any
provider or a deterministic fake in tests. The core normalises vectors for you.

### Adapters

- **fs-ingest** — `ingestDir(root, opts)` → `Document[]`. Security-defaulted (see above); deterministic
  order for a reproducible index. (`.gitignore` is not consulted — use `skipDirs`.)
- **ai-embedder** — `aiEmbedder({ model, id?, providerOptions? })` wraps an AI SDK embedding model;
  pass `providerOptions` to carry gateway residency / zero-retention.
- **cli** — the `rag` command above.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `AI_GATEWAY_API_KEY` (or provider key / OIDC) | only for ai-embedder / cli | credentials for the embedding call |

The core and the fs ingester read **no** environment.

### Scope (v1)

In: ingest → chunk → embed → JSON index → cosine retrieval with citations. Out (compose separately):
reranking, a vector database (swap `serialize` for a pgvector adapter when a corpus outgrows a file),
incremental re-indexing, and the answer-writing step itself (feed the passages to [inference](../inference)).
Changing the embedder means rebuilding the index.

</details>
