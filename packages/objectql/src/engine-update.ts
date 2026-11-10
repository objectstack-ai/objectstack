// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Update" section of `ObjectQL`: the bodies of `update`
 * moved out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link UpdateFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link UpdateHost}: exactly the `ObjectQL`
 * members they read, private ones included. Every stub hands its body, by a
 * `.call`, the same host: `updateHost` in `engine-facet-hosts.ts`, built once
 * per engine by the class's static block. Methods go as closures that call them
 * on the engine at call time, so a subclass override or an instance spy is
 * still the one reached; fields and accessors go as GETTERS, read when the body
 * reads them, as they were on the class, and a field a body assigns goes with a
 * SETTER that assigns it on the engine.
 *
 * `ObjectQL` here is `ObjectQLStatics` (imported AS `ObjectQL`): forwarders to the
 * statics the bodies read, private ones included, which the class fills in a
 * static block; the class as a type is `ObjectQLClass`.
 *
 * Values that stayed in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import type { DroppedFieldsEvent, EngineUpdateOptions, HookContext, QueryAST } from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
import { collectComposableReadableIds } from './filter-comparand-shape.js';
import { retiredSecretSlots, secretFieldsWritten } from './engine-secret-internal-fields.js';
import type { PendingSecretRow, SecretHandleSlot } from './engine-secret-internal-fields.js';
import { referencesCheckedBeforeRules } from './engine-referential-integrity.js';
import { mergeDriverOptionsIntoHookView } from './engine-driver-options.js';
import { recordNotFoundError } from '@objectstack/core';
import { SummaryRecomputeError } from './summary-errors.js';
import { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { UpdateHookResultNotWriteShapeError, isUpdateResultShape } from './verb-hook-result-shape.js';
import { DuplicateRecordError } from './duplicate-record-error.js';
import { NotNullRefusalError, envelopeDriverWriteRefusal } from './not-null-refusal-error.js';
import { redactBoundStatement } from '@objectstack/types';
import { ORGANIZATION_OBJECT } from './tenancy/system-write-organization.js';
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { assertRecordCurrencyCodes, touchesRecordCurrency } from './validation/record-currency-code.js';
import { homeAmountsTouched, planHomeAmounts, projectHomeAmounts, settleBulkHomeAmounts } from './home-amount-projection.js';
import { stripSearchCompanion } from './search-companion.js';
import { declaredOptionLabels } from './formula-option-labels.js';
import { ValidationError, coerceBooleanFields, normalizeBlankTypedValues, normalizeMultiValueFields, normalizeNumericStringValues, validateRecord, validateRecordInScope } from './validation/record-validator.js';
import { emitValidationAdvisories, evaluateValidationRules, hasParentScopedReadonlyWhenInPayload, hasParentScopedRequiredWhen, hasReadonlyWhenInPayload, needsPriorRecord, stripReadonlyFields, stripReadonlyWhenFields, stripReadonlyWhenFieldsMulti } from './validation/rule-validator.js';
import { recordHookPayloadWrites } from './hook-write-provenance.js';
import { dispatchHooksExplainingWithheldReadonly } from './hook-withheld-readonly-fault.js';
import { resolveMasterDetailRelation } from './master-detail.js';
import { declaredColumnSet, rowsWithDeclaredColumnsOnly, selectedStoredColumns, storedColumnsLeftUnwritten, withDeclaredColumnsOnly, withSelectedColumnsAnswered } from './declared-read-columns.js';
import { externalPredicateWriteRefusal, isExternalDriverFloor } from './external-driver-floor.js';
import { ENGINE_UPDATE_REJECT_MESSAGE, engineUpdateDispatchRejectError, resolveEngineUpdateDispatch } from './engine-update-dispatch.js';
import type { EngineUpdateDispatchData, EngineUpdateDispatchInput } from './engine-update-dispatch.js';
import {
  ENGINE_UPDATE_OPTION_KEYS, ENGINE_WHERE_SLOTS, WRITE_PRECONDITION_OPTION, applyStoredExpressionsToPatch,
  computeStoredExpressions, declaredDatetimeLowering, foldEngineOptionAliases, hydrateWriteFormulas,
  lowerWhereFilterArray, masterIdOf, planStoredExpressions, rejectUnknownEngineOptions,
  replacedStoredExpressionFields, settleBulkStoredExpressions, shouldSkipStateMachine, staticReadonlyStoredView,
  stripComputedWriteFields, undeclaredWriteFieldErrors, updateStaticReadonlySubject, writeFailureLogMeta,
} from './engine-top-level.js';
import type { OperationContext, StoredExpressionServing } from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link UpdateFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface UpdateHost {
  readonly _registry: ObjectQLClass['_registry'];
  admittedViolationSink: ObjectQLClass['admittedViolationSink'];
  assertBulkPerRowHookBudget: ObjectQLClass['assertBulkPerRowHookBudget'];
  assertReferencesResolve: ObjectQLClass['assertReferencesResolve'];
  assertWriteAllowed: ObjectQLClass['assertWriteAllowed'];
  buildDriverOptions: ObjectQLClass['buildDriverOptions'];
  buildEvalUser: ObjectQLClass['buildEvalUser'];
  buildHookApi: ObjectQLClass['buildHookApi'];
  buildPerRowAfterContexts: ObjectQLClass['buildPerRowAfterContexts'];
  buildProvenance: ObjectQLClass['buildProvenance'];
  buildReferentialFieldClear: ObjectQLClass['buildReferentialFieldClear'];
  buildSession: ObjectQLClass['buildSession'];
  buildUser: ObjectQLClass['buildUser'];
  dispatchPerRowBeforeHooks: ObjectQLClass['dispatchPerRowBeforeHooks'];
  dispatchUnscopedMultiWriteHooks: ObjectQLClass['dispatchUnscopedMultiWriteHooks'];
  encryptSecretFields: ObjectQLClass['encryptSecretFields'];
  enforceTransactionOrigin: ObjectQLClass['enforceTransactionOrigin'];
  executeWithMiddleware: ObjectQLClass['executeWithMiddleware'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQLClass;
  formulaFaultSink: ObjectQLClass['formulaFaultSink'];
  formulaOptionLabels: ObjectQLClass['formulaOptionLabels'];
  getDriver: ObjectQLClass['getDriver'];
  getSchema: ObjectQLClass['getSchema'];
  hasHooksFor: ObjectQLClass['hasHooksFor'];
  homeAmountServing: ObjectQLClass['homeAmountServing'];
  inAfterAbortUnit: ObjectQLClass['inAfterAbortUnit'];
  invalidateOrganizationProbe: ObjectQLClass['invalidateOrganizationProbe'];
  readonly logger: ObjectQLClass['logger'];
  mediaValueShapeStrictFor: ObjectQLClass['mediaValueShapeStrictFor'];
  opensAfterAbortUnit: ObjectQLClass['opensAfterAbortUnit'];
  permissionResolution: ObjectQLClass['permissionResolution'];
  persistSecretRows: ObjectQLClass['persistSecretRows'];
  priorMasterIdsCallerReads: ObjectQLClass['priorMasterIdsCallerReads'];
  projectHomeAmountsOntoPatch: ObjectQLClass['projectHomeAmountsOntoPatch'];
  publishBulkDataEvent: ObjectQLClass['publishBulkDataEvent'];
  publishDataEvent: ObjectQLClass['publishDataEvent'];
  readUpdatePriorRow: ObjectQLClass['readUpdatePriorRow'];
  readonly realtimeService: ObjectQLClass['realtimeService'];
  recomputeSummaries: ObjectQLClass['recomputeSummaries'];
  refuseEmptyPasswordFields: ObjectQLClass['refuseEmptyPasswordFields'];
  readonly relatedSchemaOf: ObjectQLClass['relatedSchemaOf'];
  releaseSecretHandles: ObjectQLClass['releaseSecretHandles'];
  resolveFormulaPermissions: ObjectQLClass['resolveFormulaPermissions'];
  resolveFormulaRelated: ObjectQLClass['resolveFormulaRelated'];
  resolveMasterDetailParent: ObjectQLClass['resolveMasterDetailParent'];
  resolveMasterDetailParents: ObjectQLClass['resolveMasterDetailParents'];
  resolveObjectName: ObjectQLClass['resolveObjectName'];
  resolveOptionPermissions: ObjectQLClass['resolveOptionPermissions'];
  resolvePredicateRelated: ObjectQLClass['resolvePredicateRelated'];
  settleMasterDetailLanding: ObjectQLClass['settleMasterDetailLanding'];
  summaryForeignKeyColumns: ObjectQLClass['summaryForeignKeyColumns'];
  triggerHooks: ObjectQLClass['triggerHooks'];
  update: ObjectQLClass['update'];
  updateByIdExpecting: ObjectQLClass['updateByIdExpecting'];
  validationMessageContext: ObjectQLClass['validationMessageContext'];
  valueShapeStrictFor: ObjectQLClass['valueShapeStrictFor'];
  withResolvedWhere: ObjectQLClass['withResolvedWhere'];
}

/** The bodies of the "Update" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class UpdateFacet {
  /** The body of `ObjectQL#update`; the method's docblock there is its contract. */
  static async update(this: Pick<UpdateHost, '_registry' | 'admittedViolationSink' | 'assertBulkPerRowHookBudget' | 'assertReferencesResolve' | 'assertWriteAllowed' | 'buildDriverOptions' | 'buildEvalUser' | 'buildHookApi' | 'buildPerRowAfterContexts' | 'buildProvenance' | 'buildReferentialFieldClear' | 'buildSession' | 'buildUser' | 'dispatchPerRowBeforeHooks' | 'dispatchUnscopedMultiWriteHooks' | 'encryptSecretFields' | 'enforceTransactionOrigin' | 'executeWithMiddleware' | 'facade' | 'formulaFaultSink' | 'formulaOptionLabels' | 'getDriver' | 'getSchema' | 'hasHooksFor' | 'homeAmountServing' | 'inAfterAbortUnit' | 'invalidateOrganizationProbe' | 'logger' | 'mediaValueShapeStrictFor' | 'opensAfterAbortUnit' | 'permissionResolution' | 'persistSecretRows' | 'priorMasterIdsCallerReads' | 'projectHomeAmountsOntoPatch' | 'publishBulkDataEvent' | 'publishDataEvent' | 'readUpdatePriorRow' | 'realtimeService' | 'recomputeSummaries' | 'refuseEmptyPasswordFields' | 'relatedSchemaOf' | 'releaseSecretHandles' | 'resolveFormulaPermissions' | 'resolveFormulaRelated' | 'resolveMasterDetailParent' | 'resolveMasterDetailParents' | 'resolveObjectName' | 'resolveOptionPermissions' | 'resolvePredicateRelated' | 'settleMasterDetailLanding' | 'summaryForeignKeyColumns' | 'triggerHooks' | 'update' | 'updateByIdExpecting' | 'validationMessageContext' | 'valueShapeStrictFor' | 'withResolvedWhere'>, object: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<Record<string, any> | number | null> {
     object = this.resolveObjectName(object);
     // [#22782] An aborting `afterUpdate` rolls this write back — see `opensAfterAbortUnit`.
     if (this.opensAfterAbortUnit('afterUpdate', object, options?.context)) {
       return this.inAfterAbortUnit(() => this.update(object, data, options));
     }
     this.logger.debug('Update operation starting', { object });
     this.assertWriteAllowed(object, 'update');
     // [#8844] See the insert face — an organization row that changes identity
     // invalidates the memo just as one that appears does.
     if (object === ORGANIZATION_OBJECT) this.invalidateOrganizationProbe();
     const driver = this.getDriver(object);
     // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
     // carve an append-only system ledger out of the transaction. Before any
     // hook, default or validation runs, so a refusal costs nothing.
     this.enforceTransactionOrigin(object, driver, 'update');

     // Fold the `filter` alias into `where` FIRST (#4346): everything below —
     // token resolution, the by-id fast path, the #2982 AST seeding — reads
     // `options.where` only, so an unfolded `{ filter }` left the AST with no
     // predicate at all and a `multi: true` update rewrote EVERY row.
     options = foldEngineOptionAliases(object, 'update', options, ENGINE_WHERE_SLOTS);
     rejectUnknownEngineOptions(object, 'update', options, ENGINE_UPDATE_OPTION_KEYS);
     // [#5158] Lower before the by-id extraction below reads `where.id`: on an
     // array that read is `undefined` whatever the caller wrote, so an
     // `update({ where: [['id','=',x]] })` used to route to the multi-row path.
     options = lowerWhereFilterArray(object, 'update', options, this._registry.getObject(object), this.relatedSchemaOf);
     // [ADR-0100] A predicate write is judged like a read: a non-system
     // caller's `where` evaluates no `secret` / `password` column.
     rejectCredentialEvaluation(object, 'update', options, options?.context, this.relatedSchemaOf);

     // Expand `{filter-placeholder}` values BEFORE the id is extracted (#3810).
     // The read path resolves them; without the same call here the SAME filter
     // selected different rows depending on the verb — `find({owner:
     // '{current_user_id}'})` matched the signed-in user's rows while
     // `update`/`delete` compared the literal token text and matched none. That
     // is the #3106 shape one layer down: the evaluator existed, but only some
     // call sites reached it.
     //
     // Ordering matters: a scalar `where.id` becomes the by-id fast path below,
     // so an unresolved `{current_user_id}` would be bound as the primary key
     // itself. Resolve first, then extract.
     // [ADR-0053 D-D1, amended — #5930] …and lowered in the same stage, before
     // the by-id extraction below reads the result.
     options = await this.withResolvedWhere(object, 'update', options, declaredDatetimeLowering(this._registry.getObject(object)));

     // [#20308] The insert door's rule, same place: a blank on a
     // non-string-typed column is `null` before the middleware, the
     // caller-value snapshot (`suppliedValues`), the hooks, the read-only
     // strips and validation read the payload — so a `readonlyWhen` lock judges
     // the value it snapshotted. See `normalizeBlankTypedValues`. [#20309] The
     // insert door's numeric-string rewrite, same place and same reason (see
     // `normalizeNumericStringValues`).
     data = normalizeBlankTypedValues(this._registry.getObject(object), data);
     data = normalizeNumericStringValues(this._registry.getObject(object), data);

     // 1. Extract ID from data or where if it's a single update by ID.
     //    Only a SCALAR `where.id` means "update one row by primary key". An
     //    operator object ({ $in: [...] }, { $ne: ... }, …) is a multi-row
     //    predicate — treating it as an id would bind the object literally
     //    (e.g. `WHERE id = {"$in":[...]}`, which SQLite rejects). Leave `id`
     //    undefined in that case so the call routes to updateMany (requires
     //    options.multi=true), where applyFilters compiles the operator.
     //
     // [#5480] The decision lives in `engine-update-dispatch.ts` — the twin of
     // the `delete` extraction below (#4550) — so the fake engines that stand
     // in for this method import it instead of re-deriving it. Same argument,
     // same failure mode: a double looser than the producer converts a green
     // suite into no suite at all on exactly the path the double was written
     // for (#4434), and a predicate update is no less destructive than a
     // predicate delete — it rewrites every matching row's fields.
     const dispatch = resolveEngineUpdateDispatch(
       data as EngineUpdateDispatchData,
       options as EngineUpdateDispatchInput | undefined,
     );
     const id: any = dispatch.kind === 'by-id' ? dispatch.id : undefined;

     const opCtx: OperationContext = {
       object,
       operation: 'update',
       data,
       options,
       context: options?.context,
     };
     // [ADR-0142 D4] The engine's own precondition (the assignment cursor). A
     // middleware sets the member directly; nothing else can reach it.
     const internalPrecondition = (options as Record<symbol, unknown> | undefined)?.[WRITE_PRECONDITION_OPTION];
     if (internalPrecondition && typeof internalPrecondition === 'object') {
       opCtx.writePrecondition = internalPrecondition as Record<string, unknown>;
     }

     // [#2982] A no-single-id update routes to `driver.updateMany` below with
     // an AST that used to be REBUILT from `options.where` AFTER the
     // middleware chain — so row-scoping filters a middleware AND-composed
     // onto `opCtx.ast` (RLS write policies, the sharing plugin's
     // editable-rows filter) never reached the driver, and a bulk write hit
     // every matching row regardless of ownership. Seed the AST with the
     // caller's predicate BEFORE the chain runs — the same seam the read path
     // uses — and let the multi branch consume the composed result. Keyed on
     // the SAME falsy-`id` test the multi branch dispatches on (below), so the
     // seed and the branch never disagree. `where` is included only when
     // supplied, mirroring the read path's AST shape.
     if (!id) {
       opCtx.ast = { object, ...(options?.where !== undefined ? { where: options.where } : {}) } as QueryAST;
     }

     // [#2948] Snapshot what the CALLER supplied, BEFORE any middleware /
     // beforeUpdate hook stamps server-managed columns (owner/tenant stamp,
     // `updated_by`/`updated_at`). The static-`readonly` strip below drops only
     // caller-supplied read-only writes, so hook/middleware stamps survive.
     //
     // [#5591] KEYS ARE NOT ENOUGH — this snapshot carries the VALUES too, and
     // it must be a COPY. Hooks mutate `opCtx.data` IN PLACE
     // (`ctx.input.data.x = …` — `hookContext.input.data` starts as this very
     // reference), so a snapshot that aliased it would track those mutations
     // and answer every question about "what the caller sent" with the
     // post-hook payload. A key-only snapshot was already immune to that; a
     // value snapshot only stays immune because of the spread.
     //
     // Why values: the strip runs AFTER the hooks (below), so "this key is
     // caller-supplied" and "this key still holds the caller's value" are
     // different facts, and only the second one licenses a delete. Reading the
     // first as the second deleted hook-written timestamps whenever the caller
     // had echoed the key back — see `stripReadonlyFields` for the measured
     // downstream row (`status = published`, `published_at = null`).
     const suppliedValues: Readonly<Record<string, unknown>> = {
       ...((opCtx.data ?? {}) as Record<string, unknown>),
     };

     // [#3407] Structured strip observability. The readonly/readonlyWhen strips
     // below — and, since #6437, the primary-key strip at each branch's head —
     // are LEGAL semantics (the write still succeeds without the dropped
     // fields), but until now the only trace was a server-side logger warn — a
     // caller that reports success per requested field (a flow's `update_record`
     // step) saw a clean success while the DB value never changed. When the
     // caller registers `onFieldsDropped`, report each strip pass's dropped
     // keys back with its reason. Diffing before/after key sets is exact here:
     // every strip helper returns the SAME reference when nothing was dropped,
     // else a shallow copy with keys removed. A listener fault must never break
     // the write.
     //
     // [#5126] The LOUD half of the same seam. `strictReadonlyWrites` is the
     // caller's per-call choice to have the write REFUSED rather than committed
     // without the stripped columns — the out #4903 could not add, because the
     // option key had to be declared in `packages/spec` first
     // (`WriteObservabilityOptions`, ruled Option B: in-process, not the
     // client-serializable bag).
     //
     // Two design points that are easy to get wrong later:
     //
     //  - The strips still RUN under strict. Diffing their before/after is how
     //    we learn which fields would go; the stripped payload is then thrown
     //    away with the write. So the flag adds no second policy — it reports
     //    the existing one. A field the strip does not take (an `isSystem`
     //    caller's statically-`readonly` column, an unlocked `readonlyWhen`)
     //    is not rejected either.
     //  - Under strict the listener does NOT fire. `DroppedFieldsEvent` is
     //    contracted as "dropped, and the write completed without them"; a
     //    refused write did not complete, and a flow step listening for drops
     //    would otherwise report a partial success for a write that never
     //    happened. Quiet-and-observable or loud — one per call.
     //
     // Drops accumulate across EVERY pass and throw ONCE (below, after the
     // static strip) so the caller gets every offending field in one error
     // instead of a round-trip per field. The throw lands before any driver
     // call, so nothing is written.
     //
     // [#6437] Adding a reason therefore adds a REFUSAL, and that is the
     // contract rather than a side effect: `strictReadonlyWrites` is documented
     // as covering "every drop `onFieldsDropped` reports" — a set DERIVED from
     // what this helper reports, never an enumeration frozen at #5126. So the
     // `primary_key` strip is refused under strict for exactly the reason the
     // read-only ones are (don't half-apply my payload), and the refusal error
     // composes its wording from `drops` so it never calls a stripped `id`
     // read-only. Route a new strip through here ⇒ own both halves.
     //
     // [#8093] ...and one thing is NOT a drop: the row's own primary key, when
     // it is the address of the row this call is already writing. `droppedFields`
     // has one declared meaning — fields the CALLER SUPPLIED and the engine
     // REFUSED. An `id` that names the targeted row was refused nothing; it did
     // its job. ADDRESSING IS NOT PAYLOAD.
     //
     // How a caller who sent no `id` gets one reported anyway: the REST ingress
     // folds the path id INTO the write payload (`metadata-protocol`'s
     // `updateData`: `{ ...request.data, id: request.id }`, #6479 — so a body
     // `id` can no longer bind a different row than the one the URL, the OCC
     // check and the receipt all name). That fold is correct and stays. But it
     // lands in `data` BEFORE the `suppliedValues` snapshot above, so from here
     // down the address is indistinguishable from something the caller typed —
     // and on an object whose `id` is declared `readonly: true` (as platform
     // objects' are), the static-`readonly` strip below then drops it and
     // reports it. Measured on `main` through the real ingress:
     // `PATCH /data/sys_user_preference/<id>` with the body `{"value":[...]}` —
     // no `id` key in it — answered 200 carrying
     // `droppedFields:[{fields:["id"],reason:"readonly"}]`.
     //
     // What that cost is not cosmetic. The console's internal "recent items"
     // trace runs on every org switch, so every org switch popped a user-facing
     // amber warning toast naming a field the user never touched. The damage is
     // that the warning channel gets TRAINED TO BE IGNORED — a user who learns
     // the amber toast is noise will ignore the one that matters. The identical
     // failure mode is already on record one field over: #3431 / #3794 stopped
     // `userState.ts` sending `updated_at` because doing so "made every
     // recents/favorites write pop a scary warning about a field the user never
     // touched, drowning the real signal the toast exists for."
     //
     // Deliberately the REPORT and not the strip. `id` still leaves the SET
     // clause, and must: a same-value primary-key write is a harmless no-op on
     // SQL but an outright rejection on stores with immutable primary keys, and
     // #6435's block already ruled that widening the strip to the truthy-scalar
     // case "is a separate decision, not a rider here". The payload handed to
     // the driver is byte-identical before and after this change.
     //
     // Self-scoping to SINGLE-RECORD update by construction: `id` is bound only
     // on the by-id branch, so a predicate/multi write — where nothing addresses
     // a row by key — is untouched, and a caller-supplied `id` there is still
     // reported. It cannot collide with the `primary_key` strips either: those
     // fire only when the dispatch has ALREADY RULED the value is not a primary
     // key, which is exactly when it cannot equal the bound key.
     //
     // Asked of `suppliedValues`, never of the live payload: this is a question
     // about what the CALLER submitted, and the answer must survive a hook
     // rewriting the key mid-write — the same reason that snapshot carries
     // values at all (#5591).
     //
     // [#8141] #8093 wired this to the REPORT channel only, so the strip's own
     // WARN went on calling the address a forged caller write on every
     // single-record PATCH of every platform object. It now feeds BOTH channels
     // — `reportDroppedFields` below and `stripReadonlyFields`' `addressKey`
     // argument — from this ONE predicate. Deliberately not a second derivation:
     // two notions of "this id is the address" that disagree in one edge case
     // would be a worse defect than the log line either of them silences.
     const onFieldsDropped = options?.onFieldsDropped;
     const strictReadonlyWrites = options?.strictReadonlyWrites === true;
     const strictDrops: DroppedFieldsEvent[] = [];
     const idAddressesThisRow =
       id !== undefined && id !== null
       && Object.prototype.hasOwnProperty.call(suppliedValues, 'id')
       && Object.is(suppliedValues.id, id);
     const reportDroppedFields = (
       before: Record<string, unknown> | null | undefined,
       after: Record<string, unknown> | null | undefined,
       reason: DroppedFieldsEvent['reason'],
     ): void => {
       if ((!onFieldsDropped && !strictReadonlyWrites) || before === after || !before) return;
       const afterObj = (after ?? {}) as Record<string, unknown>;
       const fields = Object.keys(before).filter(
         // [#8093] The address the caller wrote to is not a field it lost.
         (k) => !(k in afterObj) && !(idAddressesThisRow && k === 'id'),
       );
       emitDrop(fields, reason);
     };
     /** One drop to the channel this write reports through: the strict refusal, or the listener. */
     const emitDrop = (fields: string[], reason: DroppedFieldsEvent['reason']): void => {
       if (fields.length === 0) return;
       if (strictReadonlyWrites) {
         strictDrops.push({ object, fields, reason });
         return;
       }
       notifyDrop(fields, reason);
     };
     /**
      * One drop to the listener, on a non-strict write — `emitDrop`'s other arm.
      * [#25000] The `stored_expression` report no longer calls this directly:
      * it goes through `emitDrop` like every strip's, so under strict it is
      * refused, and a refused write never fires the listener.
      */
     const notifyDrop = (fields: string[], reason: DroppedFieldsEvent['reason']): void => {
       if (fields.length === 0 || !onFieldsDropped) return;
       try {
         onFieldsDropped({ object, fields, reason });
       } catch (err) {
         this.logger.warn('onFieldsDropped listener threw — ignored', { object, error: err });
       }
     };
     /**
      * Refuse the write if strict is on and any pass dropped something. Called
      * once per branch, AFTER both strip passes and BEFORE the driver write.
      */
     const assertNoStrictDrops = (): void => {
       if (strictDrops.length === 0) return;
       const fields = [...new Set(strictDrops.flatMap((d) => d.fields))];
       throw new ReadonlyFieldRejectedError(object, fields, strictDrops);
     };

     await this.executeWithMiddleware(opCtx, async () => {
       // [ADR-0139 D1] A write's predicate never carries a `ReadableIds` leaf.
       // The door refused the caller's; this refuses one the middleware chain
       // wrote — here, at the executor's entry, because the prior-row reads
       // below reach the driver before `updateMany` does.
       collectComposableReadableIds(object, 'update', opCtx.ast?.where, 'where');
       // [#20082] The write's ONE permission resolution, shared by its option
       // gates and the formula fields on its response — asked at most once, and
       // only by the first of them that needs the map.
       const permissionResolution = this.permissionResolution(opCtx.context);
       // [#8738] The declared-field door, the insert path's (#8682) applied to
       // the second write verb — same function, not a second predicate. First
       // act inside the middleware body: after middleware (which may rewrite
       // `data`), and before the prior-record read, the `beforeUpdate` hooks,
       // both readonly strips, validation and the statement.
       //
       // Measured on `origin/main` before it existed — the update half of the
       // card was filed as INFERRED and this is what the reproduction found:
       // `zzz_nonexistent_field` reached `driver.update` (and `updateMany` on
       // the multi branch) and was refused THERE, after `beforeUpdate` had run
       // and stamped a derived value onto the payload the driver then rejected.
       //
       // Single-row by construction: `update()` takes one payload, so there is
       // no partial-row mode to carry the verdict into — unlike `insert()`, the
       // refusal is simply thrown. One element in, one verdict out.
       //
       // [#16344] Hoisted from its old site below the dispatch ladder: the
       // declared-field door and the pre-hook read-only pass both need this
       // schema, and ONE lookup answering both is one fact rather than two that
       // can drift.
       const updateSchema = this._registry.getObject(object);
       // [#24619] The stored computed fields ({@link planStoredExpressions})
       // and how their expressions are served — the write's own permission
       // resolution and the read path's one hop, under this write's context.
       const storedExpressionPlan = planStoredExpressions(updateSchema);
       const storedExpressionServing: StoredExpressionServing = {
         permissionsFor: (plan, records) => this.resolveFormulaPermissions(object, plan, records, opCtx.context, permissionResolution),
         onFault: this.formulaFaultSink(object),
         relatedFor: (plan, records) => this.resolveFormulaRelated(updateSchema, plan, records, opCtx.context),
         optionLabelsFor: (plan) => declaredOptionLabels(updateSchema, plan),
       };
       const undeclared = undeclaredWriteFieldErrors(
         object,
         updateSchema as { fields?: unknown } | undefined,
         [opCtx.data],
       )[0];
       if (undeclared) throw undeclared;

       // [#20805] The computed-field door — the insert path's, same function,
       // and placed by the same rule: right after the declared-field door, in
       // EVERY context (no `isSystem` gate: a `formula` value has no column to
       // land in for any caller), before the read-only hide pass, the hook
       // recording and the hooks — so a hook is handed the payload that will
       // be stored, and a formula field also declared `readonly: true` is
       // reported once, as `computed`. `suppliedValues` (and so
       // `ctx.submitted`) keeps the caller's submission AS SENT; only the
       // payload loses the key. Reported at the confluence below, beside the
       // other strips' reports, so the listener never fires for a write the
       // post-hook door then refuses.
       const preComputedPayload = opCtx.data as Record<string, unknown> | null | undefined;
       const computedStripUpdate = stripComputedWriteFields(
         updateSchema as { fields?: unknown } | undefined,
         [preComputedPayload],
       );
       if (computedStripUpdate.dropped.length > 0) opCtx.data = computedStripUpdate.rows[0] as any;

       // ── [#16344] HIDE caller-forged read-only values from the hooks ──────
       //
       // The invariant, in the maintainer-confirmed ruling's words:「交给生命
       // 周期钩子的记录,就是它打算持久化的那条记录。」A hook handed a value
       // the engine has ALREADY decided will not be stored can derive a column
       // that IS stored, and that derived write is the HOOK's own — so nothing
       // downstream takes it back.
       //
       // Measured on this change's base, with a control, in
       // `engine-readonly-hook-input.test.ts`: one
       // `PATCH { actual_value: 380, target_value: 1, weight: 1 }` against a
       // `readonly` `target_value` committed `target_value = 400` — the strip
       // DID work — beside a hook-derived trace reading `目标 1`. A row whose
       // own audit trail cites a value it does not contain, with no error, no
       // warning and a 200. The strip was never the defect; its POSITION was.
       //
       // ⭐ HIDE, not strip, and that word is the whole design. The enforcement
       // point stays exactly where #2948 / #5591 / #14088 put it — after the
       // hooks, where it is the only pass that can tell a hook's stamp from a
       // caller's forgery (`hookWrittenKeys`). Moving it here instead would
       // delete every server-side stamp a `beforeUpdate` makes to a read-only
       // column, which is #5591 reintroduced. So this pass takes the caller's
       // values out of the HOOKS' view only, and the confluence below hands
       // them straight back before anything engine-owned reads the payload.
       //
       // What that buys: the post-hook declared-field door,
       // `normalizeMultiValueFields`, `validateRecord`, the `readonlyWhen`
       // strip, the static strip and therefore `onFieldsDropped`, the WARN and
       // `strictReadonlyWrites` all see the payload they see today, and say the
       // identical thing about it. ⛔ Feeding those channels from HERE instead
       // is the shape to avoid: it would report — and under strict REFUSE — a
       // whole-record write-back whose read-only key a hook goes on to restamp
       // (the #5591 idiom), turning a write that succeeds today into a 400.
       //
       // ⛔ A hook that legitimately needs the caller's submission reads
       // `ctx.submitted` (bound below) — the ruling's second half, and the
       // reason nothing degrades: plugin-auth's ADR-0092 identity write guard
       // names the non-whitelisted keys from THERE, so its 403 still says which
       // field it refused.
       //
       // Placed BEFORE the recording is armed: a pass running inside that
       // window is an ENGINE write recorded as a HOOK write, which is the
       // laundering the seal note below exists to make impossible.
       //
       // ⛔ `id` is excluded — ADDRESSING IS NOT PAYLOAD (#8093), and the
       // non-scalar case has its own owner further down (#6435), which reads
       // the key where it already looks. Excluded through `supplied`, the one
       // input that decides eligibility, so this pass never forms a second
       // opinion about what an address is.
       //
       // ⛔ `readonlyWhen` is NOT hidden and must not be: a conditional lock is
       // judged against the prior record — per ROW on the predicate path, where
       // one shared payload cannot carry a per-row verdict — and #9107
       // deliberately leaves it hook-writable.
       //
       // [#24822] Read ONCE, here, and handed to every static-`readonly` pass
       // below (this hide pass, the by-id and predicate strips, and the views
       // the `readonlyWhen` strips and the master-detail settlement read off
       // them): whether the Layer 0 wall judges this update's `organization_id`
       // on the stored rows. The wall declares it on the seam it installed;
       // the engine reads that member and nothing else
       // (`updateStaticReadonlySubject`). The middleware chain has run by now,
       // so the seam is in place. Where it holds, an admitted re-point is shown
       // to `beforeUpdate` and stored as sent, instead of being taken and the
       // row's own organization kept.
       const wallJudgesOrganization =
         !opCtx.context?.isSystem && opCtx.postHookWriteImageCheck?.judgesOrganization === true;
       const readonlyUpdateSubject = updateStaticReadonlySubject(updateSchema, wallJudgesOrganization);
       let readonlyHiddenFromHooks: Record<string, unknown> | undefined;
       if (!opCtx.context?.isSystem) {
         const preHookPayload = opCtx.data as Record<string, unknown> | null | undefined;
         if (preHookPayload && typeof preHookPayload === 'object') {
           const suppliedDataOnly: Record<string, unknown> = { ...suppliedValues };
           delete suppliedDataOnly.id;
           // No logger, deliberately: this pass is SILENT by construction. The
           // strip below owns every word said about these keys.
           const hidden = stripReadonlyFields(
             readonlyUpdateSubject as any, preHookPayload, suppliedDataOnly, undefined,
             { preserveAudit: opCtx.context?.preserveAudit === true },
           ) as Record<string, unknown>;
           if (hidden !== preHookPayload) {
             readonlyHiddenFromHooks = {};
             for (const k of Object.keys(preHookPayload)) {
               if (!(k in hidden)) readonlyHiddenFromHooks[k] = preHookPayload[k];
             }
             // Kept in step with the hook payload, which the recording below
             // arms over: the two must not name different objects.
             opCtx.data = hidden as any;
           }
         }
       }

       // ── [#14088] ARM the hook-write recording ────────────────────────────
       //
       // `suppliedValues` above answers "what did the caller send". This
       // answers the other half — "which keys did a HOOK assign" — and it must
       // be RECORDED, because it cannot be recovered from the values
       // afterwards: `Object.is(payload[k], supplied[k])` reads a hook that
       // deliberately wrote the value the caller also sent as a hook that never
       // touched the key, and the static `readonly` strip below then deletes
       // the hook's write. Measured: a `readonly` `completed_at` CLEARED by a
       // reopen hook against a caller that round-tripped the whole record and
       // so also sent `completed_at: null` — the row committed `in_progress`
       // with its old completion timestamp and no error.
       //
       // The two ends of this window are load-bearing, not stylistic (the
       // module's own header carries the full argument):
       //
       //  - ARMED HERE, after the entry snapshot and after the caller's payload
       //    has stopped being written by anything the caller controls. A
       //    caller cannot execute an assignment on this object; echoing a key,
       //    a value, a `null` or a `Proxy` back is not a `set`. So no key a
       //    caller supplied can enter the record, and a hook-owned key is a key
       //    the strip stops defending.
       //  - SEALED at the confluence below, BEFORE `encryptSecretFields` /
       //    `normalizeMultiValueFields` / the strips write to the payload. A
       //    recorder still armed for those would report ENGINE writes as HOOK
       //    writes, which on a caller-forged secret column is precisely the
       //    escalation this is built to make impossible.
       //
       // Writes through the recording land on the SAME object, so a hook
       // mutating `ctx.input.data.x` in place is mutating the engine's payload
       // exactly as it always has, and `opCtx.data` stays in step.
       const hookWrites =
         opCtx.data !== null && typeof opCtx.data === 'object'
           ? recordHookPayloadWrites(opCtx.data as Record<string, unknown>)
           : undefined;

       const hookContext: HookContext = {
          object,
          event: 'beforeUpdate',
          input: { id, data: hookWrites?.payload ?? opCtx.data, options: opCtx.options },
          // [#16344] The caller's submission AS SENT — the other half of the
          // ruling, and the channel that keeps a submission-reading guard whole
          // now that `input.data` is the persist image. It is the #5591
          // snapshot, which is already a COPY taken at engine entry before any
          // middleware or hook stamp, so nothing a hook does can rewrite it and
          // no hook write can leak back through it into the payload.
          //
          // Frozen at the boundary rather than trusted: `previous` is the only
          // other read-only-by-contract member and it is a live driver row, so
          // "diagnostics only" would otherwise be enforced by nothing. A hook
          // that assigns here fails loudly in strict mode instead of silently
          // editing a record of what the caller sent.
          //
          // Bound ONCE, on the batch context: `dispatchPerRowBeforeHooks`,
          // `dispatchUnscopedMultiWriteHooks` and `buildPerRowAfterContexts`
          // all build their contexts by spreading this one, so every dispatch
          // of this write — both phases, every matched row — carries the same
          // submission, which is what it is: one caller write, one submission.
          submitted: Object.freeze({ ...suppliedValues }) as Record<string, unknown>,
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          // [commit 34ce8e7db] The declared referential-cleanup marker. Conditional
          // spread, not a bare assignment: the contract is "absent unless
          // true", and an explicit `undefined` member would survive the
          // per-row context spreads as a present-but-undefined key.
          ...(this.buildReferentialFieldClear(opCtx.context)
            ? { referentialFieldClear: true as const }
            : {}),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this.facade
       };

       // ────────────────────────────────────────────────────────────────────
       // [#5574 / #5846] The dispatch ladder is resolved BEFORE the before
       // phase, and the before phase is dispatched PER MATCHED ROW.
       //
       // ADR-0058 Addendum II (ruling B, 2026-08-06) is what forces the
       // reorder rather than merely permitting it: a per-row `before*` context
       // is BUILT from the matched row set, so the row set has to be in hand
       // before the first dispatch, so the branch that decides whether there IS
       // a row set has to be decided before that. #5846's (a) direction lands
       // in the same edit — the by-id path reads its prior row ahead of the
       // dispatch and binds `previous` there, exactly as `delete()` has since
       // #5272 — because the before phase becomes a real reader of that read on
       // BOTH paths, which is the one thing #5284's gate comment said it was
       // not.
       //
       // The lever that reorder retires is named and refused rather than
       // silently dropped: see `HookTargetRebindError`.
       //
       // Keyed on the SAME falsy-`id` test the #2982 AST seed above uses, so
       // seed, ladder and branch cannot disagree.
       const isByIdWrite = Boolean(id);
       // [#11009] Keyed on the LADDER's verdict, not on `options?.multi`: the
       // dispatch can now return `reject` for a call that carries a truthy
       // `multi` (a scalar `data.id` beside an unhonourable `where`
       // predicate), and branching on the raw flag would silently promote
       // that refusal into a bulk write. For every pre-#11009 input the two
       // spellings agree (`kind === 'multi'` ⇔ `options.multi` truthy when
       // not by-id), so this narrows nothing else.
       const isPredicatePath = !isByIdWrite && dispatch.kind === 'multi' && typeof driver.updateMany === 'function';
       if (!isByIdWrite && !isPredicatePath) {
           // [#5480] The `reject` verdict of resolveEngineUpdateDispatch. It
           // used to be re-asked AFTER the before phase, because a hook could
           // still bind the id and convert the call into a by-id write; with
           // the ladder resolved first there is no such conversion, so the
           // refusal lands where it costs least — before any handler runs and
           // before anything is read.
           //
           // [#11009] The dispatch's OWN message: the unhonoured-predicate
           // refusal names the `where` keys the by-id path would have
           // dropped, while the classic no-id-no-multi shape keeps
           // `ENGINE_UPDATE_REJECT_MESSAGE` verbatim. The fallback arm covers
           // the one non-reject way in here — a `multi` verdict against a
           // driver with no `updateMany`, which stays the generic refusal it
           // has always been.
           // [#11142] Rejects throw through the dispatch module's own
           // thrower so a verdict carrying a declared code/status (the
           // conflicting-id refusal) reaches the caller — and the REST
           // boundary's status passthrough — decorated; the #5748/#11009
           // family stays a plain Error, byte-identical to before.
           if (dispatch.kind === 'reject') throw engineUpdateDispatchRejectError(dispatch);
           // [#27277] A floored plugin driver offers no `updateMany` on purpose:
           // say so, rather than ask for the `multi` this caller already passed.
           if (isExternalDriverFloor(driver)) throw externalPredicateWriteRefusal(driver.name, object, 'update');
           throw new Error(ENGINE_UPDATE_REJECT_MESSAGE);
       }

       // [#6966] The ladder verdict, stated on the contract. Bound HERE and
       // nowhere else: this is the one point that knows which branch the write
       // takes, and re-deriving it downstream is what `asScalarId` stays
       // unexported to prevent (#4434 / #4550). The batch context carries index
       // 0; `dispatchPerRowBeforeHooks` and `buildPerRowAfterContexts` override
       // only `index`, so `mode` and — load-bearing — the `scope` IDENTITY are
       // shared by every dispatch of this call, in both phases.
       hookContext.dispatch = {
           mode: isPredicatePath ? 'per-row' : 'record',
           index: 0,
           scope: {},
       };

       // Pre-update snapshot. Exposed to hooks via `hookContext.previous` in
       // BOTH phases now (the HookContext contract documents `previous` for
       // update/delete) and reused for object-level validation rules and the
       // roll-up recompute. Fetched once, and only for single-id updates —
       // [#7867] unconditionally there, since the not-found gate at the by-id
       // branch below is a fourth consumer that every such write has.
       let priorRecord: Record<string, unknown> | null = null;
       // [#5038] The matched rows a PREDICATE write fires its per-row
       // `afterUpdate` contexts over. `[]` is meaningful and distinct from
       // `null`: zero matched rows is zero record changes, hence zero hook
       // calls.
       let bulkPerRowRows: Record<string, unknown>[] | null = null;

       if (isByIdWrite) {
           // [#5284] Demand-driven, and the demand is asked PER OBJECT — see
           // the long-form reasoning at the by-id branch below, which still
           // holds for every term. What changed with #5574/#5846 is the one
           // term that comment singled out as deliberately ABSENT:
           // `beforeUpdate` is now a real reader of this read, because the
           // read happens before the dispatch and binds `previous` for it. So
           // it joins the gate, and the gate stops being narrower than
           // `delete()`'s twin (#5272) for no reason anyone could state.
           //
           // This is not a NEW read where a kernel is concerned — it is the
           // same one, moved and deduplicated. `sys_fetch_previous_update`
           // (`plugin.ts`, `object: '*'`, priority 5) used to make its own
           // `ql.findOne` on every by-id update to bind exactly this value;
           // #5846 retires it, because the engine now binds `previous` before
           // any authored before-hook runs.
           // [#7867] …and the read is now UNCONDITIONAL, because the gate below
           // is a question only a read can answer. `wantsPriorRecord` — the
           // #5284 narrowing this replaces — asked "does anything CONSUME the
           // prior row?" and skipped the read when nothing did. Existence is a
           // consumer it never counted, and it is the one consumer every by-id
           // write has.
           //
           // What the narrowing actually bought, measured rather than assumed:
           // its own #5929 twin in `delete()` enumerates the global registrants
           // (plugin-sharing, service-storage, plugin-auth, plugin-audit — all
           // registering with no `object`, hence matching every object), so on
           // any kernel that loads them `wantsPriorRecord` was ALREADY true for
           // everything and skipped nothing. The read becomes genuinely new
           // only for a bare `@objectstack/objectql/core` embedder whose object
           // has no hooks, no prior-reading validation rule and no roll-up —
           // and that embedder is buying a 404 it did not have.
           //
           // ⚠️ It cannot be answered from the write's own return value
           // instead. `IDataDriver.update` declares `Promise<Record<string,
           // unknown>>` — no not-found signal in the contract at all — and the
           // engine's post-write readback is `null` for a SECOND reason
           // (`protocol.updateData`'s own note: a write that moves the row out
           // of the caller's row scope, e.g. reassigning `owner_id` away from
           // yourself under an owner-scoped policy, reads back null while
           // having succeeded). Reading either as "not found" would answer 404
           // to a write that landed. Both siblings ask existence BEFORE the
           // write for exactly this reason; so does this.
           //
           // `buildDriverOptions` is what carries the open transaction and
           // the tenant scope onto a raw driver read — the same bag the
           // post-phase write uses, built here because the write's own
           // merge has not happened yet. `delete()`'s pre-image read does
           // the same for the same reason.
           // [#22445] Through {@link readUpdatePriorRow}, the ONE spelling of
           // this read, which the `update`-mode preview reads its stored row
           // with too — so the preview and this write judge one image.
           priorRecord = await this.readUpdatePriorRow(object, id, opCtx.context, hookContext.input.options);
           // ── [#7867] The not-found gate ──────────────────────────────────
           //
           // A by-id update whose id names no row was a SILENT NO-OP that
           // resolved `null`: nothing on this path ever asked whether the row
           // existed, so the write ran on into validation, the driver and the
           // hook chain, and died on whichever of them complained first. The
           // 400 class varied with the object's declarations — a
           // `HookConditionError` on a hooked object, a required-field
           // `VALIDATION_FAILED` on an unhooked one — while the missing 404 was
           // the constant. Two sibling paths had this gate and an action body
           // traverses neither: `protocol.updateData` (#4435) and `callData`'s
           // ObjectQL fallback (#5138). This is the third, placed at the one
           // point all of them funnel through, so it is not a fourth site.
           //
           // ⚠️ It throws BEFORE `triggerHooks('beforeUpdate')` deliberately,
           // and that ordering is the fix rather than a detail of it. The
           // reported symptom was an `afterUpdate` condition reading `previous`
           // on a row that was never there; `if (priorRecord) …` below is
           // CORRECT and stays untouched (ADR-0058 Addendum II / #4649 —
           // never fabricate a prior state), it was simply running on a path
           // that should never have been entered. Killing the producer is
           // #5574's ruled remedy for this family, not specializing the
           // message the symptom happened to produce.
           //
           // Scope: the BY-ID branch only. A `multi: true` predicate update
           // that matches zero rows is legitimately "0 rows affected", not a
           // missing record — same line both siblings draw.
           if (!priorRecord) throw recordNotFoundError(object, id);
           // Never fabricate: a row that is not there leaves `previous`
           // UNBOUND rather than `{}`/`null`, so a condition reading it
           // faults loudly instead of answering for a record nobody read
           // (#4649/#4775) — `delete()`'s `bindPreImage` rule, verbatim.
           // The guard is kept verbatim although the gate above now makes it
           // permanently true here: it states the invariant, and the invariant
           // outlives this call site.
           if (priorRecord) hookContext.previous = coerceBooleanFields(updateSchema as any, priorRecord as any) as any;
           // [#24619] The stored computed fields over the stored row merged
           // with the caller's patch, BEFORE the beforeUpdate hooks, so a hook
           // sees the expression's value over the PRE-strip row. That is not
           // always the stored value: an input the `readonlyWhen` strip takes
           // back out below still feeds this pass. Pass 2, after the hooks and
           // both strips, is the value stored.
           //
           // Written onto the RAW payload (`opCtx.data`, the recording's
           // target), never through `hookWrites.payload`: this pass runs
           // inside the recording window, and an ENGINE write must not be
           // recorded as a HOOK write (the rule at the hide pass above). And
           // never onto a key the hide pass withheld: for those the read-only
           // strips judge the caller's submission, reporting and, under
           // `strictReadonlyWrites`, refusing it as they always have.
           if (storedExpressionPlan.length > 0 && opCtx.data && typeof opCtx.data === 'object') {
               const raw = opCtx.data as Record<string, unknown>;
               const [computed] = await computeStoredExpressions(storedExpressionPlan, [{ ...priorRecord, ...raw }], opCtx.context, storedExpressionServing);
               for (const name of Object.keys(readonlyHiddenFromHooks ?? {})) delete computed[name];
               applyStoredExpressionsToPatch(raw, computed, priorRecord);
           }
           // [commit 706ad0fcc] All three `beforeUpdate` dispatch sites inside the hide
           // window share one wrapper, so a hook that faults reaching THROUGH a
           // key this pass withheld names that key instead of surfacing the
           // platform's own contract enforcement as the author's crash. It
           // rethrows the original error untouched on every other path.
           await dispatchHooksExplainingWithheldReadonly(readonlyHiddenFromHooks, 'beforeUpdate',
             () => this.triggerHooks('beforeUpdate', hookContext));
           // The retired lever, refused. Everything above — `previous`, and
           // below it the `readonlyWhen` strip and every validation rule — was
           // computed against the row the ladder chose.
           if (hookContext.input.id !== id) {
               throw new HookTargetRebindError({
                   object, event: 'beforeUpdate', path: 'by-id',
                   expectedId: id, observedId: hookContext.input.id,
               });
           }
       }

       // [#3106/#3042/#5038/#5574] D7 — ONE read of the matched row set per
       // predicate write, serving four consumers: per-row validation rules,
       // the `readonlyWhen` strip, the per-row `before*` dispatch and the
       // per-row `after*` dispatch. The ruling forbids a second fetch in as
       // many words, so the read is a MEMO rather than a call at each
       // consumer's site: the before phase needs it earliest (its contexts are
       // built from it), the strip gate can only be asked of the POST-hook
       // payload, and a memo is what lets both be true without the read
       // happening twice or being hoisted past the gate that decides it is
       // needed at all.
       let priorRows: Record<string, unknown>[] | null = null;
       let priorRowsRead = false;
       let readPriorRows: () => Promise<Record<string, unknown>[] | null> = async () => null;

       if (isPredicatePath) {
           // [#2982] Consume the middleware-composed AST seeded above, so the
           // injected row-scoping (RLS write filter, sharing's editable-rows
           // filter) actually binds every read and write on this path — the
           // per-row hook dispatch included, which is why the check moved here
           // from the driver call. Fail CLOSED if it is somehow absent:
           // rebuilding `{ object, where }` would silently drop every composed
           // filter and reopen the unscoped-bulk-write hole this fix closed
           // (AGENTS.md PD #12).
           const ast = opCtx.ast;
           if (!ast) {
               throw new Error(
                 `[Security] Refusing bulk update on '${object}': row-scoping AST was not seeded ` +
                   `(the predicate branch was reached without the AST seeded before the middleware ` +
                   `chain — the one RLS and sharing compose their row-scoping onto, so that a bulk ` +
                   `write reaches only the rows this caller may edit).`,
               );
           }
           // [#9974] The unscoped-multi shape check, BEFORE the matched-row
           // read — `delete()`'s twin (#9719), verbatim in condition, slot and
           // placement, because the two branches answer the same question about
           // the same caller options and a second reading of "unscoped" is how
           // the verbs would drift apart.
           //
           // A `multi: true` update carrying no caller predicate at all
           // dispatches ONCE, whole-operation-shaped, to the registrations that
           // declared for it — so a shape-of-the-operation refusal (#4630's on
           // `sys_comment`) fires regardless of what the predicate would match,
           // zero rows included.
           //
           // ⚠️ This is a BEHAVIOUR CHANGE on the accept set, ruled for
           // deliberately (#9974, option A, 2026-08-19), not a restoration: an
           // unscoped multi-update by a caller entitled to every matched row
           // used to succeed and rewrite the whole table. It now refuses IF the
           // object's guard declares the flag — an overwrite leaves no trace
           // and no pre-image to restore from, where a delete at least leaves
           // one, so the verb whose failure is less recoverable was the one
           // left less guarded. Objects with no declaring guard are untouched.
           //
           // Read from the caller's RAW options — the same slot the handler
           // contract reads (`input.options.where`, hook.zod.ts's upper-bound
           // rule) — never from the AST, which middleware may have narrowed and
           // only ever narrows. `where: {}` is a REAL (match-all) query and
           // stays on the per-row authorize path; only an absent or `null`
           // predicate is unscoped.
           const rawWhere = (hookContext.input.options as { where?: unknown } | undefined)?.where;
           if (rawWhere === undefined || rawWhere === null) {
               await dispatchHooksExplainingWithheldReadonly(readonlyHiddenFromHooks, 'beforeUpdate',
                 () => this.dispatchUnscopedMultiWriteHooks('beforeUpdate', object, hookContext));
           }
           const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
           readPriorRows = async () => {
               if (!priorRowsRead) {
                   priorRowsRead = true;
                   // [#21613] The matched rows' pre-images, shaped like the
                   // by-id prior read: each per-row `afterUpdate` composes its
                   // `result` from one of them, so both sides stay declared.
                   priorRows = rowsWithDeclaredColumnsOnly(
                     (await driver.find(object, ast, preOpts) as Record<string, unknown>[]) ?? [],
                     declaredColumnSet(updateSchema),
                   );
               }
               return priorRows;
           };

           // The demand is uniform across hooks and asked PER OBJECT: it is
           // NOT keyed on whether any condition mentions `previous`, which the
           // ruling rejected explicitly as a hidden rule that makes a hook's
           // firing count depend on its condition text.
           const perRowBeforeHooks = this.hasHooksFor('beforeUpdate', object);
           const perRowAfterHooks = this.hasHooksFor('afterUpdate', object);
           if (perRowBeforeHooks || perRowAfterHooks) {
               const rows = (await readPriorRows()) ?? [];
               // [D6] ONE ceiling for BOTH phases, checked BEFORE the first
               // per-row dispatch and before the driver call — so an
               // over-ceiling batch runs zero handlers and writes nothing,
               // rather than running 10 001 of them and then throwing. Named
               // for the phase that will dispatch first, so the operator is
               // told which hook to narrow or drop.
               this.assertBulkPerRowHookBudget(
                 object, perRowBeforeHooks ? 'beforeUpdate' : 'afterUpdate', rows.length,
               );
               if (perRowAfterHooks) bulkPerRowRows = rows;
               // [D1] Zero matched rows is zero dispatches — a batch that
               // changed nothing is not a record change.
               if (perRowBeforeHooks && rows.length > 0) {
                   await dispatchHooksExplainingWithheldReadonly(readonlyHiddenFromHooks, 'beforeUpdate',
                     () => this.dispatchPerRowBeforeHooks(object, 'beforeUpdate', rows, hookContext));
               }
           }
       }

       // ── [#14088] SEAL the hook-write recording ───────────────────────────
       //
       // The same CONFLUENCE commit b003cf2e8 uses one comment down, and for the same
       // reason: on either branch this is the line at which
       // `hookContext.input.data` is the final POST-hook payload and nothing
       // engine-owned has written to it yet. One seal covers both branches, so
       // the by-id and predicate paths can never end up with different notions
       // of who wrote a key — the divergence "both call sites" (#3106 / #4441)
       // is the standing shape for.
       //
       // Sealing does two things, and the write is wrong without either: it
       // freezes the record before the engine's own passes can be mis-recorded
       // as hook writes, and it puts the RAW payload back in `input.data` so no
       // recording view reaches a driver.
       //
       // `hookWrittenKeys` is `undefined` — not empty — when the recording
       // cannot speak for this call, which happens when a hook REPLACED the
       // payload object (`ctx.input.data = { …ctx.input.data }`) rather than
       // mutating it. Consumers must read that as "fall back to the #5591 value
       // test", never as "no hook wrote anything": treating a replacement's
       // keys as hook-owned would launder a caller's forgery, so the fallback
       // deliberately keeps the pre-#14088 over-strip instead.
       const sealedHookWrites = hookWrites?.seal(hookContext.input.data);
       if (sealedHookWrites) hookContext.input.data = sealedHookWrites.data as any;
       let hookWrittenKeys = sealedHookWrites?.hookWrittenKeys;

       // ── [#16344] HAND BACK what was hidden from the hooks ────────────────
       //
       // The other end of the pre-hook pass above, on the SAME confluence and
       // for the same reason: this is the line at which the payload has stopped
       // being the hooks' and has not yet been read by anything engine-owned.
       // Restoring HERE rather than at each branch's strip is what keeps the
       // change invisible below — one site covers both branches, so the two can
       // never end up with different notions of what the hooks were shown.
       //
       // ⛔ Only keys the payload does not already hold. A hook that wrote one
       // of these columns owns the value standing on it, and putting the
       // caller's back over it is precisely the forgery the recording refuses.
       //
       // Placed AFTER the seal, deliberately: a hand-back inside the recording
       // window would enter the record as a hook write, and the static strip
       // below reads that record for provenance — so the caller's own forgery
       // would be handed the one credential (`hookWrittenKeys`) that stops it
       // being stripped. The exact laundering #14088 exists to prevent.
       //
       // ⛔ ...and SET-TO-UNDEFINED of a hidden key is a NO-OP, not a hook
       // write. A hook that assigns a hidden key from the payload it was shown
       // (`data.x = data.x`, the shape #14088's own pin names) reads
       // `undefined` and RE-CREATES the key holding it. Left alone, three
       // mechanisms agree the wrong way: the recorder's `set` trap counts it as
       // a hook write, the hand-back below skips the key because `k in target`,
       // and the strip keeps it on that record — so a driver is handed
       // `{ x: undefined }`. On the memory driver that ERASES the stored
       // read-only value; on a knex-backed one `formatInput` does not drop
       // `undefined` and `builder.update(payload)` hands knex an undefined
       // binding, a bare compile-time `Error` OUTSIDE the ADR-0112 envelope.
       // Neither is "the record the engine intends to persist", which is the
       // whole subject of this card.
       //
       // Undoing it here — delete the key, drop it from the record, let the
       // ordinary hand-back put the caller's value back for the strip to judge
       // — makes the write read EXACTLY as it would have with no hook at all:
       // stripped, `onFieldsDropped` reporting it, the WARN said, and
       // `strictReadonlyWrites` refusing. That identity IS the invariant this
       // hide/hand-back pair exists to hold.
       //
       // ⛔ Dropping the key from `hookWrittenKeys` is NOT optional and is not
       // tidiness: leaving it there while handing the caller's value back over
       // it would credit the caller's forgery with hook provenance — the exact
       // laundering the note above refuses, arrived at from the other side. The
       // narrowing reaches only keys THIS pass hid, and only the one value no
       // driver can store; a hook write of any real value is untouched, so the
       // recorder's deliberate blindness to VALUE (#14088) is unchanged for
       // every key a hook can actually see.
       if (readonlyHiddenFromHooks) {
         const restoreTargets = new Set<Record<string, unknown> | null | undefined>([
           hookContext.input.data as Record<string, unknown> | null | undefined,
           opCtx.data as Record<string, unknown> | null | undefined,
         ]);
         const undoneSelfAssigns = new Set<string>();
         for (const target of restoreTargets) {
           if (!target || typeof target !== 'object') continue;
           for (const [k, v] of Object.entries(readonlyHiddenFromHooks)) {
             if (k in target && target[k] === undefined) {
               delete target[k];
               undoneSelfAssigns.add(k);
             }
             if (!(k in target)) target[k] = v;
           }
         }
         if (undoneSelfAssigns.size > 0 && hookWrittenKeys !== undefined) {
           const narrowed = new Set(hookWrittenKeys);
           for (const k of undoneSelfAssigns) narrowed.delete(k);
           hookWrittenKeys = narrowed;
         }
       }

       // ── [commit b003cf2e8] The POST-hook half of the declared-field door ──────────
       //
       // The insert path's twin, applied to the second write verb — same
       // function, same envelope, same reason (see the long-form note at the
       // `insert()` call site, which is not restated here). The #8738 door
       // above stays exactly where it is; this ADDS the check the hooks' own
       // output never had.
       //
       // Placed at the CONFLUENCE of the two branches, which is what makes one
       // call sufficient: the by-id branch mutates `hookContext.input.data` in
       // place through `triggerHooks`, and the predicate branch's
       // `dispatchPerRowBeforeHooks` accumulates each row context's payload
       // back onto the SAME `batchCtx.input.data` after every dispatch (its D3
       // half). So by this line `hookContext.input.data` is the final
       // post-hook payload on either path, and it is still pre-statement:
       // ahead of both readonly strips, `evaluateValidationRules` and every
       // `driver.update` / `driver.updateMany` dispatch below.
       //
       // Single verdict, thrown: `update()` takes one payload and has no
       // partial-row mode to carry a per-row verdict into — the same shape
       // #8738 wrote down for the pre-hook door one screen up.
       const postHookUndeclaredUpdate = undeclaredWriteFieldErrors(
         object,
         this._registry.getObject(object) as { fields?: unknown } | undefined,
         [hookContext.input.data],
       )[0];
       if (postHookUndeclaredUpdate) throw postHookUndeclaredUpdate;

       // [#20805] The computed-field door's report — its strip ran at the
       // pre-hook door above. Here, at the confluence, because this is the
       // first point both branches share after the post-hook door, and the
       // other strips report below it: under `strictReadonlyWrites` the drop
       // joins `strictDrops`, which each branch's `assertNoStrictDrops()`
       // refuses before any driver call.
       reportDroppedFields(preComputedPayload, computedStripUpdate.rows[0] as Record<string, unknown> | null | undefined, 'computed');

       // Every driver call below is handed `driverOptions` — the declared driver
       // options and nothing else; `input.options` is the hooks' additive view.
       const driverOptions = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
       hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);
       // [#27495] The credential rows this write seals, the ones it has written
       // to `sys_secret`, and the handles its committed statement moved the
       // secret columns off.
       let sealedSecrets: PendingSecretRow[] = [];
       const writtenSecrets: PendingSecretRow[] = [];
       let retiredSecrets: SecretHandleSlot[] = [];

       try {
           let result;
           // [#4639] Which event contract this write reports under. A predicate
           // write publishes the aggregate `data.records.updated`; anything else
           // publishes the per-record `data.record.updated`. Recorded at the
           // branch that made the choice rather than re-derived at the publish
           // site from an absent id — the two are the same today, and a future
           // driver returning a row from `updateMany` would silently reroute a
           // bulk write onto the per-record contract if we inferred it.
           let isPredicateWrite = false;
           // [#26950] The roll-up input a predicate write hands
           // `recomputeSummaries`: each matched row as it was (`previous`) and
           // as the write leaves it (`next`). `null` when no roll-up aggregates
           // this object, and on the by-id branch, which passes its own row.
           let summaryRows: { previous: Record<string, unknown>[]; next: Record<string, unknown>[] } | null = null;
           const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(updateSchema);
           const valueShapeStrict = await this.valueShapeStrictFor(updateSchema);
           const updateMsgCtx = this.validationMessageContext(object, opCtx.context);
           // [#4769] See the insert path — an update admits values on the same
           // terms, so it owes the same counterexample.
           const onAdmittedValueShapeViolation = this.admittedViolationSink(object);
           // [#5574] Branch on the LADDER, not on `hookContext.input.id`. The
           // two used to be the same question asked twice, which is exactly
           // what made the id slot a reroute lever; the ladder was resolved
           // before the before phase above and a handler's attempt to move it
           // has already been refused.
           if (isByIdWrite) {
               // [#6435] The by-id half of #6262's strip — same defect, other
               // arm. Reaching this branch means the dispatch found a truthy
               // scalar id, but NOT necessarily in the payload: when `data.id`
               // is a non-scalar (an operator object, an array, `null`) or a
               // falsy scalar, `resolveEngineUpdateDispatch` rules it is not a
               // primary key and falls through to `options.where.id`, binding
               // THAT (#5748 / PR #5919 — `ENGINE_UPDATE_DISPATCH_CASES` states
               // it: `operator object in data.id, scalar where.id` ⇒ `by-id`,
               // `expectId: 'rec_1'`). The dispatch is right; the PAYLOAD was
               // never cleaned. Measured on origin/main, this very branch:
               //
               //   driver.update('task', 'rec_1', { id: { $in: ['a','b'] }, title: 'x' })
               //                                     ^^^^^^^^^^^^^^^^^^^^^^ the SET clause
               //
               // `driver-sql`'s `update()` formats the WHOLE payload
               // (`sql-driver.ts`, `applyWriteColumnMap(formatInput(object,
               // data))` — `id` is on no skip list), so the row is written as
               // `UPDATE task SET id = '{"$in":["a","b"]}', title = 'x' WHERE
               // id = 'rec_1'`: rec_1's identity is overwritten with a
               // serialized operator object, irreversibly, on any backend that
               // accepts it.
               //
               // The rule is #6262's, unchanged and asked of the payload rather
               // than of the branch: a value the engine has ALREADY RULED is
               // not a primary key does not get to sit in the primary-key
               // column. It is asked by CALLING the dispatch — "would this
               // payload, on its own, identify a row?" — never by re-deriving
               // the scalar test here: `asScalarId` is deliberately unexported
               // (`engine-update-dispatch.ts`: "adding a third public spelling
               // of the same question is how a rule with one definition grows a
               // second one"), and a hand-mirrored copy is the #4434 / #4550
               // failure this family exists to prevent.
               //
               // Deliberately NARROW, and the narrowness is the whole scope:
               //
               //  - A TRUTHY SCALAR `data.id` is left exactly as it is. There
               //    the payload's `id` IS the bound key (it outranks `where` —
               //    same case-set; since #11142 a truthy scalar `where.id`
               //    naming a DIFFERENT row, and since #11230 a DECLARED
               //    non-scalar `where.id` predicate, are refused at dispatch
               //    and never reach this branch), so the write is `SET id = 'rec_1'
               //    WHERE id = 'rec_1'`: a same-value no-op, redundant rather
               //    than damaging, and long-standing behaviour. Widening the
               //    strip to cover it is a separate decision, not a rider
               //    here.
               //  - Rejecting the call instead (#6435's route B) would reverse
               //    the `expect: 'by-id'` verdict the case-set states today —
               //    a partial rollback of #5748's ruling A, i.e. a maintainer
               //    decision. This change alters NO verdict: the same call
               //    still dispatches by-id and still binds `rec_1`.
               //  - Per-driver skip lists (route C) are the #5240 / #4434 shape
               //    of five backends answering one question five ways.
               //
               // [#6437] REPORTED, on the same seam as the read-only strips.
               // The vocabulary widened (`DroppedFieldsEvent.reason` gained
               // `primary_key`), so the strip no longer has to choose between
               // silence and a `reason` that lies — the choice #6262 / #6435
               // were right to refuse. The `warn` below STAYS: it carries the
               // remedy prose, and `onFieldsDropped` is opt-in, so a caller
               // that registered no listener would otherwise lose the #4632
               // signal entirely.
               const preIdById = hookContext.input.data as Record<string, unknown> | null | undefined;
               if (
                   preIdById &&
                   typeof preIdById === 'object' &&
                   Object.prototype.hasOwnProperty.call(preIdById, 'id') &&
                   resolveEngineUpdateDispatch(preIdById as EngineUpdateDispatchData, undefined).kind !== 'by-id'
               ) {
                   const { id: notAnId, ...withoutId } = preIdById;
                   hookContext.input.data = withoutId as any;
                   this.logger.warn(
                     `Update on '${object}' of record ${String(hookContext.input.id)}: dropped 'id' from the ` +
                       `write payload. The row is identified by the id argument, and the engine has already ruled ` +
                       `this payload value is not a primary key (${JSON.stringify(notAnId) ?? String(notAnId)}) — ` +
                       `writing it would have overwritten that row's primary-key column. To update ONE row by id, ` +
                       `pass a SCALAR id (\`update(object, { id, ...fields })\` or \`{ where: { id } }\`); to ` +
                       `SELECT rows by an id set, put it in \`where\` ` +
                       `(\`{ where: { id: { $in: [...] } }, multi: true }\`).`,
                   );
                   reportDroppedFields(preIdById, hookContext.input.data as Record<string, unknown>, 'primary_key');
               }
               // [#8559] Password half of the credential write door, then the
               // secret channel (which carries the secret-arm refusal).
               this.refuseEmptyPasswordFields(object, hookContext.input.data as Record<string, unknown>);
               // [#27582] This record's own stored row is the pre-image read above.
               sealedSecrets = await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, driverOptions, async () => [priorRecord]);
               // [#21663] Scope `'skip'` — the public `validateRecord` IS that
               // scope: the readonly strip has NOT run yet, so a readonly value
               // here may be a caller's the strip is about to drop — judged, a
               // whole-record write-back echoing a legacy stored value would
               // become a refusal. Readonly values are judged after the strip
               // (`validateRecordInScope(…, 'only')`, below).
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>, 'skip');
               // [#22183] `keptOptionValues`: the option values an import kept for this write.
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation, keptOptionValues: opCtx.context?.keptOptionValues });
               // [#5284] Demand-driven, and the demand is asked PER OBJECT.
               //
               // This gate used to ask `this.hooks.get('afterUpdate').length > 0`
               // — the whole registration list, every object's hooks pooled — so
               // ONE object being observed made EVERY single-id update on EVERY
               // object pay an extra `driver.findOne`. The bulk paths next door
               // already asked the same question per object
               // (`hasHooksFor('afterUpdate', object)`, #5038), so one file held
               // two precisions of one question; this is the narrower one, which
               // `hasHooksFor` answers by mirroring `triggerHooks`' own filter
               // (an entry with no `object`, or `'*'`, is still global).
               //
               // Measured, so the expectation is right: what this saves depends
               // on how the deployment's hooks are REGISTERED, not on how many
               // there are. Object-scoped registrants stop taxing their
               // neighbours — a record-change flow trigger (`object:
               // binding.object`), plugin-sharing's per-rule recompute, plugin-
               // auth's `sys_user` snapshot refresh, every metadata-authored
               // hook. Registrants that pass no `object` at all (plugin-audit's
               // `writeAudit`, service-storage's file-reference reconcile) DO
               // reach every object, so where they are loaded this gate stays
               // true for everything and saves nothing — correctly, since their
               // handlers really do run. Making those two express in the
               // registration what their handlers already decide at runtime is
               // #5846, not this change.
               //
               // Every consumer of `priorRecord` on this branch is counted, and
               // there are exactly three:
               //   * `needsPriorRecord(updateSchema)` — object validation rules
               //     (ADR-0020: state_machine / cross_field / script; a PATCH
               //     carries only changed fields) AND the `readonlyWhen` /
               //     `requiredWhen` / option-visibility field predicates, which
               //     it subsumes;
               //   * an `afterUpdate` hook on THIS object — `hookContext.previous`
               //     for its handler (plugin-audit, the record-change trigger)
               //     and for its declarative `condition`;
               //   * a roll-up `summary` aggregating this object — `previous`
               //     carries the OLD parent id, so a child that REPOINTS
               //     recomputes both parents (see `recomputeSummaries` below).
               //     Without this term the narrowing would have turned an
               //     incidental read into a silently stale parent summary: today
               //     a repointed child is only saved by some other object having
               //     an afterUpdate hook.
               //
               // [#5574 / #5846] `beforeUpdate` USED to be deliberately absent
               // from this gate, and that was the one place it did not mirror
               // `delete()`'s twin (#5272). The reason given was ordering: this
               // path dispatched `beforeUpdate` first and bound
               // `hookContext.previous` only after the write, so no
               // `beforeUpdate` hook could observe this row however the gate was
               // written, and counting the event would have bought a read with
               // no reader. ADR-0058 Addendum II reversed the ordering, so the
               // reader now exists — the read and the binding happen ABOVE, in
               // the pre-phase, and `wantsPriorRecord` there counts
               // `beforeUpdate` alongside `afterUpdate`.
               //
               // What that also retired: the `sys_fetch_previous_update`
               // builtin (`plugin.ts`, `object: '*'`, priority 5) used to be the
               // only producer of `previous` for the before phase, making its
               // own `ql.findOne` on every by-id update. With the engine binding
               // it first the builtin's `!ctx.previous` guard is permanently
               // short-circuited, so #5846 removes it rather than leaving a
               // second read behind a guard that can no longer be false.
               //
               // B2: drop writes to fields locked by a TRUE `readonlyWhen` — the
               // field is read-only for this record's state, so the incoming
               // change is ignored (the persisted value is kept).
               const preRoWhen = hookContext.input.data as Record<string, unknown>;
               // [#4889] A `parent`-scoped predicate ("once the header invoice
               // is Paid, its lines are frozen") needs the master-detail header
               // bound as `parent`. Only the engine can fetch it, so the strip
               // is a pure function of what we hand it — resolve here, gated on
               // the payload actually touching such a predicate so a detail
               // object with only `record`-scoped locks pays no extra read.
               //
               // [#4977] `requiredWhen` reads the same root at the same write,
               // so the two slots share ONE resolution rather than each buying
               // a header read — and, more importantly, so a single write can
               // never judge its lock and its requirement against two different
               // headers. Payload-FK-first for both (#4889's rule: a repoint is
               // judged against the master it lands on) — [#19853] provided it
               // LANDS: `settleMasterDetailLanding` judges the FK's own fate
               // first and hands back the view the write STORES, so a repoint a
               // later strip takes back out is judged against the header the
               // row keeps.
               const schemaHasParentRequiredWhen = hasParentScopedRequiredWhen(updateSchema as any);
               const wantsParentBinding =
                   hasParentScopedReadonlyWhenInPayload(updateSchema as any, preRoWhen) ||
                   schemaHasParentRequiredWhen;
               // [#19853] The static strip's gate, read ONCE and consumed by
               // both the settlement below and the strip itself (#2948, further
               // down), so the two cannot disagree about whether it runs.
               const staticReadonlyStripRuns = !opCtx.context?.isSystem;
               // [#19887] The static strip's verdict, described once: the
               // settlement asks it of the FK, and both `readonlyWhen` strips
               // build their `record` view from the payload it leaves.
               // [#24822] ...with the wall's flag read once above, so the views
               // these consumers read agree with the strip below about
               // `organization_id`.
               const staticStrip = { runs: staticReadonlyStripRuns, preserveAudit: opCtx.context?.preserveAudit === true, hookWrittenKeys, wallJudgesOrganization };
               const landing = wantsParentBinding
                   ? await this.settleMasterDetailLanding({
                       schema: updateSchema, data: preRoWhen, supplied: suppliedValues,
                       staticStrip,
                       resolve: (view) => this.resolveMasterDetailParent(updateSchema, view, priorRecord, opCtx.context),
                       judgeFkLock: (named, fk) => stripReadonlyWhenFields(updateSchema as any, preRoWhen, priorRecord, this.logger, named, { supplied: suppliedValues, only: fk, stored: staticReadonlyStoredView(updateSchema, preRoWhen, suppliedValues, staticStrip) }) as Record<string, unknown>,
                     })
                   : undefined;
               const roWhenParent = landing?.header;
               // [#4977] The ADR-0113 non-regression pre-check asks whether the
               // STORED row already violated, so for a REPOINT it must read the
               // header the row hung off BEFORE the write — not the one it is
               // landing on. Resolved only when the payload actually moves the
               // detail to another master; otherwise the two are the same row
               // and `evaluateValidationRules` reuses `parent` for both.
               // [#19853] "Actually moves" is asked of the view the write
               // stores: a repoint that never lands moves nothing.
               // ⛔ And of the stored FK only as the caller's own read door
               // serves it (`priorMasterIdsCallerReads`), asked only when the
               // write names the FK: a FK the caller cannot read as stored
               // leaves the prior master UNKNOWN, bound as the unresolved
               // header (`null`), so whether the pre-check reads a second
               // header, and which, never depends on what the column holds.
               // A FK the caller reads, and a system write, are judged as
               // before.
               const mdRel = schemaHasParentRequiredWhen ? resolveMasterDetailRelation(updateSchema as any) : null;
               const landingView = landing?.view ?? preRoWhen;
               const namesMaster = mdRel != null && landingView != null && typeof landingView === 'object' && mdRel.fk in landingView;
               const [priorMaster] = namesMaster
                   ? await this.priorMasterIdsCallerReads(updateSchema, [priorRecord], opCtx.context)
                   : [undefined];
               const repointsMaster =
                   mdRel != null &&
                   priorMaster?.id != null &&
                   masterIdOf(mdRel.fk, landingView, null) !== priorMaster.id;
               const roWhenPreviousParent = priorMaster === null
                   ? null
                   : repointsMaster
                       ? await this.resolveMasterDetailParent(updateSchema, null, { [mdRel!.fk]: priorMaster!.id }, opCtx.context)
                       : undefined;
               // [#9107] `suppliedValues` — the SAME entry snapshot the static
               // strip below consumes, now feeding the conditional one too, so
               // both strips answer "did the CALLER write this key?" from one
               // fact. Before this the conditional strip judged the post-hook
               // payload, which gave a `readonlyWhen`-locked field no
               // server-side write path at all: a hook derived the value and
               // the strip deleted it, `isSystem` or not. The API-boundary lock
               // is unchanged — a caller cannot make its own value look
               // hook-written (see `ReadonlyWhenStripOptions`) — and `isSystem`
               // is still NOT an exemption here, unlike the static strip below.
               // [#19853] `landing` has already judged the FK's own lock; this
               // judges the rest, and reports against `preRoWhen` so both
               // verdicts arrive as one `readonly_when` event.
               // [#19887] `stored` — `record` is the payload the write STORES,
               // so a value forged for a static `readonly` field (stripped
               // below) cannot unlock a field whose predicate reads it.
               const roWhenSubject = landing?.subject ?? preRoWhen;
               hookContext.input.data = stripReadonlyWhenFields(updateSchema as any, roWhenSubject, priorRecord, this.logger, roWhenParent, { supplied: landing?.supplied ?? suppliedValues, stored: staticReadonlyStoredView(updateSchema, roWhenSubject, suppliedValues, staticStrip) }) as any;
               reportDroppedFields(preRoWhen, hookContext.input.data as Record<string, unknown>, 'readonly_when');
               // [#2948] Enforce STATIC `readonly` on the write path for
               // non-system callers (system writes legitimately set read-only
               // columns and are exempt). Runs AFTER hooks/middleware stamped
               // their columns; `suppliedValues` ensures only caller-forged
               // read-only writes are dropped, never the server stamps — and
               // (#5591) never a stamp a hook wrote OVER a key the caller
               // happened to echo back.
               //
               // [#8141] `addressKey` carries the SAME fact `reportDroppedFields`
               // is already keyed on — `idAddressesThisRow`, one predicate, both
               // channels — so the log and the report can never disagree about
               // what is an address. The strip is unchanged: `id` still leaves
               // the SET clause, and the driver receives the identical payload;
               // only the WARN that called the address a caller forgery is gone.
               // Undefined on every other path (the multi branch below, and the
               // insert-side sibling), which is what keeps those byte-identical.
               if (staticReadonlyStripRuns) {
                   const preRo = hookContext.input.data as Record<string, unknown>;
                   // [#8214] `strictReadonlyWrites` is threaded INTO the strip
                   // rather than consulted only at `assertNoStrictDrops()`
                   // below: the strip logs from inside, the refusal happens
                   // afterwards, and until the strip knew the flag its line
                   // told a refused caller the update had been "COMMITTED
                   // WITHOUT IT" while `driverWrites` was 0. The seam that
                   // composes the sentence has to know the mode the sentence
                   // describes; nothing else here can tell it.
                   // [#14088] `hookWrittenKeys` — the other half of the same
                   // question `suppliedValues` answers, and the half no
                   // comparison of values can reach. Without it a hook CLEARING
                   // a read-only column loses its write to any caller that
                   // echoed the same value back, which on `null` is every
                   // whole-record form round-trip.
                   // [#24822] Over `readonlyUpdateSubject`: without
                   // `organization_id` where the wall's seam judges this
                   // update's organization (read once, above, for the hide pass
                   // too). An admitted re-point is then stored as sent, not
                   // taken with the row's own organization kept; it is not
                   // reported, and not refused under `strictReadonlyWrites`,
                   // which refuses exactly what this strip takes.
                   hookContext.input.data = stripReadonlyFields(readonlyUpdateSubject as any, preRo, suppliedValues, this.logger, { preserveAudit: opCtx.context?.preserveAudit === true, addressKey: idAddressesThisRow ? 'id' : undefined, strictReadonlyWrites, hookWrittenKeys }) as any;
                   reportDroppedFields(preRo, hookContext.input.data as Record<string, unknown>, 'readonly');
               }
               // [#5126] Both strip passes are done; refuse now if the caller
               // asked for loud. Before `evaluateValidationRules` deliberately:
               // strict is about the payload the caller SENT, and reporting
               // "you sent a read-only field" should not depend on whether some
               // other field also failed a business rule.
               //
               // [#24619] The stored computed fields over the stored row merged
               // with the FINAL payload — after the hooks and both strips, so a
               // locked input the `readonlyWhen` strip took back out feeds the
               // stored value, never the caller's — and before the statement.
               // [#24690] A caller value the computation replaces is reported
               // under `stored_expression`; [#25000] through `emitDrop`, the
               // channel every strip reports through, so under strict it is
               // REFUSED like them and nothing is written. The one judgment
               // below therefore follows the computation, and one refusal names
               // every drop and replacement together. The computation writes
               // nothing (it evaluates over a copy), and an object declaring no
               // stored expression skips it, so its refusal is where it stood.
               // A pass that THROWS (a permission or related-row read) is
               // pre-empted by the strict verdict on the strips' drops already
               // collected — #5126's ordering, as on the predicate branch.
               if (storedExpressionPlan.length > 0) {
                   const patch = hookContext.input.data as Record<string, unknown>;
                   let computed: Record<string, unknown> | undefined;
                   try {
                       [computed] = await computeStoredExpressions(storedExpressionPlan, [{ ...priorRecord, ...patch }], opCtx.context, storedExpressionServing);
                   } catch (err) {
                       assertNoStrictDrops();
                       throw err;
                   }
                   emitDrop(replacedStoredExpressionFields(storedExpressionPlan, suppliedValues, patch, [computed!]), 'stored_expression');
                   applyStoredExpressionsToPatch(patch, computed!, priorRecord);
               }
               assertNoStrictDrops();
               // [ADR-0144 D5] The write-time home projection on the by-id
               // path, over the stored row with the FINAL payload laid over it
               // — after the hooks, both strips and the strict refusal, so its
               // values are never stripped and a strict caller is told about
               // its own payload first — and before the second validation pass,
               // which judges what it wrote. Only when the payload touches an
               // amount declaring `homeAmount`, its code, its document date or
               // one of the two projected fields: an unrelated edit never
               // re-reads a rate. A value a system or `preserveAudit` writer
               // sent for the home or rate field is recomputed over.
               {
                   const homeAmountPlan = planHomeAmounts(updateSchema);
                   if (homeAmountPlan.length > 0) {
                       await this.projectHomeAmountsOntoPatch(
                         object, homeAmountPlan, priorRecord, hookContext.input.data as Record<string, unknown>,
                         opCtx.context, hookContext.input.id,
                       );
                   }
               }
               // [#21663] The payload is FINAL here (see the seam below), so
               // every readonly value on it is one the driver will store: a
               // system writer's (the strip above never ran for it), a hook's,
               // or a stamp. Its SHAPE is judged now, by the same arms and
               // sentences as the caller-writable fields the first
               // `validateRecord` above judged ahead of the strip — `'only'`,
               // because those are already judged. See `ReadonlyValueScope`.
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>, 'only');
               validateRecordInScope(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', 'only', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation });
               // [ADR-0144 D8 rule 4] The stored row with the FINAL payload laid
               // over it keeps a currency code beside a record-mode amount the
               // payload touches (`ERR_CURRENCY_CODE_REQUIRED`).
               assertRecordCurrencyCodes(
                 object, (updateSchema as { fields?: unknown } | undefined)?.fields,
                 { ...(priorRecord ?? {}), ...(hookContext.input.data as Record<string, unknown>) },
                 'update', hookContext.input.data as Record<string, unknown>, hookContext.input.id,
               );
               // ── [#19989] The post-image seam on the BY-ID path ─────────────
               //
               // The by-id twin of the predicate-path call below, placed at the
               // same point and for the same reason: the payload is FINAL here.
               // The `beforeUpdate` chain, the hand-back, both readonly strips
               // and the strict-drop refusal have all run, and nothing below
               // changes a value before the statement.
               //
               // An enforcement layer used to judge this row only in its own
               // middleware, on its read of the row merged with the change set
               // AS SENT. That image is taken before `next()` runs the hooks, so
               // a `beforeUpdate` that rewrote a checked field (a scoping column
               // derived from a re-pointed parent, a status derived from another
               // field) was never judged, and the row it produced was stored
               // unjudged. The layer keeps that earlier judgement and installs
               // this seam as well, so the row the driver stores is judged too.
               //
               // The image is the prior row (read once, above, under the
               // not-found gate, so it is present) merged with the final
               // payload: the row `driver.update` is about to produce, and the
               // shape the predicate path hands over per matched row. The
               // credential channel runs above on this branch too, so a `check`
               // naming a secret field judges the stored reference, as on the
               // predicate path.
               //
               // `honoured` is set BEFORE `evaluate`: it answers "did the seam
               // run", never "did the write pass".
               const byIdImageCheck = opCtx.postHookWriteImageCheck;
               if (byIdImageCheck) {
                   byIdImageCheck.honoured = true;
                   const payload = hookContext.input.data as Record<string, unknown>;
                   await byIdImageCheck.evaluate([
                     coerceBooleanFields(updateSchema as any, { ...priorRecord, ...payload } as any) as Record<string, unknown>,
                   ]);
               }
               // [#18682] The reference FK a predicate traverses may come from
               // the PATCH or from the stored row, so the id is read off the
               // POST-strip merged view `evaluateValidationRules` evaluates.
               const updateView = { ...(priorRecord ?? {}), ...(hookContext.input.data as Record<string, unknown>) };
               const relatedForUpdate = (await this.resolvePredicateRelated(updateSchema, [updateView], opCtx.context))(updateView);
               // [#18783] The map an option gated on `current_user.can(…)` is
               // answered from — resolved only when the PATCH picks one, and a
               // resolution failure fails this write closed right here.
               const updatePayload = hookContext.input.data as Record<string, unknown>;
               const permissionsForUpdate = (await this.resolveOptionPermissions(updateSchema, [updatePayload], permissionResolution))(updatePayload);
               // [#4441] A repoint is as capable of dangling as an initial link.
               // [#29062] …but a value the row already stores is not a repoint:
               // the prior row is what the check forgives a refused value against.
               // [#29029] Before the record's validation rules unless this is a
               // system write, as on insert (`referencesCheckedBeforeRules`).
               const referencesFirst = referencesCheckedBeforeRules(opCtx.context);
               const checkReferences = () => this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
                 async () => [priorRecord],
               );
               if (referencesFirst) await checkReferences();
               emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: priorRecord, logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, parent: roWhenParent, previousParent: roWhenPreviousParent, related: relatedForUpdate, permissions: permissionsForUpdate }), this.logger, object);
               if (!referencesFirst) await checkReferences();
               // [commit 9d7f7259f] The by-id driver exit — where a driver's refusal
               // leaves this door, and where a recognised unique violation
               // stops being the driver's error. `envelopeUniqueViolation`
               // returns everything else untouched (a NOT NULL, a deadlock, a
               // missing table, an unreachable store), so only the conflict
               // changes shape; the contract is stated on `update()` above.
               // [#24768] A NOT NULL refusal on a declared field is the second
               // shape that changes: the validator's own `ValidationError`.
               // Wrapped HERE rather than at the outer `catch` below, and
               // deliberately: that `try` also encloses the `afterUpdate`
               // dispatch and the roll-up recompute, so an envelope applied
               // there would attribute a violation raised by a nested driver
               // call inside a hook to THIS object.
               // [#27495] The credential row is written now, after every pass that
               // can refuse this write and immediately before the statement; a
               // statement that fails takes it back (the outer `catch`).
               await this.persistSecretRows(sealedSecrets, writtenSecrets);
               try {
                   // [ADR-0142 D4] A write under a precondition is the driver's
                   // conditional update plus a readback — see
                   // `OperationContext.writePrecondition`.
                   const precondition = opCtx.writePrecondition;
                   result = precondition && Object.keys(precondition).length > 0
                     ? await this.updateByIdExpecting(driver, object, hookContext.input.id, hookContext.input.data as Record<string, unknown>, precondition, driverOptions)
                     : await driver.update(object, hookContext.input.id as string, hookContext.input.data as Record<string, unknown>, driverOptions);
               } catch (driverError) {
                   throw envelopeDriverWriteRefusal(driverError, object, this.getSchema(object), 'update', updateMsgCtx);
               }
               // [#21613] The by-id update returns the driver's post-write
               // readback (`select *` on driver-sql), so a column no metadata
               // declares rode back in the PATCH 200 `record` with its stored
               // value. Same default projection as the read verbs and the
               // insert result, applied on the row as the driver returned it:
               // before the formulas, the `afterUpdate` hooks, the roll-up, the
               // `data.record.updated` event and the door's ingress strip. A
               // `null` readback (the row left the caller's scope) stays `null`.
               result = withDeclaredColumnsOnly(result, declaredColumnSet(updateSchema));
               // [#29538] Same answer on the stored declared columns as the
               // insert result and the next read (#29408), less those the
               // PATCH or the stored row before it carried a value for.
               result = withSelectedColumnsAnswered(result, storedColumnsLeftUnwritten(
                 selectedStoredColumns(updateSchema, undefined), hookContext.input.data, priorRecord,
               ));
               // [#27495] The handle the stored row named before, where this
               // statement cleared or replaced it.
               retiredSecrets = retiredSecretSlots(updateSchema, [priorRecord], hookContext.input.data);
           } else {
               // [#6262] A bulk SET clause must not carry `id`. Reaching this
               // branch AT ALL means `resolveEngineUpdateDispatch` returned
               // `multi`, i.e. it found no scalar truthy id in EITHER source —
               // so whatever sits in `data.id` here (an operator object, an
               // array, `null`, a falsy scalar) is a value the engine has
               // already RULED is not a primary key. Leaving it in the payload
               // then asks the driver to write that ruled-not-an-id value into
               // the primary-key column of every matched row: the measured
               // probe was `updateMany({object}, { id: { $in: ['a','b'] },
               // title: 'x' })`, i.e. a serialized operator object as the new
               // primary key of N rows. Five backends would each answer that
               // differently (#5240 / #4434), and on the ones that accept it
               // the matched rows lose their identity irreversibly.
               //
               // This is the SAME answer to the SAME question, applied one
               // layer on — not a second opinion. #5748 / PR #5919 ruled that a
               // non-scalar `data.id` is not an id and therefore stops
               // shadowing the dispatch ladder; the declared bulk intent is
               // honoured (`ENGINE_UPDATE_DISPATCH_CASES` says `'multi'`, and
               // this change leaves every verdict in that set untouched). The
               // strip is that ruling's other half: a value that is not the
               // primary key does not get to sit in the primary-key column
               // either. Rejecting the call instead (#6262's route B) would
               // reverse a verdict the case-set states today, which is a fresh
               // maintainer decision rather than this fix.
               //
               // No reachable shape loses a legitimate write: a truthy scalar
               // `data.id` outranks both `where` and `multi` and never gets
               // here, and N rows cannot share one primary key anyway.
               //
               // [#6437] REPORTED through `reportDroppedFields` under the
               // `primary_key` reason. `DroppedFieldsEvent.reason` was a closed
               // enum over the two READ-ONLY strips when this block landed, and
               // this drop is neither — so PR #6433 emitted only the `warn`
               // rather than force-fit an arm that would have lied. #6437
               // widened the vocabulary instead (spec, plus the batch/REST
               // protocol responses that carry it transitively), which is what
               // lets the seam report it truthfully now. The `warn` STAYS: it
               // carries the remedy prose, and a caller that registered no
               // listener still needs the #4632 signal.
               const preIdMulti = hookContext.input.data as Record<string, unknown> | null | undefined;
               if (preIdMulti && typeof preIdMulti === 'object' && Object.prototype.hasOwnProperty.call(preIdMulti, 'id')) {
                   const { id: notAnId, ...withoutId } = preIdMulti;
                   hookContext.input.data = withoutId as any;
                   this.logger.warn(
                     `Bulk update on '${object}': dropped 'id' from the write payload. A multi:true update ` +
                       `targets rows through its predicate, and the engine has already ruled this value is not a ` +
                       `primary key (${JSON.stringify(notAnId) ?? String(notAnId)}) — writing it would have ` +
                       `overwritten the primary-key column of every matched row. To update ONE row by id, pass a ` +
                       `scalar id (\`update(object, { id, ...fields })\` or \`{ where: { id } }\`) instead of ` +
                       `options.multi; to SELECT rows by an id set, put it in \`where\` (\`{ where: { id: { $in: [...] } }, multi: true }\`).`,
                   );
                   reportDroppedFields(preIdMulti, hookContext.input.data as Record<string, unknown>, 'primary_key');
               }
               // [#8559] Password half of the credential write door, then the
               // secret channel (which carries the secret-arm refusal).
               this.refuseEmptyPasswordFields(object, hookContext.input.data as Record<string, unknown>);
               // [#27582] The rows this write lands on are the matched rows: the
               // D7 memo, read here only when a non-system payload carries a ref.
               sealedSecrets = await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, driverOptions, readPriorRows);
               // [#21663] Scope `'skip'` — the public `validateRecord` IS that
               // scope: the readonly strip has NOT run yet, so a readonly value
               // here may be a caller's the strip is about to drop — judged, a
               // whole-record write-back echoing a legacy stored value would
               // become a refusal. Readonly values are judged after the strip
               // (`validateRecordInScope(…, 'only')`, below).
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>, 'skip');
               // [#22183] `keptOptionValues`: the option values an import kept for this write.
               validateRecord(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation, keptOptionValues: opCtx.context?.keptOptionValues });
               // [#2982] The middleware-composed AST — asserted present and
               // bound to the memoized row read in the pre-phase above, so the
               // injected row-scoping (RLS write filter, sharing's
               // editable-rows filter) binds every read AND the write.
               const ast = opCtx.ast!;
               // [#3106] Validation rules, `requiredWhen` and per-option
               // `visibleWhen` are PER ROW on a bulk update, exactly like the
               // `readonlyWhen` strip below: one payload, N prior states. Read
               // the row-scoped match set ONCE with the SAME AST the write binds
               // (shared with the [#3042] strip), and only when the schema
               // actually needs prior state — `needsPriorRecord` subsumes
               // `hasReadonlyWhenInPayload` (readonlyWhen fields count toward
               // it), so a rule-free schema still pays nothing here.
               const rulesNeedRows = needsPriorRecord(updateSchema as any);
               const payloadHasReadonlyWhen = hasReadonlyWhenInPayload(updateSchema as any, hookContext.input.data as Record<string, unknown>);
               // [#5038/#5574] The hook phases are the third and fourth demands
               // on that same read, and they were already resolved in the
               // pre-phase above (they have to be — a per-row `before*` context
               // is built from these very rows). What is left here is the
               // strip's and the rules' own demand, asked of the POST-hook
               // payload, which is why this call site survives at all. It is
               // the SAME read: `readPriorRows` is a memo, so one `driver.find`
               // serves validation, the `readonlyWhen` strip and BOTH hook
               // phases — D7's one-read rule, and the issue's performance
               // guardrail ("行集读取一次完成,求值批内复用"), stated as code.
               if (rulesNeedRows || payloadHasReadonlyWhen) {
                   priorRows = await readPriorRows();
               }
               // [#3042] Enforce conditional `readonlyWhen` on the bulk path too.
               // Unlike static `readonly` (below), a `readonlyWhen` lock is PER
               // ROW — drop any field locked in ≥1 matched row: a bulk write
               // can't keep it for some rows and drop it for others, so a field
               // locked in any target row is fail-safe-dropped for all (narrow
               // `where` to reach the unlocked rows). Symmetric with the
               // single-id `stripReadonlyWhenFields`; INSERT stays exempt.
               //
               // [#4889] N matched rows can hang off N different masters, so the
               // `parent` binding is per row here. Batch-read the distinct
               // headers ONCE (the same shape as the single-id resolution, one
               // query instead of one per row) and hand out a lookup.
               //
               // [#4977] Hoisted out of the `readonlyWhen` block because the
               // per-row `evaluateValidationRules` below needs the same lookup
               // for `requiredWhen` — including on a batch whose payload writes
               // no `readonlyWhen` field at all. One resolution, both consumers,
               // so a bulk write cannot judge its lock and its requirement
               // against different headers.
               //
               // [#19853] The same settlement as the by-id branch, per row: a
               // repoint a later strip takes back out leaves every matched row
               // under its OWN header, and that is the one each row is judged
               // against. The FK's own lock is judged as the bulk strip judges
               // any field — locked in ≥1 matched row keeps it out of all.
               const preRoWhenMulti = hookContext.input.data as Record<string, unknown>;
               const schemaHasParentRequiredWhenMulti = hasParentScopedRequiredWhen(updateSchema as any);
               // [#19853] One read of the static strip's gate, both consumers —
               // as on the by-id branch.
               const staticReadonlyStripRunsMulti = !opCtx.context?.isSystem;
               // [#19887] Described once, three consumers — as on the by-id
               // branch.
               const staticStripMulti = { runs: staticReadonlyStripRunsMulti, preserveAudit: opCtx.context?.preserveAudit === true, hookWrittenKeys, wallJudgesOrganization };
               const landingMulti =
                   hasParentScopedReadonlyWhenInPayload(updateSchema as any, preRoWhenMulti) ||
                   schemaHasParentRequiredWhenMulti
                       ? await this.settleMasterDetailLanding({
                           schema: updateSchema, data: preRoWhenMulti, supplied: suppliedValues,
                           staticStrip: staticStripMulti,
                           resolve: (view) => this.resolveMasterDetailParents(updateSchema, view, priorRows, opCtx.context),
                           judgeFkLock: (named, fk) => stripReadonlyWhenFieldsMulti(updateSchema as any, preRoWhenMulti, priorRows, this.logger, named, { supplied: suppliedValues, only: fk, stored: staticReadonlyStoredView(updateSchema, preRoWhenMulti, suppliedValues, staticStripMulti) }) as Record<string, unknown>,
                         })
                       : undefined;
               const parentForRow = landingMulti?.header;
               // [#4977] Pre-check headers for the ADR-0113 non-regression test,
               // resolved only when the payload REPOINTS the matched rows at
               // another master (see the single-id branch for why the stored
               // row's own header is the one that question needs).
               // ⛔ Each matched row's stored FK only as the caller's own read
               // door serves it, as on the by-id branch: a row whose FK the
               // caller cannot read as stored binds the unresolved header
               // (`null`), and its stored master is never read.
               const mdRelMulti = schemaHasParentRequiredWhenMulti ? resolveMasterDetailRelation(updateSchema as any) : null;
               let previousParentForRow: ((row: Record<string, unknown> | undefined) => Record<string, unknown> | null) | undefined;
               if (mdRelMulti != null && masterIdOf(mdRelMulti.fk, landingMulti?.view ?? preRoWhenMulti, undefined) != null) {
                   const matched = priorRows ?? [];
                   const priorMasters = await this.priorMasterIdsCallerReads(updateSchema, matched, opCtx.context);
                   const known = matched.flatMap((row, i) => {
                       const prior = priorMasters[i];
                       return prior ? [{ row, stored: { [mdRelMulti.fk]: prior.id } }] : [];
                   });
                   const headerOf = await this.resolveMasterDetailParents(updateSchema, null, known.map((k) => k.stored), opCtx.context);
                   const previousByRow = new Map(known.map((k) => [k.row, headerOf(k.stored)]));
                   previousParentForRow = (row) => (row ? previousByRow.get(row) ?? null : null);
               }
               if (payloadHasReadonlyWhen) {
                   // [#9107] Same entry snapshot, same authorship gate as the
                   // by-id branch above — "both call sites" is the #3106 /
                   // #4441 shape that gets missed, and a bulk write must not
                   // reach a different verdict about who wrote a key.
                   // [#19887] Nor read a different payload: each matched row's
                   // `record` is the payload the write stores, over that row.
                   const roWhenSubjectMulti = landingMulti?.subject ?? preRoWhenMulti;
                   hookContext.input.data = stripReadonlyWhenFieldsMulti(updateSchema as any, roWhenSubjectMulti, priorRows, this.logger, parentForRow, { supplied: landingMulti?.supplied ?? suppliedValues, stored: staticReadonlyStoredView(updateSchema, roWhenSubjectMulti, suppliedValues, staticStripMulti) }) as any;
                   reportDroppedFields(preRoWhenMulti, hookContext.input.data as Record<string, unknown>, 'readonly_when');
               }
               // [#2948] Same static-`readonly` write guard on the bulk path —
               // a forged read-only column in a multi-row update is dropped for
               // non-system callers (a foreign `organization_id` is additionally
               // rejected upstream by the tenant write wall, #2946).
               if (staticReadonlyStripRunsMulti) {
                   const preRoMulti = hookContext.input.data as Record<string, unknown>;
                   // [#8214] Same threading as the by-id branch; the multi
                   // branch still passes no `addressKey` (nothing addresses a
                   // row by key here), which is what keeps it byte-identical
                   // to #8141 in every other respect.
                   // [#14088] The SAME record the by-id branch consumes,
                   // sealed once at the shared confluence. Not a second
                   // derivation: two notions of "a hook wrote this key" that
                   // disagree in one edge case would be a worse defect than the
                   // one they were each added to close, and a bulk write that
                   // reached a different verdict about authorship than a by-id
                   // write is the #3106 / #4441 divergence verbatim.
                   // [#24822] The same `readonlyUpdateSubject` as the by-id
                   // branch: the wall's seam judges every matched row merged
                   // with this payload, so an admitted re-point is stored as
                   // sent on every one of them.
                   hookContext.input.data = stripReadonlyFields(readonlyUpdateSubject as any, preRoMulti, suppliedValues, this.logger, { preserveAudit: opCtx.context?.preserveAudit === true, strictReadonlyWrites, hookWrittenKeys }) as any;
                   reportDroppedFields(preRoMulti, hookContext.input.data as Record<string, unknown>, 'readonly');
               }
               // [#5126] Same refusal on the predicate path. A bulk strip is
               // "locked in ≥1 matched row ⇒ dropped for ALL", so a strict bulk
               // caller is told before N rows are written with a column missing
               // — the failure mode a bulk write makes N times larger. The
               // judgment itself follows the stored-expression pass below, as on
               // the by-id branch.
               //
               // [#24619] The stored computed fields on the predicate path, over
               // the FINAL payload as on the by-id branch. One patch reaches
               // every matched row, so {@link settleBulkStoredExpressions} keeps
               // a computed value only when it is the same on every row, and
               // refuses a patch that would compute different ones. The rows
               // are the D7 read (`readPriorRows` is a memo — no second fetch).
               // [#24690] As on the by-id branch: a caller value differing from
               // what any matched row then stores (the one computed value, or
               // the column left as it is) is reported under
               // `stored_expression`; [#25000] through `emitDrop`, so under
               // strict it is REFUSED before the statement and no row is written,
               // in one refusal with every strip's drop. The pass writes nothing.
               // ⛔ #5126's ordering survives it: a pass that THROWS — above
               // all `settleBulkStoredExpressions` refusing a patch that computes
               // different values on different rows (`VALIDATION_FAILED`) — is
               // pre-empted by the strict verdict on the strips' drops already
               // collected, so a strict caller whose payload a strip took is told
               // `ERR_READONLY_FIELD_REJECTED` first, exactly as when the assert
               // sat ahead of the whole pass. With no throw, one refusal names
               // every strip drop plus the replacement.
               if (storedExpressionPlan.length > 0) {
                   try {
                       const matched = ((await readPriorRows()) ?? []).filter((row) => row != null && typeof row === 'object');
                       const patch = hookContext.input.data as Record<string, unknown>;
                       const before = await computeStoredExpressions(storedExpressionPlan, matched, opCtx.context, storedExpressionServing);
                       const after = await computeStoredExpressions(storedExpressionPlan, matched.map((row) => ({ ...row, ...patch })), opCtx.context, storedExpressionServing);
                       const settled = settleBulkStoredExpressions(storedExpressionPlan, patch, before, after, object);
                       emitDrop(
                         replacedStoredExpressionFields(storedExpressionPlan, suppliedValues, patch, matched.map((row) => ({ ...row, ...settled }))),
                         'stored_expression',
                       );
                       hookContext.input.data = settled as any;
                   } catch (err) {
                       assertNoStrictDrops();
                       throw err;
                   }
               }
               assertNoStrictDrops();
               // [ADR-0144 D5] The write-time home projection on the predicate
               // path, at the by-id branch's point and for its reasons. One
               // patch reaches every matched row, so each matched row (the D7
               // read — `readPriorRows` is a memo) is projected with the patch
               // laid over it, and {@link settleBulkHomeAmounts} keeps a
               // projected value only when it is the same on every row; a patch
               // that would convert to different values is refused before the
               // statement. A refusal of any matched row (no home currency, no
               // rate on its document date) refuses the whole update.
               {
                   const homeAmountPlan = planHomeAmounts(updateSchema);
                   const homePatch = hookContext.input.data as Record<string, unknown>;
                   const touched = homeAmountsTouched(homeAmountPlan, homePatch);
                   if (touched.length > 0) {
                       const matched = ((await readPriorRows()) ?? []).filter((row) => row != null && typeof row === 'object');
                       const homeServing = this.homeAmountServing(opCtx.context);
                       const projected: Array<Record<string, unknown>> = [];
                       for (const row of matched) {
                           const image = { ...row, ...homePatch };
                           projected.push(await projectHomeAmounts(touched, image, homeServing, {
                             object,
                             operation: 'update',
                             organizationId: ObjectQL.homeAmountOrganizationOf(image, opCtx.context),
                             recordId: row.id,
                           }));
                       }
                       hookContext.input.data = settleBulkHomeAmounts(touched, homePatch, projected, object) as any;
                   }
               }
               // [#21663] The predicate-path twin of the by-id second pass, at the
               // same point and for the same reason: the readonly values left on
               // the final payload are stored, so their SHAPE is judged — before
               // N rows are written.
               normalizeMultiValueFields(updateSchema, hookContext.input.data as Record<string, unknown>, 'only');
               validateRecordInScope(updateSchema, hookContext.input.data as Record<string, unknown>, 'update', 'only', { mediaValueShapeStrict, valueShapeStrict, messages: updateMsgCtx, onAdmittedValueShapeViolation });
               // [ADR-0144 D8 rule 4] The predicate-path twin: every matched row,
               // with the FINAL payload laid over it, keeps a currency code beside
               // a record-mode amount the payload touches. The matched rows are
               // read only for such a payload (`readPriorRows` is the memo the
               // seams below share).
               {
                   const currencyPayload = hookContext.input.data as Record<string, unknown>;
                   const currencyFields = (updateSchema as { fields?: unknown } | undefined)?.fields;
                   if (touchesRecordCurrency(currencyFields, currencyPayload)) {
                       for (const row of (await readPriorRows()) ?? []) {
                           assertRecordCurrencyCodes(object, currencyFields, { ...row, ...currencyPayload }, 'update', currencyPayload, row?.id);
                       }
                   }
               }
               // ── [#19950] The post-image seam on the PREDICATE path ─────────
               //
               // An enforcement layer's write `check` must hold for EVERY row a
               // write stores (ADR-0058 D4: "and on the AST-injected bulk
               // path"). For a by-id update the enforcement middleware knows the
               // one row, but can read it only before the hooks run, so that
               // path hands the final row to the same seam ([#19989], the by-id
               // branch above). For a predicate update the middleware cannot
               // even name the rows: they are the ones the
               // middleware-COMPOSED AST selects, and that AST is complete only
               // once every middleware has run (the enforcement layer's own
               // scope, a sharing layer's editable-rows filter, the tenant
               // wall). So the layer installs its judgement on
               // `opCtx.postHookWriteImageCheck`, as it does for an insert, and
               // the engine hands it the rows here.
               //
               // Each image is one matched row merged with the payload, the
               // row `updateMany` is about to produce, and it is the same shape
               // the per-row `afterUpdate` context calls `result`
               // (`buildPerRowAfterContexts`). The rows come from the D7 read,
               // the one `readPriorRows` memo that validation, the
               // `readonlyWhen` strip and both hook phases share, bound to the
               // same composed AST the statement binds. That is the one read the
               // ruling allows, never a second fetch.
               //
               // Placement: the payload is FINAL here. The per-row
               // `beforeUpdate` chain, the hand-back, both readonly strips and
               // the strict-drop refusal have all run, and nothing below
               // changes a value before the statement. The seam judges the rows
               // that will be stored, which is the rule the insert seam was
               // held to. The credential channel (`encryptSecretFields`) runs
               // above on this branch and only SEALS the `sys_secret` row there;
               // the row is written immediately before the statement (#27495),
               // so a write this seam or the validation below refuses leaves
               // none. A `check` naming a secret field judges the stored
               // reference.
               //
               // `honoured` is set BEFORE `evaluate`, exactly as on the insert
               // path: it answers "did the seam run", never "did the write
               // pass". Zero matched rows is an empty judgement, not a skipped
               // one.
               const predicateImageCheck = opCtx.postHookWriteImageCheck;
               if (predicateImageCheck) {
                   predicateImageCheck.honoured = true;
                   const matchedRows = (await readPriorRows()) ?? [];
                   const payload = hookContext.input.data as Record<string, unknown>;
                   await predicateImageCheck.evaluate(
                     matchedRows.map(
                       (row) => coerceBooleanFields(updateSchema as any, { ...row, ...payload } as any) as Record<string, unknown>,
                     ),
                   );
               }
               // [#3106] Same enforcement the single-id branch runs at its
               // `evaluateValidationRules` call, applied per matched row: any
               // error-severity violation rejects the WHOLE batch before
               // `updateMany` writes anything (all-or-nothing, like the strip's
               // locked-in-any-row rule). Runs on the stripped payload, in the
               // single-id branch's order. Warning-severity violations may log
               // once per matched row — accepted. With no prior-dependent rules
               // the payload-only evaluation covers format / json_schema /
               // non-prior conditional at zero fetch cost.
               const bulkEvalUser = this.buildEvalUser(opCtx.context);
               // [#18682] One batched resolution for the whole matched set, off
               // the same merged view each row will be evaluated as. The
               // no-prior branch below needs none: `needsPriorRecord` counts a
               // traversing rule, so an object with one never reaches it.
               const bulkPatch = hookContext.input.data as Record<string, unknown>;
               const bulkRelatedForRow = rulesNeedRows
                   ? await this.resolvePredicateRelated(
                       updateSchema,
                       (priorRows ?? []).map((r) => ({ ...(r ?? {}), ...bulkPatch })),
                       opCtx.context,
                     )
                   : undefined;
               // [#18783] ONE permission-map resolution for the whole matched
               // set — the patch is shared, so either every row picks a
               // `can`-gated option or none does. Never per row.
               const bulkPermissions = (await this.resolveOptionPermissions(updateSchema, [bulkPatch], permissionResolution))(bulkPatch);
               // [#4441] The bulk call site too — a guard wired into single-id
               // writes only is still a hole one call site over (AGENTS.md
               // PD #10's own worked example, #3106).
               // [#29062] A refused value is forgiven only when EVERY matched row
               // already stores it (the `readPriorRows` memo, read only then);
               // a row it is new to makes it this write's reference.
               // [#29029] Before the record's validation rules unless this is a
               // system write, as on insert (`referencesCheckedBeforeRules`).
               const referencesFirst = referencesCheckedBeforeRules(opCtx.context);
               const checkReferences = () => this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
                 readPriorRows,
               );
               if (referencesFirst) await checkReferences();
               if (rulesNeedRows) {
                   for (const row of priorRows ?? []) {
                       try {
                           emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: row, logger: this.logger, currentUser: bulkEvalUser, skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, parent: parentForRow?.(row), previousParent: previousParentForRow?.(row), related: bulkRelatedForRow?.({ ...(row ?? {}), ...bulkPatch }), permissions: bulkPermissions }), this.logger, object);
                       } catch (err) {
                           if (err instanceof ValidationError && row?.id != null) {
                               throw new ValidationError(err.fields.map((f) => ({ ...f, message: `${f.message} (record ${String(row.id)})` })));
                           }
                           throw err;
                       }
                   }
               } else {
                   // [#4977] No `parent` here, and it is not a hole: this branch
                   // is unreachable for an object that has a `requiredWhen` at
                   // all. `needsPriorRecord` is TRUE as soon as any field
                   // declares one (`fieldsNeedPrior`), so `rulesNeedRows` sends
                   // every such object down the per-row branch above, where the
                   // binding is supplied. This branch only ever runs for the
                   // rule families that never read a header.
                   emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: null, logger: this.logger, currentUser: bulkEvalUser, skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, permissions: bulkPermissions }), this.logger, object);
               }
               if (!referencesFirst) await checkReferences();
               // `updateMany` presence is part of the ladder verdict resolved above.
               // [commit 9d7f7259f] The predicate driver exit, enveloped on the same
               // terms as the by-id exit above. A multi-row write names no
               // row: `field` is whatever `uniqueViolationColumn` reads off
               // the driver's error, and NOTHING is invented about which of
               // the N matched rows conflicted — a fabricated row attribution
               // is worse than an absent one (triage ruling, 2026-09-02),
               // exactly as the composite-index case already behaves on insert.
               //
               // [#26950] The parents this write moves a roll-up of, read BEFORE
               // the write: the matched rows' foreign keys as they are, and as
               // the payload leaves them, so a reparent recomputes the old parent
               // and the new one, as the by-id branch does with `priorRecord`.
               // Only the descriptors' FK columns are read, through this write's
               // own row-scoped AST and driver options; the memoized matched-row
               // read serves instead when a consumer above already made it. An
               // object no roll-up aggregates reads nothing here.
               const summaryKeyColumns = this.summaryForeignKeyColumns(object);
               if (summaryKeyColumns.length > 0) {
                   const previous = priorRowsRead
                     ? ((await readPriorRows()) ?? [])
                     : (((await driver.find(object, { ...ast, fields: summaryKeyColumns }, driverOptions)) ?? []) as Record<string, unknown>[]);
                   const payload = hookContext.input.data as Record<string, unknown>;
                   summaryRows = { previous, next: previous.map((row) => ({ ...row, ...payload })) };
               }
               // [#27495] The handles the matched rows hold in the secret columns
               // this payload moves, read BEFORE the statement replaces them:
               // the D7 memo when a consumer above already made it, otherwise
               // only those columns, through this write's own AST and options.
               // A payload that moves no secret column reads nothing here.
               const movedSecretColumns = secretFieldsWritten(updateSchema, hookContext.input.data);
               const priorSecretRows = movedSecretColumns.length === 0
                 ? []
                 : priorRowsRead
                   ? ((await readPriorRows()) ?? [])
                   : (((await driver.find(object, { ...ast, fields: ['id', ...movedSecretColumns] }, driverOptions)) ?? []) as Record<string, unknown>[]);
               await this.persistSecretRows(sealedSecrets, writtenSecrets);
               try {
                   result = await driver.updateMany!(object, ast, hookContext.input.data as Record<string, unknown>, driverOptions);
               } catch (driverError) {
                   throw envelopeDriverWriteRefusal(driverError, object, this.getSchema(object), 'update', updateMsgCtx);
               }
               isPredicateWrite = true;
               retiredSecrets = retiredSecretSlots(updateSchema, priorSecretRows, hookContext.input.data);
           }

           hookContext.event = 'afterUpdate';
           // [#5504] Same formula hydration the insert path runs, on the same
           // terms: after both strip passes and `assertNoStrictDrops()` (which
           // throw before any driver call), before the afterUpdate dispatch.
           //
           // Only the BY-ID branch has records to hydrate. A predicate write
           // resolves to the affected-row COUNT `driver.updateMany` returns
           // (#4639) — it names no row and returns none, so there is nothing to
           // materialize and `isPredicateWrite` says so explicitly rather than
           // letting a `typeof` sniff decide. Giving a bulk update a record
           // response is a contract change, not a hydration gap.
           if (!isPredicateWrite) {
             await hydrateWriteFormulas(
               updateSchema,
               Array.isArray(result) ? result : [result],
               opCtx.context,
               (plan, records) => this.resolveFormulaPermissions(object, plan, records, opCtx.context, permissionResolution),
               this.formulaFaultSink(object),
               (plan, records) => this.resolveFormulaRelated(updateSchema, plan, records, opCtx.context),
               (plan) => this.formulaOptionLabels(updateSchema, plan, opCtx.context),
             );
           }
           // Coerce boolean fields (SQLite 0/1 → JS bool) on the after-hook view
           // of both the new row and the prior row, so flow conditions comparing
           // `record.is_escalated`/`previous.status` against booleans behave.
           // Shallow copies — the value returned to the caller is untouched.
           hookContext.result = Array.isArray(result)
             ? result.map((r) => coerceBooleanFields(updateSchema as any, r as any))
             : coerceBooleanFields(updateSchema as any, result as any);
           if (priorRecord) hookContext.previous = coerceBooleanFields(updateSchema as any, priorRecord as any);
           if (bulkPerRowRows) {
             // [#5038] N record changes ⇒ N `afterUpdate` dispatches, each on a
             // single-record-shaped context (see `buildPerRowAfterContexts`).
             // The batch `hookContext` still carries the affected COUNT as
             // `result` and is what this call returns — the write's own contract
             // (a predicate update resolves a count, #4639) is unchanged; only
             // the hook dispatch became per row.
             //
             // Rows outer, hooks inner — the same order batch INSERT uses
             // (#2922) — so a handler observes one whole record at a time.
             // A per-row handler that throws propagates and fails the operation,
             // exactly as it does on the single-record and batch-insert paths;
             // `onError: 'log'` still swallows it per row. `onError` needed no
             // new per-row meaning: it governs a HANDLER on a record-scoped
             // context, and that is now what it always gets.
             for (const rowCtx of this.buildPerRowAfterContexts(
               object, 'afterUpdate', bulkPerRowRows, hookContext,
               hookContext.input.data as Record<string, unknown>,
             )) {
               await this.triggerHooks('afterUpdate', rowCtx);
             }
           } else {
             await this.triggerHooks('afterUpdate', hookContext);
           }

           // [#16231] The `update()` twin of `find()`'s #15823 refusal, now
           // that this verb declares the union its two dispatch paths answer:
           // a post-write record (or `null`), or the affected-row COUNT a
           // predicate write resolves. An `afterUpdate` handler may SHAPE what
           // it is handed; replacing it with a shape outside the declaration
           // is refused.
           //
           // ⛔ Ahead of `stripSearchCompanion` and the realtime publish for
           // the same reason `find()`'s guard precedes its consumers: both
           // read this value already assuming it is a record or a non-object
           // they may skip, so a replaced container would be diagnosed from
           // whichever of them tripped over it first. AFTER the per-row
           // `afterUpdate` fan-out (#5038), because the batch context is the
           // one this call returns and a per-row handler can reassign it.
           if (!isUpdateResultShape(hookContext.result)) {
             throw new UpdateHookResultNotWriteShapeError({
               object,
               event: 'afterUpdate',
               result: hookContext.result,
             });
           }

           // Roll-up: recompute parent summaries; pass priorRecord too so a child
           // that moved to a different parent updates BOTH old and new parent.
           // [#26950] A predicate write passes its matched rows, old and new.
           const summaryFailures = summaryRows
             ? await this.recomputeSummaries(object, summaryRows.next, summaryRows.previous, opCtx.context)
             : await this.recomputeSummaries(object, result, priorRecord, opCtx.context);

           // Publish the update event under whichever contract this write can
           // honour: per-record `data.record.updated` (#4626), or the aggregate
           // `data.records.updated` for a predicate write, whose driver call
           // returns an affected count and names no row (#4639).
           if (this.realtimeService) {
             if (isPredicateWrite) {
               await this.publishBulkDataEvent('updated', object, {
                 matched: result,
                 context: opCtx.context,
                 // [#15813] The wall's recorded verdict rides the SAME operation
                 // context the middleware wrote it on.
                 tenantLayer0Verdict: opCtx.tenantLayer0Verdict,
               });
             } else {
               const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
               await this.publishDataEvent('updated', object, {
                 recordId: hookContext.input.id ?? resultId,
                 changes: hookContext.input.data,
                 after: result,
                 // [#14970] The POST-state's organization, not the pre-image's:
                 // an update that moves a row between organizations must label
                 // the event with where the row is NOW.
                 organizationRow: result,
                 context: opCtx.context,
               });
             }
           }

           // [#7642] Same strip the create body gets, for the same reason: a
           // by-id update resolves to a RECORD, `updateData` returns it as
           // `record`, and the `beforeUpdate` companion stamp had just written
           // `__search` into the row it echoes. The issue measured four
           // surfaces and this is not one of them — it is the same column, the
           // same contract and the same response shape, and leaving it out
           // would mean POST and PATCH on one object disagreed about whether a
           // client-invisible column is visible. A predicate update resolves to
           // an affected-row COUNT (#4639), which the strip skips as a
           // non-object.
           stripSearchCompanion(hookContext.result);
           // [#7823] `internal` fields are deliberately NOT stripped here —
           // the write-response omit this line used to carry (#7728's fourth
           // measured surface: a client revoking a `sys_api_key` got the
           // stored hash back in the PATCH 200 body, `apiMethods:
           // ['get','list','update']`, #7727) RELOCATED to the
           // generic-data-path ingress under the 2026-08-13 A-prime ruling on
           // #7823. That surface is still closed — `updateData` in
           // `@objectstack/metadata-protocol` builds the PATCH 200 body and
           // passes it through `omitInternalFieldsFromWriteResponse`, pinned
           // by `api-key-hash-not-serialized.dogfood.test.ts` and the
           // ingress tripwire test — while the engine-level result keeps the
           // stored row whole for privileged server-side writers (the same
           // reason as the insert path: a strip HERE also fired on writes no
           // external caller ever sees). The generic READ path is unchanged:
           // {@link omitInternalFields} still runs on every find/findOne.
           // [#27495] The write is complete: release the handles its statement
           // moved the secret columns off, each only once storage confirms no
           // row of its column still names it. After the `afterUpdate` chain, so
           // a refusal that rolls the record back never reaches here, and before
           // the roll-up verdict below, which reports a write that did land.
           await this.releaseSecretHandles(object, retiredSecrets, opCtx.context, 'retired');
           // The record IS updated; a summary that could not recompute after
           // retries must surface, not stay silent (framework#3147).
           if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, hookContext.result);
           return hookContext.result;
       } catch (e) {
          // [#8682] The insert logger's twin, and measured to carry the same
          // exposure: an UPDATE statement inlines the caller's values in its
          // `set` clause exactly as an INSERT does in its `values` list. Same
          // redaction, same one argument — the message, the level and the
          // `object` are unchanged.
          //
          // [commit 9d7f7259f] …and, as on the insert door (#14095), the line still
          // carries what the DATABASE said now that the caller receives an
          // envelope: the platform logger serializes `message` and `stack`
          // only, so logging the envelope would silently drop the failing
          // column and the driver's own frames. The log takes the `cause`;
          // `e` is what is rethrown one line down. [#21274] It is cut where it
          // leaves the engine (`executeWithMiddleware`), after this line ran.
          //
          // [#17052] The insert door's twin here too: the level is `warn`,
          // because `throw e` on the next line IS the answer to the caller.
          const logged = e instanceof DuplicateRecordError || e instanceof NotNullRefusalError ? e.cause : e;
          this.logger.warn(
            'Update operation failed',
            writeFailureLogMeta(redactBoundStatement(logged), { object }),
          );
          // [#27495] The insert door's twin: a write that did not complete takes
          // back the credential row it wrote, unless a stored row names it.
          await this.releaseSecretHandles(object, writtenSecrets, opCtx.context, 'refused');
          throw e;
       }
     });

     return opCtx.result;
  }
}
