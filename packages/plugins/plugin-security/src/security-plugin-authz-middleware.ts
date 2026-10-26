// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 12] The authorization middleware `SecurityPlugin#start`
 * registers on the ObjectQL engine, moved out of `security-plugin.ts`: the one
 * `ql.registerMiddleware` call whose handler every engine operation passes
 * through. The handler retires the permission-set memo on a write, refuses a
 * flow run's identity-assignment writes, lets every other system operation
 * through, and serves the ADR-0056 public-form grant. It then runs the
 * engine-owned write guard and the ADR-0090 D12 delegated-administration gate,
 * resolves the operation's principals and the object's posture, and runs the
 * numbered steps in the order they stand: the `requiredPermissions` AND-gate
 * (1.5), the CRUD check (2), the access depth and an external principal's
 * grant stamp (2.6), the row-level write pre-image check (2.7), the
 * controlled-by-parent write (2.8), field-level write enforcement with the
 * masked-echo and aggregate-input refusals (2.5, 2.5a, 2.5b), the `owner_id`
 * anchor (3.5), the RLS write `check` (3.6), the Layer 0 tenant post-image
 * check (3.7), the predicate guard (2.9) and the RLS filter injection (3).
 * After `next()` it fails closed on a write-check seam the engine never ran,
 * and it masks the result (4).
 *
 * A MOVE, not a redesign. The function below is that one statement of
 * `start()` as it stood, re-indented one level and otherwise unedited. It
 * registers the same handler, with the same steps in the same order, the same
 * refusals and the same log lines. The comment above the statement stays in
 * `start()`, above its call, and so does the log line after it.
 *
 * ## How the moved statement reaches the class
 *
 * The shape cut 11 used for one statement of `start()`
 * (`security-plugin-security-service.ts`), which is the shape cuts 1 to 10
 * used for a method body (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). `start()` keeps the statement's position and its
 * comment. The statement is now one block holding a literal of exactly the
 * {@link AuthzMiddlewareHost} members it reads, plus a `.call`. The statement
 * closed over three of `start()`'s locals and nothing else: the plugin
 * context, the engine and the metadata service. So the function takes them as
 * parameters, typed as the statement saw them there, where both handles are
 * already known to be present.
 *
 * A method is handed over as a closure that calls it on the plugin at call
 * time. So every step still reaches the plugin's method, and a test double or
 * spy set on the plugin is still the one the handler reaches.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `engineOperationScope` is declared `readonly`, so it goes by value: the same
 * `AsyncLocalStorage`. `delegatedAdminGate`, `epoch`, `fieldMasker`, `logger`,
 * `permissionEvaluator` and `ql` are not, so they go as GETTERS, and each read
 * happens when the handler makes it, on every operation, as before. Every one
 * of them is an object whose own methods the handler calls, or a value it
 * reads, so no receiver changes.
 *
 * ## What moved with it, and what stays in `security-plugin.ts`
 *
 * Two module-level declarations only the handler reads moved with it, each
 * with its docblock: `WriteImageCheckSeam`, the write `check` the handler
 * installs for the engine to run, and `userFacingDenialMessage`, the
 * translated refusal text its denials carry. `WriteImageCheckSeam` gains
 * `export` and nothing else: `security-plugin.ts` imports it back type-only,
 * so that `WriteWallRowVerdict`'s docblock there still links to it.
 *
 * Two exported functions stay there and are imported here by value:
 * `isGuestEnvelope`, which the principal resolution reads too, and
 * `requiredCapsForOperation`, which `packages/spec/liveness/object.json`
 * anchors by symbol in that file. Each is read only inside the handler, at
 * call time, never while either module evaluates, so the two-way import is
 * safe under ESM, and the published bundle holds one module. `RlsFilterOptions`
 * keeps its one declaration there too; this module names it through the
 * class's own signature (below). Every other name the handler reads is
 * imported from the module `security-plugin.ts` imports it from.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import {
  type PluginContext,
  recordNotFoundError,
  isExternalAudienceContext,
} from '@objectstack/core';
import { type PermissionSet, PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
// [#8220] The read-scope provenance mark: this middleware is one of the two
// merge boundaries that stamp it (see the RLS injection below).
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
// [#7414] The SHARED operation-message catalog #7307 built for the data path's
// operation-level refusals. Second consumer, same mechanism — a second remedy
// for one defect class is what that module exists to prevent.
import { renderOperationMessage } from '@objectstack/spec/system';
// [#19989] The engine's own update-dispatch predicate, asked rather than
// re-derived: step 3.6 needs to know which row the ENGINE will write.
import { resolveEngineUpdateDispatch, type EngineUpdateDispatchData } from '@objectstack/metadata-core';
import type { II18nService, IMetadataService, IObjectQLEngine } from '@objectstack/spec/contracts';
import { crossFieldClassRefusalCarriedBy, findCrossFieldClassRefusal } from '@objectstack/formula';
import type { SecurityPlugin } from './security-plugin.js';
import { isGuestEnvelope, requiredCapsForOperation } from './security-plugin.js';
import { assertFlowSystemIdentityWriteAllowed } from './flow-system-identity-write-refusal.js';
import {
  intersectDelegatedScope,
} from './explain-engine.js';
import { jsonColumnCheckRefusalCarriedBy, storedFormCheckJudge } from './rls-check-stored-form.js';
import { compiledPolicyNameOf } from './rls-compiler.js';
import { andComposeLayers, intersectTenantLayer0Verdicts } from './tenant-layer.js';
import { rlsOperationForVerb } from './lifecycle-verb-rls-operation.js';
import {
  unresolvedPostureDenialMessage,
  unresolvedPostureLogLine,
  type UnresolvedPostureCause,
} from './unresolved-posture.js';
import { assertReadableQueryFields } from './predicate-guard.js';
import { PermissionDeniedError, MaskedValueWriteError } from './errors.js';
import { assertEngineOwnedWriteAllowed } from './system-write-guard.js';
import { grantRowPolicySpeaks, stampExternalGrant } from './external-owd-grant-stamp.js';

/**
 * The layered computation's options, as the class declares them: the
 * `RlsFilterOptions` interface stays in `security-plugin.ts`, and the moved
 * statement names it exactly as it did.
 */
type RlsFilterOptions = NonNullable<Parameters<SecurityPlugin['computeLayeredRlsFilter']>[4]>;

/**
 * [insert-check commit a016f08b8a] (the original card no longer resolves)
 * The write `check` for the writes this middleware cannot judge on
 * its own, installed on the operation context for the engine to run on the
 * rows that will be stored: every row of an insert, single or array, once the
 * `beforeInsert` chain has produced it, [#19950] every row a predicate
 * (`multi`) update selects, merged with the final payload, and [#19989] the one
 * row a by-id update writes, merged with the payload the `beforeUpdate` chain
 * left. [#20013] The Layer 0 tenant wall's stored-row judgement rides the same
 * handle (step 3.7), alone or composed after the `check`.
 *
 * Structurally identical to `OperationContext.postHookWriteImageCheck` in
 * `@objectstack/objectql`, and deliberately declared here rather than imported:
 * this package depends on the engine only as a devDependency (the middleware is
 * registered through a duck-typed handle), so importing the engine's type would
 * put a package that is not a runtime dependency into this package's published
 * `.d.ts`. The two spellings are welded by a test that runs BOTH packages, not
 * by the type system — see `insert-check-post-image.test.ts`.
 */
export interface WriteImageCheckSeam {
  /** Refuses by throwing. Receives the images the driver is about to store. */
  evaluate(rows: readonly Record<string, unknown>[]): void;
  /** Set by the engine immediately before `evaluate` runs. */
  honoured?: boolean;
  /**
   * [#24822] Set by step 3.7, and only by it: `evaluate` holds every stored
   * row's `organization_id` to the Layer 0 tenant wall's own parts, on an
   * insert and on a single-payload update (the by-id image, and every row the
   * predicate path matched). The engine then leaves a caller's explicit value,
   * or an update's re-point, on the row for that verdict instead of stripping
   * it as `readonly`. Never set on a seam that carries the business `check`
   * alone, on a crossing platform operator's seam, or on an update whose
   * payload is an array: none of them judges the organization.
   */
  judgesOrganization?: boolean;
}

/**
 * [#7414] The END USER's half of an object-permission refusal.
 *
 * Both transports put a 403's `Error.message` on the wire as the body's
 * human-readable string — `@objectstack/rest`'s `mapDataError` as `body.error`,
 * the runtime dispatcher as `error.message` — and Console renders that verbatim
 * in a toast. The CRUD gate composed it English-only with the object's API name
 * and the caller's `positions` concatenated in, so an operator in a fully
 * localized app read a sentence naming a table they have never seen and an
 * authorization vocabulary that reads as a contradiction to someone who does
 * hold rights on the record they clicked. On a cascade delete it is worse
 * still: `cascadeDeleteRelations` re-authorises every CHILD independently, so
 * the object named is one the operator never addressed.
 *
 * Rendered through the SHARED operation-message catalog #7307 built
 * (`@objectstack/spec/system`), not a second mechanism: same `errors.<key>`
 * override address, same resolution ladder (deployment override → locale
 * catalog → `en` → the key), same guarantee that a misbehaving i18n service
 * cannot turn a 403 into a 500.
 *
 * The i18n service is optional and resolved per call: it is registered by a
 * different plugin, may register after this one, and a deployment that runs
 * without it still gets the built-in catalog in the caller's locale.
 *
 * [#7451] `messageKey` is a PARAMETER rather than the hard-coded
 * `permission_denied` it started as, because the end-user gates of this
 * middleware refuse for three different reasons and a user in one of them can
 * do something different from a user in another (catalog table: their grants do
 * not cover the action / they may not touch THIS record / they may not put it
 * into THAT state). One wire code, several sentences, is the rule #7307 set
 * with `delete_restricted` and `delete_restricted_required`; the unit is the
 * situation, never the code.
 */
function userFacingDenialMessage(
  ctx: PluginContext,
  messageKey: 'permission_denied' | 'record_access_denied' | 'record_change_not_allowed',
  locale: string | undefined,
): string {
  let translate:
    | ((key: string, loc: string, params?: Record<string, unknown>) => string)
    | undefined;
  try {
    const i18n = ctx.getService<II18nService>('i18n');
    const t = i18n?.t;
    if (typeof t === 'function') {
      translate = (key, loc, params) => t.call(i18n, key, loc, params);
    }
  } catch {
    // i18n is optional (ADR-0029 D8 registers it from another plugin, possibly
    // later than this one). The built-in catalog still renders the caller's
    // locale without it.
  }
  return renderOperationMessage({ messageKey }, { locale, translate });
}

/**
 * The `SecurityPlugin` members the function below reads — every one of them,
 * and no other; the function's `this` is the `Pick` of the members it reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface AuthzMiddlewareHost {
  readonly delegatedAdminGate: SecurityPlugin['delegatedAdminGate'];
  readonly engineOperationScope: SecurityPlugin['engineOperationScope'];
  readonly epoch: SecurityPlugin['epoch'];
  readonly fieldMasker: SecurityPlugin['fieldMasker'];
  readonly logger: SecurityPlugin['logger'];
  readonly permissionEvaluator: SecurityPlugin['permissionEvaluator'];
  readonly ql: SecurityPlugin['ql'];
  addressedByIdWriteId: SecurityPlugin['addressedByIdWriteId'];
  addressedPredicateWrite: SecurityPlugin['addressedPredicateWrite'];
  assertControlledByParentWrite: SecurityPlugin['assertControlledByParentWrite'];
  callerCannotReadAddressedRow: SecurityPlugin['callerCannotReadAddressedRow'];
  collectRLSPolicies: SecurityPlugin['collectRLSPolicies'];
  composeWriteTenantWall: SecurityPlugin['composeWriteTenantWall'];
  computeControlledByParentFilter: SecurityPlugin['computeControlledByParentFilter'];
  computeForbiddenFieldWrites: SecurityPlugin['computeForbiddenFieldWrites'];
  computeLayeredRlsFilter: SecurityPlugin['computeLayeredRlsFilter'];
  computePartialMaskRules: SecurityPlugin['computePartialMaskRules'];
  computeQueryGuardFieldPerms: SecurityPlugin['computeQueryGuardFieldPerms'];
  computeRlsFilter: SecurityPlugin['computeRlsFilter'];
  computeWriteCheckFilter: SecurityPlugin['computeWriteCheckFilter'];
  delegatorOwnWriteFloorOptions: SecurityPlugin['delegatorOwnWriteFloorOptions'];
  extractSingleId: SecurityPlugin['extractSingleId'];
  getCallerPreImage: SecurityPlugin['getCallerPreImage'];
  getObjectFieldNames: SecurityPlugin['getObjectFieldNames'];
  maskOperationResult: SecurityPlugin['maskOperationResult'];
  raiseWriteWallRefusal: SecurityPlugin['raiseWriteWallRefusal'];
  readableRowsScopeForPredicateWrite: SecurityPlugin['readableRowsScopeForPredicateWrite'];
  resolveCallerPosture: SecurityPlugin['resolveCallerPosture'];
  resolveOperationPrincipals: SecurityPlugin['resolveOperationPrincipals'];
  resolvePermissionSetsForContext: SecurityPlugin['resolvePermissionSetsForContext'];
  resolvePreImageFloorDrop: SecurityPlugin['resolvePreImageFloorDrop'];
  writeCheckFieldOptions: SecurityPlugin['writeCheckFieldOptions'];
}

/** The authorization middleware registration `SecurityPlugin#start` runs; the comment above its call there is its contract. */
export function registerAuthzMiddleware(
  this: Pick<AuthzMiddlewareHost, 'addressedByIdWriteId' | 'addressedPredicateWrite' | 'assertControlledByParentWrite' | 'callerCannotReadAddressedRow' | 'collectRLSPolicies' | 'composeWriteTenantWall' | 'computeControlledByParentFilter' | 'computeForbiddenFieldWrites' | 'computeLayeredRlsFilter' | 'computePartialMaskRules' | 'computeQueryGuardFieldPerms' | 'computeRlsFilter' | 'computeWriteCheckFilter' | 'delegatedAdminGate' | 'delegatorOwnWriteFloorOptions' | 'engineOperationScope' | 'epoch' | 'extractSingleId' | 'fieldMasker' | 'getCallerPreImage' | 'getObjectFieldNames' | 'logger' | 'maskOperationResult' | 'permissionEvaluator' | 'ql' | 'raiseWriteWallRefusal' | 'readableRowsScopeForPredicateWrite' | 'resolveCallerPosture' | 'resolveOperationPrincipals' | 'resolvePermissionSetsForContext' | 'resolvePreImageFloorDrop' | 'writeCheckFieldOptions'>,
  ctx: PluginContext,
  ql: IObjectQLEngine,
  metadata: IMetadataService,
): void {
  ql.registerMiddleware(async (opCtx: any, chainNext: () => Promise<void>) => {
    // [#21771] Whether THIS operation was issued from inside another engine
    // operation's pipeline (a cascade, a hook's `ctx.api` write), read before
    // this operation opens a scope of its own; and the scoped `next` every
    // exit below calls, so whatever the rest of the chain issues reads as
    // nested. See {@link engineOperationScope}.
    const nestedInOperation = this.engineOperationScope.getStore() === true;
    const next = (): Promise<void> => this.engineOperationScope.run(true, chainNext);
    // [insert-check commit a016f08b8a] (the original card no longer resolves)
    // The write `check` step 3.6 installs on the operation context
    // for the engine to run: on an insert, after `beforeInsert`; [#19950] on
    // a predicate update, over every matched row once the payload is final.
    // Held here so the post-`next()` assertion below can read whether the
    // seam was honoured — an installed judgement that never ran is a write
    // this middleware did not gate, and it fails CLOSED and loudly rather
    // than passing for an allowed one.
    //
    // [#20013] Step 3.7 composes the Layer 0 tenant wall's stored-row
    // judgement into the same seam, so this one handle can carry either
    // judgement or both; the two flags say which, for the assertion's
    // wording and for its one stand-down (the data door, see there).
    let writeImageCheckSeam: WriteImageCheckSeam | null = null;
    let businessCheckSeamInstalled = false;
    let tenantWallSeamInstalled = false;
    // [#10757] Retire every memoized permission-set resolution the moment a
    // WRITE passes through the engine. Deliberately the FIRST statement in
    // the middleware — ahead of the `isSystem` bypass immediately below —
    // because the writes most likely to change what a caller may see are
    // system ones: the platform seeder, a package publish, the auto-org-admin
    // grant. A guard that only saw user writes would leave a memo standing
    // across exactly the grants that matter. See {@link permissionSetMemo}.
    //
    // [#11968] When the engine owns the seam it has ALREADY bumped, earlier
    // in this same operation and ahead of every middleware — bumping again
    // here would be a second advance for one write. Harmless to the memo
    // (which only compares equality) but not harmless on the bus: the
    // `authz.invalidated` bridge publishes per bump. The guard below is
    // therefore about message count, not about correctness.
    if (
      !this.epoch.seamOwnedByEngine &&
      (opCtx.operation === 'insert' || opCtx.operation === 'update' || opCtx.operation === 'delete')
    ) {
      this.epoch.bump('write');
    }

    // [#25251, ruling B] One system context stops short of the bypass: a
    // flow run's (`isSystem` with a `flowRunId`) — and [#25653] the rest of
    // app-authored automation's, a hook's `runAs: 'system'` and an action
    // body's (`isSystem` with the app-automation elevation mark). Their
    // writes to the four identity-assignment objects are refused here,
    // because the gates that judge those writes — the ADR-0090 D12
    // delegated-administration gate
    // below, and the identity write guard that keeps invitations and
    // memberships on the organization endpoints — all stand down for
    // `isSystem`. Every other system write, and every read, passes on to the
    // bypass unchanged. See `flow-system-identity-write-refusal.ts`.
    assertFlowSystemIdentityWriteAllowed(opCtx);

    // System operations bypass security
    if (opCtx.context?.isSystem) {
      return next();
    }

    // ADR-0056 (Option A) — declaration-derived PUBLIC-FORM grant. A public
    // form submission carries `publicFormGrant: { object }` derived from the
    // form's declared target (set by the rest-server form-submit route). It
    // authorizes ONLY create + the immediate read-back on THAT object — never
    // anything else, and never the anonymous fall-open. This lets public forms
    // work under secure-by-default (anonymous-deny) WITHOUT a deployment-configured
    // `guest_portal`, scoped to exactly the declared object (the field
    // allow-list is enforced at the route; the context is request-scoped).
    //
    // [#21062] The grant ADMITS; it never bypasses the result masker. What
    // it hands back — the created record the route echoes, a read-back —
    // passes step 4 ({@link maskOperationResult}) for the caller the grant
    // stands in for, resolved exactly as the data plane resolves it: the
    // permission sets `resolvePermissionSetsForContext` answers for the
    // grant's context (no user id, so no baseline: the deployment's guest
    // set when it registers one, otherwise none) and the posture those sets
    // read (`resolveCallerPosture`, the zero-set stand-in included). A
    // grant context never reaches the principal-less refusal below
    // ([#21908]), whatever it carries: the grant is a declaration-derived
    // admission, decided here, and the submitter is a non-system caller,
    // which is who every `maskingRule` declares itself for.
    const formGrant = opCtx.context?.publicFormGrant;
    if (formGrant && typeof formGrant === 'object' && (formGrant as { object?: string }).object) {
      const grantObject = (formGrant as { object: string }).object;
      const allowed =
        opCtx.object === grantObject &&
        ['insert', 'find', 'findOne', 'count'].includes(opCtx.operation);
      if (allowed) {
        // [#3022] The grant bypasses every downstream write gate (FLS 2.5,
        // owner anchor 3.5, tenant CHECK) — so the system-managed anchors
        // must be forced HERE, before the write is admitted. An anonymous
        // submission has no principal to backfill from and no conceivable
        // transfer authorization, so a supplied `owner_id` /
        // `organization_id` / audit column is stripped from every row (the
        // route-side field allow-list is the first net; this is the
        // data-layer boundary that holds even if a FormView declares — or
        // a zero-section form falls open to — one of these columns).
        // Ownership stays NULL for object hooks / the first-admin
        // bootstrap to assign, exactly like other anonymous-seeded rows.
        // [ADR-0138 D1] This is the form doors' half of "the guest never
        // owns"; the endpoint doors' half is the owner-anchor stamp's guest
        // branch (step 3.5), which a grant context never reaches.
        if (opCtx.operation === 'insert' && opCtx.data && typeof opCtx.data === 'object') {
          const rows = Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data];
          const stripped = new Set<string>();
          for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
            for (const field of PUBLIC_FORM_SERVER_MANAGED_FIELDS) {
              if (Object.prototype.hasOwnProperty.call(row, field)) {
                delete (row as Record<string, unknown>)[field];
                stripped.add(field);
              }
            }
          }
          if (stripped.size > 0) {
            ctx.logger.warn(
              `[security] public-form insert on '${grantObject}' supplied server-managed ` +
                `field(s) [${[...stripped].join(', ')}] — stripped: an anonymous form submission cannot set ` +
                `ownership, tenancy or audit columns`,
            );
          }
        }
        // [#21062] The masker's inputs, read BEFORE the operation runs and
        // failing CLOSED as the data plane's do: a masker that cannot know
        // its rules must not let the echo out, and refusing before `next()`
        // leaves nothing written behind a refusal. The anonymous submitter
        // acts for nobody, so there is no delegator to intersect.
        let grantCallerSets: PermissionSet[];
        try {
          grantCallerSets = await this.resolvePermissionSetsForContext(opCtx.context);
        } catch (e) {
          ctx.logger.error(
            `[security] permission resolution failed for public-form operation '${opCtx.operation}' on ` +
              `object '${opCtx.object}' — denying request (fail-closed)`,
            e instanceof Error ? e : new Error(String(e)),
          );
          throw new PermissionDeniedError(
            `[Security] Access denied: permission subsystem unavailable for ` +
              `operation '${opCtx.operation}' on object '${opCtx.object}'`,
          );
        }
        const grantCallerPosture = await this.resolveCallerPosture(opCtx.object, grantCallerSets);
        if (grantCallerPosture.unresolved) {
          const cause: UnresolvedPostureCause = grantCallerPosture.unresolvedCause ?? 'unknown';
          ctx.logger.error(
            unresolvedPostureLogLine(opCtx.object, opCtx.operation, String(opCtx.context?.userId ?? 'unknown'), cause),
          );
          throw new PermissionDeniedError(
            unresolvedPostureDenialMessage(opCtx.object, opCtx.operation, cause),
            { operation: opCtx.operation, object: opCtx.object },
          );
        }
        await next();
        this.maskOperationResult(opCtx, grantCallerSets, grantCallerPosture, null);
        return;
      }
      throw new PermissionDeniedError(
        `[Security] Access denied: public-form grant permits only create/read-back on '${grantObject}', ` +
          `not '${opCtx.operation}' on '${opCtx.object}'`,
        { operation: opCtx.operation, object: opCtx.object },
      );
    }

    // [ADR-0103] Engine-owned write guard. Fail-closed on a user-context
    // generic write to a `system`/`append-only` object whose resolved
    // affordances forbid the verb (the engine-owned default). Keyed off
    // resolveCrudAffordances, not the raw bucket, so the admin/user-writable
    // members (RBAC link tables, prefs, messaging config) — which declare
    // userActions opening their verbs — pass through to the DelegatedAdminGate
    // / RLS below. System/boot writes carry `isSystem` and short-circuited
    // above; context-less service writes carry no userId and pass this
    // guard by construction, to be refused below ([#21908] ADR-0096 D5).
    // Runs BEFORE the principal-less refusal so engine-owned
    // tables fail CLOSED for principal-less-but-user-context callers.
    assertEngineOwnedWriteAllowed(
      // [#12481] The contract's getSchema answers `ServiceObject |
      // undefined`, which satisfies the guard's `EngineOwnedSchemaLike`
      // slice directly — the pre-#12481 `as` narrowing of an `unknown`
      // return is gone. The runtime probe stays: doubles and foreign
      // engines may omit the member (the contract header's own caveat).
      typeof ql?.getSchema === 'function'
        ? ql.getSchema(opCtx.object)
        : undefined,
      opCtx.operation,
      opCtx.context,
    );

    // [ADR-0090 D12] Delegated-administration gate. Writes to the RBAC
    // link tables (assignments / bindings / direct grants / env-set
    // authoring) are a GOVERNED operation: tenant-level admins pass
    // through to the ordinary CRUD/RLS checks; delegates need a covering
    // adminScope (BU subtree + allowlist + strict containment); everyone
    // else — including holders of plain CRUD grants on these tables — is
    // denied. Runs BEFORE the principal-less refusal below so RBAC
    // tables fail CLOSED for principal-less non-system contexts.
    if (this.delegatedAdminGate) {
      await this.delegatedAdminGate.assert(opCtx);
    }

    const positions = opCtx.context?.positions ?? [];
    const explicitPermissionSets = opCtx.context?.permissions ?? [];

    // [#21908] ADR-0096 D5 strict mode, 1. permission-set resolution, and
    // [ADR-0090 D10] the delegator's sets: the CONTEXT prologue, refused or
    // resolved before any gate below runs. One method, because the security
    // service's master-detail write member (`checkControlledByParentWrite`)
    // must refuse and resolve a context exactly as this path does — see
    // {@link SecurityPlugin.resolveOperationPrincipals}, which carries each
    // step's reasoning.
    const { permissionSets, delegatorSets, delegatorContext } = await this.resolveOperationPrincipals(
      opCtx.operation,
      opCtx.object,
      opCtx.context,
    );
    // [ADR-0058 D4] What the by-id pre-image gate (step 2.7) decided about the
    // platform ownership floor for THIS write. The post-image check (step
    // 3.6) reads it so that a USING-only policy set is held, on the new row,
    // to the same write-class policies the pre-image admitted the caller by.
    // Null until step 2.7 runs. A by-id update post-image is judged on a path
    // where it did (same single id, same guard triple). A predicate update
    // never reaches 2.7, so its per-row check (step 3.6, [#19950]) keeps the
    // floor on exactly the terms its `where` scope does: step 3 composes the
    // bulk scope with no floor options either.
    let preImageFloorOpts: RlsFilterOptions | null = null;
    // [ADR-0090 D10] Its twin for the DELEGATOR of an on-behalf-of write: the
    // floor decision and coverage vouch the delegator's OWN direct by-id write
    // of this row would get ({@link delegatorOwnWriteFloorOptions}). Null on
    // the ordinary path and until step 2.7 runs; step 3.6 reads it so the
    // post-image is held to the delegator's own check as well.
    let delegatorPreImageFloorOpts: RlsFilterOptions | null = null;

    // [ADR-0066 D2/D3] Resolve the object's security posture (private flag,
    // platform-global flag, capability contract) once for the checks below.
    // [#20995] For a caller who resolved NO permission set this is the
    // stand-in that carries the object's masking rules and [#21063] its
    // per-field capability contract, and no grant-based narrowing — see
    // resolveCallerPosture, which the field projections read too.
    const secMeta = await this.resolveCallerPosture(opCtx.object, permissionSets);

    // [#3545] Fail CLOSED when the object's own posture could not be resolved.
    // #3545 accepted the API-exposure gate's fail-open on unresolvable metadata
    // because that gate is a SURFACE-AREA control while THIS middleware is the
    // authorization boundary and enforces regardless. That holds only if the
    // boundary's own inputs are trustworthy — and two of them are read from the
    // same metadata and default permissively: an unresolved `access.default`
    // reads as PUBLIC (so a plain `'*'` wildcard covers an object ADR-0066 D2
    // says it must not) and an unresolved `requiredPermissions` reads as NO
    // CONTRACT (so the D3 capability AND-gate below is skipped entirely). Both
    // are access-NARROWING declarations, so failing to read them must never
    // resolve to a grant (ADR-0049) — the same stance the permission-resolution
    // failure above and the dangling-delegator checks already take.
    //
    // Blast radius is bounded to exactly the risky case: system/boot writes
    // (`isSystem`) short-circuited above and principal-less contexts were
    // refused there ([#21908] ADR-0096 D5),
    // so reaching here means a principal asking for an object whose
    // declaration is missing — one with resolved grants, or [#20995] one
    // resolving none, whose masking rules and [#21063] field capability
    // contract come from this same posture and are unknown while it is
    // unreadable. Cold start therefore
    // does NOT trip this — that window is served by the earlier short-circuits,
    // not by the permissive default — which is why the tiered decision recorded
    // for the exposure gate (transient unavailability → fail open) can stay
    // fail-open there while the boundary itself fails closed here.
    //
    // [#10401] …and the refusal has to SAY that, because the sentence it used
    // to carry said something else. "The security posture could not be
    // resolved" describes an internal security step, so every reader — human
    // and model — read it as a permissions problem and went hunting for a
    // sharing rule to change; and it covered two conditions with two
    // different remedies (an unpublished draft, which is *publish it*, and a
    // genuinely unreadable declaration, which is not). The DENY is unchanged
    // — same `PermissionDeniedError`, same `PERMISSION_DENIED`, same 403 —
    // only the explanation is now honest about which condition this is and
    // about permissions not being the lever. Wording for both surfaces lives
    // in `unresolved-posture.ts`; see its header for the measured cost of the
    // old sentence.
    if (secMeta.unresolved) {
      const cause: UnresolvedPostureCause = secMeta.unresolvedCause ?? 'unknown';
      ctx.logger.error(
        unresolvedPostureLogLine(
          opCtx.object,
          opCtx.operation,
          String(opCtx.context?.userId ?? 'unknown'),
          cause,
        ),
      );
      throw new PermissionDeniedError(
        unresolvedPostureDenialMessage(opCtx.object, opCtx.operation, cause),
        { operation: opCtx.operation, object: opCtx.object },
      );
    }

    // [#2850 / #7626] $expand sub-reads take the FULL gate — there is no
    // waiver here any more, and the deletion is the fix.
    //
    // #2850 routed the engine's expand path back through this middleware
    // (`find` re-entered for the referenced object carrying `__expandRead`, a
    // server-set marker `executionContext` never takes from a client), which
    // is what put the referenced object's RLS and FLS on the expansion at
    // all. That part stands. What it also added was a relaxation:
    //
    //     operation === 'find' && __expandRead && !secMeta.isPrivate
    //         → skip the CRUD + requiredPermissions throw-gates
    //
    // …justified as "a PUBLIC referenced object is covered by the '*'
    // wildcard grant and thus already broadly readable, so gating the
    // EXPANSION adds no protection and only surfaces never-designed-for-
    // expand modeling gaps". Neither half of that premise held (#7626):
    //
    //   1. `secMeta.isPrivate` reads `access.default` (ADR-0066 D2 — whether
    //      a `'*'` wildcard COVERS the object), which is a different axis
    //      from the `sharingModel` OWD an object declares to scope its ROWS.
    //      `showcase_contact` declares `sharingModel: 'private'` and no
    //      `access` block, so it read as "public" and the waiver fired for it
    //      — as it did for every object that leaves `access` unset, which is
    //      almost all of them.
    //   2. "already broadly readable" was never CHECKED. The waiver asks
    //      nothing about the caller's grants, so it fired hardest for the
    //      caller who holds NONE — #2850's own pin waives the gate for a
    //      permission set with `objects: {}`. Where the premise is true the
    //      waiver is inert (the CRUD gate would pass anyway); its only
    //      non-vacuous effect is on callers the gate meant to refuse.
    //
    // Measured on the real showcase app: a `contributor`-only session 403'd
    // on `GET /data/showcase_contact/:id` received the same contact FULLY
    // materialised — all 18 fields, `email` included — through
    // `?$expand=contact` on an invoice it legitimately owns. Both gates were
    // bypassed at once, because step 2.6 below stashes `__readScope` from
    // `getEffectiveScope`, which answers `'org'` when NO set grants the op
    // (safe only because the caller is denied separately — and the waiver is
    // what stopped them being denied). So the skipped CRUD check also handed
    // plugin-sharing an org-wide read depth and dissolved the OWD row scope.
    //
    // Removing it restores one rule for every referenced object, the rule
    // #2850 already applied to the private half: an expansion may reveal only
    // rows the caller could have read directly. Nothing over-blocks a
    // legitimate lookup — `expandRelatedRecords` catches the refusal and
    // retains the bare FK id (its documented graceful degradation), so a
    // caller who cannot read the referenced object gets the id it already
    // had, not an error on the parent read.
    //
    // `__expandRead` itself stays: it is the marker the storage/comment
    // access hooks strip as a privileged widening input, and `core`'s
    // operation-private-keys list is what keeps it unforgeable from the wire.

    // 1.5. [ADR-0066 D3/⑤] requiredPermissions AND-gate — a capability
    //      prerequisite checked BEFORE the CRUD grant (ADR §Precedence): a
    //      caller missing any required capability is denied regardless of how
    //      permissive their grants are. Per-operation (⑤): only the caps for
    //      THIS operation's CRUD class (plus any all-operations caps) apply.
    if (permissionSets.length > 0) {
      const required = requiredCapsForOperation(secMeta.requiredPermissions, opCtx.operation);
      if (required.length > 0) {
        const held = this.permissionEvaluator.getSystemPermissions(permissionSets);
        const missing = required.filter((cap) => !held.has(cap));
        // [ADR-0090 D10] Both principals must hold every required capability.
        const missingDel = delegatorSets
          ? required.filter((cap) => !this.permissionEvaluator.getSystemPermissions(delegatorSets!).has(cap))
          : [];
        if (missing.length > 0 || missingDel.length > 0) {
          const allMissing = [...new Set([...missing, ...missingDel])];
          // [#7451] Two messages, two audiences — the #7414 split, applied to
          // the gate one step above the CRUD grant.
          //
          // The user's half REUSES `permission_denied` rather than adding a
          // key, and that is the classification, not laziness. A caller
          // missing a CRUD bit and a caller missing a `requiredPermissions`
          // capability are in the SAME situation: their grants do not cover
          // this action and an administrator is the remedy. "Capability" vs
          // "object permission" is a fact about our authorization model, and
          // the model is precisely what must not reach a toast — the sentence
          // would have to name capability IDs (`manage_x`) to say anything
          // more, which is internal vocabulary by construction.
          //
          // The developer half is the previous sentence BYTE FOR BYTE, logged
          // at the throw site and attached as a SIBLING of `details` (never a
          // member — `details` is what the runtime dispatcher serialises to
          // the browser; #7414 measured that, and #7450 tracks the disclosure
          // that already exists there). `code` / `statusCode` / `details`,
          // including `requiredPermissions` and `missingPermissions`, are
          // untouched: which gate answered stays fully legible to a developer.
          const developerMessage =
            `[Security] Access denied: '${opCtx.object}' (operation '${opCtx.operation}') requires capability ` +
            `[${required.join(', ')}] — ${missing.length > 0 ? 'caller' : 'the delegator'} is missing [${allMissing.join(', ')}]`;
          ctx.logger.warn(developerMessage, {
            operation: opCtx.operation,
            object: opCtx.object,
            requiredPermissions: required,
            missingPermissions: allMissing,
            userId: opCtx.context?.userId ?? 'unknown',
          });
          throw new PermissionDeniedError(
            userFacingDenialMessage(ctx, 'permission_denied', opCtx.context?.locale),
            {
              operation: opCtx.operation,
              object: opCtx.object,
              positions,
              permissionSets: explicitPermissionSets,
              requiredPermissions: required,
              missingPermissions: allMissing,
            },
            developerMessage,
          );
        }
      }
    }

    // [#12597] The referential FK-CLEAR write is exempt from the object-level
    // CRUD check — and from THAT CHECK ALONE.
    //
    // Maintainer ruling 2026-08-28 (second round, option B). Deleting a record
    // makes the engine clear every optional lookup pointing at it
    // (`deleteBehavior: 'set_null'`). That UPDATE is engine-owned referential
    // integrity, not an exercise of the caller's authority over the
    // referencing object, and it already says so: `cascadeDeleteRelations`
    // stamps the server-DERIVED `__referentialFieldClear` marker on its
    // context (#3023). The marker cannot be forged from a request —
    // `assembleExecutionContext` builds an inbound envelope from a CLOSED
    // field set and no `__` operation-private key is in it (commit f586f1a89 / #7284).
    //
    // What it fixes: a role holding full delete rights on A and NO grant at
    // all on B could delete an A only while B was EMPTY. The moment a real row
    // referenced it, the cleanup UPDATE 403'd on B and the deployment saw one
    // generic "you do not have permission" — the same button, dead, for a
    // reason no permission screen showed. #12166 moved the pre-delete reference
    // CHECK to the system identity; this is the WRITE half of the same action.
    //
    // ⛔ NOT `isSystem`. The bypass at the top of this middleware is TOTAL —
    // `content/docs/permissions/system-context.mdx`: "Elevation is total, and
    // it is not granular." Measured on the round-1 probe, it would ALSO switch
    // off field-level security on the FK column, the RLS `using` row scope and
    // the RLS post-image `check`, none of which is a referential-integrity
    // question; a declared RLS `check` that holds or not depending on the code
    // path is the declared-≠-enforced shape this project prices highest. So
    // the exemption is spelled HERE, at the one gate that refuses for a reason
    // referential integrity answers, and every later step of this middleware
    // runs unchanged — each pinned in this package's
    // `delete-reference-cleanup-system-identity.test.ts`, whose `#12597`
    // describe carries one arm per surviving guard.
    //
    // Two narrowings the bare marker would not give:
    //   • `update` ONLY. A marker rides a context, and a context reaches
    //     whatever that write's own hooks do next; the engine stamps this one
    //     on the `set_null` UPDATE alone, so any other operation carrying it is
    //     INHERITANCE, never the ruled write.
    //   • the ADR-0090 D10 delegator half goes with it, because it is the SAME
    //     object-level grant question asked of the second principal. An agent
    //     whose delegator is exempt here does not act beyond that user's reach;
    //     leaving it standing would make the delete succeed directly and refuse
    //     on-behalf-of — the invisible coupling this card exists to remove.
    //
    // ⛔ The `cascade` arm (the child-row DELETE) is NOT covered: it carries no
    // marker, keeps the operator's own delete authority, and stays excluded by
    // ruling for the third time. Deleting whole rows is data destruction, not
    // integrity maintenance.
    const referentialFieldClearWrite =
      opCtx.operation === 'update' && opCtx.context?.__referentialFieldClear === true;

    // 2. CRUD permission check ([#12597] except the referential FK clear).
    //
    // [#21079] ADR-0056 D2 — the deny baseline. NOT guarded on a resolved
    // set: a caller who resolves none is asked the same grant question over
    // its empty list, and an empty list grants nothing, so it is refused
    // here with the same `PERMISSION_DENIED` any ungranted caller gets. The
    // guard this replaced admitted that caller to every object no set
    // grants. A principal-less context never reaches this line — it was
    // refused above ({@link isPrincipalLessContext}, [#21908] ADR-0096 D5).
    if (!referentialFieldClearWrite) {
      const allowed = this.permissionEvaluator.checkObjectPermission(
        opCtx.operation,
        opCtx.object,
        permissionSets,
        { isPrivate: secMeta.isPrivate },
      );

      if (!allowed) {
        // [#7414] TWO messages, two audiences — the split #7307 made for
        // `DELETE_RESTRICTED`, reached from the authorization side and through
        // the SAME catalog.
        //
        // `message` is what a BUSINESS USER reads, because both transports
        // ship it verbatim as the body's human-readable string and Console
        // renders it as-is in a toast. It is now a localized sentence that
        // names no object, no operation and no position.
        //
        // `developerMessage` is the previous sentence BYTE FOR BYTE. Where it
        // goes is where this card had to diverge from #7307, and the reason is
        // measured, not assumed. #7423 shipped its developer half over the
        // wire on the grounds that "it discloses nothing the envelope did not
        // already carry: `dependentObject` and `object` are API names on the
        // same body". That premise does NOT hold here on both transports:
        //
        //   - `@objectstack/rest`'s `mapDataError` 403 branch builds
        //     `{ error, code, object? }` and never reads `error.details`, and
        //     that `object` is the object the ROUTE named — so `positions`,
        //     the operation, and (on a cascade) the CHILD object's API name
        //     reach the client through NOTHING but this message today;
        //   - the runtime dispatcher does spread `e.details` onto the body
        //     (`http-dispatcher.ts` → `buildApiError` → `error.details`), so
        //     there they are already disclosed.
        //
        // One error class cannot honestly have a per-transport disclosure
        // policy, and a card whose purpose is to REDUCE what a browser is told
        // must not add a new disclosure on the transport that discloses less.
        // So the developer half is NOT shipped: it goes to the server log,
        // which is where an app builder debugging a 403 already looks. It is
        // attached to the error as a SIBLING of `details`, never a member of
        // it — `details` is the field the dispatcher serialises.
        //
        // `code` / `statusCode` / `details` are untouched: one
        // `PERMISSION_DENIED` (ADR-0112), one 403, two sentences.
        const developerMessage =
          `[Security] Access denied: operation '${opCtx.operation}' on object '${opCtx.object}' ` +
          `is not permitted for positions [${positions.join(', ')}]`;
        ctx.logger.warn(developerMessage, {
          operation: opCtx.operation,
          object: opCtx.object,
          positions,
          userId: opCtx.context?.userId ?? 'unknown',
        });
        throw new PermissionDeniedError(
          userFacingDenialMessage(ctx, 'permission_denied', opCtx.context?.locale),
          { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
          developerMessage,
        );
      }

      // [ADR-0090 D10] The delegator must independently grant the same op — an
      // agent may never act beyond the reach of the user it stands in for.
      if (delegatorSets && !this.permissionEvaluator.checkObjectPermission(
        opCtx.operation,
        opCtx.object,
        delegatorSets,
        { isPrivate: secMeta.isPrivate },
      )) {
        throw new PermissionDeniedError(
          `[Security] Access denied: on-behalf-of principal may not '${opCtx.operation}' ` +
            `'${opCtx.object}' — the delegator lacks that grant (ADR-0090 D10 intersection)`,
          { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
        );
      }
    }

    // 2.6. [ADR-0057 D1] Stash the grant's access DEPTH for this object so the
    //      sharing service can widen the owner-match (owner_id IN unit-set)
    //      while still OR-ing in shares. Owner-set expansion needs the BU graph
    //      (plugin-sharing), so we pass the scope STRING, not the resolved set.
    if (permissionSets.length > 0) {
      const sc: any = opCtx.context;
      // [ADR-0090 D10 — maintainer ruling 2026-09-08, option 1] The DELEGATED
      // principal's own depth is its ceiling's DECLARED depth, and a ceiling
      // that declares none says nothing about visibility — so the delegator's
      // depth stands (`intersectDelegatedScope`). Before this, the ceiling's
      // silence was read as `own` by `getEffectiveScope`'s owner-only default
      // and every `viewAllRecords` manager collapsed to `own + shares` the
      // moment an OAuth MCP client asked on their behalf.
      //
      // ⛔ VISIBILITY DEPTH only. The ceiling's CRUD bits (step 2.5 above),
      // its `allowTransfer` refusal (step 2.9), its managed-object write
      // denies and its private-object exclusion are all decided elsewhere and
      // are untouched — see the subtraction table on the ceiling sets.
      const depthFor = (opClass: 'read' | 'write'): { agentLegScope: string; delegatorScope: string } | null => {
        if (!delegatorSets) return null;
        const delegatorScope = this.permissionEvaluator.getEffectiveScope(opClass, opCtx.object, delegatorSets, { isPrivate: secMeta.isPrivate });
        const declared = this.permissionEvaluator.getDeclaredScope(opClass, opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate });
        return { agentLegScope: intersectDelegatedScope(declared, delegatorScope).agentLegScope, delegatorScope };
      };
      // The AGENT's own depth drives plugin-sharing's owner-match for the
      // agent identity (unchanged on the non-delegated path).
      if (['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
        const delegated = depthFor('read');
        sc.__readScope = delegated
          ? delegated.agentLegScope
          : this.permissionEvaluator.getEffectiveScope('read', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate });
        // [ADR-0090 D10] Stash the DELEGATOR's own read depth SEPARATELY (not a
        // min of the two). The OWD/sharing owner-match is identity-scoped:
        // plugin-sharing re-runs the owner filter under the delegator's
        // identity + THIS depth and AND-s it in, giving a true per-identity
        // intersection. Narrowing __readScope alone would wrongly scope the
        // AGENT's identity to the delegator's depth (owner_id = agentId),
        // hiding the very rows the delegator legitimately owns.
        if (delegated) sc.__delegatorReadScope = delegated.delegatorScope;
      } else if (['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation)) {
        const delegated = depthFor('write');
        sc.__writeScope = delegated
          ? delegated.agentLegScope
          : this.permissionEvaluator.getEffectiveScope('write', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate });
        if (delegated) sc.__delegatorWriteScope = delegated.delegatorScope;
      }
      // [Ruling of record 6355206139, letter B] The EXTERNAL rung's OWD seam.
      // plugin-sharing floors an external principal's org-wide default at
      // owner_only unless a held grant's RLS speaks for this object; whether
      // one does is a question about the grants, answered here where they are
      // resolved, and handed over beside the depth above
      // (`external-owd-grant-stamp.ts`, `@objectstack/core`
      // `external-owd-floor.ts`). An internal principal is never stamped.
      if (isExternalAudienceContext(sc)) {
        const collect = (rlsOperation: string) =>
          this.collectRLSPolicies(permissionSets, opCtx.object, rlsOperation, (sc.positions ?? []) as string[], sc);
        if (['find', 'findOne', 'count', 'aggregate'].includes(opCtx.operation)) {
          stampExternalGrant(sc, opCtx.object, 'read', grantRowPolicySpeaks(collect, 'read'));
        } else if (['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation)) {
          stampExternalGrant(sc, opCtx.object, 'write', grantRowPolicySpeaks(collect, 'write', rlsOperationForVerb(opCtx.operation)));
        }
      }
    }

    // 2.7. Row-level WRITE authorization (pre-image check).
    //
    // RLS is injected as a `where` filter on the read path (step 3, via
    // `opCtx.ast`), but a single-id update/delete goes straight to
    // `driver.update(object, id, …)` / `driver.delete(object, id)` — it builds
    // no `ast`, so the row-level predicate is NEVER applied to by-id writes.
    // The result (#1985): the CRUD check passes (member_default grants edit/
    // delete) and the owner/tenant RLS that was supposed to scope the write is
    // silently bypassed — any member could modify another user's record.
    //
    // Fix: before the mutation, compute the write-operation RLS filter and
    // verify the TARGET row satisfies it. We re-read the row through the
    // engine with `{ id } AND <writeFilter>`; a `find` does not re-enter this
    // block, so there is no recursion, and read-side RLS/tenant scoping
    // compose naturally. A `null` result means the row is either gone or
    // RLS-hidden → deny. When `computeRlsFilter` returns `null` the check
    // is skipped — but since #7665 that is a far smaller class than "no
    // WRITE policy applies": an empty write-class collection now derives
    // its scope from the caller's SELECT narrowing inside
    // `computeLayeredRlsFilter`, so the skip happens only when the caller's
    // READABLE set is unbounded too (an admin set with no RLS at all, or a
    // posture-permitting superuser bypass).
    //
    // [#5492] The filter is composed BY PROVENANCE. Two of the policies that
    // can land in it are the platform's OWN ownership floor
    // (`owner_only_writes` / `owner_only_deletes`, `created_by ==
    // current_user.id` — see `platform-ownership-policies.ts`), and that floor
    // is a SECOND implementation of ownership: the one blind to every widening
    // mechanism the platform also declares (write DEPTH, an `edit`-level
    // `sys_record_share`, the `modifyAllRecords` bypass). Running it as an
    // unconditional AND made all three inert — a manager holding Modify All
    // Data and a share target holding `access_level: 'edit'` both got 403 on
    // every row they did not personally create.
    //
    // So the floor now DEFERS to the authority that owns those wideners:
    // `ISharingService`'s tri-state write verdict (#6428).
    //
    //   allow   → the declared authority REPLACES the floor (it has a positive
    //             basis: ownership at DEPTH, an `edit` share, or the bypass).
    //   abstain → record sharing does not enforce on this row at all (public
    //             object, no owner field, platform internal). The floor is the
    //             ONLY row-level write gate such objects have, so it STAYS —
    //             #5492's E2 experiment measured what collapsing this into
    //             "permitted" costs: a member's cross-creator UPDATE on an
    //             `owner_id`-less object turned 403 into 200.
    //   deny    → the floor stays. The refusal itself belongs to the sharing
    //             middleware that produced the verdict; re-raising it here
    //             would be the duplicate implementation this composition
    //             exists to remove, and could only ever narrow a surface the
    //             ruling says may not shrink.
    //
    // Layer 0 (the tenant wall) and every APP-AUTHORED policy are untouched by
    // the replacement — a declared security property stays declared (ADR-0049).
    // Note what this is NOT: `modifyAllRecords` still does not bypass
    // write-side RLS on an ordinary business posture (ADR-0066 ① is intact).
    // The platform's own floor defers to the platform's own ownership
    // authority; app-authored policies keep refusing exactly as before.
    //
    // The verb boundary is INHERITED, not restated (ADR-0111 D3): the same
    // `rlsOperation` mapping picks `checkEdit` for the update class and
    // `checkDelete` for the delete class, so an `edit` share widens update and
    // still leaves delete denied without this file knowing why.
    if (
      // update/delete today; the lifecycle verbs stay listed so the M2 ops
      // inherit the pre-image check the moment they dispatch — the CRUD bit
      // alone must never be the only row-level defense. `transfer` clears
      // the object gate via its mapped bit (#1883/#3004); `restore`/`purge`
      // are denied AT the object gate since #12497 (bits tombstoned, rows
      // retired, DESTRUCTIVE_OPERATIONS fail-closed), so this branch is
      // dormant defense-in-depth for them until the M2 batch re-adds both.
      ['update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation) &&
      permissionSets.length > 0 &&
      !!opCtx.context?.userId &&
      this.ql
    ) {
      const targetId = this.extractSingleId(opCtx);
      if (targetId != null) {
        // RLS policies declare select/insert/update/delete — map the
        // destructive lifecycle class onto its nearest write class so
        // authored policies apply (purge destroys like delete;
        // transfer/restore mutate like update). The mapping is declared once
        // ({@link rlsOperationForVerb}); `security/explain` composes a
        // lifecycle verb's row-level security through the same one.
        const rlsOperation = rlsOperationForVerb(opCtx.operation);
        // [#5492] The floor decision. Its clauses and their reasons (floor in
        // play, `allow` only, the on-behalf-of exclusion) live on
        // {@link resolvePreImageFloorDrop}, which `security/explain` asks too.
        const dropPlatformOwnershipFloor = await this.resolvePreImageFloorDrop(
          rlsOperation,
          opCtx.object,
          String(targetId),
          opCtx.context,
          permissionSets,
          !!delegatorSets,
        );
        // [commit 6feac910b] The COVERAGE VOUCH for ADR-0055 details. This gate and the
        // master gate (step 2.8, immediately below) run on the same middleware
        // pass, and 2.8's condition is a strict SUPERSET of this one: the same
        // `permissionSets.length > 0 && userId && this.ql` triple, the same
        // single target id (`extractSingleId`; with none, 2.8 judges every
        // master the write reaches instead), and one
        // additional operation (`insert`, which has no pre-image and so no
        // floor to drop). Reaching this line therefore PROVES the master gate
        // will answer the same write — the maintainer's precondition, held
        // structurally rather than by comment, and pinned per-operation in
        // `controlled-by-parent-detail-write-authority.test.ts`.
        //
        // [ADR-0090 D10] The on-behalf-of path is EXCLUDED, matching
        // `floorApplies` above. Not because the master gate misses it — 2.8
        // runs for the delegator too — but because the delegator's own filter
        // is computed separately below and keeps its floor, so vouching here
        // would drop one principal's floor and not the other's: a half-state
        // no measurement on this card covers. The delegated by-id write keeps
        // BOTH floors, exactly as before, and that residual is recorded on the
        // card rather than resolved by a guess. What bounds it by the
        // delegator is the delegator's own composition ANDed below, never a
        // dropped floor here.
        const masterGateCoversThisWrite = !delegatorSets;
        preImageFloorOpts = { dropPlatformOwnershipFloor, masterGateCoversThisWrite };
        const writeFilter = await this.computeRlsFilter(
          permissionSets,
          opCtx.object,
          rlsOperation,
          opCtx.context,
          { dropPlatformOwnershipFloor, masterGateCoversThisWrite },
        );
        // [ADR-0090 D10] The target row must satisfy BOTH principals' write
        // RLS — a by-id write on behalf of a user may only touch rows that
        // user could also touch. Compute the delegator's write filter against
        // the delegator's context (its userId/tenant substitutions) and AND
        // it into the same pre-image re-read.
        const delWriteFilter = delegatorSets
          ? await this.computeRlsFilter(delegatorSets, opCtx.object, rlsOperation, delegatorContext)
          : null;
        // [ADR-0090 D10] ...and the delegator's OWN direct by-id write of this
        // row must admit it as well. The filter above is composed with the
        // delegated path's floor exclusion, which is not the composition the
        // delegator's own write of this row gets, so it alone does not bound
        // the on-behalf-of write by what the delegator may write. The
        // delegator's own composition — its own floor decision and coverage
        // vouch, {@link delegatorOwnWriteFloorOptions} — is ANDed beside it:
        // the row must satisfy both, so this only ever narrows, and an
        // on-behalf-of write never admits a row the delegator's own write
        // refuses. The vouch holds on this path too: step 2.8 asks the master
        // gate for the delegator below.
        if (delegatorSets) {
          delegatorPreImageFloorOpts = await this.delegatorOwnWriteFloorOptions(
            rlsOperation,
            opCtx.object,
            String(targetId),
            delegatorContext,
            delegatorSets,
            true,
          );
        }
        const delOwnWriteFilter = delegatorSets && delegatorPreImageFloorOpts
          ? await this.computeRlsFilter(
              delegatorSets,
              opCtx.object,
              rlsOperation,
              delegatorContext,
              delegatorPreImageFloorOpts,
            )
          : null;
        const writeParts = [writeFilter, delWriteFilter, delOwnWriteFilter].filter(Boolean) as Record<string, unknown>[];
        // [#21771] Ruling A on the write doors: a row the caller cannot READ
        // is a row that does not exist. For the by-id write the caller
        // addressed (see {@link addressedByIdWriteId}), "can you read it?" is
        // asked before "may you write it?", and a row the read door would not
        // return answers exactly what a nonexistent id answers — the read
        // door's own producer, `recordNotFoundError`. Asked for EVERY
        // principal class: before this the question was only implicit, inside
        // the write-class re-read below, so a principal no write-class row
        // filter binds was never asked it and got the gates' 403 for a hidden
        // row and a 404 for a missing one. A caller who can read the row but
        // may not write it keeps the 403 below; nothing is disclosed to them.
        const addressedId = this.addressedByIdWriteId(opCtx, nestedInOperation, referentialFieldClearWrite);
        if (writeParts.length > 0) {
          let visible: unknown = null;
          // A re-read that THREW is not an absent row: a store fault or a
          // read-time policy refusal keeps today's denial below (#7505).
          let reReadThrew = false;
          try {
            visible = await this.ql.findOne(opCtx.object, {
              where: { $and: [{ id: targetId }, ...writeParts] },
              context: opCtx.context,
            });
          } catch {
            // A read denial (e.g. no read permission) is itself a "cannot
            // touch this row" signal — fall through to the deny below.
            visible = null;
            reReadThrew = true;
          }
          if (
            !visible &&
            !reReadThrew &&
            addressedId !== undefined &&
            (await this.callerCannotReadAddressedRow(opCtx, addressedId))
          ) {
            throw recordNotFoundError(opCtx.object, addressedId as string | number);
          }
          if (!visible) {
            // [#7451] The refusal an ordinary business user is most likely to
            // meet: they hold the object grant, and the ROW is what they may
            // not touch. A DIFFERENT situation from the CRUD-grant denial
            // above, so a different catalog key — `record_access_denied`. The
            // remedy differs too, which is the test: "ask an administrator"
            // is wrong here, because the record's owner can often share it.
            //
            // The sentence names nothing, and unlike #7414's gate this one
            // COULD have named honestly (the row is the one the caller just
            // addressed by id). It still does not: the only spellings
            // available here are the object's API name and an opaque row id,
            // and reaching a LABEL means the ladder whose last rung is the
            // API name — the exact leak #7414 refused. The user knows which
            // record they clicked.
            const developerMessage =
              `[Security] Access denied: not permitted to ${opCtx.operation} this ` +
              `'${opCtx.object}' record (row-level security)`;
            ctx.logger.warn(developerMessage, {
              operation: opCtx.operation,
              object: opCtx.object,
              recordId: targetId,
              positions,
              userId: opCtx.context?.userId ?? 'unknown',
            });
            throw new PermissionDeniedError(
              userFacingDenialMessage(ctx, 'record_access_denied', opCtx.context?.locale),
              {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                permissionSets: explicitPermissionSets,
                recordId: targetId,
              },
              developerMessage,
            );
          }
        } else if (
          addressedId !== undefined &&
          (await this.callerCannotReadAddressedRow(opCtx, addressedId))
        ) {
          // [#21771] The principal no write-class row filter binds: the read
          // question is the only row-level question asked here, so a row the
          // read door hides (a data middleware's parent-derived visibility
          // included) answers not-found before any later gate can tell it
          // apart from a missing one.
          throw recordNotFoundError(opCtx.object, addressedId as string | number);
        }
      }
    }

    // 2.8. ADR-0055 — controlled-by-parent WRITE: a detail write (insert/update/
    // delete) requires edit access to its master. The detail itself carries no
    // authored RLS (nothing to derive from either, #7665), so the #1994
    // pre-image check above is a no-op for it; this closes the by-id write
    // path by checking the master instead — and the master's own write
    // filter, since #7665, derives from its SELECT narrowing when no
    // write-class policy applies, so a select-only master gates its details
    // by visibility too. [#25012] The same gate answers a write that
    // addresses no single row: the masters of the rows it selects are each
    // judged, and one the caller may not edit refuses the whole write.
    if (
      ['insert', 'update', 'delete', 'transfer', 'restore', 'purge'].includes(opCtx.operation) &&
      permissionSets.length > 0 &&
      !!opCtx.context?.userId &&
      this.ql
    ) {
      await this.assertControlledByParentWrite(
        permissionSets,
        opCtx.object,
        opCtx.operation,
        opCtx,
        opCtx.context,
      );
      // [ADR-0090 D10] The delegator must ALSO have edit access to the master
      // — a detail write on behalf of a user requires that user's master-edit.
      if (delegatorSets) {
        await this.assertControlledByParentWrite(
          delegatorSets,
          opCtx.object,
          opCtx.operation,
          opCtx,
          delegatorContext,
        );
      }
    }

    // 2.5. Field-Level Security write enforcement.
    //
    // The client-side masker (ObjectForm / inline grid) already hides
    // non-editable fields from the UI, but that is a UX layer only —
    // a hand-crafted POST / direct ObjectQL call can still target a
    // forbidden field. We fail-closed here with an explicit 403 and
    // the offending field names, so:
    //
    //   - honest clients get an actionable error (vs. silent drop,
    //     which manifests as a confusing partial-save), and
    //   - probing clients see that the boundary is enforced (vs.
    //     getting a 200 with the field silently ignored, which
    //     reveals nothing).
    //
    // Runs BEFORE the tenant/owner auto-injection (step 3.5) so the
    // system-set fields are not subject to the user's edit
    // permissions — they are populated from the execution context,
    // not from the caller's payload.
    //
    // [#21063] Not gated on a resolved set, as 2.5a and 2.5b are not: a
    // caller who resolves none holds no capability, so the posture's
    // per-field capability contract (resolveCallerPosture) refuses every
    // capability-gated field it names — "deny on write" — and its evaluator
    // map is empty, so nothing else is refused. The verdict is
    // computeForbiddenFieldWrites, which `canWriteObject` asks too.
    if (
      (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
      opCtx.data
    ) {
      const forbidden = this.computeForbiddenFieldWrites(
        opCtx.object, opCtx.data, secMeta, permissionSets, delegatorSets,
      );
      if (forbidden.length > 0) {
        throw new PermissionDeniedError(
          `[Security] Field write denied: not permitted to edit ` +
            `[${forbidden.join(', ')}] on '${opCtx.object}'`,
          {
            operation: opCtx.operation,
            object: opCtx.object,
            positions,
            permissionSets: explicitPermissionSets,
            forbiddenFields: forbidden,
          },
        );
      }
    }

    // 2.5a. [#8993] Masked-echo write refusal.
    //
    // A caller who reads a `maskingRule` field gets `138****5678`; a client
    // that round-trips the whole record (the default shape of an AI-authored
    // form save) would then WRITE that placeholder back, silently replacing
    // the stored value with its mask. Detect the echo — a payload value that
    // is a fixed point of its own field's rule and carries the mask
    // character — and refuse loudly with 400 VALIDATION_ERROR (same stance
    // as 2.5: silent drops hide the boundary from honest clients). Callers
    // who hold the field's unmask capabilities are exempt by construction
    // (computePartialMaskRules returns nothing for them), so a privileged
    // import of literally-starred data stays possible. [#20995] Not gated on
    // a resolved set: a caller who resolves none is served the mask too, so
    // its echo is refused like anyone's.
    if (
      (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
      opCtx.data
    ) {
      const echoRules = this.computePartialMaskRules(secMeta, permissionSets, delegatorSets);
      if (Object.keys(echoRules).length > 0) {
        const echoed = this.fieldMasker.detectMaskedEchoWrites(opCtx.data, echoRules);
        if (echoed.length > 0) {
          throw new MaskedValueWriteError(opCtx.object, opCtx.operation, echoed);
        }
      }
    }

    // 2.5b. Field-Level Security READ enforcement for aggregate inputs.
    //
    // The read path relies on RESULT masking (step 4) to hide FLS-protected
    // fields, but step 4 only covers find/findOne/insert/update — and an
    // aggregate's output rows carry only aliases, so masking could never
    // recover which source field fed `sum(salary) AS total`. Without an
    // input-side gate a caller may read a protected field's statistics
    // (sum/avg/min/max reveal the value outright on a single-row group).
    // Enforce on the INPUT: any groupBy / aggregation reference to an
    // FLS-unreadable field is rejected fail-closed with the offending names
    // (mirrors the write gate in 2.5). `where`-filter probing is a
    // platform-wide class shared with find() and is not widened here.
    // [#20995] Not gated on a resolved set, as step 2.9 never was: for a
    // caller who resolves none the map is its masked fields and [#21063]
    // its capability-gated fields alone.
    if (opCtx.operation === 'aggregate') {
      // The field map (ADR-0066 D3 `requiredPermissions` AND-gate, ADR-0090
      // D10 delegator intersection — a field the agent may read but the
      // delegator may not stays forbidden) with every masked-for-this-caller
      // field folded in as forbidden: [#8993] a partial-masked field's
      // statistics leak the very span the mask hides (min/max reveal full
      // values outright on a single-row group). One derivation, shared with
      // step 2.9 and the published `getQueryableFields` — see
      // computeQueryGuardFieldPerms.
      const queryGuard = this.computeQueryGuardFieldPerms(opCtx.object, secMeta, permissionSets, delegatorSets);
      if (Object.keys(queryGuard).length > 0) {
        const ast: any = opCtx.ast ?? {};
        const referenced = new Set<string>();
        for (const g of Array.isArray(ast.groupBy) ? ast.groupBy : []) {
          const f = typeof g === 'string' ? g : g?.field;
          if (typeof f === 'string' && f) referenced.add(f);
        }
        for (const a of Array.isArray(ast.aggregations) ? ast.aggregations : []) {
          if (typeof a?.field === 'string' && a.field) referenced.add(a.field);
        }
        const forbidden = [...referenced].filter((f) => queryGuard[f]?.readable === false);
        if (forbidden.length > 0) {
          throw new PermissionDeniedError(
            `[Security] Field read denied: not permitted to aggregate ` +
              `[${forbidden.join(', ')}] on '${opCtx.object}'`,
            {
              operation: opCtx.operation,
              object: opCtx.object,
              positions,
              permissionSets: explicitPermissionSets,
              forbiddenFields: forbidden,
            },
          );
        }
      }
    }

    // 3.5. [#3004] `owner_id` — the row-ownership ANCHOR — is SYSTEM-MANAGED
    // for non-privileged writers. It is deliberately not `readonly` in the
    // schema (ownership is transferable, see registry.ts applySystemFields),
    // so the #2948 static-readonly strip never covers it; FLS doesn't gate it
    // by default; and OWD/RLS owner gates key OFF it — whoever controls the
    // value controls who may update/delete the row. So the middleware owns
    // the anchor:
    //
    //   • INSERT: an empty `owner_id` is auto-stamped to the acting user
    //     (without this the row has `owner_id = NULL` and the default
    //     `owner_only_writes` RLS policy hides it from its own creator).
    //     Batch rows included. A SUPPLIED owner that is NOT the acting user
    //     is an ownership FORGE — denied unless the caller holds the
    //     transfer grant (`allowTransfer`, or `modifyAllRecords` which
    //     implies it).
    //   • UPDATE: a supplied `owner_id` is an ownership TRANSFER (or a
    //     disown, when null) — denied without the transfer grant. The
    //     single-id no-op echo (a form save sending the unchanged owner
    //     back) is tolerated by comparing against the pre-image; a bulk
    //     change-set carrying `owner_id` has no pre-image to compare and
    //     fails CLOSED.
    //   • GUEST — [ADR-0138 D1] the guest is a principal, never an owner. For
    //     the anonymous principal ({@link isGuestEnvelope}) the step stamps
    //     nothing: there is no user id to stamp, and nothing stands in for
    //     one — never the guest, never the system principal — so an absent or
    //     empty owner is left unset. A guest-SUPPLIED owner, on insert or on
    //     update, is a forgery and is refused WHATEVER the guest is granted:
    //     the transfer grant is never consulted for it (the anchor tier keeps
    //     the transfer bit off a guest binding, and this branch does not lean
    //     on that). Who owns a guest-written row is the scenario's own
    //     metadata, and its writers never meet this step as the guest's
    //     value: a `beforeInsert` hook runs inside the engine's operation,
    //     after this middleware, and a record-change flow writes as itself.
    //     So "supplied" is told apart from "set by the scenario" by where the
    //     value came from — the payload the guest's write arrived with — and
    //     never by what the value is.
    //
    // System/boot writes carry `isSystem` and short-circuited the whole
    // middleware above — imports, OAuth provisioning, cron snapshots and
    // seed claims that legitimately write foreign/NULL owners are unaffected.
    // Under delegation (ADR-0090 D10) BOTH principals must hold the grant.
    //
    // `organization_id` auto-injection has moved to
    // `@objectstack/organizations`; its forge guard is step 3.7 below.
    //
    // [#3023] EXEMPTION — the engine's referential-integrity FK clear. When a
    // referenced record is deleted, `cascadeDeleteRelations` nulls the FK on
    // every dependent (owner_id included). That `owner_id = null` is an
    // integrity-mandated consequence of an already-authorized parent delete,
    // NOT a user disown, so the transfer guard must not fire and abort the
    // cascade. The marker rides a server-DERIVED context (never client-built —
    // same trust model as `__expandRead`), so it cannot be forged from a
    // request to slip an ordinary ownership write past the guard.
    if (
      (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
      opCtx.data &&
      typeof opCtx.data === 'object' &&
      !opCtx.context?.__referentialFieldClear
    ) {
      const isInsert = opCtx.operation === 'insert';
      const rows = (Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data]) as Record<string, unknown>[];
      // Own-property test only — never read `owner_id` through the prototype
      // chain (a polluted `Object.prototype.owner_id` must not make ordinary
      // field-only updates look like ownership writes).
      const writesOwner = (r: unknown): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && !Array.isArray(r) &&
        Object.prototype.hasOwnProperty.call(r, 'owner_id');
      // A valid owner id is a NON-EMPTY SCALAR. Anything else (array / object /
      // boolean / '' ) is neither a stampable self-owner nor a tolerable echo —
      // String()-coercing it would let `owner_id: [selfId]` pass as "self" and
      // corrupt the anchor into an array (self-lockout).
      const isScalarId = (v: unknown): v is string | number =>
        (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v));

      // Cheap pre-check: does any row actually WRITE owner_id? On update this
      // skips the whole guard (and the field-set resolution) for the common
      // path whose change-set never mentions the anchor. Insert always runs —
      // it must stamp an absent owner.
      if (isInsert || rows.some(writesOwner)) {
        const fields = await this.getObjectFieldNames(metadata, opCtx.object, ql);
        if (fields?.has('owner_id')) {
          const userId = opCtx.context?.userId;
          const denyOwnerWrite = (action: string): never => {
            throw new PermissionDeniedError(
              `[Security] Access denied: 'owner_id' on '${opCtx.object}' is system-managed — ` +
                `${action} requires the transfer grant (allowTransfer or modifyAllRecords)`,
              { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
            );
          };
          // [ADR-0138 D1] The guest branch (see the step's header). Its refusal
          // names no grant to acquire, because none admits a guest's owner.
          const guest = isGuestEnvelope(opCtx.context);
          const denyGuestOwnerWrite = (): never => {
            throw new PermissionDeniedError(
              `[Security] Access denied: 'owner_id' on '${opCtx.object}' cannot be set by an anonymous caller — ` +
                `a guest never owns a record and never assigns one, whatever it is granted. Leave 'owner_id' out ` +
                `of the request: the owner of a row a guest writes is set by the object's own hooks or ` +
                `record-change flows, and stays unset when none sets it (ADR-0138 D1)`,
              { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
            );
          };
          // Lazily evaluated + memoized (incl. a `false` result): the common
          // path pays nothing, and ADR-0090 D10 — under delegation BOTH
          // principals must independently hold the transfer grant.
          let transferGrant: boolean | null = null;
          const hasTransferGrant = (): boolean => {
            if (transferGrant === null) {
              transferGrant =
                this.permissionEvaluator.checkObjectPermission('transfer', opCtx.object, permissionSets, { isPrivate: secMeta.isPrivate }) &&
                (!delegatorSets || this.permissionEvaluator.checkObjectPermission('transfer', opCtx.object, delegatorSets, { isPrivate: secMeta.isPrivate }));
            }
            return transferGrant;
          };

          if (isInsert) {
            for (const row of rows) {
              if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
              if (!writesOwner(row) || row.owner_id == null || row.owner_id === '') {
                // Auto-stamp the acting user (batch rows included — the
                // single-record-only stamp left bulk-inserted rows NULL-owned
                // and invisible to their creator).
                if (userId) row.owner_id = userId;
                // [ADR-0138 D1 item 5] A guest is stamped with nothing, and
                // its empty owner is left UNSET: an empty string would land
                // in the anchor as a value that is neither an owner nor none.
                else if (guest && row.owner_id === '') row.owner_id = null;
              } else if (guest) {
                denyGuestOwnerWrite();
              } else if (
                !(isScalarId(row.owner_id) && userId != null && String(row.owner_id) === String(userId)) &&
                !hasTransferGrant()
              ) {
                // A supplied owner that is not the acting user (or not a valid
                // scalar id) is a forge — denied without the transfer grant.
                denyOwnerWrite('creating a record owned by another user');
              }
            }
          } else {
            // UPDATE — a supplied owner_id is a transfer/disown. Only the
            // single-id no-op echo (a form save resending the UNCHANGED owner)
            // is tolerated; an array / bulk change-set has no single pre-image
            // to compare and fails CLOSED.
            const single = !Array.isArray(opCtx.data);
            for (const row of rows) {
              if (!writesOwner(row)) continue;
              // [ADR-0138 D1] A guest assigns no ownership — not a transfer,
              // not a disown, not an echo — and no grant changes that.
              if (guest) denyGuestOwnerWrite();
              if (hasTransferGrant()) break; // authorized transfer — allow every row
              let unchanged = false;
              if (single && isScalarId(row.owner_id)) {
                const targetId = this.extractSingleId(opCtx);
                if (targetId != null && this.ql) {
                  // Read the pre-image under the CALLER's context (NOT
                  // isSystem): a form echo only makes sense for a row the
                  // caller can already see. This threads the caller's open
                  // transaction (an in-tx echo isn't spuriously denied) AND
                  // closes the owner-enumeration oracle a system read would
                  // open (a caller who can't read the row gets null → deny,
                  // indistinguishable from a non-owner).
                  //
                  // [#7505] A throw here is NOT evidence about ownership, so
                  // it no longer collapses into `unchanged = false`. That
                  // catch predates the probe distinguishing "row absent"
                  // from "could not be read": with both facts arriving as
                  // `null` it was the only available fail-closed answer, and
                  // it answered a store outage with `403 changing record
                  // ownership` — a refusal an SDK also treats as terminal.
                  // The fault now propagates (the write is still refused —
                  // this throws before `next()`), so the caller learns the
                  // store is down instead of that it tried to steal a
                  // record. The oracle is untouched: an absent row, and a
                  // row the caller cannot read, both still come back `null`
                  // and still deny below.
                  const pre = await this.getCallerPreImage(opCtx, targetId);
                  unchanged = !!pre && pre.owner_id != null && String(pre.owner_id) === String(row.owner_id);
                }
              }
              if (!unchanged) denyOwnerWrite(`changing record ownership on ${opCtx.operation}`);
            }
          }
        }
      }
    }

    // 3.6. [ADR-0058 D4] RLS WRITE `check` — post-image validation.
    //
    // `using` gates which EXISTING rows a write may target (the #1994
    // pre-image, step 2.7). `check` validates the NEW / CHANGED row
    // (post-image) on insert/update — the PostgreSQL WITH CHECK analog. We
    // compile the declared `check` clauses with the canonical compiler and
    // match the resolved FilterCondition against the post-image in-memory
    // (the single-record backend for the same filter shape, ADR-0058 D6). A
    // row that fails the check is DENIED (fail closed, D5) — never silently
    // written. A policy that declares no `check` is held to its `using`
    // (the published default), except when a sibling declares one — the
    // exact composition, and the ownership-floor exception, live on
    // `writeCheckPolicies`.
    //
    // ── [commit a016f08b8] WHICH IMAGE, on an INSERT ──────────────────────
    //
    // Both verbs judge THE ROW THAT WILL EXIST. `update` has a pre-image to
    // merge the change set onto here, though only the change set AS SENT
    // (the [#19989] note below says what that missed). `insert` could not:
    // it has no pre-image, and this middleware runs BEFORE the engine's
    // operation — so `opCtx.data` is the caller's payload as it arrived, and
    // the `beforeInsert` hooks that derive the row's real values have not run.
    //
    // A denormalised scoping field is exactly what an RLS predicate compares
    // (ADR-0055: a predicate cannot traverse a lookup) and exactly what an app
    // stamps in `beforeInsert` so a caller cannot choose it. Judging the raw
    // payload therefore inverted the policy on both sides, measured on 17.3.0:
    //
    //   • the value the app derives is NOT on the image, so the only way to
    //     pass a `check` over it was for the caller to SEND the value the hook
    //     exists to make un-sendable (same identity, same object, same second:
    //     payload with the stamped field 201, payload without it 403, and the
    //     stored row identical either way);
    //   • the value the caller sent IS on the image and is then overwritten,
    //     so an insert naming an in-scope organization on a parent belonging
    //     to ANOTHER organization PASSED the check and stored the parent's
    //     organization — a row whose stored scope the caller does not hold.
    //
    // Ruled 2026-09-07 (maintainer, 「同意」): the insert post-image becomes the
    // hook-mutated payload — the row that will be stored — so insert and
    // update judge the same thing. Mechanically that means the judgement can
    // no longer happen HERE for an insert; it is installed on the operation
    // context and run by the engine once the `beforeInsert` chain is done
    // (`OperationContext.postHookWriteImageCheck`, `@objectstack/objectql`),
    // still ahead of every producer and every statement.
    //
    // ⛔ The alternative — keep the order and write the contract that a
    // checked field must arrive from the caller — is REFUSED, not deferred:
    // it institutionalises the contradiction (the caller sending the value the
    // hook exists to make un-sendable) and needs a permanent lint to keep it.
    //
    // ── [#19950 / #19964] EVERY row a write stores ────────────────────────
    //
    // The check is a guarantee about each stored row, so a write that stores
    // several rows is judged once per row, and ONE failing row refuses the
    // whole write. Two multi-row shapes used to escape it here:
    //
    //   • an ARRAY insert was excluded by a non-array guard, so no judgement
    //     was installed and every row was stored unjudged. The seam already
    //     receives every live row of an array insert, so the guard now admits
    //     an array for `insert` (an `update` still takes one payload);
    //   • a PREDICATE update (no row address) was skipped with a log line,
    //     on the assumption that a `using`-scoped `where` governed it. That
    //     assumption fails twice: a policy that declares only `check` scopes
    //     nothing, and a `where` scoped by `using` still says nothing about
    //     the NEW row. The rows it changes are the ones the COMPOSED AST
    //     selects, known only once every middleware has run, so the same
    //     seam is installed and the engine runs it over each matched row
    //     merged with the final payload.
    //
    // ── [#19989] The BY-ID update, after its hooks ────────────────────────
    //
    // The by-id image formed HERE is the caller's pre-image merged with the
    // change set as sent, and this middleware runs before `next()` runs the
    // `beforeUpdate` chain. A hook that rewrites a checked field (a scoping
    // column stamped from a re-pointed parent, a status derived from another
    // field) therefore produced a row nobody judged, and it was stored. So a
    // by-id update installs the seam too, and the engine runs it on the one
    // row it writes, merged with the final payload.
    //
    // The judgement here STAYS. It refuses a change set whose own values the
    // check refuses, including one a hook would have overwritten with a
    // value the check admits; dropping it would admit writes refused today,
    // and this change only ever refuses more. A by-id update is now judged
    // twice: the change set as sent, here, and the stored row, in the engine.
    if (
      (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
      opCtx.data &&
      typeof opCtx.data === 'object' &&
      (opCtx.operation === 'insert' || !Array.isArray(opCtx.data)) &&
      permissionSets.length > 0 &&
      !!opCtx.context?.userId
    ) {
      const checkFilter = await this.computeWriteCheckFilter(
        permissionSets,
        opCtx.object,
        opCtx.operation,
        opCtx.context,
        preImageFloorOpts ?? undefined,
      );
      // [ADR-0090 D10] The post-image must satisfy the delegator's CHECK too —
      // an on-behalf-of write may not produce a row the delegator itself
      // could not have written.
      const delCheckFilter = delegatorSets
        ? await this.computeWriteCheckFilter(delegatorSets, opCtx.object, opCtx.operation, delegatorContext)
        : null;
      // [ADR-0090 D10] ...and the check the delegator's OWN direct by-id write
      // of this row is held to, on the floor decision its own pre-image got
      // (step 2.7, `delegatorPreImageFloorOpts`). ANDed beside the check
      // above, so it only narrows: an on-behalf-of write never stores a row
      // the delegator's own write could not.
      const delOwnCheckFilter = delegatorSets && delegatorPreImageFloorOpts
        ? await this.computeWriteCheckFilter(
            delegatorSets,
            opCtx.object,
            opCtx.operation,
            delegatorContext,
            delegatorPreImageFloorOpts,
          )
        : null;
      const checkParts = [checkFilter, delCheckFilter, delOwnCheckFilter].filter(Boolean) as Record<string, unknown>[];
      if (checkParts.length > 0) {
        // The ONE refusal, shared by every shape — so a write judged inside
        // the engine (an insert, a predicate update) and a by-id update
        // judged here answer a caller identically.
        const denyCheck = (): never => {
          this.logger.warn?.(
            `[Security] RLS check FAILED on ${opCtx.operation} '${opCtx.object}' — write denied (fail-closed)`,
          );
          // [#7451] The third end-user situation, and the only one of the
          // three the user can resolve THEMSELVES: they may edit this record,
          // just not into the state they asked for (showcase authors exactly
          // this — `check: 'owner == current_user.email'`, so a contributor
          // cannot reassign an invoice they own). Hence its own key, and copy
          // that says "change what you entered" rather than "ask an admin".
          //
          // It names nothing for a reason particular to this gate: the
          // post-image failed an authored predicate over the WHOLE row, and
          // the gate does not know which field carried the offending value.
          // Naming the object without the field would send the user hunting.
          const developerMessage =
            `[Security] Access denied: the ${opCtx.operation} would violate a row-level CHECK on '${opCtx.object}'`;
          ctx.logger.warn(developerMessage, {
            operation: opCtx.operation,
            object: opCtx.object,
            positions,
            userId: opCtx.context?.userId ?? 'unknown',
          });
          throw new PermissionDeniedError(
            userFacingDenialMessage(ctx, 'record_change_not_allowed', opCtx.context?.locale),
            { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
            developerMessage,
          );
        };
        // [#20355] The object's declared columns go with every judgement, so
        // the evaluator applies the spec's cross-field comparison class — the
        // rule driver-sql's read applies to the same policy. A comparison
        // between two columns of no shared class (text vs number, text vs a
        // file field, anything vs a formula field) is refused `INVALID_FILTER`
        // / 400 for every image, where it used to be answered by comparing
        // the two raw values and the write admitted and stored. No map (a
        // schema that cannot be loaded) judges values only, as before.
        const checkFieldOptions = await this.writeCheckFieldOptions(opCtx.object);
        // [#21109, ruling A] Every image is judged as the row it will be
        // STORED as: on each declared `date` / `datetime` / `time` column,
        // the image's value and the check's comparands go through
        // `@objectstack/core`'s `temporalStorageForm`, the rule the drivers
        // write and compare that column by, so the write and the read the
        // same policy scopes give one answer for one row. This is the one
        // step for every image this block judges, here and in the engine's
        // seams (`rls-check-stored-form.ts` says what it does and does not
        // carry). A refusal is still attributed to `checkParts`, the
        // compiled policies as they are.
        const judgeStoredForm = storedFormCheckJudge(checkParts, checkFieldOptions);
        const satisfiesCheck = (image: Record<string, unknown>): boolean => {
          try {
            return judgeStoredForm(image);
          } catch (e) {
            const refusal = crossFieldClassRefusalCarriedBy(e);
            if (refusal && checkFieldOptions?.fields) {
              // The caller's 400 names nothing from the policy; the operator
              // reading this line is told which policy and which columns.
              const fields = checkFieldOptions.fields;
              const policies = checkParts.flatMap((f) => {
                const members = compiledPolicyNameOf(f) === undefined && Array.isArray((f as { $or?: unknown }).$or)
                  ? ((f as { $or: unknown[] }).$or)
                  : [f];
                return members
                  .filter((m) => findCrossFieldClassRefusal(m as Record<string, unknown>, fields) !== null)
                  .map((m) => compiledPolicyNameOf(m) ?? '(unnamed)');
              });
              ctx.logger.warn(
                `[Security] RLS check REFUSED on ${opCtx.operation} '${opCtx.object}' (INVALID_FILTER): ` +
                  `policy ${[...new Set(policies)].map((p) => `'${p}'`).join(', ') || '(unattributed)'} — ` +
                  `${refusal.diagnostic}. Two columns are compared only within one comparison class; the ` +
                  `read this policy scopes is refused for the same reason.`,
                {
                  operation: opCtx.operation,
                  object: opCtx.object,
                  policies: [...new Set(policies)],
                  field: refusal.field,
                  operator: refusal.operator,
                  reference: refusal.reference,
                  userId: opCtx.context?.userId ?? 'unknown',
                },
              );
            }
            // [#21254] An operator the read refuses on a declared JSON-stored
            // column. The caller's 400 withholds the field and the operator
            // and says the full diagnostic is in the server log: this line.
            const jsonColumnRefusal = jsonColumnCheckRefusalCarriedBy(e);
            if (jsonColumnRefusal) {
              const policy = jsonColumnRefusal.policy ?? '(unattributed)';
              ctx.logger.warn(
                `[Security] RLS check REFUSED on ${opCtx.operation} '${opCtx.object}' (INVALID_FILTER): ` +
                  `policy '${policy}' — At ${jsonColumnRefusal.path}: ${jsonColumnRefusal.diagnostic} The ` +
                  `read this policy scopes is refused for the same reason.`,
                {
                  operation: opCtx.operation,
                  object: opCtx.object,
                  policies: [policy],
                  field: jsonColumnRefusal.field,
                  operator: jsonColumnRefusal.operator,
                  userId: opCtx.context?.userId ?? 'unknown',
                },
              );
            }
            throw e;
          }
        };
        // [insert-check commit a016f08b8a] (the original card no longer resolves)
        // The judgement the engine runs: every image it hands over
        // must pass, and the first that fails refuses the whole write. The
        // compiled filter is captured HERE — while the caller's permission
        // sets, the delegator's, the staged membership and this request's
        // context are all resolved — and only the IMAGES are deferred.
        // Deferring the compilation too would move authorization inputs into
        // the engine's timeline for no gain.
        const newWriteImageCheck = (): WriteImageCheckSeam => ({
          evaluate: (rows) => {
            for (const row of rows) {
              if (!row || typeof row !== 'object') continue;
              if (!satisfiesCheck(row)) denyCheck();
            }
          },
        });

        if (opCtx.operation === 'insert') {
          // [insert-check commit a016f08b8a] (the original card no longer resolves)
          // The engine runs it on the rows the `beforeInsert` chain
          // produced — [#19964] every row of an array insert.
          writeImageCheckSeam = newWriteImageCheck();
          opCtx.postHookWriteImageCheck = writeImageCheckSeam;
          businessCheckSeamInstalled = true;
        } else {
          const targetId = this.extractSingleId(opCtx);
          if (targetId != null) {
            // BY-ID UPDATE, the change set AS SENT. Build the image: the
            // caller's pre-image merged with the change set (so a check on
            // an unchanged field still sees its value). Unchanged by
            // [#19989], which adds the stored-row judgement below rather
            // than replacing this one (see the block note above).
            let postImage: Record<string, unknown> = { ...(opCtx.data as Record<string, unknown>) };
            if (this.ql) {
              // Shares the memoized caller pre-image with the step-3.5 owner
              // echo check — the identical (object, id, caller-context) row.
              const pre = await this.getCallerPreImage(opCtx, targetId);
              if (pre) postImage = { ...pre, ...(opCtx.data as Record<string, unknown>) };
            }
            if (!satisfiesCheck(postImage)) denyCheck();
          }
          // [#19989] A FALSY payload id (`''`, `0`) is not a row address to
          // the engine (`resolveEngineUpdateDispatch`), which then binds a
          // truthy scalar `where.id` instead and writes THAT row by id. The
          // image above, and every other by-id gate in this middleware, was
          // formed from the payload id, so what they judged is not the row
          // that would be stored. That write used to reach the driver and be
          // refused only afterwards, by the fail-closed guard below (the
          // seam was installed for a predicate path the engine never took).
          // Now that the engine runs the seam on the by-id path too, that
          // guard would no longer fire, so the write is refused HERE, before
          // anything runs: one row address, or no write. The question is put
          // to the engine's own dispatch predicate, never re-derived.
          if (targetId != null && !targetId) {
            const engineRoute = resolveEngineUpdateDispatch(opCtx.data as EngineUpdateDispatchData, opCtx.options);
            if (engineRoute.kind === 'by-id') {
              const developerMessage =
                `[Security] Access denied: the update on '${opCtx.object}' carries the payload id ` +
                `'${String(targetId)}', which addresses no row, while the engine would write the row ` +
                `'${String(engineRoute.id)}' named by where.id — so the row this gate judged is not the row ` +
                `that would be stored, and the row-level CHECK cannot vouch for it. Address the row with ` +
                `one id: update(object, { id, ...fields }) or update(object, fields, { where: { id } }).`;
              ctx.logger.warn(developerMessage, {
                operation: opCtx.operation,
                object: opCtx.object,
                positions,
                userId: opCtx.context?.userId ?? 'unknown',
              });
              throw new PermissionDeniedError(
                userFacingDenialMessage(ctx, 'record_change_not_allowed', opCtx.context?.locale),
                { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
                developerMessage,
              );
            }
          }
          // The stored-row judgement, installed on EVERY update and run by
          // the engine once the payload is final (a write it never runs
          // fails CLOSED after `next()`):
          //
          //   • [#19989] BY-ID — the one row it writes, merged with the
          //     payload the `beforeUpdate` chain left;
          //   • [#19950] PREDICATE — every row the composed AST selects, each
          //     merged with the final payload. That covers a null id and a
          //     falsy one the engine routes to its predicate path, which is
          //     then judged BOTH ways: its by-id image above, and every
          //     matched row. Without the seam a falsy id would carry a bulk
          //     update past the per-row check on a change-set-only image.
          //
          // If no image can be formed the write is not admitted: the engine
          // refuses an update it cannot route, and a seam it never runs
          // fails CLOSED after `next()`.
          writeImageCheckSeam = newWriteImageCheck();
          opCtx.postHookWriteImageCheck = writeImageCheckSeam;
          businessCheckSeamInstalled = true;
        }
      }
    }

    // 3.7. [ADR-0095 D1 / #2937 / Finding 1] Layer 0 tenant post-image check
    // for INSERT and UPDATE.
    //
    // The tenant wall (Layer 0) is AND-composed onto reads and onto the
    // update/delete PRE-image, but two write paths escaped it because they
    // carry a `organization_id` VALUE that the pre-image/AST scoping never
    // inspects:
    //
    //   • INSERT has no pre-image and builds no AST, so a member could `insert`
    //     a row bearing a FORGED `organization_id` (another org) and land it in
    //     the victim tenant (the enterprise auto-stamp only fills a MISSING
    //     value, never overwrites a supplied one).
    //   • UPDATE (Finding 1 / BLOCKER): the pre-image check (step 2.7) validates
    //     only that the caller may touch the EXISTING row (old org == A); it
    //     never sees the NEW value. `organization_id` is auto-stamp-insert-only,
    //     FLS doesn't protect it, server-side `readonly` isn't enforced, and
    //     business RLS may not govern the column at all — so a member owning a
    //     row R in org A could `update` R with `{organization_id: victim org B}`
    //     and MOVE the row into another tenant, where it becomes visible. This
    //     is a cross-tenant write by any member.
    //
    // Both close identically here: a SUPPLIED (non-empty) `organization_id` in
    // the write payload must satisfy the SAME Layer 0 filter the read side uses
    // (isolation active, tenant object, platform-admin posture exemption,
    // fail-closed on a missing active org). For UPDATE that bounds a re-point
    // by the caller's organization scope, and [#24822] a re-point the wall
    // admits is STORED as sent. Under `isolated` the only value that passes is
    // the caller's active org (which, since the pre-image already scoped the
    // target to that org, equals the row's current org), so a re-point to any
    // OTHER tenant is denied. Under `group` a re-point to another organization
    // of the membership set is admitted and stored there, and one outside the
    // set is denied. On an app object's platform-injected column, the seam
    // below declares `judgesOrganization`, so the engine's static-`readonly`
    // strip leaves the admitted value on the row for this wall's verdict
    // instead of taking it and keeping the row's own organization in silence.
    // A `sys_` or platform-internal object, and an AUTHORED read-only
    // `organization_id`, keep that strip. A bulk update carrying a
    // cross-tenant `organization_id` change-set is caught too (the check
    // inspects the change-set value here, and [#20013] every stored row in the
    // engine).
    //
    // [#22278] The invariant, stated whole: wherever the wall applies to a
    // non-system UPDATE, the row's organization after the write is one the
    // wall admits. So an update that EMPTIES the column (`null` or `''`) is
    // refused as well — a re-point to NO tenant, not only to another one.
    // Judging only a value that NAMES an organization left that move
    // unjudged on both halves below, and an organization-less row is not
    // inert: on an ordinary tenant object it drops out of every reader's
    // scope, and on the organization-scoped grant tables
    // (`sys_user_position`, `sys_user_permission_set`) `@objectstack/core`'s
    // `grantAppliesInTenant` reads it as a grant that applies in EVERY
    // organization. The stored organization is judged on every non-system
    // update path — the payload as sent here, and the row the engine is
    // about to store (by id and by predicate) below.
    //
    // Scope: on INSERT only a SUPPLIED `organization_id` is validated — an
    // ABSENT or empty value is the organizations-plugin auto-stamp's
    // responsibility, and INSERT keeps that rule. On UPDATE nothing stamps an
    // emptied value back, so there the column is judged whenever the write
    // sets it, empty included; an update that doesn't touch `organization_id`
    // carries no value here, so ordinary writes are unaffected. [#20013]
    // "Supplied" includes a value the engine's `beforeInsert` /
    // `beforeUpdate` chain wrote: that half is judged on the stored row,
    // below. A pure plugin-security deployment has no
    // isolation active (Layer 0 → null), so this is ordering-independent w.r.t.
    // the auto-stamp middleware. System / boot writes carry `isSystem` and
    // short-circuited the whole middleware above, so legitimate cross-org moves
    // (import engine, migrations, plugin SYSTEM_CTX) are unaffected. A true
    // platform admin on a posture-permitting object is exempt via Layer 0 (same
    // rule as reads/insert).
    //
    // [ADR-0105 D5] BULK inserts are covered here too. The check previously
    // required a non-array payload, so an `insert` of an ARRAY of rows could
    // carry a forged `organization_id` per row and never meet the wall — the
    // same defect #2937 closed for the single-row shape, one call-site down
    // (AGENTS.md #10: a `case` label is not enforcement, check the call site).
    //
    // This validates SUPPLIED values only; it never fills an absent one.
    // Auto-stamping `organization_id` stays with the enterprise
    // `@objectstack/organizations` runtime (its Middleware A), which is also
    // what ACTIVATES every walled posture — so a deployment that reaches this
    // code with a walled posture always has the stamper installed. Keeping the
    // stamp there means a forged `org-scoping` registration yields NULL-org
    // rows that the wall hides, i.e. a broken deployment rather than a working
    // unlicensed one; validation stays here because it is a security property,
    // not a packaging one.
    if (
      (opCtx.operation === 'insert' || opCtx.operation === 'update') &&
      opCtx.data &&
      typeof opCtx.data === 'object' &&
      !!opCtx.context?.userId
    ) {
      const writeRows: Record<string, unknown>[] = (
        Array.isArray(opCtx.data) ? (opCtx.data as unknown[]) : [opCtx.data as unknown]
      ).filter((r: unknown): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && !Array.isArray(r),
      );

      // [#25062] The wall itself, its scope pre-test, its parts and every
      // judgement of a row, is composed by ONE method,
      // {@link SecurityPlugin.composeWriteTenantWall}, which carries each
      // arm's reasoning; this step throws what it answers. The write PREVIEW
      // asks the same method for each row ({@link SecurityPlugin.writeWallVerdict},
      // which `validate()` reads through `registerWriteWallVerdict`), so the
      // preview and the write hold a row to one spelling of the wall.
      const wall = await this.composeWriteTenantWall(
        opCtx.object,
        opCtx.operation,
        opCtx.context,
        writeRows,
        !Array.isArray(opCtx.data),
        { permissionSets, delegatorSets, delegatorContext },
        { positions, permissionSets: explicitPermissionSets },
      );
      // The scope pre-test first ("you have no active organization" is the
      // actionable half), then the payload as the caller SENT it.
      const payloadRefusal = wall.preTest ?? wall.judgePayload(writeRows);
      if (payloadRefusal) this.raiseWriteWallRefusal(payloadRefusal);

      // ── [#20013] The wall on the STORED row, after the hooks ─────────────
      //
      // Everything above judges `opCtx.data`, the payload as the caller SENT
      // it, and runs before `next()` runs the engine's `beforeInsert` /
      // `beforeUpdate` chain. A hook that writes `organization_id` (derived
      // from another payload field, a parent, a lookup) therefore produced a
      // value the wall never saw, and the row was stored in whatever
      // organization it named. Measured on driver-sql and driver-sqlite-wasm,
      // `isolated` posture: an insert, an array insert, a by-id update and a
      // predicate update were all admitted with the row stored outside the
      // caller's organization scope.
      //
      // So the wall also judges the row the engine is about to store, in the
      // seam the row-level `check` already uses
      // (`OperationContext.postHookWriteImageCheck`): the rows the insert
      // chain produced, the prior row merged with the final payload on a
      // by-id update, and every matched row merged with it on a predicate
      // update. The predicate is the SAME `tenantParts` — composed once above,
      // with this request's caller and delegator contexts — so a stored row is
      // held to exactly the wall a supplied value is. On an update the image
      // carries the row's current organization whenever the final payload
      // leaves the column alone; that row was selected under this same wall
      // (step 2.7's pre-image on the by-id path, the composed AST on the
      // predicate path), so an update that does not touch the column clears
      // it and nothing ordinary moves.
      //
      // The seam is installed whenever the wall applies to the write — a
      // walled posture, a tenant object, a caller Layer 0 does not exempt —
      // and NOT only when a business `check` does: step 3.6 installs its own
      // judgement only when a `check` applies, and the common tenant object
      // declares none. When step 3.6 installed one, the two are composed
      // into the one handle the engine runs, in the order this middleware
      // judges in (the `check`, then the wall).
      //
      // The judgement above STAYS. It refuses a supplied value a hook would
      // have overwritten with an in-scope one; dropping it would admit writes
      // refused today, and this change only ever refuses more.
      //
      // Array UPDATE payloads are left as step 3.6 leaves them: the engine
      // takes one payload per update, so the seam judges a single payload.
      //
      // [#22278] On an UPDATE the stored row is held to the whole invariant:
      // an image whose organization a hook (or the payload) EMPTIED is
      // refused, not skipped as "names no organization". An update that
      // leaves the column alone hands over the row's own organization — the
      // one the pre-image or the composed AST selected it under — so it
      // clears this exactly as before.
      //
      // [#24821] A crossing platform operator's insert with no active
      // organization installs the seam too: its own Layer 0 is `null`, so
      // `tenantParts` can be empty while its rows still need somewhere to
      // land. With no wall part the per-row loop below admits every row.
      if (wall.storedImage) {
        const storedImage = wall.storedImage;
        const businessCheck = writeImageCheckSeam;
        writeImageCheckSeam = {
          evaluate: (rows) => {
            const landing = storedImage.judgeLanding(rows);
            if (landing) this.raiseWriteWallRefusal(landing);
            businessCheck?.evaluate(rows);
            for (const row of rows) {
              if (!row || typeof row !== 'object') continue;
              const refused = storedImage.judgeRow(row);
              if (refused) this.raiseWriteWallRefusal(refused);
            }
          },
          // [#24822 · ADR-0105 D5] Whether the wall JUDGES the write's
          // organization, so the engine leaves a caller's explicit value on
          // the row for this verdict instead of stripping it as `readonly`.
          // Composed with the parts (see `judgesOrganization` there), and
          // set only where it holds, so the strip runs as before elsewhere.
          ...(storedImage.judgesOrganization ? { judgesOrganization: true } : {}),
        };
        opCtx.postHookWriteImageCheck = writeImageCheckSeam;
        tenantWallSeamInstalled = true;
      }
    }

    // 2.9. Field-level predicate guard (anti filter-oracle, objectui#2251).
    // FieldMasker (step 4) only strips hidden fields from RESULTS — a
    // caller could still probe a hidden field's value by filtering /
    // sorting / grouping on it (row presence is the oracle; the objectui
    // /data surface makes URL-driven predicates first-class). Reject such
    // queries outright — silent predicate dropping would change query
    // semantics unpredictably. MUST run against the CALLER's OWN predicate,
    // before the RLS injection below: RLS / sharing filters legitimately
    // reference fields the caller cannot read (e.g. owner_id) and must not be
    // rejected.
    if (opCtx.ast) {
      // [ADR-0090 D10] A field readable only by the agent is not queryable on
      // the delegator's behalf, and [#8993] a field this caller sees
      // PARTIALLY MASKED is just as probe-able as a hidden one — both are
      // folded in as non-queryable by the one derivation this guard shares
      // with step 2.5b and the published `getQueryableFields`
      // (computeQueryGuardFieldPerms).
      const guardPerms = this.computeQueryGuardFieldPerms(opCtx.object, secMeta, permissionSets, delegatorSets);
      if (Object.keys(guardPerms).length > 0) {
        // [#2982 follow-up] For a bulk WRITE the caller's own predicate is
        // `opCtx.options.where` (untouched); `opCtx.ast.where` may ALREADY
        // carry an owner-match that plugin-sharing's write branch composed in
        // — and plugin-sharing is a SIBLING middleware whose registration
        // order relative to this one is not guaranteed. Guarding the injected
        // AST would 403 a legitimate bulk write on an object whose owner_id is
        // FLS-hidden, purely because a sibling filter mentioned it. Inspect
        // the caller's own predicate so the guard is independent of middleware
        // order and never mistakes an injected filter for a probe. Reads keep
        // guarding the ast: the read seed is the caller's query verbatim and
        // this middleware runs before its own RLS injection.
        const guardTarget: Record<string, unknown> =
          opCtx.operation === 'update' || opCtx.operation === 'delete'
            ? { where: opCtx.options?.where }
            : (opCtx.ast as unknown as Record<string, unknown>);
        assertReadableQueryFields(guardTarget, guardPerms, opCtx.object);
      }
    }

    // 3. RLS filter injection. The policy collection + field-existence
    // safety + compile (incl. the fail-closed deny sentinel) is shared with
    // the public getReadFilter service via computeRlsFilter, so the engine
    // find-path and the analytics raw-SQL path enforce identical scoping.
    //
    // [#7809] `opCtx.operation` is passed RAW here — no `purge -> delete`,
    // `transfer|restore -> update` normalisation like the 2.7 gate above
    // does at `rlsOperation` (through `rlsOperationForVerb`, the one
    // declaration of that mapping). That asymmetry is deliberate and safe, but ONLY
    // because of an invariant that lives in another package: the engine's
    // middleware dispatch vocabulary (`OperationContext['operation']`) has
    // seven members and none of them is a destructive lifecycle verb, and
    // middleware is reachable only through the private
    // `executeWithMiddleware(ctx: OperationContext, …)`. So no `purge` /
    // `transfer` / `restore` can arrive here to be mis-derived.
    //
    // Measured, not assumed — a real engine driven through every public
    // method dispatches exactly `find/findOne/count/aggregate` (with ast),
    // `insert/update/delete` by-id (no ast) and bulk `update`/`delete` (with
    // ast). The 2.7 gate normalises anyway because it is pre-wired for the
    // M2 ops (#1883); this path is not, and does not need to be while the
    // invariant holds.
    //
    // ⚠️ The invariant is PINNED, in the package that owns it:
    // `packages/objectql/src/engine-middleware-operation-vocabulary.test.ts`.
    // If a recycle bin (#3146) ever makes one of those verbs dispatchable,
    // that pin goes red first — and THIS site and the D10 delegator half
    // below are what must normalise before it can go green again, by
    // reading `rlsOperationForVerb` (`lifecycle-verb-rls-operation.ts`), the
    // mapping the 2.7 gate and `security/explain` already read — never a
    // second inline copy of it.
    if (opCtx.ast) {
      const extra: Record<string, unknown>[] = [];
      // [#15813] The layered split rather than `computeRlsFilter`, composed
      // here with the SAME `andComposeLayers` that wrapper uses — so the
      // injected predicate is byte-identical to before, and the Layer 0
      // verdict that produced it is in hand to be RECORDED below.
      const layered = await this.computeLayeredRlsFilter(
        permissionSets,
        opCtx.object,
        opCtx.operation,
        opCtx.context,
      );
      const rlsFilter = andComposeLayers(layered.layer0, layered.layer1);
      if (rlsFilter) extra.push(rlsFilter);
      let tenantLayer0Verdict = layered.tenantLayer0Verdict;
      // ADR-0055: a controlled_by_parent object derives its read scope from the
      // master record — `masterFK IN (<the master ids this caller may read>)`,
      // AND-ed in as the engine's `ReadableIds` leaf over the master
      // (ADR-0139 D6), which the engine composes at its executor boundary
      // from this very service's `canReadObject` / `getReadFilter` of the
      // master. Nothing for a write verb's predicate (ADR-0139 D1).
      const cbpFilter = this.computeControlledByParentFilter(opCtx.object, opCtx.operation, opCtx.context);
      if (cbpFilter) extra.push(cbpFilter);
      // [ADR-0090 D10] AND the delegator's read RLS (and CBP) into the same
      // where — the delegated principal sees only rows BOTH may see. Computed
      // against the delegator's own context so its userId/tenant substitutions
      // are faithful.
      if (delegatorSets) {
        const delLayered = await this.computeLayeredRlsFilter(delegatorSets, opCtx.object, opCtx.operation, delegatorContext);
        const delRls = andComposeLayers(delLayered.layer0, delLayered.layer1);
        if (delRls) extra.push(delRls);
        // [#15813] Two Layer 0 walls are AND-ed onto this operation; the
        // recorded verdict is their intersection — what the composed wall
        // decided, not the caller's half alone.
        tenantLayer0Verdict = intersectTenantLayer0Verdicts(tenantLayer0Verdict, delLayered.tenantLayer0Verdict);
        // The delegator's half writes the same leaf over the master; the
        // engine composes it with the request's delegated context, whose
        // scope `getReadFilter` answers as the ADR-0090 D10 intersection
        // (ADR-0139 D5.1 as amended), so both halves carry one subquery
        // twice — correct rows, measured, and left as it is.
        const delCbp = this.computeControlledByParentFilter(opCtx.object, opCtx.operation, delegatorContext);
        if (delCbp) extra.push(delCbp);
      }
      // [#21829] The write doors' rule on the PREDICATE door: a row the
      // caller cannot read is not matched. For the update or delete the
      // caller addressed ({@link addressedPredicateWrite}), the matched set
      // is narrowed to the rows the read door returns for the caller's own
      // predicate ({@link readableRowsScopeForPredicateWrite}): readable ∩
      // writable. Composed here, before `next()`, so it binds the engine's
      // matched-row read, its per-row hook dispatch and the driver write
      // alike — a hidden row is not written, not counted and not refused.
      if (this.addressedPredicateWrite(opCtx, nestedInOperation, referentialFieldClearWrite)) {
        const readable = await this.readableRowsScopeForPredicateWrite(opCtx);
        if (readable) extra.push(readable);
      }
      // [#15813 / ADR-0131 D8] RECORD the Layer 0 verdict on the operation —
      // the seam ruled on #15706 (option (i)): the wall states what it
      // decided, and the bulk data-event producer in the engine
      // (`publishBulkDataEvent` → `bulkEventOrganizationId`) reads it
      // instead of re-deriving the wall from posture + context + schema,
      // which structurally could not see the deployment's #12699 carve-out
      // and mislabelled that population. Written for every operation whose
      // predicate the wall was composed onto (this branch: reads and
      // predicate writes); a system context exits before this point and a
      // by-id write carries no `ast`, so neither records anything — absence
      // is a distinct, honest state ("no wall was composed"), never `none`.
      // The member is declared on `OperationContext` (`@objectstack/objectql`)
      // and its shape by `TenantLayer0VerdictSchema` (`@objectstack/spec`).
      opCtx.tenantLayer0Verdict = tenantLayer0Verdict;
      // [#8220, A of #7929] This is one of the two read-scope MERGE
      // BOUNDARIES, and the only frame that knows which subtree the caller
      // did not write — so the provenance mark is stamped here, before the
      // shapes blur into one `$and`.
      //
      //  - Every injected scope is marked `'policy'`: a cross-field refusal
      //    raised from inside it keeps the #7929 redaction.
      //  - The caller's own predicate is marked `'author'` — but ONLY when
      //    this middleware can positively vouch for it: `opCtx.ast.where`
      //    still IS `opCtx.options.where`, the caller's verbatim predicate
      //    (the same identity step 2.9 above leans on). If a sibling
      //    middleware (plugin-sharing) already composed its own filter in,
      //    or the engine rewrote the tree (context tokens), identity fails
      //    and NOTHING is vouched — the whole tree stays unmarked, which
      //    withholds. Fail closed: the mark is permission to reveal, never
      //    a guess; a wholesale mark on a tree that might contain another
      //    plugin's policy would disclose it.
      //
      // Marking is on the OBJECTS, so it survives the `$and` wrapper below
      // and any sibling's later wrapping by reference. `markFilterSubtreeProvenance`
      // never overwrites an existing mark and no-ops on frozen input.
      for (const scope of extra) markFilterSubtreeProvenance(scope, 'policy');
      const callerWhere = opCtx.ast.where;
      if (
        callerWhere &&
        typeof callerWhere === 'object' &&
        callerWhere === (opCtx.options as { where?: unknown } | undefined)?.where
      ) {
        markFilterSubtreeProvenance(callerWhere, 'author');
      }
      if (extra.length) {
        opCtx.ast.where = opCtx.ast.where
          ? { $and: [opCtx.ast.where, ...extra] }
          : extra.length === 1
            ? extra[0]
            : { $and: extra };
      }
    }

    await next();

    // [commit a016f08b8] FAIL CLOSED on a seam that was never run. `honoured` is set by
    // the engine immediately before it calls the judgement, so an unset flag
    // means one thing only: the write went past without its stored-row
    // `check` being evaluated at all — an engine that does not implement the
    // seam, or a host that executed the operation itself. Every insert and
    // every update step 3.6 judges is covered ([#19950], [#19989] by-id
    // included). The row may already be
    // stored, which is exactly why this is LOUD: the alternative is a gate
    // that silently stops gating and a deployment that never finds out.
    // ⛔ Do not soften this into a warning: a middleware that cannot say a
    // write was checked must not report that it was.
    if (writeImageCheckSeam && writeImageCheckSeam.honoured !== true) {
      const developerMessage = businessCheckSeamInstalled
        ? `[Security] Access denied: the ${opCtx.operation} on '${opCtx.object}' was executed without the row-level CHECK ` +
          `being evaluated — the engine did not run OperationContext.postHookWriteImageCheck. ` +
          (tenantWallSeamInstalled ? `The Layer 0 tenant wall was not evaluated on the stored row either. ` : '') +
          `The write is NOT vouched for by this gate.`
        : `[Security] Access denied: the ${opCtx.operation} on '${opCtx.object}' was executed without the Layer 0 ` +
          `tenant wall being evaluated on the stored row — the engine did not run ` +
          `OperationContext.postHookWriteImageCheck. The write is NOT vouched for by this gate.`;
      // Contract arg order (#5637): `error(message, error?: Error, meta?)` —
      // the structured fields ride in the THIRD position. There is no `Error`
      // to carry here: nothing threw, the seam simply never ran.
      ctx.logger.error(developerMessage, undefined, {
        operation: opCtx.operation,
        object: opCtx.object,
        positions,
        userId: opCtx.context?.userId ?? 'unknown',
      });
      throw new PermissionDeniedError(
        userFacingDenialMessage(ctx, 'record_change_not_allowed', opCtx.context?.locale),
        { operation: opCtx.operation, object: opCtx.object, positions, permissionSets: explicitPermissionSets },
        developerMessage,
      );
    }

    // 4. Field-level security: mask restricted fields in returned records.
    // Covers reads AND the record echoed back by a write — otherwise a caller
    // with edit-but-not-field-read could PATCH a record and read a
    // read-protected field back out of the mutation response (FLS bypass).
    // Field WRITES are already blocked upstream (detectForbiddenWrites); this
    // closes the read leak on the response image. [#21062] The body is
    // {@link maskOperationResult}, which the ADR-0056 public-form grant
    // branch above reads too — one masker for both.
    this.maskOperationResult(opCtx, permissionSets, secMeta, delegatorSets);
  });
}
