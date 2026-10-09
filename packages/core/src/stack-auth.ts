// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readEnvWithDeprecation } from '@objectstack/types';

/**
 * The ONE rule that decides whether a boot composes the platform's auth family
 * — `AuthPlugin` and, paired with it, the security plugin — for a stack that
 * does not mount `AuthPlugin` itself. Read by `os serve` (`@objectstack/cli`,
 * its "5d. Auto-register AuthPlugin (and paired Security/Audit)" step) and by
 * `os migrate security-catalog-overlays`, which composes what `serve` composes
 * for the first phase.
 *
 * ## Why this lives in `@objectstack/core`
 *
 * The auth gate decides which permission-set names a deployment's packages hold
 * at boot: the security plugin declares its shipped sets (`member_default`,
 * `admin_full_access` and the rest) on its own manifest in `init()`, and it is
 * composed only behind this gate. The cold-boot check refuses an environment
 * row over a package-held name, so the offline step that lists those rows must
 * answer the gate exactly as `serve` does — measured on #22371: one database
 * and one config were refused on 3 names with `OS_AUTH_SECRET` set and on 2
 * without it. Maintainer ruling letter B on #22371 (record 6074838935): the
 * step composes the deployment "by `serve`'s own rules (the configuration's
 * plugins, the application or the compiled artifact, the security plugin under
 * `serve`'s auth gating)". So the gate is one declaration with two readers, in
 * the package both already depend on — the reason `stack-plugins.ts` and
 * `capability-providers.ts` give for their own home. ⛔ Never a second copy of
 * it beside a reader.
 *
 * ## The rule
 *
 * The tiers first ({@link resolveStackTiers}): the stack's declared `tiers`
 * when it declares any, otherwise the preset's; plus the tier every `requires`
 * token opens ({@link CAPABILITY_TO_TIER}). Then the gate
 * ({@link resolvePlatformAuthComposition}), in `serve`'s order:
 *
 *  1. the stack mounts `AuthPlugin` itself → the platform composes none;
 *  2. the `auth` tier is off → none;
 *  3. the composition is a host kernel (`ObjectOSEnvironmentPlugin`, the cloud
 *     runtime: auth belongs to each per-project kernel there) → none;
 *  4. no auth secret ({@link resolveAuthSecret}: `OS_AUTH_SECRET`, its two legacy
 *     spellings, or the development fallback) → none;
 *  5. otherwise the platform composes `AuthPlugin`, and the security plugin
 *     beside it.
 *
 * What each boot does with the answer stays with that boot: `serve` constructs
 * `AuthPlugin` with its origins, providers and cookies, and warns on 3 and 4;
 * the offline step composes the security plugin for its declarations alone.
 *
 * Pure apart from {@link resolveAuthSecret}'s environment read: importing this
 * module loads nothing.
 */

/** The tier presets `os serve --preset` names. `default` is the fallback for an unknown name. */
export const STACK_TIER_PRESETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  minimal: Object.freeze(['core']),
  default: Object.freeze(['core', 'i18n', 'ui', 'ai', 'auth']),
  full: Object.freeze(['core', 'i18n', 'ui', 'ai', 'auth']),
});

/**
 * The `requires` tokens that open a tier when listed. A token not in this map
 * (`automation`, `analytics`, `audit` …) bypasses tier gating: its provider is
 * loaded by the capability resolver ({@link CAPABILITY_PROVIDERS}) instead.
 */
export const CAPABILITY_TO_TIER: Readonly<Record<string, string>> = Object.freeze({
  ai: 'ai',
  // `ai-studio` (AI-driven authoring) rides on the base AI service, so
  // requiring it opens the same `ai` tier (#1597).
  'ai-studio': 'ai',
  i18n: 'i18n',
  ui: 'ui',
  auth: 'auth',
});

/**
 * The tiers a boot enables. Precedence: the stack's declared `tiers` when it
 * declares any, otherwise the named preset's (`default` for an unknown or
 * absent name); every `requires` token that maps to a tier adds it.
 */
export function resolveStackTiers(input: {
  readonly declaredTiers: readonly string[];
  readonly requires: readonly string[];
  readonly preset?: string;
}): Set<string> {
  const presetTiers = STACK_TIER_PRESETS[input.preset ?? 'default'] ?? STACK_TIER_PRESETS.default;
  const baseTiers = input.declaredTiers.length > 0 ? input.declaredTiers : presetTiers;
  const requiredTiers = input.requires
    .map((token) => CAPABILITY_TO_TIER[token])
    .filter((tier): tier is string => typeof tier === 'string');
  return new Set([...baseTiers, ...requiredTiers]);
}

/** Does the stack mount `AuthPlugin` itself? By registered name or class name, as `serve` has always asked. */
export function stackSuppliesAuthPlugin(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const plugin = p as { name?: unknown; constructor?: { name?: unknown } } | null | undefined;
    return plugin?.name === 'com.objectstack.auth' || plugin?.constructor?.name === 'AuthPlugin';
  });
}

/**
 * Is this composition a host kernel — the cloud runtime's routing shell, marked
 * by `ObjectOSEnvironmentPlugin`? `OS_CLOUD_URL` alone is not the signal: a
 * regular app may set it for the marketplace proxy and still want its own auth.
 */
export function isHostKernelComposition(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const plugin = p as { name?: unknown; constructor?: { name?: unknown } } | null | undefined;
    return plugin?.name === 'com.objectstack.runtime.objectos-environment'
      || plugin?.constructor?.name === 'ObjectOSEnvironmentPlugin';
  });
}

/**
 * The auth secret a development boot falls back to, so trying the login flow
 * locally does not need `OS_AUTH_SECRET`. Never used outside development.
 */
export const DEV_AUTH_SECRET_FALLBACK = 'dev-only-insecure-secret-change-me-in-production';

/**
 * The auth secret this boot runs with: `OS_AUTH_SECRET`, else its legacy
 * spellings `AUTH_SECRET` / `BETTER_AUTH_SECRET` (read silently), else — in
 * development only — {@link DEV_AUTH_SECRET_FALLBACK}; `undefined` when none.
 */
export function resolveAuthSecret(input: { readonly isDev: boolean }): string | undefined {
  return readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'], { silent: true })
    ?? (input.isDev ? DEV_AUTH_SECRET_FALLBACK : undefined);
}

/** Why a boot composes no platform auth family. */
export type PlatformAuthSkipReason =
  /** The stack mounts `AuthPlugin` in its own `plugins`. */
  | 'stack-supplies-auth'
  /** The `auth` tier is not enabled. */
  | 'auth-tier-off'
  /** A host kernel: auth is owned per project there. */
  | 'host-kernel'
  /** No auth secret, and not a development boot. */
  | 'no-secret';

/** The gate's answer: compose the platform auth family (with the secret it runs on), or why not. */
export type PlatformAuthComposition =
  | { readonly composes: true; readonly secret: string }
  | { readonly composes: false; readonly reason: PlatformAuthSkipReason };

/**
 * Does this boot compose the platform auth family — `AuthPlugin`, and the
 * security plugin paired with it? The rule is this module's header; the checks
 * run in `serve`'s order, so the reason is the first one that holds.
 */
export function resolvePlatformAuthComposition(input: {
  /** The stack's own `plugins`, after the boot's merge with the standalone stack. */
  readonly plugins: readonly unknown[];
  /** The tiers the boot enabled ({@link resolveStackTiers}). */
  readonly tiers: ReadonlySet<string>;
  /** The secret the boot resolved ({@link resolveAuthSecret}). */
  readonly secret: string | undefined;
}): PlatformAuthComposition {
  if (stackSuppliesAuthPlugin(input.plugins)) return { composes: false, reason: 'stack-supplies-auth' };
  if (!input.tiers.has('auth')) return { composes: false, reason: 'auth-tier-off' };
  if (isHostKernelComposition(input.plugins)) return { composes: false, reason: 'host-kernel' };
  if (!input.secret) return { composes: false, reason: 'no-secret' };
  return { composes: true, secret: input.secret };
}
