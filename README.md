# blocks

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-Node-3178c6.svg)
![AI SDK 7](https://img.shields.io/badge/AI%20SDK-7-black.svg)
![Status: early](https://img.shields.io/badge/status-early%20(v0.1)-orange.svg)

Composable, portable building blocks for TypeScript/Node AI apps — a **copy-in source
registry**, not a dependency. You don't `npm install` a block; a tiny CLI copies its
**source** into your project, and your project owns the code from then on.

This is the [shadcn/ui](https://ui.shadcn.com) model applied to backend AI plumbing.

> **Status:** early (v0.1). The six blocks below are tested and adversarially reviewed, but the API
> may still change between versions. Because you copy source in, an upgrade never breaks you silently
> — you re-copy when you choose. See [drift](#using-a-block).

## Why copy-in (the two things this optimises for)

**Portability.** A block has no runtime coupling to this repo. Once copied, it's ordinary
source in your tree — you read it, edit it, and ship it like anything else you wrote. No
private registry to authenticate against, no version resolution, no "works on my machine"
from a transitive dependency.

**Security.** A copied-in block adds **zero new supply-chain dependency** to your project.
There is no auto-update silently pulling unreviewed code into your build, no registry-auth
secret in every CI, no transitive blast radius. Every line is reviewed once, at copy time,
and pinned by living in your repo. The only third-party code a block pulls is declared,
first-party AI SDK packages you already trust (listed as `peerDependencies` per block).

The trade-off is deliberate: central fixes do **not** auto-propagate. Run `blocks diff` to
see where a copy has drifted from the registry, and re-copy intentionally.

## Target

TypeScript on Node, using [AI SDK 7](https://ai-sdk.dev). Blocks assume this substrate and
keep adapters thin. They do **not** try to run on every runtime — that abstraction isn't
worth its weight for the projects these serve (nke, patrim, …).

## Using a block

```bash
# from a consuming project
node /path/to/blocks/cli/blocks.mjs list
node /path/to/blocks/cli/blocks.mjs add inference ./src          # copies the core
node /path/to/blocks/cli/blocks.mjs add inference ./src --adapter next-postgres
node /path/to/blocks/cli/blocks.mjs diff inference ./src         # show drift
```

`add` copies the block's source under the destination you give, then prints the
`peerDependencies` to install and the environment variables the block reads. Nothing runs
in your project automatically; you wire the block in yourself.

## Shape of every block

```
<name>/                 (at the repo root, e.g. inference/, rag/)
  block.json      manifest: files, peerDependencies, env contract, adapters
  README.md       what it does, the public API, the env table, how to wire it
  SECURITY.md     threat model: secret handling, injection surface, safe defaults
  src/            the pure core — framework-free, config-injected, no process.env
  adapters/       optional glue (a Next route handler, a Postgres-backed selector)
  tests/          the core's tests, copied alongside
```

**The core rule:** a block's `src/` takes an explicit config object and an injected secret
reader. It never reads `process.env`, never imports a project module, never reaches global
state. Everything environment-specific lives in `adapters/`, which you copy only if you want
it. This is what makes a block both portable (drop it anywhere) and testable (no mocks of
global modules) — and it's the decoupling learned the hard way: a registry that read
`process.env` directly pulled mocked modules into unrelated tests.

See [`AGENTS.md`](./AGENTS.md) for the conventions an author (human or agent) follows when
adding a block.

## Registry

[`registry.json`](./registry.json) indexes the blocks. Current:

Together these decompose a grounded-answer AI app — route a query, resolve a model, retrieve and
cite, verify, and keep it safe and configurable — each usable on its own.

- **inference** — provider-agnostic model resolution. One seam turns `(role) → model + provider
  options`; swap where inference runs (Vercel AI Gateway, Mistral EU, any OpenAI-compatible
  endpoint, self-hosted) without touching call sites. A fail-closed chooser keeps an unvetted or
  misconfigured target from serving traffic; residency / retention are operator-declared metadata
  enforced by the injected gateway options, not by the block.
- **rag** — retrieval pipeline: documents → structure-aware chunks → an embedded, serialisable index
  → cited top-k retrievals. Provider-free core (embedder injected); a security-defaulted repo/KB
  ingester and a one-command CLI. Fences passages against prompt injection.
- **router** — classify a query into a tier (which model should answer): deterministic rules first,
  then an optional injected LLM classifier (bounded by a timeout), then a safe default. Fail-safe.
- **verify-correct** — bounded generate → verify → correct loop that catches ungrounded answers;
  judge/corrector/generate injected. Fail-safe: never reports a false "verified", never crashes
  answering.
- **guardrails** — security primitives: reversible PII masking, per-principal spend/rate caps over
  an injected store, and untrusted-content fencing. Zero dependencies.
- **settings** — runtime operator-editable config: typed setting resolved env-override → stored
  value → default, short cache (live after a write), fail-safe decoding. Store + env injected.

## Contributing

Issues and PRs are welcome. Every block follows the same portability + security contract — read
[`AGENTS.md`](./AGENTS.md) before adding or changing one, and [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the workflow. By contributing you agree your contribution is licensed under the MIT License.

## License

[MIT](./LICENSE) © Axel Sooriah.

Every block is MIT-licensed. When you copy a block into your project with the CLI, the source becomes
yours to use, modify, and ship under those terms — keep the copyright notice from `LICENSE`. The only
third-party code a block relies on is its declared `peerDependencies` (Vercel [AI SDK](https://ai-sdk.dev)
packages, Apache-2.0), which you install and which carry their own permissive licenses.
