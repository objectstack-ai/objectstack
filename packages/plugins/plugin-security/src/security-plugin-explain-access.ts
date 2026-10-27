// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 10] `SecurityPlugin#explainAccessForCaller`, moved out of
 * `security-plugin.ts`: the `security/explain` answer for a caller — who may
 * explain whom, the explained user's context built and vetted against the
 * caller's organization, and the evaluation through the explain engine with
 * the same internals the middleware uses and with the CALLER as the asker of
 * the record's read.
 *
 * A MOVE, not a redesign. The function below is the body of the method of the
 * same name as it stood, re-indented one level and otherwise unedited: the
 * same target check, the same context build, the same internals handed to
 * the engine in the same order.
 *
 * ## How the moved body reaches the class
 *
 * The shape cuts 1 to 9 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps the public method — the published
 * `dist/*.d.ts` lists its name, docblock and position — and its body is one
 * literal of exactly the {@link ExplainAccessHost} members it reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the plugin
 * at call time, so a test double or spy set on the plugin is still the one
 * the body reaches: the explanation still asks the plugin's set resolution,
 * RLS filters, sharing read filter, write-depth stash, floor decision,
 * controlled-by-parent check, field folds, posture reader and by-id read, and
 * the `security/explain` route and every other caller still reach the method
 * through the plugin. The method was async and the function still is; the
 * method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `baselinePermissionSets` is declared `readonly` and goes by VALUE.
 * `delegatedAdminGate`, `permissionEvaluator`, `ql`, `resolveKernelService`
 * and `tenancyPosture` are not (`start()` assigns four of them after
 * construction, and tests replace `permissionEvaluator` on a constructed
 * plugin), so they go as GETTERS, and each read happens when the body makes
 * it. The delegated-admin gate and the evaluator are objects whose own
 * methods the body calls, so no receiver changes. `resolveKernelService` is a
 * function-valued field the body calls through the host, so its receiver is
 * the host and no longer the plugin; the one function ever assigned to it is
 * the arrow function `start()` assigns, which reads no `this`, so the call
 * answers as it did.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * Three module-level functions this body reads stay there, exported, and are
 * imported here by value: `requiredCapsForOperation`, which the middleware
 * and the object admissions read too, and the two classifications of a
 * caller-context by-id read, `absentUnderCallerRead` — shared with the write
 * path's step 2.7 — and `unreadableUnderCallerRead`, which is defined and
 * documented beside it (this cut exports both, and changes nothing else in
 * either). Each is read only inside the function body, at call time, never
 * while either module evaluates, so the two-way import is safe under ESM, and
 * the published bundle holds one module. `PermissionSet` and the explain
 * decision types are imported from `@objectstack/spec/security`, the write
 * operation type from `@objectstack/spec/contracts`, `PermissionDeniedError`
 * from `errors.js`, the organization vetting from `@objectstack/core`, and
 * the context build, the explain engine, the delegator's resolution, its
 * organization check and the sharing-depth intersection from
 * `explain-engine.js`, as `security-plugin.ts` imported them; no body that
 * stays there reads the context build, the explain engine, the organization
 * vetting or the explain operation type, so that file no longer imports them.
 *
 * The system-context page anchors the explanation's elevation read on this
 * module's `explainAccessForCaller`, which is where the read now sits, and the
 * delegated-organization pin counts the delegator resolution here.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import { resolveUserAuthzGrants, vetOrganizationClaim } from '@objectstack/core';
import { OWNERSHIP_QUEUE_SERVICE, type AuthoredRowWriteOperation, type IOwnershipQueueService } from '@objectstack/spec/contracts';
import type { ExplainDecision, ExplainOperation, PermissionSet } from '@objectstack/spec/security';
import type { SecurityPlugin } from './security-plugin.js';
import { absentUnderCallerRead, requiredCapsForOperation, unreadableUnderCallerRead } from './security-plugin.js';
import { ExplainUserNotFoundError, PermissionDeniedError } from './errors.js';
import { grantRowPolicySpeaks } from './external-owd-grant-stamp.js';
import { rlsOperationForVerb } from './lifecycle-verb-rls-operation.js';
import {
  buildContextForUser,
  delegatedOrganizationRefusal,
  explainAccessForAsker,
  intersectDelegatedScope,
  readSysUserRow,
  resolveDelegatorContext,
} from './explain-engine.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface ExplainAccessHost {
  readonly baselinePermissionSets: SecurityPlugin['baselinePermissionSets'];
  readonly delegatedAdminGate: SecurityPlugin['delegatedAdminGate'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly resolveKernelService: SecurityPlugin['resolveKernelService'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  checkControlledByParentWrite: SecurityPlugin['checkControlledByParentWrite'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  computeLayeredRlsFilter: SecurityPlugin['computeLayeredRlsFilter'];
  computeReadPartialMaskRules: SecurityPlugin['computeReadPartialMaskRules'];
  computeRlsFilter: SecurityPlugin['computeRlsFilter'];
  foldFieldRequiredPermissions: SecurityPlugin['foldFieldRequiredPermissions'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  readRowById: SecurityPlugin['readRowById'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
  resolvePreImageFloorDrop: SecurityPlugin['resolvePreImageFloorDrop'];
  resolveSharingReadFilter: SecurityPlugin['resolveSharingReadFilter'];
  resolveSharingWriteVerdict: SecurityPlugin['resolveSharingWriteVerdict'];
  resolveWriteScopeForSharing: SecurityPlugin['resolveWriteScopeForSharing'];
}

/**
 * The layered computation's options, as the class declares them: the
 * `RlsFilterOptions` interface stays in `security-plugin.ts`, and the moved
 * body names it exactly as it did.
 */
type RlsFilterOptions = NonNullable<Parameters<SecurityPlugin['computeLayeredRlsFilter']>[4]>;

/** The body of `SecurityPlugin#explainAccessForCaller`; the method's docblock there is its contract. */
export async function explainAccessForCaller(
  this: Pick<ExplainAccessHost, 'baselinePermissionSets' | 'checkControlledByParentWrite' | 'collectRLSPolicies' | 'computeLayeredRlsFilter' | 'computeReadPartialMaskRules' | 'computeRlsFilter' | 'delegatedAdminGate' | 'foldFieldRequiredPermissions' | 'getObjectSecurityMeta' | 'permissionEvaluator' | 'ql' | 'readRowById' | 'resolveKernelService' | 'resolvePermissionSetsForContext' | 'resolvePreImageFloorDrop' | 'resolveSharingReadFilter' | 'resolveSharingWriteVerdict' | 'resolveWriteScopeForSharing' | 'tenancyPosture'>,
  request: { object: string; operation: string; userId?: string; recordId?: string },
  callerContext?: any,
): Promise<ExplainDecision> {
  const operation = String(request?.operation ?? 'read') as ExplainOperation;
  const object = String(request?.object ?? '');
  if (!object) throw new Error('[Security] explain: request.object is required');
  const recordId = request?.recordId != null && request.recordId !== '' ? String(request.recordId) : undefined;

  let targetContext = callerContext ?? {};
  if (request.userId && request.userId !== callerContext?.userId) {
    const callerIsSystem = callerContext?.isSystem === true;
    if (!callerIsSystem) {
      const callerSets = await this.resolvePermissionSetsForContext(callerContext).catch(() => []);
      const held = this.permissionEvaluator.getSystemPermissions(callerSets);
      if (!held.has('manage_users')) {
        // [ADR-0090 D12, amended 2026-10-17] An organization administrator
        // may explain a member of the organization it administers — the
        // members whose assignments it creates and removes. Then [D12]
        // delegated administrators may explain principals inside their
        // delegation boundary. Both fail closed on any error, and both read
        // the organization the caller's sets were resolved in, never another.
        const organizationLevel = this.delegatedAdminGate
          ? await this.delegatedAdminGate
              .organizationAdminCoversUser(callerSets, request.userId, callerContext)
              .catch(() => false)
          : false;
        const delegated = organizationLevel || (this.delegatedAdminGate
          ? await this.delegatedAdminGate
              .scopesCoverUser(callerSets, request.userId, callerContext)
              .catch(() => false)
          : false);
        if (!delegated) {
          throw new PermissionDeniedError(
            `[Security] Access denied: explaining another user's access requires the 'manage_users' ` +
              `capability, organization administration of an organization that user is a member of, ` +
              `or a delegated adminScope covering that user (ADR-0090 D6/D12).`,
            { object, operation, targetUserId: request.userId },
          );
        }
      }
    }
    // [#26641] ...and only a user who exists is explained. The resolver
    // synthesises the baseline anchor and sets for ANY id, so an id no
    // `sys_user` row has was explained as a baseline member, `allowed: true`.
    // Asked here, after the caller is admitted and never before, so a caller
    // who may not explain others learns nothing about which ids exist; read
    // through the delegator path's own existence read (`readSysUserRow`).
    if (!(await readSysUserRow(this.ql, request.userId))) {
      throw new ExplainUserNotFoundError(request.userId);
    }
    // [#20515] Resolved in the CALLER's organization — the one the explain
    // right above was checked in. Grants scoped to any other organization do
    // not apply there, and with no active organization only global grants do.
    const callerTenantId = typeof callerContext?.tenantId === 'string' && callerContext.tenantId !== ''
      ? callerContext.tenantId
      : undefined;
    // [#20580] ...but only while the explained user could be resolved in it.
    // Explaining them in the caller's organization is a CLAIM on it made for
    // them, and enforcement vets a claim before it resolves anything:
    // under a walled posture a member removed from that organization, whose
    // session still names it, has the claim dropped and resolves with NO
    // active organization — so none of that organization's grants apply.
    // `vetOrganizationClaim` is that check (the session arm of
    // `resolveAuthzContext`), asked of the same membership set; the explainer
    // spells no membership rule of its own.
    const nowMs = Date.now();
    let explained = await buildContextForUser(this.ql, request.userId, nowMs, callerTenantId);
    const explainedTenantId = vetOrganizationClaim(callerTenantId, explained.accessible_org_ids ?? [], this.tenancyPosture);
    if (explainedTenantId !== callerTenantId) {
      explained = await buildContextForUser(this.ql, request.userId, nowMs, explainedTenantId);
    }
    // [#20604] ...and the organization the user is resolved in is the one
    // their requests run in: enforcement's context for them carries it as
    // `tenantId`, which the tenant wall, the organization-scoped
    // permission-set catalogue and the engine all read. `buildContextForUser`
    // returns none of its own, so it is set here from the SAME vetted value,
    // as `resolveDelegatorContext` sets a delegator's. Without it a current
    // member was explained with NO organization: denied a tenant object
    // their own find reads under `isolated`, and without a permission set
    // their organization authored.
    if (explainedTenantId !== undefined) explained.tenantId = explainedTenantId;
    targetContext = explained;
  } else if (
    callerContext?.principalKind === 'human'
    && callerContext.isSystem !== true
    && !callerContext.onBehalfOf?.userId
    && typeof callerContext.userId === 'string' && callerContext.userId !== ''
  ) {
    // [#25799] A self-explanation runs on the request's own context, and the
    // request envelope does not carry the resolver's split of a set's two
    // channels (`directPermissions`): its field set is closed. So a HUMAN
    // caller is resolved once more through the resolver itself, in the
    // organization the request runs in, and only that split is attached; the
    // context's grants stay the request's. An agent, a guest and a system
    // caller keep the context as it arrived. A resolution that fails, or
    // answers no split, is said as such (`directPermissionsUnread`), never
    // guessed.
    const tenantId = typeof callerContext.tenantId === 'string' && callerContext.tenantId !== '' ? callerContext.tenantId : undefined;
    const split = await resolveUserAuthzGrants(this.ql, callerContext.userId, { tenantId, nowMs: Date.now(), bypassGrantsCache: true })
      .then((g) => (Array.isArray(g?.directPermissions) ? g.directPermissions : undefined), () => undefined);
    targetContext = split ? { ...callerContext, directPermissions: split } : { ...callerContext, directPermissionsUnread: true };
  }

  // [C2 / ADR-0095] The optional `sharing` service backs the record-grained
  // sharing attribution. Resolved lazily; absent (no plugin-sharing) → the
  // record path still works, the sharing layer simply reports not_evaluated.
  const sharing = recordId ? (this.resolveKernelService?.('sharing') as any) : undefined;
  // [ADR-0142 D3] The ownership-queue service, for the record's queue story.
  const queueSvc = recordId
    ? (this.resolveKernelService?.(OWNERSHIP_QUEUE_SERVICE) as Pick<IOwnershipQueueService, 'isMember'> | undefined)
    : undefined;
  const ownershipQueues = queueSvc && typeof queueSvc.isMember === 'function' ? queueSvc : undefined;

  // [#19963] A record-grained WRITE verdict is computed from the by-id write
  // path's own inputs, so `record.visible` for `update` / `delete` is the
  // answer the by-id PATCH / DELETE gives:
  //  - Layer 1 carries the pre-image gate's floor decision (step 2.7,
  //    {@link resolvePreImageFloorDrop}).
  //  - [ADR-0055] It also carries step 2.7's coverage vouch,
  //    `masterGateCoversThisWrite`, on step 2.7's own condition (not on behalf
  //    of anyone), for an `update` and a `delete` alike: explain asks the
  //    master gate for every by-id write of a record that exists
  //    ({@link checkControlledByParentWrite}, wired below), so a
  //    `controlled_by_parent` record's ownership floor (`owner_only_writes`,
  //    `owner_only_deletes`) is handed over to that check here exactly as the
  //    write path hands it over.
  //  - plugin-sharing's per-record gate is asked with `__writeScope` stamped
  //    as the middleware stamps it (step 2.6), always overwritten, so an
  //    `org` / unit writer is not judged owner-only.
  //  - [#5493 / ADR-0105 D3] A refusal of that gate is deferred as the
  //    middleware defers it: to an app-authored row-level policy that admits
  //    the row for the gate's verb (`probeAuthoredRowWrite`, wired below).
  // [#19986] The READ verdict's twin: plugin-sharing's read filter is asked
  // with `__readScope` stamped as step 2.6 stamps it for a find, so
  // `record.visible` for `read` is what the caller's find returns.
  // [#24646] On the on-behalf-of path the per-record WRITE gate is asked as
  // the by-id write asks it ({@link delegatedWriteGate}): once for the
  // delegated principal at its agent-leg depth, then, if that admits, once
  // for the delegator at the delegator's own depth. The delegator's own
  // write filter, which step 2.7 ANDs into the pre-image re-read, is composed
  // by the engine, as the gate composes it: once with the floor standing
  // (`computeRlsFilter`), once as the delegator's own record composition
  // (`computeLayeredRlsFilter` below, asked with the delegator's context, so
  // its floor decision is the delegator's own). The floor decision still
  // excludes the delegated context itself, as the gate's does. The delegated
  // READ depths are not modelled on explain's record
  // path: the read filter is asked with the delegated context as it stands.
  const actsOnBehalfOf = (c: any): boolean => !!c?.onBehalfOf?.userId;
  const recordWriteFloorOptions = async (
    sets: PermissionSet[],
    o: string,
    engineOp: string,
    c: any,
  ): Promise<RlsFilterOptions | undefined> => {
    // [#22550] `engineOp` here is the operation explain composes the verb's
    // row-level security for (`rlsOperationForVerb`, the 2.7 gate's own
    // mapping), so a transfer arrives as `update` and meets the floor
    // decision and the vouch step 2.7 makes for it, on the mapped verb.
    if (!recordId || (engineOp !== 'update' && engineOp !== 'delete')) return undefined;
    // Fail toward the floor: an unanswerable decision keeps it standing,
    // which is what the gate's own verdict does on a failed probe.
    const dropPlatformOwnershipFloor = await this.resolvePreImageFloorDrop(
      engineOp, o, recordId, c, sets, actsOnBehalfOf(c),
    ).catch(() => false);
    // Step 2.7's vouch is `!delegatorSets` for every verb it runs on; the
    // floor itself comes off only where `masterGateCoversOperation` says the
    // master gate covers the verb (`update`, `delete`).
    const masterGateCoversThisWrite = !actsOnBehalfOf(c);
    return { dropPlatformOwnershipFloor, masterGateCoversThisWrite };
  };
  const withWriteScope = async (o: string, c: any): Promise<any> =>
    actsOnBehalfOf(c) ? c : { ...c, __writeScope: await this.resolveWriteScopeForSharing(o, c) };
  /**
   * [#24646 / ADR-0090 D10] The two contexts the by-id write path hands
   * plugin-sharing's per-record gate for an on-behalf-of principal, built as
   * the write path builds them:
   *
   * - `agent`: the delegated context with step 2.6's two stamps, the
   *   agent-leg write depth ({@link intersectDelegatedScope} of the ceiling's
   *   DECLARED depth and the delegator's effective one) as `__writeScope`, and
   *   the delegator's effective depth as `__delegatorWriteScope`;
   * - `delegator`: what the sharing middleware's second gate call hands the
   *   service, that same context as the delegator (`userId` the delegator's,
   *   no delegation link) at the delegator's depth.
   *
   * A delegation link naming no user (`missing`) answers `null`: the write
   * path refuses such a principal before any gate runs, and so does every
   * gate built on this. [#25107] So does a delegator who is not a member of
   * the organization the write runs in, on a walled posture: the prologue
   * refuses it there ({@link delegatedOrganizationRefusal}).
   */
  const delegatedWriteContexts = async (o: string, c: any): Promise<{ agent: any; delegator: any } | null> => {
    const del = await resolveDelegatorContext(this.ql, c);
    if (del.kind !== 'resolved') return null;
    if (delegatedOrganizationRefusal(c, del.context, this.tenancyPosture) !== undefined) return null;
    const [sets, delegatorSets, meta] = await Promise.all([
      this.resolvePermissionSetsForContext(c),
      this.resolvePermissionSetsForContext(del.context),
      this.getObjectSecurityMeta(o),
    ]);
    const delegatorScope = this.permissionEvaluator.getEffectiveScope('write', o, delegatorSets, { isPrivate: meta.isPrivate });
    const declared = this.permissionEvaluator.getDeclaredScope('write', o, sets, { isPrivate: meta.isPrivate });
    const agent = {
      ...c,
      __writeScope: intersectDelegatedScope(declared, delegatorScope).agentLegScope,
      __delegatorWriteScope: delegatorScope,
    };
    return { agent, delegator: { ...agent, userId: c.onBehalfOf.userId, onBehalfOf: undefined, __writeScope: delegatorScope } };
  };
  /**
   * [#24646] A per-record write gate of the sharing service, asked as the
   * by-id write asks it: for an ordinary principal once, at its own write
   * depth; for an on-behalf-of principal as the agent and then, only if that
   * admits, as the delegator — the sharing middleware's two calls, in its
   * order ({@link delegatedWriteContexts}).
   */
  const delegatedWriteGate = (gate: (o: string, rid: string, c: any) => Promise<boolean>) =>
    async (o: string, rid: string, c: any): Promise<boolean> => {
      if (!actsOnBehalfOf(c)) return gate(o, rid, await withWriteScope(o, c));
      const legs = await delegatedWriteContexts(o, c);
      if (!legs) return false;
      if (!(await gate(o, rid, legs.agent))) return false;
      return gate(o, rid, legs.delegator);
    };
  // {@link resolveSharingReadFilter} IS the read-depth stamp step 2.6 makes
  // (the same two inputs to the same evaluator call); the analytics path
  // already asks it. The caller's own key is cleared first, so the depth
  // is always the computed one — never one the context brought — even
  // where resolution fails and the helper stamps nothing (`own`, the safe
  // direction).
  const readFilterWithReadScope = (o: string, c: any): Promise<unknown | null> =>
    this.resolveSharingReadFilter(o, { ...c, __readScope: undefined });

  return explainAccessForAsker(
    {
      ql: this.ql,
      resolveSets: (c: any) => this.resolvePermissionSetsForContext(c),
      evaluator: this.permissionEvaluator,
      getObjectSecurityMeta: (o: string) => this.getObjectSecurityMeta(o),
      requiredCaps: (meta: any, engineOp: string) => requiredCapsForOperation(meta, engineOp),
      computeRlsFilter: (sets, o, engineOp, c) => this.computeRlsFilter(sets as any, o, engineOp, c),
      getFieldMask: (sets, o, fieldRequired) => {
        let fp = this.permissionEvaluator.getFieldPermissions(o, sets as any);
        fp = this.foldFieldRequiredPermissions(fp, fieldRequired, sets as any);
        return fp as any;
      },
      // [#9127] The partial-mask dimension of the SAME field-mask decision,
      // read straight off the enforcement composition (`maskResults`' own
      // `partialRules` argument) rather than re-derived — explain reports the
      // three states, it does not compute them.
      getPartialMaskRules: async (sets, o, delSets) => {
        const meta = await this.getObjectSecurityMeta(o);
        const basePerms = this.permissionEvaluator.getFieldPermissions(o, sets as any);
        const delBasePerms = delSets
          ? this.permissionEvaluator.getFieldPermissions(o, delSets as any)
          : null;
        return this.computeReadPartialMaskRules(meta, sets as any, delSets as any, basePerms, delBasePerms);
      },
      baselinePermissionSets: this.baselinePermissionSets,
      // [Ruling of record 6355206139] The EXTERNAL OWD seam's question, asked
      // through the SAME collection the middleware's step 2.6 stamp asks.
      externalGrantSpeaks: (sets, o, opClass, dataOp, c) =>
        grantRowPolicySpeaks(
          (op) => this.collectRLSPolicies(sets as any, o, op, (c?.positions ?? []) as string[], c),
          opClass,
          rlsOperationForVerb(dataOp),
        ),
      // [#25107] The prologue's posture, for its organization-membership
      // refusal of a delegated context ({@link delegatedOrganizationRefusal}).
      tenancyPosture: this.tenancyPosture,
      // ── record-grained deps (only consulted when recordId is present) ──
      computeLayeredRlsFilter: async (sets, o, engineOp, c) =>
        this.computeLayeredRlsFilter(
          sets as any, o, engineOp, c, await recordWriteFloorOptions(sets as any, o, engineOp, c),
        ),
      fetchRecord: async (o: string, rid: string) => {
        try {
          const finder = this.ql?.findOne
            ? this.ql.findOne(o, { where: { id: rid }, context: { isSystem: true } })
            : this.ql?.find?.(o, { where: { id: rid }, limit: 1, context: { isSystem: true } });
          const res = await finder;
          const row = Array.isArray(res) ? res[0] : res;
          return row ?? null;
        } catch {
          return null;
        }
      },
      ...(sharing && typeof sharing.buildReadFilter === 'function'
        ? {
            sharingReadFilter: (o: string, c: any) =>
              actsOnBehalfOf(c) ? sharing.buildReadFilter(o, c) : readFilterWithReadScope(o, c),
          }
        : {}),
      // [#26188 · ADR-0057] Asked by the depth layer's record cell: with no
      // resolver mounted a hierarchy read depth is evaluated as 'own', and the
      // cell names that instead of the depth. The kernel's own answer, read
      // per explain; no reader of the service, no answer.
      ...(this.resolveKernelService
        ? { hierarchyResolverMounted: () => this.resolveKernelService?.('hierarchy-scope-resolver') != null }
        : {}),
      ...(sharing && typeof sharing.listShares === 'function'
        // [ADR-0111 D5] listShares is now management-gated in the sharing
        // service, but explain's own caller authorization already ran
        // (explaining ANOTHER user requires `manage_users` — D12). Read the
        // stored rows under system context so the record story keeps its
        // share attribution when the EXPLAINED principal isn't a share
        // manager — the exact behaviour this binding had before the gate.
        ? { listRecordShares: (o: string, rid: string) => sharing.listShares(o, rid, { isSystem: true }) }
        : {}),
      // [#26180] The pending approval requests that grant the EXPLAINED
      // principal read of the record — the same answer the sharing read filter
      // ORs in, asked with the explained context, so the attribution names the
      // request the filter admitted the row through.
      ...(sharing && typeof sharing.listApprovalReadGrants === 'function'
        ? { listApprovalReadGrants: (o: string, rid: string, c: any) => sharing.listApprovalReadGrants(o, rid, c) }
        : {}),
      ...(sharing && typeof sharing.canEdit === 'function'
        ? { canEditRecord: delegatedWriteGate((o, rid, c) => sharing.canEdit(o, rid, c)) }
        : {}),
      // [ADR-0111 D3] The narrower delete gate — an edit share opens update
      // but not delete, so a delete explanation must consult this.
      ...(sharing && typeof sharing.canDelete === 'function'
        ? { canDeleteRecord: delegatedWriteGate((o, rid, c) => sharing.canDelete(o, rid, c)) }
        : {}),
      // [#5493 / ADR-0105 D3] The by-id write gate's deferral, asked through
      // the sharing service's own probe, the member its middleware asks
      // after the gate above refuses, with the context that gate is asked
      // with. The probe passes through to {@link checkAuthoredRowWrite} and
      // abstains on every failure; a sharing service without it defers
      // nothing, so explain reports the gate's refusal as before. [#24646] An
      // on-behalf-of principal's probe carries the agent leg's stamps, as the
      // middleware's own context does when it asks.
      ...(sharing && typeof sharing.probeAuthoredRowWrite === 'function'
        ? {
            probeAuthoredRowWrite: async (o: string, rid: string, op: AuthoredRowWriteOperation, c: any) => {
              if (!actsOnBehalfOf(c)) return sharing.probeAuthoredRowWrite(o, rid, op, await withWriteScope(o, c));
              const legs = await delegatedWriteContexts(o, c);
              return legs ? sharing.probeAuthoredRowWrite(o, rid, op, legs.agent) : 'abstain';
            },
          }
        : {}),
      // [#21771] The by-id write path's read question, asked the same way:
      // the caller-context by-id read, every data middleware included.
      recordAbsentToCaller: (o: string, rid: string, c: any) =>
        absentUnderCallerRead(() => this.readRowById(o, rid, c)),
      // [ADR-0055] The master-detail write check a by-id update, delete or
      // transfer meets at step 2.8, served as
      // `ISecurityService.checkControlledByParentWrite` and asked with the
      // EXPLAINED context. The update's answer is each of those verbs' answer
      // (the check judges EDIT of the master whatever the record's verb). Its
      // presence is what licenses the `masterGateCoversThisWrite` vouch
      // above: the two go together.
      checkControlledByParentWrite: (o: string, rid: string, c: any) =>
        this.checkControlledByParentWrite(o, rid, c),
      // [ADR-0142 D3/D4] The queue story's two questions, asked of the same
      // authorities the doors ask: the queue service's holder check (the
      // access path's queue basis), and the tri-state sharing write verdict
      // the ownership gate's claim admission reads.
      ...(ownershipQueues ? { queueMember: (u: string, q: string, org: string | null) => ownershipQueues.isMember(u, q, org) } : {}),
      claimVerdict: (o: string, rid: string, c: any) => this.resolveSharingWriteVerdict('update', o, rid, c),
    },
    { object, operation, context: targetContext, recordId },
    // The asker: the caller, whose read of the record decides whether this
    // explanation discloses that the record exists. On a self-explanation it
    // is the explained context itself, and the engine asks it the write
    // path's question; explaining another user, the engine asks `cannotRead`,
    // the same read with a refusal counted as "cannot read" (ruling C).
    {
      context: callerContext,
      cannotRead: (o: string, rid: string) => unreadableUnderCallerRead(() => this.readRowById(o, rid, callerContext)),
    },
  );
}
