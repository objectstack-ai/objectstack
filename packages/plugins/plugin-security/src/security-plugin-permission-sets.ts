// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 8] The permission-set resolution of `SecurityPlugin` for an
 * execution context, moved out of `security-plugin.ts`:
 *
 * - `resolvePermissionSetsForContextUnmemoized`, the resolution itself: the
 *   permission sets the context names, the additive human baseline or the
 *   agent's restricted ceiling, and the post-resolution fallback for an
 *   authenticated caller whose sets resolved nothing.
 * - `reportUngrantedNamesakeSets`, the once-per-name warning for a permission
 *   set that shares a held position's name and is NOT granted through it,
 *   because the position's definition does not name it (#13419, #24757).
 * - `permissionSetMemoKey`, the fields of the context the per-context memo is
 *   keyed on (#10757).
 *
 * A MOVE, not a redesign, when it landed. Each function below is the body of
 * the `SecurityPlugin` method of the same name. #24757 then retired the
 * position-name fold here: no position name is requested as a permission-set
 * name any more, the folded-set ledger drop went with it, and the fold's
 * warning became the report of a namesake set that is not granted.
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
 * body reaches: the resolution still asks the plugin's catalog loader and its
 * namesake report, and the memo, the position catalog's description and every
 * other caller still reach these methods through the plugin. The async
 * methods return their function's promise.
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
 * `POSITION_NAME_FOLD_EVENT`, which the namesake report's docblock there names
 * in place, with a `{@link}`. Each is read only inside a function body, at call
 * time, never while either module evaluates, so the two-way import is safe
 * under ESM, and the published bundle holds one module. The event name is
 * still not exported from the package: `index.ts` exports only
 * `SecurityPlugin`.
 *
 * The imports only these bodies read moved here: the agent's restricted set
 * from `@objectstack/spec/ai`. `PermissionSet` is imported from
 * `@objectstack/spec/security`, as `security-plugin.ts` imports it.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isGuestEnvelope, POSITION_NAME_FOLD_EVENT } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';
import { humanBaselineFor } from './external-baseline.js';

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
  reportUngrantedNamesakeSets: SecurityPlugin['reportUngrantedNamesakeSets'];
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
  this: Pick<PermissionSetsHost, 'baselinePermissionSets' | 'bootstrapPermissionSets' | 'dbLoaderForContext' | 'logger' | 'metadata' | 'permissionEvaluator' | 'reportUngrantedNamesakeSets'>,
  context: any,
): Promise<PermissionSet[]> {
  // [ADR-0138 D3] The GUEST requests exactly the sets its envelope carries —
  // the `guest` anchor's bindings, which `resolveAuthzContext` resolved in
  // the organization D4 derived — and they are treated as any requested set
  // below. The baseline does not reach it (applied only to a caller with a
  // user id, below), and `everyone` is never among its positions; its anchor
  // is not even judged for a namesake set.
  const isGuest = isGuestEnvelope(context);
  const positions = isGuest ? [] : (context?.positions ?? []);
  // [ADR-0131 D3/D4; #13419 ruling B, retired by #24757] The request is the
  // permission-set NAMES the context carries and nothing else: the sets each
  // held position's definition names in `permissionSets` (§6b of
  // `resolveUserAuthzGrants` pushes them as names) and the directly assigned
  // ones. A held position's NAME is not a permission-set name — the binding is
  // written, not inferred — so a set that merely shares it is not requested.
  const explicitPermissionSets = context?.permissions ?? [];
  const requested = [...explicitPermissionSets];
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
  // One helper names it, so the explainer and the describe fallback attribute
  // and resolve the same baseline (`external-baseline.ts`).
  const baseline: string[] = isAgent
    ? [MCP_AGENT_PERMISSION_SET_RESTRICTED]
    : humanBaselineFor(positions, this.baselinePermissionSets);
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
  // A baseline name joins the request, so a position sharing it is granted
  // that set anyway and is not reported below.
  if (!isAgent && context?.userId) {
    for (const name of baseline) {
      if (!requested.includes(name)) requested.push(name);
    }
  }
  let permissionSets = await this.permissionEvaluator.resolvePermissionSets(
    requested,
    this.metadata,
    this.bootstrapPermissionSets,
    this.dbLoaderForContext(context),
    { logger: this.logger },
  );
  // [#13419 执行要点 5] The retirement is LOUD: a held position whose namesake
  // set exists, and is not granted, is reported — never granted, never silent.
  await this.reportUngrantedNamesakeSets(positions, requested, context);
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

/** The body of `SecurityPlugin#reportUngrantedNamesakeSets`; the method's docblock there is its contract. */
export async function reportUngrantedNamesakeSets(
  this: Pick<PermissionSetsHost, 'bootstrapPermissionSets' | 'dbLoaderForContext' | 'logger' | 'metadata' | 'nameFoldWarned' | 'permissionEvaluator'>,
  positions: unknown,
  requested: readonly string[],
  context: any,
): Promise<void> {
  if (!Array.isArray(positions) || positions.length === 0) return;
  const candidates = [...new Set(positions)].filter(
    (n): n is string => typeof n === 'string' && n !== '' && !requested.includes(n) && !this.nameFoldWarned.has(n),
  );
  if (candidates.length === 0) return;
  // The same three sources the resolution reads, asked only whether a set of
  // each name exists. What comes back is never granted.
  const namesakes = await this.permissionEvaluator.resolvePermissionSets(
    candidates,
    this.metadata,
    this.bootstrapPermissionSets,
    this.dbLoaderForContext(context),
    { logger: this.logger },
  );
  for (const set of namesakes) {
    const position = (set as any)?.name;
    if (typeof position !== 'string' || !candidates.includes(position)) continue;
    if (this.nameFoldWarned.has(position)) continue;
    this.nameFoldWarned.add(position);
    // ⛔ No tracker id in the STRING — an operator reading this log has no tracker, no
    // git log and no ADR to resolve `#NNNN` against (`check:doc-authoring`; maintainer
    // ruling 2026-08-12). The card anchor lives in the docblock above, where the reader
    // who can resolve it is already looking.
    this.logger.warn?.(
      `[security] ${POSITION_NAME_FOLD_EVENT}: permission set '${position}' shares its name ` +
        `with position '${position}', but holders of position '${position}' are NOT granted it. ` +
        `A position grants only the permission sets its definition names in permissionSets, ` +
        `and the definition of position '${position}' does not name '${position}'; a shared ` +
        `name grants nothing. To grant it, declare it (position '${position}': permissionSets: ` +
        `['${position}']); if the shared name is a coincidence, rename one of the two.`,
      {
        event: POSITION_NAME_FOLD_EVENT,
        position,
        permissionSet: position,
        // The consequence as data, for a consumer that keys on fields rather
        // than prose. The three fields above are unchanged on purpose.
        granted: false,
      },
    );
  }
}
