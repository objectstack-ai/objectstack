// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 10] The record-sharing verdicts of `SecurityPlugin`, moved out
 * of `security-plugin.ts`:
 *
 * - `resolveSharingReadFilter`, the owner/share half of the read scope,
 *   resolved through the late-bound `sharing` service with the read depth the
 *   middleware would stash, and THROWING on a resolution failure so its
 *   callers fail closed.
 * - `resolveSharingCanEdit`, the same service's gate for a single-record
 *   write, failing closed (`false`) when the probe throws.
 * - `resolveWriteScopeForSharing`, the write-depth stash both write probes
 *   hand the service, resolved for the probed object.
 * - `resolveSharingWriteVerdict`, the tri-state write verdict for a single
 *   row, `abstain` where nothing was consulted and `deny` where the probe
 *   throws.
 * - `resolvePreImageFloorDrop`, the by-id write pre-image gate's floor
 *   decision, which `security/explain` asks too.
 * - `delegatorOwnWriteFloorOptions`, the composition knobs the delegator's
 *   own direct by-id write would get.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same service methods asked in the same order,
 * the same fail-closed answers, the same errors logged.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 9 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all six private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link SharingVerdictsHost} members
 * that method reads, plus a `.call`. A method is handed over as a closure that
 * calls it on the plugin at call time, so a test double or spy set on the
 * plugin is still the one the body reaches: the verdicts still ask the
 * plugin's set resolution, posture reader and RLS policy collection, and
 * each other through the plugin, and every caller still reaches the six
 * methods through the plugin. All six methods were async and all six
 * functions still are; each method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `logger`, `permissionEvaluator` and `resolveKernelService` are not declared
 * `readonly` (`start()` assigns two of them after construction, and tests
 * replace `permissionEvaluator` on a constructed plugin), so they go as
 * GETTERS, and each read happens when the body makes it. The logger and the
 * evaluator are objects whose own methods the bodies call, so no receiver
 * changes. `resolveKernelService` is a function-valued field the bodies call
 * through the host, so its receiver is the host and no longer the plugin; the
 * one function ever assigned to it is the arrow function `start()` assigns,
 * which reads no `this`, so each call answers as it did.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * The options interface `RlsFilterOptions` keeps its one declaration there,
 * where the RLS filter and every gate read it; this module names it through
 * the class's own signature (below). `PermissionSet` is imported from
 * `@objectstack/spec/security`, the write verdict type from
 * `@objectstack/spec/contracts`, and the platform-ownership floor predicate
 * from `platform-ownership-policies.js`, as `security-plugin.ts` imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import type { SharingWriteVerdict } from '@objectstack/spec/contracts';
import type { PermissionSet } from '@objectstack/spec/security';
import type { SecurityPlugin } from './security-plugin.js';
import { isPlatformOwnershipFloorPolicy } from './platform-ownership-policies.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SharingVerdictsHost {
  readonly logger: SecurityPlugin['logger'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly resolveKernelService: SecurityPlugin['resolveKernelService'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
  resolvePreImageFloorDrop: SecurityPlugin['resolvePreImageFloorDrop'];
  resolveSharingWriteVerdict: SecurityPlugin['resolveSharingWriteVerdict'];
  resolveWriteScopeForSharing: SecurityPlugin['resolveWriteScopeForSharing'];
}

/**
 * The layered computation's options, as the class declares them: the
 * `RlsFilterOptions` interface stays in `security-plugin.ts`, and the moved
 * bodies name it exactly as they did.
 */
type RlsFilterOptions = NonNullable<Parameters<SecurityPlugin['computeLayeredRlsFilter']>[4]>;

/** The body of `SecurityPlugin#resolveSharingReadFilter`; the method's docblock there is its contract. */
export async function resolveSharingReadFilter(
  this: Pick<SharingVerdictsHost, 'getObjectSecurityMeta' | 'permissionEvaluator' | 'resolveKernelService' | 'resolvePermissionSetsForContext'>,
  object: string,
  context: any,
  resolvedSets?: PermissionSet[],
  /**
   * [ADR-0090 D10] The depth to stamp instead of the one `getEffectiveScope`
   * answers for `resolvedSets` — what step 2.6 stamps on a DELEGATED read,
   * where the agent leg carries the intersected depth and the delegator leg
   * its own ({@link computeDelegatedReadFilter}). Absent on every
   * non-delegated call, which resolves the depth here as before.
   */
  depth?: string,
): Promise<Record<string, unknown> | null> {
  const sharing = this.resolveKernelService?.('sharing') as
    | { buildReadFilter?: (o: string, c: any) => Promise<unknown | null> }
    | undefined;
  if (!sharing || typeof sharing.buildReadFilter !== 'function') return null;
  // Mirror the middleware's ADR-0057 D1 depth stash. `getEffectiveScope`
  // needs the resolved sets and the object's posture — the same two inputs
  // the middleware feeds it — so the owner-match widens identically here.
  // [#5386] `resolvedSets` lets an in-middleware caller (the
  // controlled_by_parent derivation) pass the sets it already resolved for
  // THIS identity, instead of re-resolving them from the context.
  let readScope: string | undefined = depth;
  if (readScope === undefined) {
    try {
      const permissionSets = resolvedSets ?? (await this.resolvePermissionSetsForContext(context));
      if (permissionSets.length > 0) {
        const meta = await this.getObjectSecurityMeta(object);
        readScope = this.permissionEvaluator.getEffectiveScope(
          'read',
          object,
          permissionSets,
          { isPrivate: meta.isPrivate },
        );
      }
    } catch {
      // Depth is a WIDENING input: failing to resolve it leaves the owner-match
      // at its narrowest ('own'), which is the safe direction. The sharing call
      // below still runs — and its own failure still denies.
      readScope = undefined;
    }
  }
  const filter = await sharing.buildReadFilter(object, {
    ...context,
    ...(readScope ? { __readScope: readScope } : {}),
  });
  return (filter ?? null) as Record<string, unknown> | null;
}

/** The body of `SecurityPlugin#resolveSharingCanEdit`; the method's docblock there is its contract. */
export async function resolveSharingCanEdit(
  this: Pick<SharingVerdictsHost, 'logger' | 'resolveKernelService' | 'resolveWriteScopeForSharing'>,
  object: string,
  recordId: string,
  context: any,
  resolvedSets?: PermissionSet[],
): Promise<boolean> {
  const sharing = this.resolveKernelService?.('sharing') as
    | { canEdit?: (o: string, id: string, c: any) => Promise<boolean> }
    | undefined;
  if (!sharing || typeof sharing.canEdit !== 'function') return true;
  const writeScope = await this.resolveWriteScopeForSharing(object, context, resolvedSets);
  try {
    return (
      (await sharing.canEdit(object, recordId, { ...context, __writeScope: writeScope })) === true
    );
  } catch (e) {
    this.logger.error?.(
      `[security] controlled_by_parent write gate could not resolve the sharing (OWD) edit ` +
        `check for '${object}' record '${recordId}' (user ${context?.userId ?? 'unknown'}) — ` +
        `denying (fail-closed: a child is writable only where its master is, so a master check that ` +
        `cannot be resolved refuses)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return false;
  }
}

/** The body of `SecurityPlugin#resolveWriteScopeForSharing`; the method's docblock there is its contract. */
export async function resolveWriteScopeForSharing(
  this: Pick<SharingVerdictsHost, 'getObjectSecurityMeta' | 'permissionEvaluator' | 'resolvePermissionSetsForContext'>,
  object: string,
  context: any,
  resolvedSets?: PermissionSet[],
): Promise<string | undefined> {
  try {
    const permissionSets = resolvedSets ?? (await this.resolvePermissionSetsForContext(context));
    if (permissionSets.length === 0) return undefined;
    const meta = await this.getObjectSecurityMeta(object);
    return this.permissionEvaluator.getEffectiveScope(
      'write',
      object,
      permissionSets,
      { isPrivate: meta.isPrivate },
    );
  } catch {
    return undefined;
  }
}

/** The body of `SecurityPlugin#resolveSharingWriteVerdict`; the method's docblock there is its contract. */
export async function resolveSharingWriteVerdict(
  this: Pick<SharingVerdictsHost, 'logger' | 'resolveKernelService' | 'resolveWriteScopeForSharing'>,
  rlsOperation: string,
  object: string,
  recordId: string,
  context: any,
  resolvedSets?: PermissionSet[],
): Promise<SharingWriteVerdict> {
  const method = rlsOperation === 'delete' ? 'checkDelete' : 'checkEdit';
  const sharing = this.resolveKernelService?.('sharing') as
    | Record<string, ((o: string, id: string, c: any) => Promise<SharingWriteVerdict>) | undefined>
    | undefined;
  const probe = sharing?.[method];
  if (typeof probe !== 'function') return 'abstain';
  const writeScope = await this.resolveWriteScopeForSharing(object, context, resolvedSets);
  try {
    const verdict = await probe.call(sharing, object, recordId, {
      ...context,
      __writeScope: writeScope,
    });
    return verdict === 'allow' || verdict === 'deny' ? verdict : 'abstain';
  } catch (e) {
    this.logger.error?.(
      `[security] the row-level write gate could not resolve the sharing (${method}) verdict ` +
        `for '${object}' record '${recordId}' (user ${context?.userId ?? 'unknown'}) — keeping ` +
        `the platform ownership floor (fail-closed: only a resolved sharing allow, from Modify All Data ` +
        `or an edit-level share, may replace that floor)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return 'deny';
  }
}

/** The body of `SecurityPlugin#resolvePreImageFloorDrop`; the method's docblock there is its contract. */
export async function resolvePreImageFloorDrop(
  this: Pick<SharingVerdictsHost, 'collectRLSPolicies' | 'resolveSharingWriteVerdict'>,
  rlsOperation: string,
  object: string,
  recordId: string,
  context: any,
  permissionSets: PermissionSet[],
  delegated: boolean,
): Promise<boolean> {
  if (delegated) return false;
  const floorApplies = this.collectRLSPolicies(
    permissionSets,
    object,
    rlsOperation,
    (context?.positions ?? []) as string[],
    context,
  ).some(isPlatformOwnershipFloorPolicy);
  if (!floorApplies) return false;
  return (
    (await this.resolveSharingWriteVerdict(rlsOperation, object, recordId, context, permissionSets)) ===
    'allow'
  );
}

/** The body of `SecurityPlugin#delegatorOwnWriteFloorOptions`; the method's docblock there is its contract. */
export async function delegatorOwnWriteFloorOptions(
  this: Pick<SharingVerdictsHost, 'resolvePreImageFloorDrop'>,
  rlsOperation: string,
  object: string,
  recordId: string,
  delegatorContext: any,
  delegatorSets: PermissionSet[],
  masterGateCoversThisWrite: boolean,
): Promise<RlsFilterOptions> {
  const dropPlatformOwnershipFloor = await this.resolvePreImageFloorDrop(
    rlsOperation,
    object,
    recordId,
    delegatorContext,
    delegatorSets,
    false,
  );
  return { dropPlatformOwnershipFloor, masterGateCoversThisWrite };
}
