# inference — threat model

## What flows through this block

- **API keys** for off-gateway providers. They enter only through the injected `secrets` reader
  and `createMistral`/`createOpenAICompatible` `apiKey` option. The core never reads
  `process.env`, never stores a key beyond the provider instance that needs it, and **never
  returns a key or puts one in `Resolved`** (`model`, `id`, `providerOptions` carry no secret).
- **Model ids and residency labels** — not secret; shown in admin UIs and logs.

## Safe defaults (fail-closed, not fail-open)

- `pickEffectiveTarget` downgrades to the registry default on an unknown id (including a
  prototype name like `constructor` — the registry map is null-prototype and looked up with
  `Object.hasOwn`), a missing key, or (in production) a target that isn't `enabled`. The failure
  mode is "keep running on the vetted default", never "route to an unapproved provider".
- `defineRegistry` requires the default to be an `enabled` gateway target, so the fail-closed
  fallback is always reachable; and it rejects duplicate ids so a later target can't shadow one.
- If `resolve` is handed an off-gateway target whose key resolves empty, it **throws** instead of
  sending an unauthenticated request or letting a provider SDK silently read its own env var. An
  off-gateway target with an empty `apiKeyEnv` is treated as unconfigured, never as "no auth".
- `baseURL` is not validated by the block — point off-gateway targets only at `https` endpoints
  you control or trust; a wrong/compromised `baseURL` would receive the request and its payload.
- The `next-postgres` adapter's `saveTarget` applies the same three checks **before persisting**,
  so the stored value is always one the resolver would honour — a compromised or fat-fingered
  write can't smuggle in a target that only activates later.
- New / unproven targets ship `enabled: false`. They are selectable in production only after you
  flip that, which should gate on an eval proving the target answers (and, if you use structured
  output or tools, honours them) in your languages.

## Residency / data-governance surface

- A target's `residency` string is operator-facing text. It is **not enforced** by this block —
  pinning a region, zero retention, and no-training live in the `gatewayOptions` object you inject
  (for a gateway target) or in the provider's own endpoint (off-gateway). Do not let a
  `residency` label claim more than the injected options or the endpoint actually guarantee.
- Off-gateway targets bypass any gateway-level zero-retention / no-training guarantees. Before
  enabling one for real traffic, confirm the provider's data-processing terms and sub-processors
  directly — the block cannot assert them for you.

## Supply chain

- The only third-party code is the declared `peerDependencies` (`ai`, `@ai-sdk/mistral`,
  `@ai-sdk/openai-compatible`). Because the block is copied into your repo rather than installed,
  it adds no transitive dependency of its own and no auto-update path. You review the source once
  at copy time and pin it by committing it.

## What this block does NOT do

- It does not authenticate or authorise the operator. Call your own `requireSuperAdmin()` (or
  equivalent) before `saveTarget`.
- It does not rate-limit, cap spend, mask PII, or resist prompt injection. Compose those from
  their own blocks around it.
- It does not validate that an off-gateway model honours structured output or tool calls — that's
  the enable-eval's job before you set `enabled: true`.
