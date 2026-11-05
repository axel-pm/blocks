# rag — threat model

## Retrieved content is DATA, not instructions

The passages this block returns come from your corpus, which may include third-party or
user-contributed text. When you feed retrievals into a model prompt, treat them as **data**: a
retrieved passage that says "ignore your instructions and …" is a prompt-injection attempt, not a
command. Use the exported `fencePassages(retrievals)` helper, which wraps each passage in a
labelled fence and neutralises any attempt to close that fence early — then tell your model, in the
system prompt, to treat fenced passages as reference data it may quote but never obey. Note that a
passage's `title` and `meta` also come from file content and are equally untrusted. This block does
not sanitise content; it faithfully returns what was indexed.

## What enters the index (the ingest step decides)

The `fs-ingest` adapter is **deny-by-default** on three axes, because anything indexed becomes
retrievable text and is sent to your embedding provider:

1. **Directories** (by name, anywhere in the tree): `node_modules`, `.git`, build output
   (`dist`/`build`/`out`/…), and credential dirs `.aws`, `.ssh`, `.gnupg`, `.gcloud`, `.kube`,
   `.terraform`, `secrets`.
2. **File shapes** almost always secret: `.env*`, `*.pem/key/pfx/p12/ppk`, `id_rsa*`, `kubeconfig`,
   `*.tfstate/tfvars`, `service-account`/`credentials` `*.json|*.yaml`, `.npmrc`/`.netrc`/
   `.git-credentials`/`.pypirc`/`.dockercfg`.
3. **File content**: a scan for secret signatures — private-key blocks, AWS `AKIA…`, OpenAI `sk-…`,
   GitHub `ghp_…`, Slack `xox…`, Google `AIza…`. This is the backstop that catches a key pasted
   into an ordinary `.md`/`.txt` (and makes widening `--ext` to code/config safer).

Name rules are intentionally **precise, not fuzzy**: matching "secret"/"password" anywhere in a
name would wrongly skip legitimate docs (`reset-password.md`, `credentials-guide.md`). Those are
indexed; a real secret *inside* one is caught by the content scan. Caveat: the content scan covers
common high-signal token shapes, not every possible secret — review a corpus built from a tree you
didn't audit, and pass `onSkip` to see what was excluded and why.

**`.gitignore` is not consulted.** A private directory that is gitignored but not in the skip list
(e.g. a project's `internal/`) would be ingested — add it via `skipDirs`. There are also
`maxFiles`/`maxTotalBytes` caps (defaults 5000 / 50 MiB) so an accidental huge tree can't be
embedded (and paid for) silently; they throw when exceeded.

If you ingest from your own code instead of the adapter, apply the same discipline.

## Secrets in the pipeline

- The core and the fs ingester read **no** credentials. Only the `ai-embedder` adapter uses an API
  key, through the AI SDK (`AI_GATEWAY_API_KEY`/provider key/OIDC). The key never enters the index,
  a `Document`, a `Retrieval`, or a citation.
- The index file contains your corpus text and its embeddings in plaintext. Treat `kb.json` with
  the same sensitivity as the source corpus — don't commit an index built from private material to
  a public repo.

## Correctness-as-safety

- Querying with a different embedder than built the index returns meaningless-but-plausible results.
  `createRetriever` **refuses** an embedder whose `id` differs, and `parseIndex` rejects an index
  whose vectors don't match the recorded dimension — a corrupt or mismatched index fails loudly
  instead of silently returning wrong passages a model will then treat as grounded truth.

## What this block does NOT do

- No reranking, no access-control filtering of results (add your own `meta`-based filter if some
  passages are restricted), no PII masking, no generation. Compose those from their own blocks.
