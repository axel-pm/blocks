// Types for the settings block: runtime, operator-editable configuration with an env override and a
// safe default. Pure core — the persistence store and the environment reader are injected, so this
// module touches neither a database nor process.env.

/** Turns a typed value to/from the string the store holds. */
export type Codec<T> = {
  parse: (raw: string) => T;
  serialize: (value: T) => string;
};

/** A typed setting descriptor. Precedence when resolved: env override → stored value → default. */
export type Setting<T> = {
  /** Store key. No env var name is derived from it — set `envVar` explicitly to enable an override. */
  key: string;
  /** The value used when nothing is stored, or when a stored/env value fails to parse or validate. */
  default: T;
  /** Env var whose presence overrides the stored value entirely. */
  envVar?: string;
  /** How the value is stored as a string. */
  codec: Codec<T>;
  /** Optional check; a value failing it is treated as invalid (→ falls back to default on read, throws on write). */
  validate?: (value: T) => boolean;
};

/** The persistence the settings resolver uses. YOU provide it (Postgres app_settings, KV, memory). */
export type SettingsStore = {
  /** Latest stored string for a key, or undefined if unset. */
  read: (key: string) => Promise<string | undefined>;
  /** Persist a key's string value (newest-row-wins or upsert). */
  write: (key: string, value: string) => Promise<void>;
};

/** Reads an env var by name. Injected so the core never touches process.env. */
export type EnvReader = (name: string) => string | undefined;

export type SettingsConfig = {
  store: SettingsStore;
  /** Injected env reader (e.g. `(n) => process.env[n]`). Without it, env overrides are ignored. */
  env?: EnvReader;
  /** In-memory cache window in ms. Default 15000. */
  cacheMs?: number;
  /** Called when a stored or env value fails to parse/validate and the default is used instead. */
  onError?: (key: string, source: 'env' | 'store', error: unknown) => void;
};
