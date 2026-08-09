// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0090 D5 (interim wiring, supersedes ADR-0056 D7) — resolve the
 * app-declared default permission-set NAME from a stack's `permissions[]`.
 *
 * A permission set marked `isDefault` declares the app's suggested default
 * access posture. Until the built-in `everyone` position lands (ADR-0090 P2),
 * the CLI keeps using this name as the runtime fallback for users with no
 * explicit grants; P2 replaces the fallback mechanism with an install-time
 * suggestion bound to `everyone`.
 *
 * Returns the first `isDefault` set's `name`, or `undefined` when none is
 * declared (callers then keep the built-in `member_default` fallback).
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
