// Runtime settings: resolve a typed value from an env override, a persisted store value, or a safe
// default — in that order — behind a short in-memory cache. Fail-safe: a stored/env value that won't
// parse or validate, and a store that is briefly down, both fall back to the default on the read
// path (never throw); writes are strict and round-trip-checked so the store never holds a value a
// read would reject.

import { jsonCodec } from './codec';
import type { Codec, EnvReader, Setting, SettingsConfig } from './types';

/** Build a typed Setting. Defaults the codec to JSON. */
export function defineSetting<T>(cfg: Omit<Setting<T>, 'codec'> & { codec?: Codec<T> }): Setting<T> {
  return { codec: jsonCodec<T>(), ...cfg };
}

export type Settings = {
  get: <T>(setting: Setting<T>) => Promise<T>;
  set: <T>(setting: Setting<T>, value: T) => Promise<void>;
  /** Drop cached values: one key, or all when omitted. */
  invalidate: (key?: string) => void;
};

export function createSettings(config: SettingsConfig): Settings {
  const cacheMs = config.cacheMs ?? 15_000;
  const env: EnvReader = config.env ?? (() => undefined);
  const cache = new Map<string, { value: unknown; at: number }>();
  const owners = new Map<string, Setting<unknown>>(); // key → the one Setting allowed to use it
  let generation = 0; // bumped on set/invalidate; a concurrent read won't cache across a bump

  /** A throwing onError must never break get/set. */
  const report = (key: string, source: 'env' | 'store', error: unknown) => {
    try {
      config.onError?.(key, source, error);
    } catch {
      /* ignore a misbehaving reporter */
    }
  };

  /** Guard against two different Setting objects sharing one key (their cache entries would collide). */
  function claimKey<T>(setting: Setting<T>): void {
    const existing = owners.get(setting.key);
    if (existing && existing !== (setting as unknown as Setting<unknown>)) {
      throw new Error(`settings: key "${setting.key}" is already used by a different Setting object`);
    }
    if (!existing) owners.set(setting.key, setting as unknown as Setting<unknown>);
  }

  /** Parse + validate a raw string into T, or throw. Without an explicit validate, enforce that the
   *  decoded value's primitive type matches the default's (so e.g. a string stored where a number is
   *  expected is rejected rather than silently returned). */
  function decode<T>(setting: Setting<T>, raw: string): T {
    const value = setting.codec.parse(raw);
    if (setting.validate) {
      if (!setting.validate(value)) throw new Error(`settings: value for "${setting.key}" failed validation`);
    } else if (!defaultTypeMatches(setting.default, value)) {
      throw new Error(`settings: value for "${setting.key}" has the wrong type (expected ${describe(setting.default)})`);
    }
    return value;
  }

  async function get<T>(setting: Setting<T>): Promise<T> {
    claimKey(setting);

    // 1. Env override (bypasses the cache). Empty string = unset. An invalid override is ignored and
    //    we fall through to the stored value/default, rather than jumping straight to the default.
    if (setting.envVar) {
      let raw: string | undefined;
      try {
        raw = env(setting.envVar);
      } catch (e) {
        report(setting.key, 'env', e); // a throwing env reader must not break the read path
        raw = undefined;
      }
      if (raw !== undefined && raw !== '') {
        try {
          return decode(setting, raw);
        } catch (e) {
          report(setting.key, 'env', e);
        }
      }
    }

    // 2. Cache.
    const hit = cache.get(setting.key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value as T;

    // 3. Store, else default. A read error or a bad stored value both fall back to default (fail-safe).
    const gen = generation;
    let value = setting.default;
    let cacheable = true;
    try {
      const raw = await config.store.read(setting.key);
      if (raw !== undefined) value = decode(setting, raw);
    } catch (e) {
      report(setting.key, 'store', e);
      cacheable = false; // don't cache a value derived from a transient store failure
    }
    // Only cache if no set/invalidate happened during the read (else we'd cache a stale value).
    if (cacheable && gen === generation) cache.set(setting.key, { value, at: Date.now() });
    return value;
  }

  async function set<T>(setting: Setting<T>, value: T): Promise<void> {
    claimKey(setting);
    if (setting.validate && !setting.validate(value)) throw new Error(`settings: refusing to store an invalid value for "${setting.key}"`);
    const raw = setting.codec.serialize(value);
    if (typeof raw !== 'string') throw new Error(`settings: codec for "${setting.key}" did not serialize to a string`);
    decode(setting, raw); // round-trip: never persist something a later read would reject
    generation++;
    cache.delete(setting.key);
    try {
      await config.store.write(setting.key, raw);
    } finally {
      // Bump again after the write settles: a get() that started during the write (reading the OLD
      // stored value) must not be allowed to cache it — this second bump invalidates that race.
      generation++;
      cache.delete(setting.key);
    }
  }

  function invalidate(key?: string): void {
    generation++;
    if (key === undefined) cache.clear();
    else cache.delete(key);
  }

  return { get, set, invalidate };
}

/** True when `value` is a usable instance of the same primitive kind as `def` (the no-explicit-validate guard). */
function defaultTypeMatches(def: unknown, value: unknown): boolean {
  if (def === null || def === undefined) return true; // caller opted out of a type guard
  if (value === null || value === undefined) return false;
  if (Array.isArray(def)) return Array.isArray(value);
  if (typeof def === 'object') return typeof value === 'object' && !Array.isArray(value); // object default rejects arrays
  return typeof value === typeof def;
}

function describe(def: unknown): string {
  return def === null ? 'null' : Array.isArray(def) ? 'array' : typeof def;
}
