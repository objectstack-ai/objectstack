// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveArtifactPackageOrder } from '@objectstack/core';

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
 * [ADR-0130 D4, #15007] Every permission set a stack config DECLARES — from the
 * flattened top level, and from `packages[]`.
 *
 * ## What this exists to stop
 *
 * A multi-package artifact carries each definition twice today: flattened onto
 * the top level, and again inside `packages[i]`. Option B (the ADR-0130 D4
 * ruling on #14512) removes the flattened copy, so `packages[]` carries it
 * once. A reader that only ever looked at the top level does not fail when that
 * happens — it reads `undefined`, finds no `isDefault` set, and answers "the app
 * declared no default profile".
 *
 * For THIS reader that silence has a security posture attached. The name it
 * resolves becomes the `SecurityPlugin`'s `fallbackPermissionSet`, i.e. the
 * app's half of every authenticated human's additive baseline
 * ({@link composeHumanBaselinePermissionSets}). Losing it does not deny the
 * boot and does not log: the deployment simply runs on the platform floor
 * alone, and every member of a multi-package app quietly holds less than the
 * app declared they should. #7555 measured what that looks like from the
 * outside — nav entries served, 403 behind them — and could only measure it
 * because someone went looking.
 *
 * ## Top level FIRST, `packages[]` second — and why that order is the contract
 *
 * The reader half of the program lands while the artifact is still ADDITIVE, so
 * this function has to be a superset of the old read rather than a replacement
 * for it: for every artifact the platform emits today the flattened level
 * answers first and this returns exactly what it returned before. The
 * `packages[]` pass only supplies a set where the top level had none — which is
 * precisely the option-B artifact. That is what makes this card revertible on
 * its own and safe to land before the emitter half (#14512).
 *
 * ## The order is `resolveArtifactPackageOrder`'s, not the array's
 *
 * `appDefaultPermissionSetName` resolves the FIRST `isDefault` set, so with more
 * than one package declaring one, "first" has to mean the same thing here as it
 * does everywhere else the artifact is read. `resolveArtifactPackageOrder`
 * (`@objectstack/core`, ADR-0130 D4+D5, #14643) is the ONE place that turns an
 * artifact into its ordered package list — dependency-topological, so a package
 * that extends another is read after it regardless of which array slot it
 * occupies. ⛔ Do not iterate `config.packages` directly here; a second
 * traversal is a second ordering, and the depended-upon package would win or
 * lose by authoring accident.
 *
 * ## Two things it deliberately does NOT do
 *
 *   • It does not look inside the SINGULAR `manifest`. That constraint is
 *     #7001's and it still holds — the harness must not honour a declaration
 *     `serve.ts` ignores. Note this is not a special case bolted on: an
 *     artifact carrying no `packages` key makes `resolveArtifactPackageOrder`
 *     return the caller's own object as the single package body (D4's second
 *     branch, D7's compatibility term), so that branch reads `permissions` from
 *     exactly where the old code read it and nowhere else.
 *   • It does not catch `resolveArtifactPackageOrder`'s refusals. A malformed
 *     `packages` (not an array, an unwrapped entry, a duplicate package id)
 *     raises an ADR-0112 envelope here, the same one the manifest service
 *     raises when it registers that artifact moments later. Swallowing it would
 *     resolve a permission surface out of an artifact the loader refuses to
 *     load — the gate travels with the read.
 */
function declaredPermissionSets(config: unknown): unknown[] {
  const sets: unknown[] = [];

  const flattened = (config as { permissions?: unknown } | null | undefined)?.permissions;
  if (Array.isArray(flattened)) sets.push(...flattened);

  const packages = (config as { packages?: unknown } | null | undefined)?.packages;
  if (packages === undefined || packages === null) return sets;

  for (const body of resolveArtifactPackageOrder(config)) {
    const declared = (body as { permissions?: unknown } | null | undefined)?.permissions;
    if (Array.isArray(declared)) sets.push(...declared);
  }
  return sets;
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
 * Reads the sets through {@link declaredPermissionSets} — the flattened top
 * level `serve.ts` has always read, and, for a multi-package artifact, the
 * `packages[]` bodies that carry the same declaration under ADR-0130 D4.
 */
export function appSecurityPluginOptions(
  config: unknown,
): { fallbackPermissionSet: string } | undefined {
  const name = appDefaultPermissionSetName(declaredPermissionSets(config));
  return name ? { fallbackPermissionSet: name } : undefined;
}
