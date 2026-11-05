// A registry is a set of targets keyed by id, plus the pure rule for choosing which one is
// active. The choosing rule is the safety net: an unknown, unconfigured, or (in production)
// not-enabled choice falls back to a known-safe default. This is fail-closed — a bad setting
// can never route inference somewhere the operator didn't vet.
//
// Nothing here reads the environment. The caller passes the chosen id (from a setting or env)
// and a `hasKey` probe (from an injected secret reader); this module decides.

import type { Target } from './types';

export type Registry<Role extends string> = {
  /** All targets, keyed by id. Null-prototype, so a key like "constructor" or "__proto__" can't match. */
  targets: Record<string, Target<Role>>;
  /** The id to fall back to: validated to be an enabled gateway target. */
  defaultId: string;
  /** The resolved default target — kept so the fail-closed path never does an unchecked lookup. */
  fallback: Target<Role>;
};

/**
 * Build a registry from a list of targets and the id of the safe default.
 *
 * The default MUST be an `enabled` gateway target: the fail-closed path lands on it whenever a
 * choice is rejected, so it has to be something always reachable (platform-authenticated) and
 * vetted. Throws otherwise. Also throws on a duplicate id, so a later target can't silently
 * shadow an earlier one.
 */
export function defineRegistry<Role extends string>(
  targets: Target<Role>[],
  defaultId: string,
): Registry<Role> {
  // Null prototype: lookups can never resolve inherited members (Object.prototype.constructor, …).
  const byId = Object.create(null) as Record<string, Target<Role>>;
  for (const t of targets) {
    if (Object.hasOwn(byId, t.id)) throw new Error(`defineRegistry: duplicate target id "${t.id}"`);
    byId[t.id] = t;
  }
  const fallback = Object.hasOwn(byId, defaultId) ? byId[defaultId] : undefined;
  if (!fallback) {
    throw new Error(`defineRegistry: defaultId "${defaultId}" is not among the targets`);
  }
  if (!(fallback.mode === 'gateway' && fallback.enabled)) {
    throw new Error(
      `defineRegistry: the default target "${defaultId}" must be an enabled gateway target ` +
        `(the fail-closed fallback must always be reachable and vetted)`,
    );
  }
  return { targets: byId, defaultId, fallback };
}

/**
 * True when a target is usable: a gateway (authenticated by the platform), or an off-gateway
 * target whose key is present. A non-gateway target MUST name a non-empty `apiKeyEnv` — an
 * off-gateway target with no key env is treated as unconfigured, never as "no auth needed".
 */
export function isConfigured<Role extends string>(
  t: Target<Role>,
  hasKey: (envName: string) => boolean,
): boolean {
  if (t.mode === 'gateway') return true;
  return t.apiKeyEnv !== '' && hasKey(t.apiKeyEnv);
}

/** Safe lookup against a (possibly plain-object) registry map: own keys only, never the prototype. */
function targetById<Role extends string>(registry: Registry<Role>, id: string): Target<Role> | undefined {
  return Object.hasOwn(registry.targets, id) ? registry.targets[id] : undefined;
}

/**
 * Choose the effective target, fail-closed. Returns the chosen target only when it exists, is
 * configured, and — in production — is `enabled`. Otherwise returns the registry default.
 *
 * @param chosenId   the operator's choice (from a setting or env), or undefined
 * @param registry   the registry
 * @param opts.isProd        whether this is production (gates `enabled`)
 * @param opts.hasKey        probe for a present secret, from an injected reader (see SecretReader)
 */
export function pickEffectiveTarget<Role extends string>(
  chosenId: string | undefined,
  registry: Registry<Role>,
  opts: { isProd: boolean; hasKey: (envName: string) => boolean },
): Target<Role> {
  const fallback = registry.fallback;
  if (!chosenId) return fallback;
  const chosen = targetById(registry, chosenId);
  if (!chosen) return fallback; // unknown id (or a prototype key)
  if (!isConfigured(chosen, opts.hasKey)) return fallback; // no key
  if (opts.isProd && !chosen.enabled) return fallback; // not vetted for prod
  return chosen;
}

/** The chosen target, or undefined if it's unknown — own-keys-only, for an adapter that validates a save. */
export function lookupTarget<Role extends string>(registry: Registry<Role>, id: string): Target<Role> | undefined {
  return targetById(registry, id);
}
