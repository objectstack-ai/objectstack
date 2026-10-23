// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 11] The `security` service registration `SecurityPlugin#start`
 * runs, moved out of `security-plugin.ts`: the `ISecurityService` literal that
 * every door bypassing the engine middleware asks, and its registration as the
 * `security` kernel service. The literal binds the read filter, the object
 * admission, the field readers, the export admission, the two write verdicts,
 * the permission-set resolution, the effective permissions, the position
 * grants and the explanation to the plugin's methods. It answers the write
 * bypass, the write scope, the delegation narrowing, the permission-set names
 * and the delegable scope in place, and it serves the audience-binding
 * suggestions through the suggestion surface. `Object.assign` adds the two
 * members the published contract does not type: the metadata-plane readable
 * fields and the ownership-floor alternate seam.
 *
 * A MOVE, not a redesign. The function below is that one `try` statement of
 * `start()` as it stood, re-indented one level and otherwise unedited. It has
 * the same members bound to the same methods, the same suggestion deps, the
 * same boot log line and the same warning when the registration throws. The
 * comment above the statement stays in `start()`, above its call.
 *
 * ## How the moved statement reaches the class
 *
 * The shape cuts 1 to 10 used for a method body
 * (`security-plugin-object-inputs.ts`, whose header carries the reasoning),
 * applied to one statement of `start()`. `start()` keeps the statement's
 * position and its comment. The statement is now one block holding a literal
 * of exactly the {@link SecurityServiceHost} members it reads, plus a `.call`.
 * The statement closed over three of `start()`'s locals and nothing else: the
 * plugin context, the engine and the metadata service. So the function takes
 * them as parameters, typed as the statement saw them there, where both
 * handles are already known to be present.
 *
 * A method is handed over as a closure that calls it on the plugin at call
 * time. So every member of the registered service still reaches the plugin's
 * method, and a test double or spy set on the plugin is still the one it
 * reaches.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `acceptedDefaultPermissionSets` and `ownershipFloorAlternates` are declared
 * `readonly`, so they go by value. `delegatedAdminGate`, `logger`,
 * `permissionEvaluator`, `ql` and `tenancyPosture` are not, so they go as
 * GETTERS, and each read happens when the service makes it. The posture that
 * the suggestion deps hand out is still read per call. Every one of the five
 * is an object whose own methods the service calls, or a value it reads, so no
 * receiver changes.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * The contract types are imported from `@objectstack/spec/contracts` and
 * `@objectstack/spec/security`, the delegation readers from
 * `explain-engine.js` and the suggestion surface from
 * `suggested-audience-bindings.js`, as `security-plugin.ts` imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import type { PluginContext } from '@objectstack/core';
import type {
  AuthoredRowWriteOperation,
  DelegationNarrowing,
  IMetadataService,
  IObjectQLEngine,
  ISecurityService,
} from '@objectstack/spec/contracts';
import type { ObjectAccessScope, PermissionSet } from '@objectstack/spec/security';
import type { SecurityPlugin } from './security-plugin.js';
import {
  resolveDelegatorContext,
  delegatedOrganizationRefusal,
  intersectDelegatedScope,
  d10NarrowingStatement,
} from './explain-engine.js';
import type { OwnershipFloorAlternate } from './platform-ownership-policies.js';
import {
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  type SuggestionDeps,
  type SuggestionListFilter,
} from './suggested-audience-bindings.js';

/**
 * The `SecurityPlugin` members the function below reads — every one of them,
 * and no other; the function's `this` is the `Pick` of the members it reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SecurityServiceHost {
  readonly acceptedDefaultPermissionSets: SecurityPlugin['acceptedDefaultPermissionSets'];
  readonly delegatedAdminGate: SecurityPlugin['delegatedAdminGate'];
  readonly logger: SecurityPlugin['logger'];
  readonly ownershipFloorAlternates: SecurityPlugin['ownershipFloorAlternates'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  readonly tenancyPosture: SecurityPlugin['tenancyPosture'];
  canExport: SecurityPlugin['canExport'];
  canReadObject: SecurityPlugin['canReadObject'];
  checkAuthoredRowWrite: SecurityPlugin['checkAuthoredRowWrite'];
  checkControlledByParentWrite: SecurityPlugin['checkControlledByParentWrite'];
  declareEveryone: SecurityPlugin['declareEveryone'];
  describePositionGrants: SecurityPlugin['describePositionGrants'];
  explainAccessForCaller: SecurityPlugin['explainAccessForCaller'];
  getEffectiveObjectPermissions: SecurityPlugin['getEffectiveObjectPermissions'];
  getMetadataReadableFields: SecurityPlugin['getMetadataReadableFields'];
  getObjectSecurityMeta: SecurityPlugin['getObjectSecurityMeta'];
  getQueryableFields: SecurityPlugin['getQueryableFields'];
  getReadFilter: SecurityPlugin['getReadFilter'];
  getReadableFields: SecurityPlugin['getReadableFields'];
  getWritableFields: SecurityPlugin['getWritableFields'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
}

/** The `security` service registration `SecurityPlugin#start` runs; the comment above its call there is its contract. */
export function registerSecurityService(
  this: Pick<SecurityServiceHost, 'acceptedDefaultPermissionSets' | 'canExport' | 'canReadObject' | 'checkAuthoredRowWrite' | 'checkControlledByParentWrite' | 'declareEveryone' | 'delegatedAdminGate' | 'describePositionGrants' | 'explainAccessForCaller' | 'getEffectiveObjectPermissions' | 'getMetadataReadableFields' | 'getObjectSecurityMeta' | 'getQueryableFields' | 'getReadFilter' | 'getReadableFields' | 'getWritableFields' | 'logger' | 'ownershipFloorAlternates' | 'permissionEvaluator' | 'ql' | 'resolvePermissionSetsForContext' | 'tenancyPosture'>,
  ctx: PluginContext,
  ql: IObjectQLEngine,
  metadata: IMetadataService,
): void {
  try {
    // [ADR-0090 D5/D9] Suggested audience bindings — shared deps for the
    // list/accept/dismiss surface: the posture the deployment authority is
    // judged under, and the re-derivation an accept or a revoke runs.
    const suggestionDeps: SuggestionDeps = {
      ql,
      metadata,
      posture: () => this.tenancyPosture,
      rederiveEveryone: () => this.declareEveryone(ctx.logger),
      acceptedDefaultPermissionSets: this.acceptedDefaultPermissionSets,
      logger: ctx.logger,
    };
    // Typed against the published contract so the registered surface cannot
    // drift from what cross-package consumers are promised: a renamed method,
    // a dropped one, or a changed return type fails THIS build rather than
    // silently degrading a consumer's feature detection at runtime.
    const securityService: ISecurityService = {
      getReadFilter: (object: string, context?: any) => this.getReadFilter(object, context),
      // The OBJECT-level half of the same read. `getReadFilter` answers
      // "which rows" and answers `undefined` for a caller with NO grant at
      // all, so a door holding only the filter cannot tell "unrestricted"
      // from "not permitted" — which is how the analytics raw-SQL path served
      // a row count for an object whose `/data` door answers 403. Exposed
      // here so every door that bypasses the middleware asks BOTH halves.
      canReadObject: (object: string, context?: any) => this.canReadObject(object, context),
      // [#3547] Readable-field projection for a context — the authoritative
      // column set for a read-derived export (`export ⊆ list`, #3391).
      // Same field mask as the read middleware (no drift). The REST export
      // route uses it to project columns instead of inferring readability
      // from already-masked data rows. See getReadableFields.
      getReadableFields: (object: string, context?: any) => this.getReadableFields(object, context),
      // [#18386] Its write-side twin: the fields step 2.5 would not refuse.
      // The import template narrows its columns by it. See getWritableFields.
      getWritableFields: (object: string, context?: any) => this.getWritableFields(object, context),
      // [#20935] Its query-side twin: the fields steps 2.5b and 2.9 would not
      // refuse as a group key, an aggregate input, a filter or a sort key. A
      // field served MASKED is readable and NOT queryable, so a door that
      // compiles its own statement (the analytics raw-SQL path) asks this as
      // well as the read projection. See getQueryableFields.
      getQueryableFields: (object: string, context?: any) => this.getQueryableFields(object, context),
      // [#3544] User-level export axis. `export ⊆ list`, so a bulk export
      // reaches the middleware as a plain `find` and `allowExport` would never
      // be consulted — the REST export route asks HERE before it streams.
      canExport: (object: string, context?: any) => this.canExport(object, context),
      // [ADR-0111 D2] Super-user WRITE bypass probe — the management-authority
      // primitive behind `ISharingService.canManageShares`. Explicit
      // `modifyAllRecords` only (NOT the effective write scope, whose
      // unmatched-object case fails open to 'org'); fails CLOSED on
      // resolution errors, principal-less contexts, and on-behalf-of
      // contexts (no D10 delegator intersection on this path).
      hasWriteBypass: async (object: string, context?: any): Promise<boolean> => {
        if (context?.isSystem) return true;
        if (!context?.userId) return false;
        if (context?.onBehalfOf?.userId) return false;
        try {
          const meta = await this.getObjectSecurityMeta(object);
          const sets = await this.resolvePermissionSetsForContext(context);
          return this.permissionEvaluator.hasSuperuserWriteBypass(object, sets, { isPrivate: meta.isPrivate });
        } catch (e) {
          this.logger.warn?.(
            `[security] hasWriteBypass failed for object '${object}' (user ${context?.userId ?? 'unknown'}) — denying (fail-closed)`,
            e instanceof Error ? e : new Error(String(e)),
          );
          return false;
        }
      },
      // [ADR-0111 D1 DEPTH] Effective WRITE scope — the DEPTH primitive behind
      // canManageShares' hierarchy-manager branch. Same evaluator the CRUD
      // write path uses; fails CLOSED to 'own' on error / principal-less /
      // on-behalf-of. Returns 'org' for system and for Modify-All holders —
      // AND for the fail-open unmatched-object case, which is why the sharing
      // gate treats 'org' from here as non-authoritative on its own.
      resolveWriteScope: async (object: string, context?: any): Promise<'own' | 'own_and_reports' | 'unit' | 'unit_and_below' | 'org'> => {
        if (context?.isSystem) return 'org';
        if (!context?.userId || context?.onBehalfOf?.userId) return 'own';
        try {
          const meta = await this.getObjectSecurityMeta(object);
          const sets = await this.resolvePermissionSetsForContext(context);
          return this.permissionEvaluator.getEffectiveScope('write', object, sets, { isPrivate: meta.isPrivate });
        } catch (e) {
          this.logger.warn?.(
            `[security] resolveWriteScope failed for object '${object}' (user ${context?.userId ?? 'unknown'}) — narrowing to 'own' (fail-closed)`,
            e instanceof Error ? e : new Error(String(e)),
          );
          return 'own';
        }
      },
      // [ADR-0090 D10 — maintainer ruling 2026-09-08, consequence 2] The
      // delegated-read diagnostic. NOT an enforcement path: it decides
      // nothing, narrows nothing, and never throws outward. It answers the
      // one question a transport serving a delegated read owes its caller —
      // "is this count a fact about the object, or about the ceiling?" —
      // because the caller is an AI that will otherwise report `total: 0` as
      // an answer (the measured failure on #16549).
      //
      // Resolved from the SAME two evaluator calls the CRUD middleware makes
      // when it stashes `__readScope` (step 2.6), folded by the SAME
      // `intersectDelegatedScope`. That is what stops it becoming a phantom
      // check: it cannot report a narrowing the query did not have, and it
      // cannot miss one the query did.
      describeDelegationNarrowing: async (object: string, context?: any): Promise<DelegationNarrowing> => {
        const none: DelegationNarrowing = { narrowed: false };
        if (context?.isSystem) return none;
        const delegatorId = context?.onBehalfOf?.userId;
        if (!context?.userId || !delegatorId) return none;
        try {
          const del = await resolveDelegatorContext(this.ql, context);
          // A dangling delegator is a fail-CLOSED DENIAL upstream, not a
          // narrowing — the read never returns rows for this to describe.
          if (del.kind !== 'resolved') return none;
          // [#25107] Nor is a delegator who is not a member of the
          // organization the read runs in, on a walled posture: the prologue
          // refuses the read ({@link delegatedOrganizationRefusal}).
          if (delegatedOrganizationRefusal(context, del.context, this.tenancyPosture) !== undefined) return none;
          const meta = await this.getObjectSecurityMeta(object);
          const sets = await this.resolvePermissionSetsForContext(context);
          const delegatorSets = await this.resolvePermissionSetsForContext(del.context);
          const delegatorScope = this.permissionEvaluator.getEffectiveScope('read', object, delegatorSets, { isPrivate: meta.isPrivate });
          const declared = this.permissionEvaluator.getDeclaredScope('read', object, sets, { isPrivate: meta.isPrivate });
          const folded = intersectDelegatedScope(declared, delegatorScope);
          if (!folded.narrowedByCeiling) return none;
          return {
            narrowed: true,
            statement: d10NarrowingStatement({
              object,
              delegatorId: String(delegatorId),
              effectiveScope: folded.agentLegScope,
              delegatorScope,
            }),
            effectiveScope: folded.agentLegScope as ObjectAccessScope,
            delegatorScope,
          };
        } catch (e) {
          // ⛔ A diagnostic must never fail a read. Silence is the only safe
          // direction: it degrades to exactly the behaviour that shipped
          // before this method existed.
          this.logger.warn?.(
            `[security] describeDelegationNarrowing failed for object '${object}' — reporting no narrowing`,
            e instanceof Error ? e : new Error(String(e)),
          );
          return none;
        }
      },
      // [#5493 / ADR-0105 D3] Authored-row-write evidence: does an
      // APP-AUTHORED (non-floor) RLS policy admit this row for this write,
      // with the platform's `created_by` ownership floor taken out by
      // provenance? The composed RLS answer cannot stand in for it — the
      // floor admits every row's CREATOR, so a caller deferring to "composed
      // RLS admits" hands transferred records back to their former creators
      // (#5493 probe E-A). Verdict-shaped and fail-closed to `abstain`; see
      // the method for why a null Layer 1 is an abstention.
      checkAuthoredRowWrite: (
        object: string,
        recordId: string,
        operation: AuthoredRowWriteOperation,
        context?: any,
      ) => this.checkAuthoredRowWrite(object, recordId, operation, context),
      // [ADR-0055] The master-detail write check's answer for a by-id update
      // of one record — the write path's own composition, served for a gate
      // outside it (the `sys_attachment` and `sys_comment` parent gates)
      // that must judge a `controlled_by_parent` parent as its own update is
      // judged. Served on the typed literal, so the compiler holds it to the
      // contract's signature and outcome type.
      checkControlledByParentWrite: (object: string, recordId: string, context?: any) =>
        this.checkControlledByParentWrite(object, recordId, context),
      // [ADR-0046 §6.7] Effective permission-set NAMES for a caller — the
      // primitive the REST read layer needs to evaluate a permission-set-
      // gated book/doc audience ({ permissionSet: '…' }). Same resolution
      // as the middleware (positions expanded, additive baseline), so the
      // docs gate can never drift from data-plane enforcement. Throws on
      // resolution failure — callers must fail CLOSED (ADR-0049).
      resolvePermissionSetNames: async (context?: any): Promise<string[]> => {
        const sets = await this.resolvePermissionSetsForContext(context);
        return sets.map((s) => s.name);
      },
      // [#7616] The same resolution, returned WHOLE — `objects`, `fields`,
      // `systemPermissions`, `tabPermissions`, in resolution order. The names
      // above answer an AUDIENCE question; a consumer that must MERGE the
      // caller's grants (the object/field map `/auth/me/permissions` serves,
      // the capability + tab surface `/me/apps` filters its app list with)
      // cannot reach any of those four columns from a name, so both endpoints
      // re-implement this resolution locally instead — one rule in three
      // copies, which has already drifted from the enforcement path three
      // times (#7608, #7555, #6334), each divergence found only after it
      // reached a user.
      //
      // Exposed HERE, on the registered literal, and not merely as a public
      // class member: `plugin-hono-server` must never take a runtime
      // dependency on this plugin (it is optional in the stacks those
      // endpoints serve — the `!evaluator` degraded branches are exactly its
      // absence), so the service locator is the only seam that can carry the
      // delegation. A method the class declares but the literal does not
      // expose is unreachable across that seam, which is the precise failure
      // this addition exists to prevent.
      //
      // The class method stays private on purpose: this literal is the
      // supported surface, and routing every cross-package caller through it
      // is what keeps the published contract and the enforcement path the
      // same code rather than two that agree today.
      resolvePermissionSetsForContext: (context?: any): Promise<PermissionSet[]> =>
        this.resolvePermissionSetsForContext(context),
      // [#18783] The EFFECTIVE object-permission map — the `objects` slot of
      // `/auth/me/permissions`, from the same function that endpoint uses
      // (`buildEffectiveObjectPermissions`). Exposed on the literal for the
      // reason above: a cross-package consumer can only reach it here.
      getEffectiveObjectPermissions: (context?: any) => this.getEffectiveObjectPermissions(context),
      // [ADR-0131 D3/D4] Positions described as the resolver enforces them —
      // holders and the sets in force — for the position catalog's list.
      describePositionGrants: (positions: readonly string[], context?: any) =>
        this.describePositionGrants(positions, context),
      // [ADR-0090 D6] First-class access explanation. Same code paths as
      // the middleware (resolution/evaluator/RLS compiler) — explained by
      // construction. Explaining ANOTHER user requires `manage_users`.
      explain: (request, callerContext?: any) =>
        this.explainAccessForCaller(
          { ...request, operation: String(request.operation) },
          callerContext,
        ),
      // [ADR-0090 D12 / ADR-0105 D8] What the CALLER may delegate — the read
      // half of the delegated-admin gate. A scoped-invitation form narrows
      // its unit/position pickers with this instead of listing the whole
      // tree and letting the user discover the boundary by refusal. Purely
      // self-scoped (the caller's own resolved sets are the only input), so
      // it discloses nothing beyond the authority they already hold.
      describeDelegableScope: async (callerContext?: any) => {
        const sets = await this.resolvePermissionSetsForContext(callerContext);
        // No gate wired (degraded start) → no delegable authority, and the
        // consumer renders an empty picker rather than a permissive one.
        if (!this.delegatedAdminGate) {
          return {
            isTenantAdmin: false,
            scopes: [],
            placeableBusinessUnitIds: [],
            assignablePositions: [],
          };
        }
        // The caller's context, not just their sets: the gate resolves every
        // business-unit anchor inside the organization this names, so the
        // report can never offer another organization's units.
        return this.delegatedAdminGate.describeDelegableScope(sets, callerContext);
      },
      // [ADR-0090 D5/D9] Install-time suggestion surface: packages suggest a
      // set for `everyone`; a `manage_metadata` holder accepts it once for
      // the deployment (the `everyone` definition is re-derived) or dismisses.
      listAudienceBindingSuggestions: (callerContext?: any, filter?: SuggestionListFilter) =>
        listAudienceBindingSuggestions(suggestionDeps, callerContext, filter),
      confirmAudienceBindingSuggestion: (callerContext: any, id: string) =>
        confirmAudienceBindingSuggestion(suggestionDeps, callerContext, id),
      dismissAudienceBindingSuggestion: (callerContext: any, id: string) =>
        dismissAudienceBindingSuggestion(suggestionDeps, callerContext, id),
    };
    // [ADR-0106 D7] The metadata-plane readable-field query, registered as an
    // EXTENSION of the published contract rather than inside the typed
    // literal above (consumers already feature-detect, which is exactly why a
    // partial surface degrades instead of lying). `Object.assign` keeps the
    // literal type-checked against the contract while the extension stays
    // visible as an extension.
    const registeredSecurityService = Object.assign(securityService, {
      getMetadataReadableFields: (object: string, context?: any) =>
        this.getMetadataReadableFields(object, context),
      // [#21729] The ownership-floor alternate seam — how a plugin that
      // installs a tighter row gate stops the platform's `created_by` floor
      // pre-empting it, registered beside that gate and nowhere else. Same
      // extension pattern as the one above (the contract lives in
      // `packages/spec`; a contributor feature-detects the method). Keyed by
      // the contributing plugin: a second call replaces the first, an empty
      // list withdraws. Throws on a contribution the seam refuses — see
      // `ownership-floor-alternates.ts` for the rules.
      contributeOwnershipFloorAlternates: (
        plugin: string,
        alternates: readonly OwnershipFloorAlternate[],
      ): void => {
        this.ownershipFloorAlternates.contribute(plugin, alternates);
        ctx.logger.info(
          `[security] ownership-floor alternates from '${plugin}': ` +
            (alternates.length === 0
              ? 'withdrawn'
              : alternates.map((a) => `${a.object}.${a.operation} (${a.name})`).join(', ')),
        );
      },
    });
    ctx.registerService('security', registeredSecurityService);
    // The member list is READ OFF the registered object, never typed by hand:
    // a hand-kept list fell behind the served surface (five served members
    // never appeared in it), and a boot log that is silent about a member
    // reads as that member's absence.
    ctx.logger.info(
      `[security] registered "security" service (${Object.keys(registeredSecurityService).sort().join(', ')}) ` +
        '— ADR-0021 D-C / ADR-0055 / ADR-0090 D5/D6/D9 / ADR-0094 / ADR-0106 D7',
    );
  } catch (e) {
    ctx.logger.warn?.('[security] failed to register "security" service', {
      error: (e as Error).message,
    });
  }
}
