# Authoring a block

Conventions for adding or changing a block in this registry. These exist so every block is
portable and secure by construction, not by review afterwards.

## The core is pure

- `src/` is framework-free TypeScript. It imports only: other files in the same block, and
  the block's declared `peerDependencies` (first-party AI SDK packages).
- **No `process.env` in `src/`.** Secrets and config arrive through an injected reader or a
  config object the caller passes. A core that reads the environment is not portable (it
  assumes a deployment) and not testable (it forces global mocks that leak into other tests).
- **No project imports.** A core never does `import { x } from '../ai'`. If a block needs the
  host's shared options (e.g. gateway provider options), the host injects them.
- No global singletons that read config at module load. Build instances from an explicit
  factory the caller invokes.
- Keep roles / domains generic (type parameters), not a hard-coded enum from one app.

## Adapters are where the environment lives

Anything that touches `process.env`, a database, a framework request, or `next`/`react`
lives in `adapters/`. Adapters are optional: a consumer copies one only if they want that
glue. Each adapter is a thin factory that reads its environment and calls the pure core.

## Every block ships its own documentation

- `README.md` — one-paragraph what/why, the public API with signatures, an **env table**
  (every variable: name, required?, default, what it does), and a wiring example.
- `SECURITY.md` — the threat model: what secrets flow through, how they're handled (never
  logged, never returned), the injection/abuse surface, and the **safe defaults** the block
  falls back to when misconfigured (fail-closed, not fail-open).
- `block.json` — the manifest the CLI reads (schema below). Keep `files` and `env` honest;
  the CLI prints them verbatim to the person copying the block in.

## block.json schema

```jsonc
{
  "name": "inference",
  "version": "0.1.0",
  "description": "one line",
  "peerDependencies": { "ai": "^7", "@ai-sdk/openai-compatible": "^3" },
  "env": [
    { "name": "INFERENCE_TARGET", "required": false, "default": "(registry default)",
      "desc": "override the active target id" }
  ],
  "files": [                                  // core files, always copied
    { "from": "src/types.ts", "to": "lib/inference/types.ts" }
  ],
  "adapters": [                               // optional, copied only with --adapter <name>
    { "name": "next-postgres", "desc": "...", "files": [ { "from": "...", "to": "..." } ] }
  ]
}
```

`from` is relative to the block directory; `to` is relative to the destination the user
passes to `blocks add`. Keep `to` paths framework-neutral (`lib/<block>/…`).

## Verification before a block is "done"

1. The core type-checks in isolation with only its `peerDependencies` present.
2. Tests in `tests/` pass and cover the safe-default / downgrade paths, not just the happy path.
3. An **independent adversarial review by a different model** reads the extracted block cold
   for portability leaks (hidden env/global/project coupling), security holes (leaked or
   logged secrets, fail-open defaults, injection surface), and contract gaps. Findings that
   survive scrutiny are folded in before the block ships.
