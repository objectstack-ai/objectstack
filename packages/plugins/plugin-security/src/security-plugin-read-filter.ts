// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 9] The row-level read scope of `SecurityPlugin`, moved out of
 * `security-plugin.ts`:
 *
 * - `getReadFilter`, the scope the `security` service serves to the doors that
 *   compile their own statement: the same three layers the engine middleware
 *   ANDs into every find (tenant Layer 0 and RLS, the controlled-by-parent
 *   leaf, the sharing filter), the deny sentinel for a caller who resolves no
 *   set or carries no principal, and fail-closed on any resolution failure.
 * - `computeDelegatedReadFilter`, the same scope for an on-behalf-of caller:
 *   the intersection of the principal's leg and the delegator's, layer for
 *   layer, refused where the middleware's prologue refuses the delegator
 *   (#25106).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same layers in the same order, the same deny
 * sentinel by identity, the same warnings.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 8 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps both methods — the published
 * `dist/*.d.ts` lists each one's name, docblock and position, and
 * `getReadFilter` is public — and each body is one literal of exactly the
 * {@link ReadFilterHost} members that method reads, plus a `.call`. A method
 * is handed over as a closure that calls it on the plugin at call time, so a
 * test double or spy set on the plugin is still the one the body reaches: the
 * scope still asks the plugin's RLS filter, controlled-by-parent leaf, sharing
 * filter, set resolution and posture, and the service binding, the middleware
 * and every other caller still reach both methods through the plugin. Both
 * methods were async and both functions still are; each method now returns
 * its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `logger`, `permissionEvaluator`, `ql` and `tenancyPosture` are not declared
 * `readonly` (`start()` assigns three of them after construction, and tests
 * replace `permissionEvaluator` on a constructed plugin), so they go as
 * GETTERS, and each read happens when the body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `isPrincipalLessContext` stays there: ADR-0138 anchors it in that file, and
 * the docblocks that stay there, `getReadFilter`'s among them, link to it in
 * place. It is exported (cut 6) and imported here by value, as the prologue's
 * and the object admission's modules import it. It is read only inside a
 * function body, at call time,
 * never while either module evaluates, so the two-way import is safe under
 * ESM, and the published bundle holds one module. The deny sentinel is
 * imported from `rls-compiler.js`, the layer composition from
 * `tenant-layer.js`, and the delegator's resolution, its organization check
 * and the sharing-depth intersection from `explain-engine.js`, as
 * `security-plugin.ts` imports them.
 *
 * The system-context page anchors the scope's elevation read on this module's
 * `getReadFilter`, which is where the read now sits.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isPrincipalLessContext } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import { andComposeLayers } from './tenant-layer.js';
import { delegatedOrganizationRefusal, intersectDelegatedScope, resolveDelegatorContext } from './explain-engine.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface ReadFilterHost {
  readonly logger: SecurityPlugin['logger'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  computeControlledByParentFilter: SecurityPlugin['computeControlledByParentFilter'];
  computeDelegatedReadFilter: SecurityPlugin['computeDelegatedReadFilter'];
  computeRlsFilter: SecurityPlugin['computeRlsFilter'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
  resolveSharingReadFilter: SecurityPlugin['resolveSharingReadFilter'];
}

/** The body of `SecurityPlugin#getReadFilter`; the method's docblock there is its contract. */
export async function getReadFilter(
  this: Pick<ReadFilterHost, 'computeControlledByParentFilter' | 'computeDelegatedReadFilter' | 'computeRlsFilter' | 'logger' | 'resolvePermissionSetsForContext' | 'resolveSharingReadFilter'>,
  object: string,
  context?: any,
): Promise<Record<string, unknown> | undefined> {
  // System operations bypass scoping (mirrors the middleware's isSystem skip).
  if (context?.isSystem) return undefined;
  // [#21908] ADR-0096 D5 strict mode — the middleware's principal-less
  // refusal, mirrored: zero rows, read off the same predicate, before any
  // layer resolves. This used to answer the sharing predicate alone.
  if (isPrincipalLessContext(context)) return RLS_DENY_FILTER;
  // [ADR-0090 D10 / ADR-0139 D5.1 as amended] A DELEGATED (on-behalf-of)
  // context is scoped to the intersection of its own leg and its delegator's,
  // composed as the engine middleware chain composes a delegated find
  // ({@link computeDelegatedReadFilter}). This path used to answer the deny
  // sentinel for every such context, because the intersection was threaded
  // through the chain only; the engine's `ReadableIds` composition asks this
  // method with the delegated context as it stands, so the intersection
  // reaches here now. Fails CLOSED on every throw: a delegated read is never
  // scoped wider than its delegator's own, and never served with a layer
  // dropped.
  if (context?.onBehalfOf?.userId) {
    try {
      return await this.computeDelegatedReadFilter(object, context);
    } catch (e) {
      this.logger.error?.(
        `[security] getReadFilter failed for object '${object}' (principal ${context?.userId ?? 'unknown'} ` +
          `on behalf of ${context.onBehalfOf.userId}) — denying (fail-closed)`,
        e instanceof Error ? e : new Error(String(e)),
      );
      return RLS_DENY_FILTER;
    }
  }
  // [#4467] The OWD/sharing predicate is resolved for EVERY non-system caller,
  // ahead of the RLS branches below, because it is a SEPARATE middleware in
  // the chain this method mirrors: none of the RLS stand-downs below is a
  // reason to drop it. A resolution failure denies outright — running the
  // analytics raw-SQL path with a dropped owner predicate is the leak.
  let sharingFilter: Record<string, unknown> | null;
  try {
    sharingFilter = await this.resolveSharingReadFilter(object, context);
  } catch (e) {
    this.logger.error?.(
      `[security] getReadFilter could not resolve the sharing (OWD) read scope for object ` +
        `'${object}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed: a path that bypasses ` +
        `the engine middleware never runs without the owner and share scope a direct read applies)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return RLS_DENY_FILTER;
  }
  try {
    const permissionSets = await this.resolvePermissionSetsForContext(context);
    // [#21079] ADR-0056 D2 — the deny baseline at the row scope. A caller who
    // carries a principal (a principal-less one was refused above) and
    // resolves NO permission set is refused at the middleware's object
    // admission, so the scope that agrees with it is zero rows. Composed
    // from the layers instead, it was the sharing predicate alone — every
    // row of an object whose sharing model is not private. Not a failure,
    // so nothing is logged.
    if (permissionSets.length === 0) return RLS_DENY_FILTER;
    const filter = await this.computeRlsFilter(permissionSets, object, 'find', context);
    // [#5815] ADR-0055 — the SECOND thing the middleware ANDs into `ast.where`
    // for a read: the leaf over the master, the same answer the middleware
    // writes for a find. It stands down (null) for any object that is not
    // controlled_by_parent, and it is internally fail-closed (the deny
    // sentinel for an unresolvable relation, `$in: []` for a chain the
    // registry walk refuses); a THROW propagates to the catch below, which
    // denies — the same posture as the surrounding layers.
    const cbpFilter = this.computeControlledByParentFilter(object, 'find', context);
    // [#4467] RLS AND controlled-by-parent AND sharing — the same
    // AND-composition the middlewares achieve by all writing into `ast.where`.
    // Any layer may be absent; `andComposeLayers` returns the others, or null
    // when none constrains.
    return andComposeLayers(andComposeLayers(filter, cbpFilter), sharingFilter) ?? undefined;
  } catch (e) {
    // Fail CLOSED — a resolution failure must deny (zero rows), never expose
    // every tenant's data through the raw-SQL analytics path.
    this.logger.error?.(
      `[security] getReadFilter failed for object '${object}' ` +
        `(user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return RLS_DENY_FILTER;
  }
}

/** The body of `SecurityPlugin#computeDelegatedReadFilter`; the method's docblock there is its contract. */
export async function computeDelegatedReadFilter(
  this: Pick<ReadFilterHost, 'computeControlledByParentFilter' | 'computeRlsFilter' | 'getObjectSecurityMeta' | 'logger' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'resolveSharingReadFilter' | 'tenancyPosture'>,
  object: string,
  context: any,
): Promise<Record<string, unknown> | undefined> {
  const permissionSets = await this.resolvePermissionSetsForContext(context);
  if (permissionSets.length === 0) return RLS_DENY_FILTER;
  const del = await resolveDelegatorContext(this.ql, context);
  if (del.kind !== 'resolved') {
    this.logger.error?.(
      `[security] getReadFilter received an on-behalf-of context for object '${object}' whose delegator ` +
        `'${String(context?.onBehalfOf?.userId)}' does not exist — denying (fail-closed: a delegated read is ` +
        `never scoped wider than its delegator's own) — with no delegator to intersect against it is not ` +
        `scoped at all (ADR-0090 D10)`,
    );
    return RLS_DENY_FILTER;
  }
  const delegatorContext = del.context;
  // [#25106 · ADR-0090 D10] The prologue's organization-membership refusal
  // (`resolveOperationPrincipals`), mirrored at the same point: after the
  // dangling-delegator refusal, before the delegator's sets resolve. On a
  // walled posture the find path refuses every operation of a delegated
  // context whose live active organization the delegator's own membership
  // does not back, so the scope that agrees with it is zero rows, on every
  // object. [#25107] The prologue's own ask ({@link delegatedOrganizationRefusal}),
  // with the inputs it passes; under `single` the claim stands, and a context
  // with no active organization is not this rule's (ADR-0123 D2).
  if (delegatedOrganizationRefusal(context, delegatorContext, this.tenancyPosture) !== undefined) {
    this.logger.warn?.(
      `[security] getReadFilter received an on-behalf-of context for object '${object}' whose delegator is not a ` +
        `member of the organization it runs in — denying, as the operation prologue refuses it (ADR-0090 D10, fail-closed)`,
    );
    return RLS_DENY_FILTER;
  }
  const delegatorSets = await this.resolvePermissionSetsForContext(delegatorContext);
  if (delegatorSets.length === 0) return RLS_DENY_FILTER;

  // Step 2.6's two depth stamps, from the same two evaluator calls.
  const meta = await this.getObjectSecurityMeta(object);
  const delegatorScope = this.permissionEvaluator.getEffectiveScope('read', object, delegatorSets, { isPrivate: meta.isPrivate });
  const declared = this.permissionEvaluator.getDeclaredScope('read', object, permissionSets, { isPrivate: meta.isPrivate });
  const agentLegScope = intersectDelegatedScope(declared, delegatorScope).agentLegScope;

  // Layers 5 and 6 — the sibling middleware's two calls. Resolved first, as
  // the non-delegated path resolves its one sharing layer first: a sharing
  // outage denies before any RLS layer is composed.
  const sharingFilter = await this.resolveSharingReadFilter(object, context, permissionSets, agentLegScope);
  const delegatorSharingFilter = await this.resolveSharingReadFilter(
    object,
    { ...context, userId: delegatorContext.userId, onBehalfOf: undefined },
    delegatorSets,
    delegatorScope,
  );

  // Layers 1 to 4 — the security middleware's own four, in its order.
  const filter = await this.computeRlsFilter(permissionSets, object, 'find', context);
  const cbpFilter = this.computeControlledByParentFilter(object, 'find', context);
  const delFilter = await this.computeRlsFilter(delegatorSets, object, 'find', delegatorContext);
  const delCbpFilter = this.computeControlledByParentFilter(object, 'find', delegatorContext);

  const securityLayers = andComposeLayers(andComposeLayers(filter, cbpFilter), andComposeLayers(delFilter, delCbpFilter));
  const sharingLayers = andComposeLayers(sharingFilter, delegatorSharingFilter);
  return andComposeLayers(securityLayers, sharingLayers) ?? undefined;
}
