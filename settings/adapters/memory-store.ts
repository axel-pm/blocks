// OPTIONAL adapter. An in-memory SettingsStore for dev and tests. For production, back it with a
// durable store. The canonical pattern (from the nke assistant) is a newest-row-wins table:
//
//   CREATE TABLE app_settings (
//     id         bigserial PRIMARY KEY,
//     key        text NOT NULL,
//     value      text NOT NULL,          -- the serialized setting
//     updated_by text,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   -- read:  SELECT value FROM app_settings WHERE key = $1 ORDER BY created_at DESC LIMIT 1;
//   -- write: INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3);
//
// Newest-row-wins keeps a full history (who changed what, when) while `read` returns the latest.

import type { SettingsStore } from '../src/types';

/** In-memory SettingsStore (last write wins). Reference/dev only. */
export function memoryStore(initial: Record<string, string> = {}): SettingsStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    async read(key) {
      return data.get(key);
    },
    async write(key, value) {
      data.set(key, value);
    },
  };
}
