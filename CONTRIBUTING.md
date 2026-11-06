# Contributing

Thanks for your interest. This repository is a **copy-in source registry**: blocks are not published
to npm — a tiny CLI copies a block's source into a consuming project, which then owns it. That shapes
how contributions work.

## Before you start

- Read [`AGENTS.md`](./AGENTS.md). It is the contract every block follows — a pure, framework-free
  core that reads no `process.env` and imports no project module, with all environment glue isolated
  in `adapters/`. A contribution that breaks that contract will be sent back.
- For a new block, open an issue first to agree the scope. Blocks stay small and single-purpose.

## Local setup

```bash
npm install
npm run typecheck   # tsc --noEmit over every block
npm test            # vitest over every block's tests/
npm run cli -- list # exercise the CLI
```

Node 22+ is required (AI SDK 7 is ESM-only). `node_modules/` exists only to type-check and test the
blocks; it is never copied into a consuming project.

## What a change must satisfy

1. **The portability test passes.** Each block has `tests/portability.test.ts`, a TypeScript-AST walk
   that fails the build if `src/` reaches for `process`, a runtime global, dynamic code loading, or an
   import that escapes the block. Do not weaken it to make code pass.
2. **Safe defaults are tested.** Cover the fail-closed / downgrade paths, not just the happy path.
3. **Docs stay honest.** Update the block's `README.md`, `SECURITY.md`, and `block.json` (the CLI
   prints `env` and `peerDependencies` verbatim to whoever copies the block in). Add the block to
   [`registry.json`](./registry.json).
4. **Adversarial review.** Per `AGENTS.md`, a new or substantially changed block gets an independent
   review by a different model, reading the extracted block cold for portability leaks, leaked or
   logged secrets, fail-open defaults, and injection surface. Findings that survive are folded in
   before it ships.

## License

By submitting a contribution you agree it is licensed under the [MIT License](./LICENSE), the license
of this repository. Don't paste in code under an incompatible (e.g. copyleft) license, and keep new
dependencies permissive (MIT / Apache-2.0 / BSD / ISC).
