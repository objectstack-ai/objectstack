// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 8] The permission-set resolution of `SecurityPlugin` for an
 * execution context, moved out of `security-plugin.ts`:
 *
 * - `resolvePermissionSetsForContextUnmemoized`, the resolution itself: the
 *   positions folded into the request (never the guest's), the additive human
 *   baseline or the agent's restricted ceiling, and the post-resolution
 *   fallback for an authenticated caller whose positions resolved nothing.
 * - `dropDeactivatedFoldedSets`, the activation ledger's say over a set that
 *   reached the resolution only through a position of the same name.
 * - `reportNameFoldCollisions`, the once-per-name warning for a grant that
 *   exists only because a position and a permission set share a name
 *   (#13419, #24757).
 * - `permissionSetMemoKey`, the fields of the context the per-context memo is
 *   keyed on (#10757).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same request, in the same order, the same
 * baseline and fallback rules, the same ledger read, the same warning text and
 * structured payload, once per name, and the same memo key.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 7 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all four private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link PermissionSetsHost} members
 * that method reads, plus a `.call`. `permissionSetMemoKey` reads no member,
 * so its method calls its function directly, as cut 1's `extractTargetField`
 * does. A method is handed over as a closure that calls it on the plugin at
 * call time, so a test double or spy set on the plugin is still the one the
 * body reaches: the resolution still asks the plugin's catalog loader, its
 * folded-set drop and its fold report, and the memo, the position catalog's
 * description and every other caller still reach these methods through the
 * plugin. Two of the methods were async and their functions still are; each
 * of those methods now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `baselinePermissionSets`, `bootstrapPermissionSets` and `nameFoldWarned` are
 * declared `readonly` and go by value, so the bodies read the plugin's own
 * lists and its own warned set. `logger`, `metadata`, `permissionEvaluator`
 * and `ql` are not declared `readonly` (`start()` assigns three of them after
 * construction, and tests replace `permissionEvaluator` on a constructed
 * plugin), so they go as GETTERS, and each read happens when the body makes
 * it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * Four members of the same family stay in the class whole.
 *
 * - `getEffectiveObjectPermissions` and `resolveFallbackPermissionSets`: each
 *   body is no longer than its stub would be.
 * - `resolvePermissionSetsForContext`, the memo: its body retires a rejected
 *   entry with `permissionSetMemo.delete(…)`. The tenant-audit census places
 *   that call by its receiver's declared type, a `WeakMap` the class
 *   constructs. Read through a host, the receiver has no type the census can
 *   read, and the census asks for a row in its untyped-receiver ledger, which
 *   is shrink-only.
 * - `describePositionGrants`: its body asks the read admission
 *   `canReadObject`, and `row-serving-door-exposure.pin.test.ts` in
 *   `@objectstack/core` classifies every non-test source file that calls it,
 *   so moving that body would make this module a caller the pin has no
 *   classification for.
 *
 * Two module-level values these bodies read stay there too, and are exported
 * and imported here by value: `isGuestEnvelope`, which the middleware's
 * owner-write step reads as well (cut 6 exported it), and
 * `POSITION_NAME_FOLD_EVENT`, which the fold report's docblock there names in
 * place, with a `{@link}`. Each is read only inside a function body, at call
 * time, never while either module evaluates, so the two-way import is safe
 * under ESM, and the published bundle holds one module. The event name is
 * still not exported from the package: `index.ts` exports only
 * `SecurityPlugin`.
 *
 * The imports only these bodies read moved here: the agent's restricted set
 * from `@objectstack/spec/ai`, and the activation ledger's reader from
 * `@objectstack/core`. `PermissionSet` is imported from
 * `@objectstack/spec/security`, as `security-plugin.ts` imports it.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isGuestEnvelope, POSITION_NAME_FOLD_EVENT } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';
import { readDisabledCatalogNames } from '@objectstack/core';
import { BUILTIN_IDENTITY_ORG_EXTERNAL } from '@objectstack/spec';
import { EXTERNAL_DEFAULT_PERMISSION_SET } from './objects/default-permission-sets.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface PermissionSetsHost {
  readonly baselinePermissionSets: SecurityPlugin['baselinePermissionSets'];
  readonly bootstrapPermissionSets: SecurityPlugin['bootstrapPermissionSets'];
  readonly logger: SecurityPlugin['logger'];
  readonly metadata: SecurityPlugin['metadata'];
  readonly nameFoldWarned: SecurityPlugin['nameFoldWarned'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  dbLoaderForContext: SecurityPlugin['dbLoaderForContext'];
  dropDeactivatedFoldedSets: SecurityPlugin['dropDeactivatedFoldedSets'];
  reportNameFoldCollisions: SecurityPlugin['reportNameFoldCollisions'];
}

/** The body of `SecurityPlugin#permissionSetMemoKey`; the method's docblock there is its contract. */
export function permissionSetMemoKey(
  context: any,
): string {
  const positions = Array.isArray(context?.positions) ? context.positions : [];
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return JSON.stringify([
    positions,
    permissions,
    context?.principalKind ?? null,
    context?.userId ? 1 : 0,
  ]);
}

/** The body of `SecurityPlugin#resolvePermissionSetsForContextUnmemoized`; the method's docblock there is its contract. */
export async function resolvePermissionSetsForContextUnmemoized(
  this: Pick<PermissionSetsHost, 'baselinePermissionSets' | 'bootstrapPermissionSets' | 'dbLoaderForContext' | 'dropDeactivatedFoldedSets' | 'logger' | 'metadata' | 'permissionEvaluator' | 'reportNameFoldCollisions'>,
  context: any,
): Promise<PermissionSet[]> {
  // [ADR-0138 D3] The GUEST requests exactly the sets its envelope carries —
  // the `guest` anchor's bindings, which `resolveAuthzContext` resolved in
  // the organization D4 derived — and they are treated as any requested set
  // below. Its position is NOT folded into the request: the position-name
  // fold (#13419's ruling retires it) would hand an anonymous caller any set
  // that merely shares the anchor's name, the one channel D3 item 3 says
  // never reaches the guest. The baseline does not reach it either (applied
  // only to a caller with a user id, below), and `everyone` is never among
  // its positions.
  const isGuest = isGuestEnvelope(context);
  const positions = isGuest ? [] : (context?.positions ?? []);
  const explicitPermissionSets = context?.permissions ?? [];
  const requested = [...positions, ...explicitPermissionSets];
  // [ADR-0090 D10] An AGENT principal's grants are EXACTLY its scope-derived
  // ceiling set(s) — the additive human baseline (member_default) must NOT
  // apply, or its write bit would silently widen a read-only agent past the
  // scope the user consented to. The agent's floor is instead the restricted
  // (no-object-access) set, so an agent whose sets fail to resolve fails
  // CLOSED (every object op denied) rather than falling open. The delegating
  // user's own baseline still applies on the OTHER side of the intersection
  // (resolved from `onBehalfOf` via a context without this flag).
  const isAgent = context?.principalKind === 'agent';
  // [#7555] The human side is a LIST, and the agent side deliberately is not:
  // the agent's ceiling is EXACTLY the restricted set, and composing the
  // platform baseline into it is precisely the widening D10 forbids. The two
  // branches produce arrays only so the code below reads once.
  // [Ruling 6355206139, letter B, stage 1, E4] An EXTERNAL member (`org_external`,
  // projected from `sys_member.role = external` in the active organization) is
  // not handed the deployment's member baseline — `member_default`'s
  // fellow-member directory scope, an app's `isDefault` set — here any more
  // than through the `everyone` anchor it does not hold. Its floor is its own
  // anchor-safe set: its own identity rows, and data only through explicit grants.
  const baseline: string[] = isAgent
    ? [MCP_AGENT_PERMISSION_SET_RESTRICTED]
    : positions.includes(BUILTIN_IDENTITY_ORG_EXTERNAL)
      ? [EXTERNAL_DEFAULT_PERMISSION_SET]
      : this.baselinePermissionSets;
  // [ADR-0090 D5] Baseline is ADDITIVE, always (for humans): the baseline
  // set(s) apply to every authenticated request IN ADDITION to whatever else
  // resolved. The former "only when the user has nothing else" conditional
  // was the fallback CLIFF — receiving your first explicit grant silently
  // cost you the entire baseline. Agents skip this additive step (their
  // ceiling is closed, not floored) — see above.
  // [#7555] The same cliff had a second spelling the list closes: an app
  // declaring an `isDefault` set REPLACED `member_default` here, so every
  // member of that app lost the platform floor (and with it every built-in
  // Account destination) the moment the app declared a posture of its own.
  // [#13419] Recorded, not merely pushed: a name granted by the BASELINE is in
  // force whether or not the position-name fold exists, so it is not evidence
  // of the fold and must not be warned about below.
  const baselineApplied: string[] = [];
  if (!isAgent && context?.userId) {
    for (const name of baseline) {
      if (!requested.includes(name)) requested.push(name);
      baselineApplied.push(name);
    }
  }
  let permissionSets = await this.permissionEvaluator.resolvePermissionSets(
    requested,
    this.metadata,
    this.bootstrapPermissionSets,
    this.dbLoaderForContext(context),
    { logger: this.logger },
  );
  permissionSets = await this.dropDeactivatedFoldedSets(positions, explicitPermissionSets, baselineApplied, permissionSets);
  // [#13419 执行要点 3] Report — never alter — a grant that exists ONLY because
  // this method folded a POSITION name into the permission-set request above.
  this.reportNameFoldCollisions(positions, explicitPermissionSets, baselineApplied, permissionSets);
  // Post-resolution fallback — closes the fail-open hole where a populated
  // `positions` array maps to no permission set yet (no sys_position binding),
  // which would otherwise skip RLS entirely and expose every tenant's data.
  // For an agent, the fallback is the restricted set (deny all objects), NOT
  // the human baseline — a mis-resolved agent must never inherit member access.
  if (
    permissionSets.length === 0 &&
    context?.userId &&
    baseline.length > 0
  ) {
    permissionSets = await this.permissionEvaluator.resolvePermissionSets(
      baseline,
      this.metadata,
      this.bootstrapPermissionSets,
      this.dbLoaderForContext(context),
      { logger: this.logger },
    );
  }
  return permissionSets;
}

/** The body of `SecurityPlugin#dropDeactivatedFoldedSets`; the method's docblock there is its contract. */
export async function dropDeactivatedFoldedSets(
  this: Pick<PermissionSetsHost, 'ql'>,
  positions: unknown,
  explicitPermissionSets: unknown,
  baselineApplied: string[],
  resolved: PermissionSet[],
): Promise<PermissionSet[]> {
  if (!Array.isArray(positions) || positions.length === 0 || resolved.length === 0) return resolved;
  const judged = new Set<string>(baselineApplied);
  for (const n of Array.isArray(explicitPermissionSets) ? explicitPermissionSets : []) {
    if (typeof n === 'string') judged.add(n);
  }
  const resolvedNames = new Set(resolved.map((ps) => (ps as any)?.name).filter((n: unknown): n is string => typeof n === 'string'));
  const folded = positions.filter((n): n is string => typeof n === 'string' && resolvedNames.has(n) && !judged.has(n));
  if (folded.length === 0) return resolved;
  const disabled = await readDisabledCatalogNames(this.ql, [], [...new Set(folded)]);
  if (disabled.permissions.size === 0) return resolved;
  return resolved.filter((ps) => !disabled.permissions.has((ps as any)?.name));
}

/** The body of `SecurityPlugin#reportNameFoldCollisions`; the method's docblock there is its contract. */
export function reportNameFoldCollisions(
  this: Pick<PermissionSetsHost, 'logger' | 'nameFoldWarned'>,
  positions: unknown,
  explicitPermissionSets: unknown,
  baselineApplied: string[],
  resolved: PermissionSet[],
): void {
  if (!Array.isArray(positions) || positions.length === 0) return;
  const governed = new Set<string>(
    (Array.isArray(explicitPermissionSets) ? explicitPermissionSets : []).filter(
      (n): n is string => typeof n === 'string',
    ),
  );
  for (const name of baselineApplied) governed.add(name);
  const resolvedNames = new Set<string>(
    resolved.map((ps) => (ps as any)?.name).filter((n: unknown): n is string => typeof n === 'string'),
  );
  for (const position of positions) {
    if (typeof position !== 'string' || position.length === 0) continue;
    if (!resolvedNames.has(position)) continue;
    if (governed.has(position)) continue;
    if (this.nameFoldWarned.has(position)) continue;
    this.nameFoldWarned.add(position);
    // ⛔ No tracker id in the STRING — an operator reading this log has no tracker, no
    // git log and no ADR to resolve `#NNNN` against (`check:doc-authoring`; maintainer
    // ruling 2026-08-12). The card anchor lives in the docblock above, where the reader
    // who can resolve it is already looking.
    this.logger.warn?.(
      `[security] ${POSITION_NAME_FOLD_EVENT}: permission set '${position}' is in force for ` +
        `holders of position '${position}' only because the two share a name — the definition ` +
        `of position '${position}' does not name it in its permissionSets. This name-based ` +
        `grant is deprecated and is removed in the next major version: from then on, holders ` +
        `of position '${position}' do not receive permission set '${position}' unless the ` +
        `position's definition names it. To keep the grant, declare it (position ` +
        `'${position}': permissionSets: ['${position}']); if the shared name is a ` +
        `coincidence, rename one of the two.`,
      {
        event: POSITION_NAME_FOLD_EVENT,
        position,
        permissionSet: position,
        // The consequence as data, for a consumer that keys on fields rather
        // than prose. The three fields above are unchanged on purpose.
        removedIn: 'next_major',
      },
    );
  }
}
