// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Environment-variable helpers shared across `@objectstack/*` packages.
 *
 * The framework standardises on `OS_*` prefixed env vars (see AGENTS.md
 * "Environment Variables" section). Some historical names predate this
 * convention — `AUTH_SECRET`, `ROOT_DOMAIN`, `OBJECTSTACK_*`, …
 *
 * To migrate without breaking user `.env` files mid-release, call
 * {@link readEnvWithDeprecation} at every legacy read site:
 *
 *   const v = readEnvWithDeprecation('OS_AUTH_SECRET', 'AUTH_SECRET');
 *
 * If only the legacy name is set, the value is still returned but a
 * one-shot `console.warn` fires (per-process per-variable) telling
 * operators to rename it.
 */

const _warnedKeys = new Set<string>();

/**
 * Read an env var, preferring the canonical `OS_*` name and falling
 * back to one or more legacy aliases.
 *
 * When only a legacy alias is set, emits a one-shot deprecation warning.
 * The warning is process-wide deduplicated: identical (preferred, legacy)
 * pairs will only warn once even if read from multiple call sites.
 *
 * Legacy aliases are checked in order; the first one with a defined
 * value wins (and triggers the warning for that specific alias).
 *
 * Safe to call from environments where `process` is unavailable (returns
 * `undefined`); the warning is suppressed when running outside Node-like
 * runtimes that lack `console.warn`.
 *
 * @param preferred  Canonical OS_*-prefixed env var name.
 * @param legacy     Older name (or array of older names) to fall back on.
 * @param options    Optional behaviour flags. Set `silent: true` for aliases
 *                   that remain accepted conventions rather than true legacy
 *                   names — e.g. `PORT`, which PaaS platforms (Render, Railway,
 *                   Heroku, Fly, …) inject automatically. Warning on those
 *                   would nag operators about env they never set.
 * @returns The resolved value, or `undefined` if neither is set.
 */
export function readEnvWithDeprecation(
  preferred: string,
  legacy: string | readonly string[],
  options?: { silent?: boolean },
): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (!env) return undefined;

  const preferredValue = env[preferred];
  if (preferredValue !== undefined) return preferredValue;

  const legacyList = typeof legacy === 'string' ? [legacy] : legacy;
  for (const legacyName of legacyList) {
    const legacyValue = env[legacyName];
    if (legacyValue !== undefined) {
      const dedupeKey = `${preferred}|${legacyName}`;
      if (!options?.silent && !_warnedKeys.has(dedupeKey)) {
        _warnedKeys.add(dedupeKey);
        const consoleRef = (globalThis as { console?: { warn?: (msg: string) => void } }).console;
        try {
          consoleRef?.warn?.(
            `[ObjectStack] Env var \`${legacyName}\` is deprecated; rename it to \`${preferred}\`. ` +
            `The legacy name still works for now but will be removed in a future major release.`,
          );
        } catch {
          /* `console.warn` unavailable (exotic runtime) — ignore */
        }
      }
      return legacyValue;
    }
  }

  return undefined;
}

/**
 * Resolve whether the deployment runs in multi-org (a.k.a. multi-tenant) mode.
 *
 * Single source of truth for the `OS_MULTI_ORG_ENABLED` flag. Resolution: the
 * canonical `OS_MULTI_ORG_ENABLED` wins; else the deprecated `OS_MULTI_TENANT`
 * (which fires the one-shot rename warning via {@link readEnvWithDeprecation});
 * else `false`. Any value other than a case-insensitive `'false'` enables it.
 *
 * Every site that needs to know "is this multi-org?" — the SQL driver's
 * tenant-audit gate, the auth manager's `/auth/config` feature flag and
 * org-create guard, the CLI / dev / runtime org-scoping plugin wiring — MUST
 * call this instead of re-reading the env, so the driver, the security layer,
 * and the UI can never disagree about the mode. Previously each site inlined
 * its own `String(... ?? 'false').toLowerCase() !== 'false'` (and the SQL
 * driver read `process.env` directly, skipping the deprecation warning).
 *
 * Reads `process.env` live on each call; memoise at the call site if the
 * result must be stable for the process lifetime.
 */
export function resolveMultiOrgEnabled(): boolean {
  const raw = readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT');
  return String(raw ?? 'false').toLowerCase() !== 'false';
}

/**
 * Maximum number of organizations a single user may CREATE, from `OS_ORG_LIMIT`.
 * The auth plugin forwards this as better-auth's `organizationLimit` in function
 * form, counting only the caller's `role=owner` memberships — so it caps
 * self-created orgs (each of which can auto-provision a free environment on the
 * cloud control plane) without penalising a user invited into many orgs.
 *
 * Only meaningful when multi-org is enabled ({@link resolveMultiOrgEnabled}).
 * Returns `undefined` when unset or non-positive → no limit (better-auth treats
 * an absent `organizationLimit` as unlimited), preserving self-host behaviour.
 * Deployments that let users self-create orgs SHOULD set a generous cap.
 */
export function resolveOrgLimit(): number | undefined {
  const raw = readEnvWithDeprecation('OS_ORG_LIMIT', [], { silent: true });
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Internal: clear the dedupe set. Test-only; exposed so suite-wide
 * deprecation warnings don't bleed between tests.
 *
 * @internal
 */
export function _resetEnvDeprecationWarnings(): void {
  _warnedKeys.clear();
}
