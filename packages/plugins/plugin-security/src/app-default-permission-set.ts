// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D5, #7555] The PLATFORM's own human baseline permission set.
 *
 * Every authenticated human principal resolves this set in addition to whatever
 * else they hold. It is the platform floor: read on the better-auth identity
 * tables and self-service on the caller's own preference rows — the grants that
 * keep `/auth/me`, the org switcher and the built-in Account app working for a
 * member who holds no application profile at all. A platform app's platform
 * object belongs here (maintainer ruling, 2026-08-11).
 */
export const PLATFORM_BASELINE_PERMISSION_SET = 'member_default';

/**
 * [#7555] The human baseline as the LIST of set names it actually is: the
 * app/deployment-declared baseline COMPOSED WITH the platform baseline — never
 * one displacing the other.
 *
 * ADR-0090 D5 rules the baseline additive without exception ("The fallback
 * cliff is abolished. … `everyone` is additive like any other position:
 * baseline ∪ explicit, always"), and narrows `isDefault` to "a package-authored
 * *suggestion* consumed once at install time … never a runtime fallback". The
 * interim wiring below (`appSecurityPluginOptions`) nevertheless funnels an
 * app's `isDefault` set into a SINGLE `fallbackPermissionSet` name, so
 * declaring one silently REPLACED `member_default` for every member of that
 * app. That is the D5 cliff in its other spelling — an app-authoring decision
 * costing members the entire platform floor — and #7555 measured what it does:
 * on the showcase, all 10 built-in Account nav entries are served and 7/7 of
 * the objects behind them answer 403, because the declared set names no `sys_*`
 * object and `member_default` was no longer in force.
 *
 * The composition is safe by construction in one direction only, which is the
 * direction that matters: the evaluator merges sets most-permissively, so
 * adding the platform baseline back can only ADD grants for human principals.
 * It is deliberately NOT a way to widen anything else —
 *
 *   • `null` still means "no baseline at all" and composes to `[]`. That is the
 *     one escape hatch, and it is all-or-nothing on purpose: a deployment that
 *     wants a floor NARROWER than the platform's states it by unbinding
 *     `member_default` from the `everyone` anchor (the D5 end state), not by
 *     naming a different set here.
 *   • AGENT principals never reach this list at all — ADR-0090 D10 gives them a
 *     restricted CEILING, not a human floor, and `resolvePermissionSetsForContext`
 *     branches before it is consulted.
 *
 * Order is app-set-first, platform-second, and load-bearing only for the
 * explain surface's reading order; the merge itself is order-independent.
 */
export function composeHumanBaselinePermissionSets(
  configured: string | null | undefined,
): string[] {
  if (!configured) return [];
  return configured === PLATFORM_BASELINE_PERMISSION_SET
    ? [PLATFORM_BASELINE_PERMISSION_SET]
    : [configured, PLATFORM_BASELINE_PERMISSION_SET];
}

/**
 * ADR-0090 D5 (interim wiring, supersedes ADR-0056 D7) — resolve the
 * app-declared default permission-set NAME from a stack's `permissions[]`.
 *
 * A permission set marked `isDefault` declares the app's suggested default
 * access posture. Until the built-in `everyone` position lands (ADR-0090 P2),
 * the CLI keeps using this name as the app's runtime baseline — composed with
 * the platform baseline, never replacing it (see
 * {@link composeHumanBaselinePermissionSets}, #7555); P2 replaces the mechanism
 * with an install-time suggestion bound to `everyone`.
 *
 * Returns the first `isDefault` set's `name`, or `undefined` when none is
 * declared (callers then run on the platform baseline alone).
 */
export function appDefaultPermissionSetName(permissions: unknown): string | undefined {
  if (!Array.isArray(permissions)) return undefined;
  for (const p of permissions) {
    if (p && typeof p === 'object') {
      const ps = p as { name?: unknown; isDefault?: unknown };
      if (ps.isDefault === true && typeof ps.name === 'string' && ps.name.length > 0) {
        return ps.name;
      }
    }
  }
  return undefined;
}

/**
 * [#7001] The `SecurityPlugin` options a stack config implies — ONE resolution
 * for EVERY boot path.
 *
 * `appDefaultPermissionSetName` above answers "which profile did the app
 * declare"; this answers the question every booter actually has: "what do I
 * hand the `SecurityPlugin` constructor for this config". The difference
 * sounds cosmetic and is not — the second half (`name ? { fallbackPermissionSet:
 * name } : undefined`) is a decision, not a formatting choice, and while it was
 * open-coded at the one call site that had it, the other boot path simply never
 * grew one:
 *
 *   • `objectstack serve` honoured an app's `isDefault` profile.
 *   • `@objectstack/verify`'s `bootStack` constructed a vanilla
 *     `new SecurityPlugin()` and never read `config.permissions`.
 *
 * So an app could declare a profile, ship it to users through the CLI, and have
 * every one of its own tests run against a boot that did not include it. That
 * stayed invisible until #5491 removed `member_default`'s `'*'` wildcard: before
 * it, the floor underneath granted everything anyway, so the fallback was never
 * load-bearing. #5491's Migration section prescribes shipping an `isDefault`
 * profile — a prescription `bootStack` had no way to express.
 *
 * Returning `undefined` (rather than `{ fallbackPermissionSet: undefined }`) is
 * deliberate: it lets the constructor apply its OWN derivation from the
 * built-in sets, which is not the same thing as being told "no fallback". Pass
 * the result straight through — `new SecurityPlugin(appSecurityPluginOptions(config))`
 * — and a caller cannot get the undefined case subtly wrong.
 *
 * Reads `config.permissions`, top-level, exactly as `serve.ts` always has.
 * Being cleverer here (also looking inside `manifest`) would re-open the gap it
 * closes, in the other direction.
 */
export function appSecurityPluginOptions(
  config: unknown,
): { fallbackPermissionSet: string } | undefined {
  const permissions = (config as { permissions?: unknown } | null | undefined)?.permissions;
  const name = appDefaultPermissionSetName(permissions);
  return name ? { fallbackPermissionSet: name } : undefined;
}
