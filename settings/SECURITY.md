# settings — threat model

## Authorization is the caller's job

This block changes application behaviour at runtime, so `set` is a privileged operation. It does
**not** authenticate or authorize — call `set` only behind your own super-admin (or equivalent)
check, exactly as you would any privileged mutation. A setting that flips a security control (which
provider runs, whether a cap is on) is as sensitive as the control itself.

## Fail-safe by design

- **Reads never throw on bad data.** A stored or env value that won't parse or fails `validate` is
  dropped in favour of the setting's default, and surfaced via `onError`. This means a corrupted row
  or a fat-fingered env var degrades to the (safe) default rather than taking the app down — but it
  also means you should make each setting's `default` the safe choice, and watch `onError`.
- **Writes are strict.** `set` validates before persisting, so the store never holds a value `get`
  would reject. A value that passes `validate` but is still operationally risky is your
  responsibility to gate.

## Caching and propagation

- A change is visible immediately in the process that called `set` (its cache is invalidated) and
  within `cacheMs` elsewhere. **Across multiple instances**, each process has its own cache, so a
  change made on one instance reaches others only after their cache window expires (up to `cacheMs`).
  Don't rely on instant global propagation for a security-critical flip; use a short `cacheMs`, or
  invalidate out-of-band, if you need it.
- The env override always wins and bypasses the cache — use it as the break-glass override.

## What the store sees

Setting values are stored as plain strings (JSON by default). Don't put secrets (API keys, tokens)
in a setting — those belong in your secret manager / env, not in an operator-editable settings row
that may be world-readable to anyone with store access or shown in an admin UI. This block is for
configuration, not secrets.
