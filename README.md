# blocks

Composable, portable building blocks for TypeScript/Node AI apps — a **copy-in source
registry**, not a dependency. You don't `npm install` a block; a tiny CLI copies its
**source** into your project, and your project owns the code from then on.

This is the [shadcn/ui](https://ui.shadcn.com) model applied to backend AI plumbing.

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
blocks/<name>/
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

- **inference** — provider-agnostic model resolution. One seam turns `(role) → model + provider
  options`; swap where inference runs (Vercel AI Gateway, Mistral EU, any OpenAI-compatible
  endpoint, self-hosted) without touching call sites. A fail-closed chooser keeps an unvetted or
  misconfigured target from serving traffic; residency / retention are operator-declared metadata
  enforced by the injected gateway options, not by the block.
