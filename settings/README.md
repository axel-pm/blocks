# settings

Runtime, operator-editable configuration for an app: a super admin changes a setting and it takes
effect **without a redeploy**, an env var can override it, and there's always a safe default. A
typed setting resolves in this order — **env override → stored value → default** — behind a short
in-memory cache. Zero dependencies; the store and the env reader are injected.

## Usage

```ts
import { createSettings, defineSetting, enumCodec } from './lib/settings/src';
import { memoryStore } from './lib/settings/adapters/memory-store'; // or your Postgres store

// Describe settings once (typed).
const INFERENCE_TARGET = defineSetting<'gateway' | 'mistral'>({
  key: 'inference_target', default: 'gateway', envVar: 'INFERENCE_TARGET', codec: enumCodec(['gateway', 'mistral']),
});

const settings = createSettings({
  store: myStore,              // { read(key), write(key, value) }
  env: (n) => process.env[n],  // injected — the core never touches process.env itself
  cacheMs: 15_000,
  onError: (key, source, e) => log.warn({ key, source, e }, 'bad setting, using default'),
});

await settings.get(INFERENCE_TARGET);        // 'gateway' | 'mistral'
await settings.set(INFERENCE_TARGET, 'mistral'); // call behind YOUR super-admin check; live immediately
```

- `defineSetting<T>({ key, default, envVar?, codec?, validate? })` — typed descriptor; codec defaults to JSON.
- `createSettings({ store, env?, cacheMs?, onError? })` → `{ get, set, invalidate }`.
- Codecs: `jsonCodec<T>()` (default), `stringCodec`, `enumCodec(values)` — or supply your own `{ parse, serialize }`.

## Precedence, caching, and safety

- **Env override** is checked first and bypasses the cache, so an operator's env change is instant.
- **Cache**: reads are served from memory for `cacheMs`; `set` invalidates the key so a change shows
  up immediately, and `invalidate(key?)` clears one or all entries.
- **Fail-safe reads**: a stored or env value that won't parse or fails `validate` is ignored in
  favour of the default (and reported via `onError`) — a bad value can't throw on your hot path.
- **Strict writes**: `set` refuses to persist a value that fails `validate`, so the store never
  holds something `get` would reject.

## Store contract

You provide `{ read(key): Promise<string|undefined>, write(key, value): Promise<void> }`. The
canonical durable implementation is a **newest-row-wins** `app_settings` table (full change history,
`read` returns the latest row) — the SQL is in the `memory-store` adapter's header. `memoryStore` is
for dev/tests.

## Note on authorization

This block does not do authn/authz. Call `set` only behind your own super-admin (or equivalent)
check — the same way you'd gate any privileged mutation.

## Environment

None in the core — the env reader is injected. A real store adapter reads its own DB credentials.
