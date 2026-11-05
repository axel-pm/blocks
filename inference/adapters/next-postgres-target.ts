// OPTIONAL adapter. Copy this only if you want the active inference target to be chosen at
// runtime from a database setting (super-admin-editable in an admin page), with an env
// override, a short in-memory cache, and the fail-closed downgrade from the core.
//
// This is where the environment lives: it reads process.env and queries a table. It depends on
// the core (./registry, ./types) and on whatever query function you pass. It makes no
// assumptions about your DB client — you hand it a `readSetting`/`writeSetting` pair.
//
// Pattern: newest-row-wins settings table, a few seconds of cache, env override takes precedence
// over the stored value, and the chosen id is run through pickEffectiveTarget so an unknown /
// key-less / not-enabled-in-prod choice can never actually route inference.

import { isConfigured, lookupTarget, pickEffectiveTarget, type Registry } from '../src/registry';
import type { SecretReader, Target } from '../src/types';

export type TargetSelectorConfig<Role extends string> = {
  registry: Registry<Role>;
  /** Reads the stored target id (e.g. newest `app_settings` row for this key). Returns undefined if unset. */
  readSetting: () => Promise<string | undefined>;
  /** Persists a chosen target id. Called by saveTarget after validation. */
  writeSetting: (id: string) => Promise<void>;
  /**
   * The SAME secret reader you give the resolver, so "is this target configured?" here agrees
   * with "can the resolver get the key?" there. Defaults to process.env — override for a vault.
   */
  secrets?: SecretReader;
  /** Env var name that overrides the stored setting entirely. Default 'INFERENCE_TARGET'. */
  envVar?: string;
  /** Cache window in ms. Default 15000. */
  cacheMs?: number;
  /**
   * How the adapter learns it's production. Default: production UNLESS NODE_ENV is explicitly
   * 'development' or 'test'. Fail-closed — an unset NODE_ENV is treated as production, so the
   * `enabled` gate on unvetted targets can't be switched off by a missing env var.
   */
  isProd?: () => boolean;
};

export function createTargetSelector<Role extends string>(config: TargetSelectorConfig<Role>) {
  const secrets = config.secrets ?? ((name: string) => process.env[name]);
  const envVar = config.envVar ?? 'INFERENCE_TARGET';
  const cacheMs = config.cacheMs ?? 15_000;
  const isProd = config.isProd ?? (() => !['development', 'test'].includes(process.env.NODE_ENV ?? ''));
  const hasKey = (envName: string) => !!secrets(envName);

  let cache: { id: string | undefined; at: number } | null = null;

  /** The operator's raw choice: env override if set, else the cached/stored setting. */
  async function chosenId(): Promise<string | undefined> {
    const override = process.env[envVar];
    if (override) return override;
    if (cache && Date.now() - cache.at < cacheMs) return cache.id;
    const id = await config.readSetting();
    cache = { id, at: Date.now() };
    return id;
  }

  /** The target that actually serves a request, after the fail-closed downgrade. */
  async function effectiveTarget(): Promise<Target<Role>> {
    return pickEffectiveTarget(await chosenId(), config.registry, { isProd: isProd(), hasKey });
  }

  /**
   * Validate and persist a chosen id. Refuses an unknown id, an unconfigured one, or (in prod)
   * one that isn't enabled — the same three checks pickEffectiveTarget applies — so the stored
   * value is always something the core would honour. Call requireSuperAdmin() yourself first.
   */
  async function saveTarget(id: string): Promise<void> {
    const t = lookupTarget(config.registry, id);
    if (!t) throw new Error(`unknown inference target: ${id}`);
    if (!isConfigured(t, hasKey)) throw new Error(`inference target ${id} is not configured (missing ${t.apiKeyEnv})`);
    if (isProd() && !t.enabled) throw new Error(`inference target ${id} is not enabled in production`);
    await config.writeSetting(id);
    cache = null; // invalidate so the change is live within the request, not the cache window
  }

  return { chosenId, effectiveTarget, saveTarget };
}
