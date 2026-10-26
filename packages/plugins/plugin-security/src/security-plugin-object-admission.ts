// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 9] The object-level admissions of `SecurityPlugin`, moved out of
 * `security-plugin.ts`:
 *
 * - `canReadObject`, whether a context may read an object at all: the
 *   admission the read doors that bypass the engine middleware ask before
 *   they compile a statement of their own.
 * - `objectReadAdmission`, that admission's arms over permission sets the
 *   caller has already resolved: the posture, the capability AND-gate, the
 *   read grant, and the delegator's same questions.
 * - `canWriteObject`, the write admission the write preview asks (#18682), the
 *   sibling of `canReadObject`, with its arms in the middleware's own order.
 * - `canExport`, the user-level export axis a bulk-egress door asks before it
 *   reads (#3544).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same arms in the same order, the same system
 * and principal-less answers, the same fail-closed delegator legs, the same
 * warnings.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 8 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all four methods — the published
 * `dist/*.d.ts` lists each one's name, docblock and position, and three of
 * them are public — and each body is one literal of exactly the
 * {@link ObjectAdmissionHost} members that method reads, plus a `.call`. A
 * method is handed over as a closure that calls it on the plugin at call
 * time, so a test double or spy set on the plugin is still the one the body
 * reaches: the admissions still ask the plugin's set resolution, posture,
 * arms, organization wall and forbidden-field check, and the service binding,
 * the write preview and every other caller still reach these methods through
 * the plugin. All four methods were async and all four functions still are;
 * each method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `delegatedAdminGate`, `logger`, `permissionEvaluator`, `ql` and
 * `tenancyPosture` are not declared `readonly` (`start()` assigns four of them
 * after construction, and tests replace `permissionEvaluator` on a constructed
 * plugin), so they go as GETTERS, and each read happens when the body makes
 * it. The delegated-admin gate is an object whose own method the write
 * admission calls, so no receiver changes.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * Two module-level functions these bodies read stay there, exported, and are
 * imported here by value: `isPrincipalLessContext`, which ADR-0138 anchors in
 * that file (cut 6 exported it), and `requiredCapsForOperation`, which the
 * middleware and the explain path read too. Each is read only inside a
 * function body, at call time, never while either module evaluates, so the
 * two-way import is safe under ESM, and the published bundle holds one
 * module. `PermissionSet` is imported from `@objectstack/spec/security`,
 * `PermissionDeniedError` from `errors.js`, the engine-owned write guard from
 * `system-write-guard.js`, and the delegator's resolution and its
 * organization check from `explain-engine.js`, as `security-plugin.ts`
 * imports them.
 *
 * The system-context page anchors the three admissions' elevation reads on
 * this module's `canReadObject`, `canWriteObject` and `canExport`, which is
 * where the reads now sit.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import { isPrincipalLessContext, requiredCapsForOperation } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { PermissionDeniedError } from './errors.js';
import { assertEngineOwnedWriteAllowed } from './system-write-guard.js';
import { delegatedOrganizationRefusal, resolveDelegatorContext } from './explain-engine.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface ObjectAdmissionHost {
  readonly delegatedAdminGate: SecurityPlugin['delegatedAdminGate'];
  readonly logger: SecurityPlugin['logger'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  computeForbiddenFieldWrites: SecurityPlugin['computeForbiddenFieldWrites'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  objectReadAdmission: SecurityPlugin['objectReadAdmission'];
  organizationWallRefusal: SecurityPlugin['organizationWallRefusal'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/** The body of `SecurityPlugin#canReadObject`; the method's docblock there is its contract. */
export async function canReadObject(
  this: Pick<ObjectAdmissionHost, 'logger' | 'objectReadAdmission' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  object: string,
  context?: any,
): Promise<boolean> {
  const objectName = String(object ?? '');
  if (!objectName) return false;
  // 1. System operations bypass (mirrors the middleware's isSystem skip).
  if (context?.isSystem) return true;
  // 2. [#21908] ADR-0096 D5 strict mode — the middleware refuses a
  //    principal-less context before it resolves anything, so this does too.
  if (isPrincipalLessContext(context)) return false;

  try {
    const permissionSets = await this.resolvePermissionSetsForContext(context);
    //    [#21079] No sets resolved → the deny baseline (ADR-0056 D2): an
    //    empty list grants nothing, which is the middleware's step 2 answer.
    if (permissionSets.length === 0) return false;

    // [ADR-0090 D10] Resolve the delegator ONCE — arms 4 and 6 both need it,
    // and a dangling link denies before either runs. [#25107] So does a
    // delegator who is not a member of the organization the read runs in, on
    // a walled posture: the middleware's prologue refuses the read there
    // ({@link delegatedOrganizationRefusal}).
    let delegatorSets: PermissionSet[] | null = null;
    if (context?.onBehalfOf?.userId) {
      const del = await resolveDelegatorContext(this.ql, context);
      if (del.kind === 'missing') return false;
      if (del.kind === 'resolved') {
        if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) return false;
        delegatorSets = await this.resolvePermissionSetsForContext(del.context);
      }
    }

    // 3–6. The posture and grant arms, over the resolved sets — the one
    // predicate the ADR-0055 master-derived read scope asks as well.
    return await this.objectReadAdmission(objectName, permissionSets, delegatorSets);
  } catch (e) {
    this.logger.error?.(
      `[security] canReadObject could not resolve the object-level read admission for ` +
        `'${objectName}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return false;
  }
}

/** The body of `SecurityPlugin#objectReadAdmission`; the method's docblock there is its contract. */
export async function objectReadAdmission(
  this: Pick<ObjectAdmissionHost, 'getObjectSecurityMeta' | 'permissionEvaluator'>,
  objectName: string,
  permissionSets: PermissionSet[],
  delegatorSets: PermissionSet[] | null,
): Promise<boolean> {
  if (permissionSets.length === 0) return false;

  const { isPrivate, unresolved, requiredPermissions } =
    await this.getObjectSecurityMeta(objectName);
  // 3. [#3545] Posture unresolvable → deny.
  if (unresolved) return false;

  // 4. [ADR-0066 D3/⑤] The capability AND-gate, ahead of the grant, for both
  //    principals — a caller missing any required capability is denied
  //    however permissive their grants are.
  const required = requiredCapsForOperation(requiredPermissions, 'find');
  if (required.length > 0) {
    const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
    if (required.some((cap) => !held.has(cap))) return false;
    if (delegatorSets && delegatorSets.length > 0) {
      const delHeld = this.permissionEvaluator.getSystemPermissions(delegatorSets);
      if (required.some((cap) => !delHeld.has(cap))) return false;
    }
  }

  // 5. The object-level CRUD grant.
  if (!this.permissionEvaluator.checkObjectPermission('find', objectName, permissionSets, { isPrivate })) {
    return false;
  }

  // 6. [ADR-0090 D10] The delegator must independently grant the same read.
  if (
    delegatorSets &&
    !this.permissionEvaluator.checkObjectPermission('find', objectName, delegatorSets, { isPrivate })
  ) {
    return false;
  }

  return true;
}

/** The body of `SecurityPlugin#canWriteObject`; the method's docblock there is its contract. */
export async function canWriteObject(
  this: Pick<ObjectAdmissionHost, 'computeForbiddenFieldWrites' | 'delegatedAdminGate' | 'getObjectSecurityMeta' | 'logger' | 'organizationWallRefusal' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  object: string,
  operation: 'insert' | 'update',
  context?: any,
  data?: unknown,
): Promise<boolean> {
  const objectName = String(object ?? '');
  if (!objectName) return false;
  // 1. System operations bypass.
  if (context?.isSystem) return true;

  try {
    // 2-3. The middleware's two PRE-RESOLUTION caller-class refusals, called
    //      as the middleware calls them and at the same point in its order:
    //      after the `isSystem` bypass, BEFORE the principal-less refusal
    //      (arm 4) and before any permission set resolves. Both answer about
    //      the CALLER and the OBJECT, so a caller they refuse cannot reach
    //      the write by omitting a value or naming a different row — which
    //      is exactly the class this method exists to keep out of the
    //      preview.
    try {
      // 2. [ADR-0103] Engine-owned write affordance. ⛔ Not a re-derivation:
      //    this is the middleware's own primitive over the same registered
      //    schema, so the `userActions` members that reopen a verb pass here
      //    for the one reason they pass there.
      assertEngineOwnedWriteAllowed(
        typeof this.ql?.getSchema === 'function' ? this.ql.getSchema(objectName) : undefined,
        operation,
        context,
      );
      // 3. [ADR-0090 D12] Delegated administration on the RBAC link tables.
      //    The middleware hands its whole `opCtx`; a preview names no stored
      //    row, so this hands `object`, `operation`, `context` and the rows
      //    of `data` and NOTHING else — leaving the gate's delegate branch
      //    refusing an id-less mutation it cannot boundary-check, pinned as a
      //    direction in `can-write-object-admission.test.ts`.
      //
      //    ⭐ And the rows it supplies are SHALLOW COPIES, never the caller's
      //    own objects. The gate stamps `granted_by` onto the rows it
      //    materialises (its dual audit), and on an insert it materialises
      //    the payload rows BY REFERENCE — while `validate()` hands this
      //    method the caller's RAW payload, so passing it straight through
      //    would let a PREVIEW write into the caller's own objects. The
      //    decision cannot notice the copy: nothing reads `granted_by` back,
      //    it is only ever written — so its pin reads the caller's rows
      //    instead (`can-write-object-admission.test.ts`, the copy block).
      if (this.delegatedAdminGate) {
        const shallow = (row: unknown) =>
          row && typeof row === 'object' && !Array.isArray(row)
            ? { ...(row as Record<string, unknown>) }
            : row;
        await this.delegatedAdminGate.assert({
          object: objectName,
          operation,
          context,
          data: Array.isArray(data) ? data.map(shallow) : shallow(data),
        });
      }
    } catch (e) {
      // A refusal from either gate IS the admission answer — the write path's
      // own denial, not a failure to resolve one. Anything else is a
      // subsystem failure and belongs to the outer catch, which logs it and
      // still denies.
      if (e instanceof PermissionDeniedError) return false;
      throw e;
    }

    // 4. [#21908] ADR-0096 D5 strict mode — the middleware refuses a
    //    principal-less context at this point in its order, after its
    //    caller-class gates and before anything resolves, so this does too.
    if (isPrincipalLessContext(context)) return false;

    const permissionSets = await this.resolvePermissionSetsForContext(context);
    // 10. [ADR-0123 D2] The no-active-organization write wall — the
    //     middleware's own verdict, `organizationWallRefusal`, under its step
    //     3.7 guard: a payload is supplied and the context names a user. Its
    //     point is last, after the field gate.
    const organizationWallAdmits = async (
      delegatorSets: PermissionSet[] | null,
      delegatorContext: unknown,
    ): Promise<boolean> =>
      !(data && typeof data === 'object' && context?.userId
        && (await this.organizationWallRefusal(
          permissionSets, objectName, operation, context, delegatorSets, delegatorContext,
        )));
    //    [#21079] No sets resolved → the deny baseline (ADR-0056 D2): an
    //    empty list grants no create or edit, which is the middleware's step
    //    2 answer for a caller who carries a principal — refused there
    //    before its field gate or its organization wall is reached, whatever
    //    the payload.
    if (permissionSets.length === 0) return false;

    const { isPrivate, unresolved, requiredPermissions, fieldRequiredPermissions } =
      await this.getObjectSecurityMeta(objectName);
    // 5. [#3545] Posture unresolvable → deny.
    if (unresolved) return false;

    // [ADR-0090 D10] Resolve the delegator ONCE — the arms below need it,
    // and a dangling link denies before any of them runs. [#25107] So does a
    // delegator who is not a member of the organization the write runs in,
    // on a walled posture: the middleware's prologue refuses the write there
    // ({@link delegatedOrganizationRefusal}).
    let delegatorSets: PermissionSet[] | null = null;
    let delegatorContext: unknown = null;
    if (context?.onBehalfOf?.userId) {
      const del = await resolveDelegatorContext(this.ql, context);
      if (del.kind === 'missing') return false;
      if (del.kind === 'resolved') {
        if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) return false;
        delegatorContext = del.context;
        delegatorSets = await this.resolvePermissionSetsForContext(del.context);
      }
    }

    // 6. [ADR-0066 D3/⑤] The capability AND-gate, ahead of the grant, for both
    //    principals.
    const required = requiredCapsForOperation(requiredPermissions, operation);
    if (required.length > 0) {
      const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
      if (required.some((cap) => !held.has(cap))) return false;
      if (delegatorSets && delegatorSets.length > 0) {
        const delHeld = this.permissionEvaluator.getSystemPermissions(delegatorSets);
        if (required.some((cap) => !delHeld.has(cap))) return false;
      }
    }

    // 7. The object-level CRUD grant for the operation asked.
    if (!this.permissionEvaluator.checkObjectPermission(operation, objectName, permissionSets, { isPrivate })) {
      return false;
    }

    // 8. [ADR-0090 D10] The delegator must independently grant the same write.
    //    [#21079] Asked over the delegator's list whatever its length, as the
    //    middleware asks it: a delegator who resolves NO set grants nothing,
    //    the deny baseline for the second principal too.
    if (
      delegatorSets &&
      !this.permissionEvaluator.checkObjectPermission(operation, objectName, delegatorSets, { isPrivate })
    ) {
      return false;
    }

    // 9. The field-level-security WRITE gate — the middleware's step 2.5,
    //    over the payload the caller supplied: the middleware runs it for an
    //    `insert`/`update` carrying `opCtx.data`. ⛔ Not a re-derivation —
    //    [#21063] it IS the middleware's verdict (computeForbiddenFieldWrites);
    //    a second spelling of "which fields may this caller write" is the
    //    drift this whole method exists to avoid.
    //    [#25866] This reader holds no stored row: an insert is judged on the
    //    payload rows as the middleware judges them; an update applies each
    //    row-conditioned entry as its lock (no `preImage`), so the answer here
    //    is never wider than the gate's.
    if (data) {
      const forbidden = await this.computeForbiddenFieldWrites(
        objectName, data as Record<string, any> | Record<string, any>[],
        { fieldRequiredPermissions }, permissionSets, delegatorSets,
        { operation, context },
      );
      if (forbidden.length > 0) return false;
    }

    // 10. [ADR-0123 D2] At the middleware's point — see above.
    return await organizationWallAdmits(delegatorSets, delegatorContext);
  } catch (e) {
    this.logger.error?.(
      `[security] canWriteObject could not resolve the write admission for ` +
        `'${objectName}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
      e instanceof Error ? e : new Error(String(e)),
    );
    return false;
  }
}

/** The body of `SecurityPlugin#canExport`; the method's docblock there is its contract. */
export async function canExport(
  this: Pick<ObjectAdmissionHost, 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  object: string,
  context?: any,
): Promise<boolean> {
  const objectName = String(object ?? '');
  if (!objectName) return false;
  // System operations bypass (mirrors the middleware's isSystem skip).
  if (context?.isSystem) return true;
  // [#21908] ADR-0096 D5 strict mode — the middleware refuses a
  // principal-less context before it resolves anything, so this does too.
  if (isPrincipalLessContext(context)) return false;

  const permissionSets = await this.resolvePermissionSetsForContext(context);
  // [#21079] No sets resolved → the deny baseline (ADR-0056 D2): an empty
  // list grants nothing, which is the middleware's step 2 answer.
  if (permissionSets.length === 0) return false;

  const { isPrivate, unresolved } = await this.getObjectSecurityMeta(objectName);
  // [#3545] Posture unresolvable → deny. `isPrivate` would default to `false`,
  // which is precisely what lets a plain wildcard reach the object; a bulk
  // egress decision must not rest on a default we could not read.
  if (unresolved) return false;
  if (!this.permissionEvaluator.checkObjectPermission('export', objectName, permissionSets, { isPrivate })) {
    return false;
  }

  // [ADR-0090 D10] An on-behalf-of caller may never export past what the
  // DELEGATOR could have exported themselves — intersect the delegator's own
  // answer. A dangling delegator fails CLOSED, the same stance the CRUD
  // middleware and {@link getReadableFields} take. [#21079] So does a
  // delegator who resolves NO set: the evaluator answers that empty list's
  // export as it answers any list, and the middleware refuses its read.
  // [#25107] So does a delegator who is not a member of the organization the
  // export runs in, on a walled posture: the middleware's prologue refuses
  // the read there ({@link delegatedOrganizationRefusal}).
  if (context?.onBehalfOf?.userId) {
    const del = await resolveDelegatorContext(this.ql, context);
    if (del.kind === 'missing') return false;
    if (del.kind === 'resolved') {
      if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) return false;
      const delegatorSets = await this.resolvePermissionSetsForContext(del.context);
      if (
        !this.permissionEvaluator.checkObjectPermission('export', objectName, delegatorSets, { isPrivate })
      ) {
        return false;
      }
    }
  }

  return true;
}
