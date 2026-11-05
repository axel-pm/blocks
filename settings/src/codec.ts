// Codecs turn a typed setting value to/from the string the store holds. JSON is the default;
// `stringCodec` is for plain-string settings; `enumCodec` restricts to a fixed set.

import type { Codec } from './types';

/** JSON codec (the default). Parse throws on malformed JSON — the resolver treats that as invalid. */
export function jsonCodec<T>(): Codec<T> {
  return { parse: (raw) => JSON.parse(raw) as T, serialize: (v) => JSON.stringify(v) };
}

/** Identity codec for string-valued settings. */
export const stringCodec: Codec<string> = { parse: (raw) => raw, serialize: (v) => v };

/** A codec that accepts only one of `values` (stored as the literal string). */
export function enumCodec<T extends string>(values: readonly T[]): Codec<T> {
  const set = new Set<string>(values);
  return {
    parse: (raw) => {
      if (!set.has(raw)) throw new Error(`settings: "${raw}" is not one of ${values.join(', ')}`);
      return raw as T;
    },
    serialize: (v) => v,
  };
}
