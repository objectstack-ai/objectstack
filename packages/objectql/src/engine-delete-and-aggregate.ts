// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Delete, count, aggregate and execute" section of
 * `ObjectQL`: the bodies of `delete`, `assertNoInternalFieldEvaluated`,
 * `aggregate` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link DeleteAndAggregateFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link DeleteAndAggregateHost}: exactly
 * the `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `deleteAndAggregateHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
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

import { normalizeFilterComparandTypes } from '@objectstack/spec/data';
import type { EngineAggregateOptions, EngineDeleteOptions, HookContext, QueryAST } from '@objectstack/spec/data';
import type { InternalFieldEvaluationOptions, InternalFieldEvaluationQuery } from '@objectstack/spec/contracts';
import { assertFilterIsMaterializable, assertListComparandShapes, collectComposableReadableIds, invalidFilterError } from './filter-comparand-shape.js';
import { assertHavingTemporalComparandsInterpretable, assertTemporalComparandsInterpretable } from './temporal-comparand-door.js';
import { assertTextOperatorTargetsAreStringCapable } from './text-operator-declared-type-door.js';
import { narrowHavingNumberComparands, narrowNumberComparands } from './number-comparand-declared-type-door.js';
import { deletedSecretColumns, deletedSecretSlots } from './engine-secret-internal-fields.js';
import type { SecretHandleSlot } from './engine-secret-internal-fields.js';
import { readPermanentDelete } from './recycle-bin/purge.js';
import type { RecycleBinDeleteObservability } from './recycle-bin/list.js';
import { mergeDriverOptionsIntoHookView } from './engine-driver-options.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { recordNotFoundError } from '@objectstack/core';
import { SummaryRecomputeError, cascadeStoppedRefusal } from './summary-errors.js';
import { withoutDeletedSelfParents } from './summary-aggregate.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { DeleteHookResultNotWriteShapeError, isDeleteResultShape } from './verb-hook-result-shape.js';
import { redactBoundStatement } from '@objectstack/types';
import { ORGANIZATION_OBJECT } from './tenancy/system-write-organization.js';
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { assertNoInternalFieldEvaluated, rejectInternalFieldEvaluation } from './internal-field-evaluation-guard.js';
import { assertGroupByNamesNoJsonStoredField } from './group-by-structured-json-door.js';
import { assertAggregationFieldTypesAccepted } from './aggregate-field-type-door.js';
import { ROLLUP_AGGREGATE_OPTION, assertRecordCurrencyAggregatesGrouped } from './record-currency-aggregate-door.js';
import {
    assertAggregatedColumnsAreDistinct,
    assertDateBucketTargetsAreTemporal,
    assertGroupByTargetsAreStored,
} from './aggregate-query-shape-door.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';
import { aggregatedRowColumnClasses, aggregatedRowColumnTypes, aggregatedRowColumns, applyHaving, assertAggregationFilterIsEvaluable, assertFilterNodeShapes, assertHavingIsEvaluable, assertHavingIsFilterCondition } from './having-filter.js';
import { coerceBooleanFields } from './validation/record-validator.js';
import { declaredColumnSet, rowsWithDeclaredColumnsOnly, withDeclaredColumnsOnly } from './declared-read-columns.js';
import { externalPredicateWriteRefusal, isExternalDriverFloor } from './external-driver-floor.js';
import { ENGINE_DELETE_REJECT_MESSAGE, resolveEngineDeleteDispatch } from './engine-delete-dispatch.js';
import type { EngineDeleteDispatchInput } from './engine-delete-dispatch.js';
import {
  ENGINE_AGGREGATE_OPTION_KEYS, ENGINE_DELETE_OPTION_KEYS, ENGINE_WHERE_SLOTS, declaredDatetimeLowering,
  describeNonFilterWhere, foldEngineOptionAliases, isWhereFilterObject, lowerWhereFilterArray, mergeReadContext,
  organizationPredicateDeleteRefusal, rejectUnknownEngineOptions, resolveThenLowerWhere, whereResolvedTokenJudge,
  writeFailureLogMeta,
} from './engine-top-level.js';
import type { EngineReadOptions, OperationContext } from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link DeleteAndAggregateFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface DeleteAndAggregateHost {
  readonly _registry: ObjectQLClass['_registry'];
  assertBulkPerRowHookBudget: ObjectQLClass['assertBulkPerRowHookBudget'];
  assertWriteAllowed: ObjectQLClass['assertWriteAllowed'];
  buildDriverOptions: ObjectQLClass['buildDriverOptions'];
  buildHookApi: ObjectQLClass['buildHookApi'];
  buildPerRowAfterContexts: ObjectQLClass['buildPerRowAfterContexts'];
  buildProvenance: ObjectQLClass['buildProvenance'];
  buildSession: ObjectQLClass['buildSession'];
  buildUser: ObjectQLClass['buildUser'];
  cascadeDeleteRelations: ObjectQLClass['cascadeDeleteRelations'];
  claimReferentialCascadeDelete: ObjectQLClass['claimReferentialCascadeDelete'];
  composeReadableIdsAtBoundary: ObjectQLClass['composeReadableIdsAtBoundary'];
  delete: ObjectQLClass['delete'];
  dispatchPerRowBeforeHooks: ObjectQLClass['dispatchPerRowBeforeHooks'];
  dispatchUnscopedMultiWriteHooks: ObjectQLClass['dispatchUnscopedMultiWriteHooks'];
  enforceTransactionOrigin: ObjectQLClass['enforceTransactionOrigin'];
  executeWithMiddleware: ObjectQLClass['executeWithMiddleware'];
  expandSearchOnOptions: ObjectQLClass['expandSearchOnOptions'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQLClass;
  getDriver: ObjectQLClass['getDriver'];
  getSummaryDescriptors: ObjectQLClass['getSummaryDescriptors'];
  hasHooksFor: ObjectQLClass['hasHooksFor'];
  inAfterAbortUnit: ObjectQLClass['inAfterAbortUnit'];
  invalidateOrganizationProbe: ObjectQLClass['invalidateOrganizationProbe'];
  readonly logger: ObjectQLClass['logger'];
  openRecycleBinCapture: ObjectQLClass['openRecycleBinCapture'];
  opensAfterAbortUnit: ObjectQLClass['opensAfterAbortUnit'];
  planCascadeAtomicity: ObjectQLClass['planCascadeAtomicity'];
  publishBulkDataEvent: ObjectQLClass['publishBulkDataEvent'];
  publishDataEvent: ObjectQLClass['publishDataEvent'];
  readonly realtimeService: ObjectQLClass['realtimeService'];
  recomputeSummaries: ObjectQLClass['recomputeSummaries'];
  rejectCredentialAggregation: ObjectQLClass['rejectCredentialAggregation'];
  readonly relatedSchemaOf: ObjectQLClass['relatedSchemaOf'];
  releaseSecretHandles: ObjectQLClass['releaseSecretHandles'];
  resolveObjectName: ObjectQLClass['resolveObjectName'];
  resolveWhereTokens: ObjectQLClass['resolveWhereTokens'];
  summaryForeignKeyColumns: ObjectQLClass['summaryForeignKeyColumns'];
  transaction: ObjectQLClass['transaction'];
  triggerHooks: ObjectQLClass['triggerHooks'];
  warnCascadeNotAtomic: ObjectQLClass['warnCascadeNotAtomic'];
  withResolvedWhere: ObjectQLClass['withResolvedWhere'];
}

/** The bodies of the "Delete, count, aggregate and execute" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class DeleteAndAggregateFacet {
  /** The body of `ObjectQL#delete`; the method's docblock there is its contract. */
  static async delete(this: Pick<DeleteAndAggregateHost, '_registry' | 'assertBulkPerRowHookBudget' | 'assertWriteAllowed' | 'buildDriverOptions' | 'buildHookApi' | 'buildPerRowAfterContexts' | 'buildProvenance' | 'buildSession' | 'buildUser' | 'cascadeDeleteRelations' | 'claimReferentialCascadeDelete' | 'delete' | 'dispatchPerRowBeforeHooks' | 'dispatchUnscopedMultiWriteHooks' | 'enforceTransactionOrigin' | 'executeWithMiddleware' | 'facade' | 'getDriver' | 'getSummaryDescriptors' | 'hasHooksFor' | 'inAfterAbortUnit' | 'invalidateOrganizationProbe' | 'logger' | 'openRecycleBinCapture' | 'opensAfterAbortUnit' | 'planCascadeAtomicity' | 'publishBulkDataEvent' | 'publishDataEvent' | 'realtimeService' | 'recomputeSummaries' | 'relatedSchemaOf' | 'releaseSecretHandles' | 'resolveObjectName' | 'summaryForeignKeyColumns' | 'transaction' | 'triggerHooks' | 'warnCascadeNotAtomic' | 'withResolvedWhere'>, object: string, options?: EngineDeleteOptions & RecycleBinDeleteObservability): Promise<boolean | number> {
    object = this.resolveObjectName(object);
    // [#22782] An aborting `afterDelete` rolls this write back — see `opensAfterAbortUnit`.
    if (this.opensAfterAbortUnit('afterDelete', object, options?.context)) {
      return this.inAfterAbortUnit(() => this.delete(object, options));
    }
    this.logger.debug('Delete operation starting', { object });
    this.assertWriteAllowed(object, 'delete');
    // [#8844] See the insert face — deleting the install's only organization
    // must not leave the memo answering with it.
    if (object === ORGANIZATION_OBJECT) this.invalidateOrganizationProbe();
    const driver = this.getDriver(object);
    // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
    // carve an append-only system ledger out of the transaction. Before any
    // hook, default or validation runs, so a refusal costs nothing.
    this.enforceTransactionOrigin(object, driver, 'delete');

    // Fold the `filter` alias into `where` first — same reasoning as update()
    // above (#4346): unfolded, a `multi: true` delete with `{ filter }` had no
    // predicate on its AST and emptied the table.
    options = foldEngineOptionAliases(object, 'delete', options, ENGINE_WHERE_SLOTS);
    rejectUnknownEngineOptions(object, 'delete', options, ENGINE_DELETE_OPTION_KEYS);
    // [#5158] Same ordering reason as update(): the dispatch decision below
    // reads `where.id`, which an unlowered array never carries.
    options = lowerWhereFilterArray(object, 'delete', options, this._registry.getObject(object), this.relatedSchemaOf);
    // [ADR-0100] Same credential-column refusal as update().
    rejectCredentialEvaluation(object, 'delete', options, options?.context, this.relatedSchemaOf);

    // Expand `{filter-placeholder}` values before the id is extracted — same
    // reasoning as update() above (#3810).
    // [ADR-0053 D-D1, amended — #5930] …and lowered in the same stage.
    options = await this.withResolvedWhere(object, 'delete', options, declaredDatetimeLowering(this._registry.getObject(object)));

    // Extract ID logic mirroring update(): only a SCALAR `where.id` means
    // "delete one row by primary key". An operator object ({ $in: [...] }, …)
    // is a multi-row predicate — treating it as an id would bind the object
    // literally (driver.delete(object, {$in:[…]})) and both skip the #2982 AST
    // seeding below AND bypass the by-id RLS pre-image check. Leave `id`
    // undefined so the call routes to deleteMany with the scoped AST.
    //
    // [#4550] The decision lives in `engine-delete-dispatch.ts` so the fake
    // engines that stand in for this method import it instead of re-deriving
    // it. #4434 shipped a dead REST route green because plugin-sharing's fake
    // accepted the one shape the `reject` branch below refuses; a double that
    // reads THIS predicate cannot be looser than this method.
    const dispatch = resolveEngineDeleteDispatch(options as EngineDeleteDispatchInput | undefined);
    const id: any = dispatch.kind === 'by-id' ? dispatch.id : undefined;
    // [#30237, ADR-0148, Q3 = A] A permanent delete writes no recycle-bin entry
    // and is authorized as `purge`, the recycle-bin manager's verb. Refused here,
    // before any middleware or hook, unless it is a by-id delete of an object
    // the bin takes (see `readPermanentDelete`).
    const permanent = readPermanentDelete(object, options, dispatch.kind);
    // [#23221] Is this the child delete a cascade issued? Decided here, once,
    // before any middleware or hook runs, so the claim is this call's alone.
    const referentialCascadeDelete = this.claimReferentialCascadeDelete(object, id);

    const opCtx: OperationContext = {
      object,
      operation: permanent ? 'purge' : 'delete',
      options,
      context: options?.context,
    };

    // [#2982] Same seam as update: a no-single-id delete routes to
    // `driver.deleteMany` with an AST that used to be rebuilt from
    // `options.where` after the middleware chain, discarding any row-scoping a
    // middleware composed onto `opCtx.ast`. Seed the caller's predicate before
    // the chain, keyed on the SAME falsy-`id` test the multi branch dispatches
    // on; the multi branch consumes the composed result.
    if (!id) {
      opCtx.ast = { object, ...(options?.where !== undefined ? { where: options.where } : {}) } as QueryAST;
    }

    await this.executeWithMiddleware(opCtx, async () => {
      // [ADR-0139 D1] As in `update`: a leaf the middleware chain wrote into a
      // delete's predicate is refused at the executor's entry, before the
      // pre-image reads reach the driver.
      collectComposableReadableIds(object, 'delete', opCtx.ast?.where, 'where');
      const hookContext: HookContext = {
          object,
          event: 'beforeDelete',
          input: { id, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          // [#23221] The declared cascade-delete marker, the delete twin of
          // `update()`'s `referentialFieldClear` spread: conditional for the
          // same reason, "absent unless true". Bound once on this context,
          // which `afterDelete` reuses, so both phases carry it.
          ...(referentialCascadeDelete ? { referentialCascadeDelete: true as const } : {}),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this.facade
      };

      // [#5272] The pre-image of the row this delete is about to remove.
      //
      // `HookContext.previous` is documented — in the spec, since it was
      // written — as "the state of the record BEFORE the operation (for
      // update/delete)", and `update()` has bound it all along. `delete()`
      // never did: `previous` was `undefined` in `beforeDelete` AND in
      // `afterDelete`, so a legal, contract-shaped delete-side transition
      // condition (`previous.status == "done"`) was unevaluable — and since
      // #4775 unevaluable REJECTS the operation. Worse, it was reported
      // through the generic branch, which reads as "you misspelled a key"
      // when the key was fine and the engine simply never bound it (#5037's
      // shape, one path over).
      //
      // #5038 made the asymmetry visible from the other side: a predicate
      // bulk delete already binds each doomed row's own pre-image on its
      // per-row `afterDelete`, so the SINGLE-record path was strictly worse
      // than the bulk one — the exact inversion #4800/#4862 ruled against.
      //
      // Demand-driven, like `update()`'s `priorRecord`: read only when
      // something on this object actually consumes it —
      //   * a delete-side hook, EITHER phase (its `condition` may read
      //     `previous`; its handler — plugin-audit, the record-change
      //     trigger — reads `ctx.previous` directly);
      //   * a roll-up summary aggregating this object, which needs the
      //     doomed row's FK value to find the parent to recompute.
      // Those two used to be separate reads at separate times (the summary
      // one fetched only after `beforeDelete` had run); they are ONE read
      // now — and a RAW driver read, which is exactly what `update()`
      // already hands `recomputeSummaries` as its `previous` argument, so
      // the two write paths now agree on what a pre-image is.
      //
      // `needsPriorRecord(schema)` is deliberately NOT part of this gate
      // even though `update()`'s twin carries it: object validation rules
      // are evaluated on insert/update only — `delete()` evaluates none —
      // so including it would buy a read with no reader.
      //
      // Read BEFORE `beforeDelete` fires. A delete's `before` phase is the
      // one that has nothing else to look at (its `input` carries an id and
      // no data), and the pre-image has to be taken before the row is gone
      // either way, so a single read serves both phases.
      //
      // [#5574] The same read now serves the PER-ROW `beforeDelete` dispatch on
      // the predicate path — see the pre-phase below. `delete()` was already
      // the right shape here; what changed is that the predicate branch grew
      // the same discipline the by-id branch has had since #5272.
      //
      // [#5929] The gate's THREE terms, unchanged by that card and enumerated
      // here because it had to enumerate them to answer it:
      //   1. `hasHooksFor('beforeDelete', object)`
      //   2. `hasHooksFor('afterDelete', object)`
      //   3. `getSummaryDescriptors(object).length > 0`
      // No validation term, deliberately — see `needsPriorRecord` above.
      //
      // What #5929 changed is not this expression but what term 1 MEANS. Until
      // then, objectql's own `ObjectQLPlugin` registered a builtin
      // `sys_fetch_previous_delete` on `beforeDelete` with `object: '*'`, so on
      // every kernel-hosted engine term 1 was true for every object and the
      // per-object skip this gate exists to perform could never happen. The
      // builtin's only remaining effect WAS holding this gate open: the read
      // below binds `previous` before `beforeDelete` dispatches, so its own
      // `!ctx.previous` guard was already unreachable. Retiring it (plugin.ts,
      // ADR-0049 enforce-or-remove) makes term 1 an honest question.
      //
      // ⚠️ Honest is not the same as usually-false, and the difference is worth
      // knowing before anyone reads a skip into a production trace. Every
      // delete-phase hook below registers with NO `object` — global — so each
      // holds term 1 or term 2 open for every object on a kernel that loads it:
      //
      //   * `plugin-auth`   identity-write-guard  beforeDelete  (filters by
      //                     `isManaged(ctx.object)` inside the handler)
      //   * `plugin-sharing` record-share-cascade  before+afterDelete (filters
      //                     by `targets(objectName)` inside the handler)
      //   * `service-storage` file-reference-lifecycle before+afterDelete
      //                     (filters by `activeFileFields(object)` inside)
      //   * `plugin-audit`  writeAudit  afterDelete only — #6656 retired
      //                     `captureBefore`, which was its `beforeDelete` half,
      //                     so it holds term 2 open and no longer term 1;
      //                     global MINUS `excludeObjects: AUDIT_EXCLUDED_OBJECTS`
      //                     (#5860) — the one that narrows at the ENGINE face,
      //                     so `hookMatchesObject` can subtract it and an
      //                     excluded object really does skip this read.
      //
      // The first three are real handlers with real work, merely deciding their
      // own applicability at dispatch time rather than at registration time;
      // this gate answering "yes" for them is the gate WORKING, not a second
      // instance of the #5929 defect. Narrowing any of them to the objects it
      // actually serves — plugin-audit's `excludeObjects` face is the worked
      // example — is what would convert them into skips, and that is each
      // package's own card, not this one's.
      // [#7867] ⚠️ RETIRED — the three-term `wantsPreImage` gate the paragraphs
      // above describe is GONE, and the paragraphs are kept because what they
      // record (which registrants hold which term open, and why an honest gate
      // is not the same as a usually-false one) is still the reason the removal
      // costs nothing measurable.
      //
      // It asked "does anything CONSUME the pre-image?" and skipped the read
      // when nothing did. Existence is a consumer it never counted — and it is
      // the one consumer EVERY by-id delete has, because a delete against an id
      // that names no row must answer 404 rather than run. So the by-id branch
      // below reads the pre-image unconditionally and gates on it; the
      // predicate branch reads its doomed rows under its own `perRowBefore/
      // AfterHooks` gate, which is untouched. On any kernel loading the global
      // registrants enumerated above, term 1 or 2 was already true for every
      // object, so this skipped nothing there anyway; the read becomes
      // genuinely new only for a bare embedder whose object has no delete-side
      // hook and no roll-up — and that embedder is buying a 404 it did not have.
      //
      // ⛔ Do not reintroduce it as a guard around the by-id read. A gate on
      // whether to LOOK is not compatible with a rule about what to do when
      // nothing is there. See `update()`'s twin.
      //
      // [#7933] The first three entries were carried here UNVERIFIED when
      // #7707 corrected the `plugin-audit` one, which was wrong on BOTH halves
      // — hook name and term. All three have since been read against the
      // function that binds them — `registerIdentityWriteGuard`,
      // `bindRecordShareCascade`, `installFileReferenceHooks` — and all three
      // match what is claimed above: same events, same object-less
      // registration, same in-handler filter. Nothing above needed changing.
      // That audit is what the retirement note's "term 1 or 2 was already true
      // for every object" stands on, so it is recorded here rather than left
      // in a closed issue: the enumeration outlived the gate it was written
      // for, and it is now load-bearing for a different claim than the one it
      // was written to support.
      const deleteSchema = this._registry.getObject(object);
      // `buildDriverOptions` is what carries the open transaction and the
      // tenant scope onto a raw driver read. Skipping it here would read
      // outside this write's transaction and across the tenant boundary —
      // `update()`'s prior read passes the same bag for the same reason.
      // [#21613] Both pre-image reads below are shaped to the declared field
      // set, as `update()`'s are: the pre-image is the delete's `previous`, and
      // the audit ledger records it whole as the delete's `old_value`, so a
      // column no metadata declares reached that served row with its value.
      const declaredDeleteColumns = declaredColumnSet(deleteSchema);
      const readPreImage = async (targetId: unknown): Promise<Record<string, unknown> | null> => {
        const preAst: QueryAST = { object, where: { id: targetId }, limit: 1 };
        const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
        return withDeclaredColumnsOnly(
          (await driver.findOne(object, preAst, preOpts)) as Record<string, unknown> | null,
          declaredDeleteColumns,
        );
      };
      const bindPreImage = (row: Record<string, unknown> | null): void => {
        // Never fabricate: a row that is not there leaves `previous` UNBOUND
        // rather than `{}`/`null`, so a condition reading it faults loudly
        // instead of answering for a record nobody read (#4649/#4775).
        hookContext.previous = row ? (coerceBooleanFields(deleteSchema as any, row as any) as any) : undefined;
      };
      let priorRecord: Record<string, unknown> | null = null;
      // [#5038] Matched rows for the per-row `afterDelete` dispatch — see the
      // twin in update(). A bulk delete is N record changes too, so a
      // `record-after-delete` flow must see each deleted row rather than one
      // context that names none of them.
      let bulkPerRowRows: Record<string, unknown>[] | null = null;
      // [#26950] The predicate path's matched rows as the per-row hook read
      // below took them (`null` when no delete-side hook asked for them), and
      // the rows whose foreign keys `recomputeSummaries` is handed after the
      // delete (`null` when no roll-up aggregates this object).
      let predicateMatchedRows: Record<string, unknown>[] | null = null;
      let summaryPriorRows: Record<string, unknown>[] | null = null;
      // [#27581] The `secret` columns this object declares, and the handles the
      // removed rows held in them: the by-id pre-image, or the predicate
      // path's matched rows, read before the statement takes them away.
      const secretColumns = deletedSecretColumns(deleteSchema);
      let deletedSecrets: SecretHandleSlot[] = [];

      // [#5574] The dispatch ladder, resolved BEFORE the before phase — see
      // update()'s twin for the full reasoning. Keyed on the SAME falsy-`id`
      // test the #2982 AST seed above uses.
      const isByIdDelete = Boolean(id);
      // [#11009] Keyed on the LADDER's verdict, not on `options?.multi` — the
      // update twin says why; for every pre-#11009 input the two spellings
      // agree.
      const isPredicatePath = !isByIdDelete && dispatch.kind === 'multi' && typeof driver.deleteMany === 'function';
      // [#24948] An organization is deleted by id or not at all: plugin-auth's
      // organization delete refuses one that still owns records and removes its
      // auth structure per organization, which a predicate delete would skip
      // (see `organizationPredicateDeleteRefusal`). Any delete not by id is
      // refused here, whatever the driver offers, before any hook or write.
      if (!isByIdDelete && object === ORGANIZATION_OBJECT) {
        throw organizationPredicateDeleteRefusal();
      }
      if (!isByIdDelete && !isPredicatePath) {
        // [#4550] The `reject` verdict of resolveEngineDeleteDispatch. It used
        // to be re-asked after the before phase because a hook could still bind
        // the id; with the ladder resolved first there is no such conversion.
        //
        // [#11009] The dispatch's OWN message — the unhonoured-predicate
        // refusal names the dropped `where` keys; the classic shape keeps
        // `ENGINE_DELETE_REJECT_MESSAGE`; the fallback arm is a `multi`
        // verdict against a driver with no `deleteMany`.
        if (dispatch.kind === 'reject') throw new Error(dispatch.message);
        // [#27277] See update()'s twin: a floored plugin driver offers no `deleteMany`.
        if (isExternalDriverFloor(driver)) throw externalPredicateWriteRefusal(driver.name, object, 'delete');
        throw new Error(ENGINE_DELETE_REJECT_MESSAGE);
      }

      // [#6966] See update()'s twin — same rule, same single binding point.
      hookContext.dispatch = {
        mode: isPredicatePath ? 'per-row' : 'record',
        index: 0,
        scope: {},
      };

      if (isByIdDelete) {
        // [#7867] Read first, then GATE — the twin of `update()`'s, and #5138's
        // own record names `delete` as the worst of the three when the gate was
        // missing: "the delete ran and the answer was `200 { deleted: true }`
        // for any string in the path, so a typo'd id, an already-deleted row
        // and a real deletion were indistinguishable" — the shape #4435 removed
        // from `protocol.deleteData` and #5138 removed from `callData`, still
        // live here on the path an action body's `.delete()` actually takes.
        //
        // The pre-image is the only honest place to ask. `IDataDriver.delete`
        // does declare `Promise<boolean>` ("true if deleted, false if not
        // found"), so the answer exists downstream — but downstream is AFTER
        // `beforeDelete` has dispatched and after `cascadeDeleteRelations` has
        // run, i.e. after handlers have fired and children have been touched
        // for a parent that was never there. `IDataEngine.delete` also declares
        // `Promise<any>` and passes its driver's result through the hook chain,
        // so testing it for `=== false` here would read a signal this layer's
        // contract does not promise — #5138's argument, unchanged.
        priorRecord = await readPreImage(id);
        if (!priorRecord) throw recordNotFoundError(object, id);
        // Bound unconditionally now that the row is proven present.
        // `bindPreImage`'s never-fabricate rule (#4649/#4775) is unchanged and
        // still the reason the binding goes through it rather than around it.
        bindPreImage(priorRecord);
        await this.triggerHooks('beforeDelete', hookContext);
        // [#6752] The retired lever, refused — the `update()` twin's check,
        // verbatim, because the rule is now ONE rule: a by-id target is
        // immutable in a `before*` handler.
        //
        // Both halves of it used to be answered separately here. CLEARING the
        // id was already refused (ADR-0058 Amendment II.1): it worked by
        // falling through to the predicate branch, and the ladder is now
        // resolved before any handler runs, so there is no ladder left to
        // re-enter. REBINDING to another id was still HONOURED, by re-reading
        // the new target's pre-image and rebinding `previous` (#5272) so
        // nothing stale reached `afterDelete` or the summary recompute.
        //
        // The 2026-08-09 ruling on #6752 retires that second half. #5272's
        // mechanism was internally correct — that is not what was weighed. What
        // was weighed: the measured compatibility cost is zero (no consumer in
        // the repository repoints), one rule across both verbs beats two
        // individually-correct rules an author has to memorize, and a hook that
        // silently redirects WHICH ROW GETS DELETED is a top-grade footgun for
        // authored — especially AI-authored — handlers. Correctness of the
        // mechanism does not justify the surface.
        //
        // ⛔ Route 3 (growing the same re-resolution for `update()`) stays
        // excluded by #5574's ruling: "do not silently pick re-resolution
        // instead". The alignment goes the other way, and this is that edit.
        //
        // The re-read that used to sit here is GONE, not merely bypassed: its
        // guard was `input.id !== id && input.id`, which is exactly the case
        // this refusal now throws on, so it became unreachable. `readPreImage`
        // survives for the pre-dispatch read above — the only read left. A
        // handler writing back the SAME id is untouched, as on `update()`.
        if (hookContext.input.id !== id) {
          throw new HookTargetRebindError({
            object, event: 'beforeDelete', path: 'by-id',
            expectedId: id, observedId: hookContext.input.id,
          });
        }
      } else {
        // [#2982] Consume the middleware-composed AST seeded above so the
        // injected row-scoping binds every read AND the delete. Fail CLOSED if
        // it is absent rather than rebuilding an unscoped `{ object, where }`
        // (AGENTS.md PD #12).
        const ast = opCtx.ast;
        if (!ast) {
          throw new Error(
            `[Security] Refusing bulk delete on '${object}': row-scoping AST was not seeded ` +
              `(the predicate branch was reached without the AST seeded before the middleware ` +
              `chain — the one RLS and sharing compose their row-scoping onto, so that a bulk ` +
              `write reaches only the rows this caller may edit).`,
          );
        }
        // [#9719] The unscoped-multi shape check, BEFORE the matched-row read:
        // a `multi: true` delete carrying no caller predicate at all dispatches
        // ONCE, whole-operation-shaped, to the registrations that declared for
        // it — so a shape-of-the-operation refusal (#4757) fires regardless of
        // what the predicate would match, zero rows included. Read from the
        // caller's RAW options — the same slot the handler contract reads
        // (`input.options.where`, hook.zod.ts's upper-bound rule) — never from
        // the AST, which middleware may have narrowed and only ever narrows.
        // `where: {}` is a REAL (match-all) query and stays on the per-row
        // authorize path; only an absent or `null` predicate is unscoped.
        // `update()`'s predicate branch carries the identical check (#9974).
        const rawWhere = (hookContext.input.options as { where?: unknown } | undefined)?.where;
        if (rawWhere === undefined || rawWhere === null) {
          await this.dispatchUnscopedMultiWriteHooks('beforeDelete', object, hookContext);
        }
        // [#5038/#5574] Read the doomed rows ONCE, before they are gone — the
        // only moment their pre-image exists — and serve BOTH phases from it
        // (D7). Gated on this object actually having delete-side hooks, so a
        // bulk delete with none pays for no read.
        const perRowBeforeHooks = this.hasHooksFor('beforeDelete', object);
        const perRowAfterHooks = this.hasHooksFor('afterDelete', object);
        if (perRowBeforeHooks || perRowAfterHooks) {
          const preOpts = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
          // [#21613] Each doomed row is its per-row `previous`: declared set.
          const doomed = rowsWithDeclaredColumnsOnly(
            (await driver.find(object, ast, preOpts) as Record<string, unknown>[]) ?? [],
            declaredDeleteColumns,
          );
          predicateMatchedRows = doomed;
          // [D6] One ceiling, both phases, BEFORE the first per-row dispatch
          // and before the driver call.
          this.assertBulkPerRowHookBudget(
            object, perRowBeforeHooks ? 'beforeDelete' : 'afterDelete', doomed.length,
          );
          if (perRowAfterHooks) bulkPerRowRows = doomed;
          // [D1] Zero matched rows is zero dispatches.
          if (perRowBeforeHooks && doomed.length > 0) {
            await this.dispatchPerRowBeforeHooks(object, 'beforeDelete', doomed, hookContext);
          }
        }
      }

      // Every driver call below is handed `driverOptions` — the declared driver
      // options and nothing else; `input.options` is the hooks' additive view.
      const driverOptions = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);

      try {
          let result;
          // [#4639] See update()'s twin: recorded at the branch that chose the
          // driver call, not inferred later from a missing id.
          let isPredicateWrite = false;
          if (isByIdDelete) {
              // Honor referential delete behavior (cascade/set_null/restrict)
              // for relations pointing at this record before removing it.
              //
              // [#7413] ONE UNIT OF WORK — the cascade and the parent's own row
              // removal, or neither. These two statements used to run bare, and
              // the cascade re-enters `this.delete()`/`this.update()` per
              // dependent, each committing as it executed; a refusal partway
              // (the `restrict` branch, a child's permission check, a later
              // child's `beforeDelete` hook) stranded an arbitrary prefix of the
              // children deleted while the caller got 409/403 and read it as
              // "nothing happened". #4620's changeset already ruled the shape
              // for the batch path: atomic honoured for real, or refused — a
              // partial delete has no natural undo.
              //
              // The recursion COMPOSES rather than deadlocking because
              // `transaction()` publishes its handle into the ambient `txStore`
              // and joins an already-open one (ADR-0067 D2 / #5696): the child
              // `delete()` calls below receive `trxContext` explicitly AND see
              // the ambient entry, so a grandchild's own wrap JOINS with
              // `owned: false` instead of opening a second driver transaction on
              // a second connection.
              //
              // The driver options are rebuilt INSIDE the callback on purpose:
              // the ones computed above were built before any transaction
              // existed, so they carry no handle and the parent's own
              // `driver.delete` would execute outside the very transaction
              // wrapping its cascade. `buildDriverOptions` only fills keys that
              // are still `undefined`, so re-running it adds the handle and
              // changes nothing else.
              //
              // A dependent's stale-roll-up refusal stops the walk before this
              // row is removed, so it is not this delete's answer:
              // `cascadeStoppedRefusal` says what it is instead.
              //
              // [#30237, ADR-0148 D1] The recycle bin rides the same unit: the
              // capture opens before the cascade (a retention defect refuses
              // here, before any write), reads the collected set before the
              // walk touches it, and writes the one entry after the walk and
              // before this row goes. A removal that throws takes the entry
              // with it: the transaction's rollback when one covers the bin,
              // the capture's compensation otherwise. [#31630] A removal the
              // driver answers as removing nothing withdraws the entry inside
              // the same unit, so no entry stays for a row that is still live
              // (`capture.ts` says why it is not written after instead).
              // A caller's `multi: true` opens none, even here: the lifecycle
              // sweep reaps by id with it. Nor does a permanent delete, which
              // is the point of it.
              //
              // [#30237] The entry's id is told to the caller
              // (`options.onRecycleBinEntry`) only once the unit has landed:
              // after the transaction commits, never from inside it.
              let binEntryId: string | undefined;
              const runByIdDelete = async (writeContext?: ExecutionContext) => {
                const bin = this.openRecycleBinCapture(object, hookContext.input.id as string | number, writeContext, options?.multi === true || permanent);
                await this.cascadeDeleteRelations(object, [hookContext.input.id as string | number], writeContext, 0, bin?.onCollected)
                  .catch((e: unknown) => { throw cascadeStoppedRefusal(e, object); });
                const entry = await bin?.write();
                try {
                  const removed = await driver.delete(
                    object,
                    hookContext.input.id as string,
                    this.buildDriverOptions(object, writeContext, hookContext.input.options as any),
                  );
                  // Told only for a row the driver says it removed: `false`
                  // (not found) and an off-contract count of 0 (kept) name no
                  // deletion an undo could reverse, and their entry is
                  // withdrawn.
                  if (removed !== false && (removed as unknown) !== 0) binEntryId = entry?.id;
                  else await entry?.withdraw();
                  return removed;
                } catch (e) {
                  await entry?.compensate();
                  throw e;
                }
              };
              // WHEN to open one is `planCascadeAtomicity`'s call — see there.
              // `'none'` (nothing references this object) keeps the pre-#7413
              // path exactly, so a plain non-cascade delete opens no
              // transaction and emits no degrade warning; `'split'` keeps it
              // too, because a transaction on the default driver cannot cover a
              // cross-datasource cascade and would refuse it outright.
              const plan = this.planCascadeAtomicity(object);
              if (plan === 'atomic') {
                  // No `require: true` — see the changeset. `delete()` never
                  // asked for atomicity, so it must not start REFUSING on a
                  // runtime that cannot roll back; `transaction()`'s declared
                  // degrade (ADR-0119 D1) already warns once per driver (#4619).
                  result = await this.transaction(
                    async (trxCtx: any) => await runByIdDelete(trxCtx as ExecutionContext),
                    opCtx.context,
                  );
              } else {
                  if (plan === 'split') this.warnCascadeNotAtomic(object);
                  result = await runByIdDelete(opCtx.context);
              }
              if (binEntryId !== undefined && typeof options?.onRecycleBinEntry === 'function') {
                  options.onRecycleBinEntry(binEntryId);
              }
              // [#27581] The handles the removed row held, off its pre-image.
              deletedSecrets = deletedSecretSlots(deleteSchema, [priorRecord]);
          } else {
               // [#2982] The AST asserted present and already used for the
               // pre-phase row read above.
               // `deleteMany` presence is part of the ladder verdict resolved above.
               //
               // [#26871] A predicate delete honours `deleteBehavior` as the
               // by-id branch does: a `restrict` refuses, a `cascade` (a
               // `master_detail` by default) deletes the dependents, a
               // `set_null` clears them. This arm used to go straight to
               // `deleteMany`, so a flow's `delete_record` with `multi: true`
               // skipped every declared rule the same delete done record by
               // record honours.
               //
               // `planCascadeAtomicity` is the by-id branch's own question:
               // `'none'` means no relation of the delete family points at
               // this object, so the walk could write nothing and the arm keeps
               // its single `deleteMany`, no rows read and no transaction.
               //
               // [#26950] A roll-up over this object needs the matched rows'
               // foreign keys, read BEFORE the delete, to find the parents to
               // recompute after it: the by-id branch hands `recomputeSummaries`
               // its pre-image, and this arm hands it the matched rows. Only the
               // descriptors' FK columns are read, through the composed AST and
               // the write's driver options, and only once: the walk's own id
               // read carries them below, and with no walk the per-row hook
               // read serves when it was made. An object no roll-up aggregates
               // reads nothing new.
               const summaryKeyColumns = this.summaryForeignKeyColumns(object);
               const plan = this.planCascadeAtomicity(object);
               if (plan === 'none') {
                 if (summaryKeyColumns.length > 0) {
                   summaryPriorRows = predicateMatchedRows
                     ?? (((await driver.find(object, { ...opCtx.ast!, fields: summaryKeyColumns }, driverOptions)) ?? []) as Record<string, unknown>[]);
                 }
                 // [#27581] The handles the matched rows hold, read BEFORE the
                 // statement removes them: the per-row hook read when it was
                 // made, otherwise only `id` and the secret columns, through
                 // this write's AST and options. No secret column, no read.
                 if (secretColumns.length > 0) {
                   deletedSecrets = deletedSecretSlots(deleteSchema, predicateMatchedRows
                     ?? (((await driver.find(object, { ...opCtx.ast!, fields: ['id', ...secretColumns] }, driverOptions)) ?? []) as Record<string, unknown>[]));
                 }
                 result = await driver.deleteMany!(object, opCtx.ast!, driverOptions);
               } else {
                 // Otherwise: resolve the matched rows through the composed,
                 // row-scoped AST, run `cascadeDeleteRelations` once over them
                 // as one root set (#27004), then delete exactly those rows by
                 // id. By id, not by re-running the
                 // predicate: the walk's own writes (a `set_null` on a
                 // self-reference) can move a row into or out of the predicate,
                 // and the rows deleted must be the rows walked. The ids were
                 // read under this caller's scope inside the same unit of work,
                 // as the by-id branch deletes its id after reading its
                 // pre-image under that scope. The unit of work is the by-id
                 // branch's, for the same reasons (#7413).
                 const runPredicateDelete = async (writeContext?: ExecutionContext): Promise<unknown> => {
                   const writeOptions = this.buildDriverOptions(object, writeContext, hookContext.input.options as any);
                   // [#27581] The same read carries the secret columns, so the
                   // handles released are those of the rows deleted.
                   const matched = ((await driver.find(object, { ...opCtx.ast!, fields: ['id', ...summaryKeyColumns, ...secretColumns] }, writeOptions)) ?? []) as Array<Record<string, unknown>>;
                   const matchedIds = matched.map((row) => row?.id).filter((v): v is string | number => v != null);
                   if (summaryKeyColumns.length > 0) summaryPriorRows = withoutDeletedSelfParents(object, matched, matchedIds, this.getSummaryDescriptors(object));
                   deletedSecrets = deletedSecretSlots(deleteSchema, matched);
                   // [#27004] One walk, rooted at the whole matched set. A
                   // dependent's stale-roll-up refusal is not this delete's
                   // answer, as in the by-id branch.
                   await this.cascadeDeleteRelations(object, matchedIds, writeContext)
                     .catch((e: unknown) => { throw cascadeStoppedRefusal(e, object); });
                   // The id set rides an `$in`; batched so one statement never
                   // outgrows a driver's bind-parameter limit.
                   const batchSize = ObjectQL.REFERENCE_PROBE_BATCH;
                   let removed = 0;
                   for (let i = 0; i < matchedIds.length; i += batchSize) {
                     const batchAst: QueryAST = { object, where: { id: { $in: matchedIds.slice(i, i + batchSize) } } };
                     const count = await driver.deleteMany!(object, batchAst, writeOptions);
                     // A non-count answer goes back as the driver gave it, so
                     // the `isDeleteResultShape` check below refuses it.
                     if (typeof count !== 'number') return count;
                     removed += count;
                   }
                   return removed;
                 };
                 if (plan === 'atomic') {
                   result = await this.transaction(
                     async (trxCtx: any) => await runPredicateDelete(trxCtx as ExecutionContext),
                     opCtx.context,
                   );
                 } else {
                   this.warnCascadeNotAtomic(object);
                   result = await runPredicateDelete(opCtx.context);
                 }
               }
               isPredicateWrite = true;
          }

          hookContext.event = 'afterDelete';
          hookContext.result = result;
          if (bulkPerRowRows) {
            // [#5038] One dispatch per deleted row. No payload is passed, so
            // each context carries `previous` = the deleted row and no
            // `result`: after a delete there IS no post-state, and every
            // consumer (hook `condition`, the record-change trigger, the audit
            // diff) already falls back to the pre-image for `record` on a
            // delete-shaped context.
            for (const rowCtx of this.buildPerRowAfterContexts(
              object, 'afterDelete', bulkPerRowRows, hookContext,
            )) {
              await this.triggerHooks('afterDelete', rowCtx);
            }
          } else {
            await this.triggerHooks('afterDelete', hookContext);
          }

          // [#16231] The `delete()` twin, on its own declaration: whether the
          // by-id row was there (`boolean`), or how many rows a predicate
          // delete removed (`number`). ⚠️ `false` and `0` are the two most
          // ordinary answers this verb gives, so `isDeleteResultShape` is a
          // pair of `typeof` tests and never a truthiness check — a lenient
          // guard here would refuse exactly the answers
          // `metadata-protocol`'s `deleteData` turns into its 404.
          if (!isDeleteResultShape(hookContext.result)) {
            throw new DeleteHookResultNotWriteShapeError({
              object,
              event: 'afterDelete',
              result: hookContext.result,
            });
          }

          // [#27581] The delete is complete: release the handles the removed
          // rows held, through the release a committed update uses, so each one
          // goes only once storage confirms no row of its column still names it,
          // inside this write's unit. After the `afterDelete` chain, so a hook
          // can still dereference the value and a refusal that rolls the delete
          // back never reaches here.
          await this.releaseSecretHandles(object, deletedSecrets, opCtx.context, 'retired');

          // Roll-up: recompute the parent summary now that the child is gone,
          // from the row's FK values captured BEFORE deletion. [#5272] That
          // capture is now the same single pre-image read `previous` rides on
          // (it used to be its own later `findOne`), which is also what
          // `update()` passes here. [#26950] A predicate delete passes the
          // matched rows it read before the delete.
          const summaryPrevious = priorRecord ?? summaryPriorRows;
          const summaryFailures = summaryPrevious
            ? await this.recomputeSummaries(object, null, summaryPrevious, opCtx.context)
            : [];

          // Same split as update(): per-record `data.record.deleted` (#4626),
          // or the aggregate `data.records.deleted` when the delete was by
          // predicate (#4639).
          if (this.realtimeService) {
            if (isPredicateWrite) {
              await this.publishBulkDataEvent('deleted', object, {
                matched: result,
                context: opCtx.context,
                // [#15813] Same seam as the update branch.
                tenantLayer0Verdict: opCtx.tenantLayer0Verdict,
              });
            } else {
              const resultId = (typeof result === 'object' && result && 'id' in result) ? (result as any).id : undefined;
              await this.publishDataEvent('deleted', object, {
                recordId: hookContext.input.id ?? resultId,
                // [#14970] The pre-image — a delete has no post-state, and
                // this branch is the by-id one, where `priorRecord` was read
                // unconditionally by #7867's existence gate and proven
                // non-null before `beforeDelete` ever fired. So the row is
                // already in hand and NO new read is bought here.
                organizationRow: priorRecord,
                context: opCtx.context,
              });
            }
          }

          // The record IS deleted; a summary that could not recompute after
          // retries must surface, not stay silent (framework#3147).
          if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, hookContext.result);
          return hookContext.result;
      } catch (e) {
          // [#7307] `Error.message` is now the END USER's localized sentence for
          // a `DELETE_RESTRICTED`, and the logger serializes only `message` +
          // `stack` — so without this the operator-facing half (API names, the
          // `deleteBehavior:'cascade'` remedy) would reach no channel at all,
          // and the server log of a zh-CN deployment would read in Chinese. An
          // error that carries no `developerMessage` logs exactly as before.
          // [#8682] Same redaction as the insert/update loggers. A DELETE's
          // statement carries the caller's values in its `where` clause — which
          // is how a record is addressed, so it is the same class of payload.
          // `developerMessage` is read off the ORIGINAL error: it is written by
          // our own throw sites (#7307), never by a driver, so it carries no
          // statement and the redaction has no opinion about it.
          // [#17052] The third write door, moved with its two siblings: this
          // catch also ends in `throw e`, so the caller is told and the entry
          // is not a degradation report. `developerMessage` keeps its place in
          // the meta and the redaction is unchanged.
          const devDetail = (e as any)?.developerMessage;
          this.logger.warn(
            'Delete operation failed',
            writeFailureLogMeta(redactBoundStatement(e), {
              object,
              ...(typeof devDetail === 'string' && devDetail.length > 0 ? { developerMessage: devDetail } : {}),
            }),
          );
          throw e;
      }
    });

    return opCtx.result;
  }

  /** The body of `ObjectQL#assertNoInternalFieldEvaluated`; the method's docblock there is its contract. */
  static assertNoInternalFieldEvaluated(this: Pick<DeleteAndAggregateHost, 'relatedSchemaOf'>, object: string, query: InternalFieldEvaluationQuery, options?: InternalFieldEvaluationOptions): void {
    assertNoInternalFieldEvaluated(object, query, this.relatedSchemaOf, options);
  }

  /** The body of `ObjectQL#aggregate`; the method's docblock there is its contract. */
  static async aggregate(this: Pick<DeleteAndAggregateHost, '_registry' | 'buildDriverOptions' | 'composeReadableIdsAtBoundary' | 'executeWithMiddleware' | 'expandSearchOnOptions' | 'getDriver' | 'logger' | 'rejectCredentialAggregation' | 'relatedSchemaOf' | 'resolveObjectName' | 'resolveWhereTokens'>, object: string, query: EngineAggregateOptions, options?: EngineReadOptions): Promise<any[]> {
      object = this.resolveObjectName(object);
      // Fold the `filter` alias into `where` (#4346) — the AST below reads
      // `query.where` only, so an unfolded `{ filter }` aggregated every row.
      query = foldEngineOptionAliases(object, 'aggregate', query, ENGINE_WHERE_SLOTS);
      rejectUnknownEngineOptions(object, 'aggregate', query, ENGINE_AGGREGATE_OPTION_KEYS);
      query = lowerWhereFilterArray(object, 'aggregate', query, this._registry.getObject(object), this.relatedSchemaOf);
      // [ADR-0100] The filter half of the credential-column guard — `where`
      // and every `aggregations[i].filter` — before the search term joins
      // `where`; the aggregate half (`rejectCredentialAggregation`) follows.
      // [internal: true] The flagged-column refusal goes first, over every
      // position at once (`where`, `groupBy`, each aggregation's `field` and
      // `filter`), so a non-system caller meets the data door's words here
      // too rather than the aggregate guard's.
      rejectInternalFieldEvaluation(object, query, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
      rejectCredentialEvaluation(object, 'aggregate', query, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
      // ADR-0061 `search` → the rows are searched BEFORE they are grouped, by
      // the one expander `find` runs, at the same point in the sequence (after
      // the `where` doors above, before the AST is built and tokens resolve).
      query = await this.expandSearchOnOptions(object, query, options);
      this.rejectCredentialAggregation(object, query);
      // [#20783] …and a `groupBy` entry naming a structured-JSON field (`json`,
      // `composite`, `address`, …) is refused `INVALID_FIELD` / 400 here, before
      // any driver is asked: the drivers share no meaning for a JSON document as
      // a group key (memory merged every row into one group, SQLite grouped each
      // serialized document apart, PostgreSQL answered 500). After the
      // credential refusal, which reads the same entries, so a protected field
      // keeps that refusal's words. [#20808] The same door refuses a `groupBy`
      // entry naming a MULTI-VALUE field (`isMultiValueField`: a list stored in
      // a JSON column, split the same three ways), judged in one walk so the
      // first offending position is the one named.
      assertGroupByNamesNoJsonStoredField(object, this._registry.getObject(object), query.groupBy);
      // [#20808] …and every aggregation's (function, declared field type)
      // pair, asked of the spec table (`isAggregateCompatibleWithFieldType`)
      // beside `isMultiValueField`, before any driver is asked. [#20808] took
      // the `count_distinct` row (memory counted equal documents apart, SQLite
      // compared serialized text, PostgreSQL answered 500); [#20914] took the
      // other rows — `max` over a `json` field answered a document in memory, a
      // string on SQLite and a 500 on PostgreSQL; `sum` over one answered `0`,
      // `0` and a 500. Every row of the table is asked (see the door's header).
      assertAggregationFieldTypesAccepted(object, this._registry.getObject(object), query.aggregations);
      // [ADR-0144 D6] …and a `sum` / `avg` / `min` / `max` over a `record`-mode
      // amount that does not group by its code field: the rows hold amounts in
      // different currencies, which add into one number under one label.
      // After the type door, so a type it refuses keeps that door's words.
      // [ADR-0144 D6, amended] A roll-up's own recompute names the
      // master_detail it totals one parent's rows through, on a module-private
      // symbol no door can set: an amount following that parent is one currency.
      assertRecordCurrencyAggregatesGrouped(
        object, this._registry.getObject(object), query.groupBy, query.aggregations,
        (options as Record<symbol, unknown> | undefined)?.[ROLLUP_AGGREGATE_OPTION],
      );
      // [#25818] …and the two shapes that answered a plausible wrong table: a
      // `dateGranularity` over a field declared neither a date nor a datetime
      // (every row in one null bucket), and two columns of the aggregated row
      // under one name (the last value written won). After the two doors
      // above, so a JSON field under a date bucket keeps their words.
      // [#29167, #29304] A group entry of any form over a VIRTUAL (`formula`)
      // field first: no driver stores a column for it (a SQL driver refused
      // it as a missing column, the in-memory aggregation served one null
      // group), and the date-bucket door has no class to judge it by.
      assertGroupByTargetsAreStored(object, this._registry.getObject(object), query.groupBy);
      assertDateBucketTargetsAreTemporal(object, this._registry.getObject(object), query.groupBy);
      assertAggregatedColumnsAreDistinct(object, query.groupBy, query.aggregations);
      // [#10576] The per-aggregation `filter` (`AggregationNodeSchema.filter`,
      // the contract half of #10413) is a second filter position on this verb,
      // so it walks through the same refusal doors `where` does at this seam:
      // the comparand-shape gate (#5869 — a scalar `$in` etc. is refused, not
      // silently matched against nothing) and the materializable-field gate
      // (#8296 — a typo'd column would otherwise select ZERO rows for that one
      // aggregation, silently, which is the same wrong-number shape #10413
      // measured). The path names which aggregation carries the offending key.
      {
          const aggregations = Array.isArray(query.aggregations) ? query.aggregations : [];
          let typedAggregations: typeof aggregations | undefined;
          for (const [i, agg] of aggregations.entries()) {
              const aggFilter = (agg as { filter?: unknown })?.filter;
              if (aggFilter == null) continue;
              // [#20122] The SHAPE gate `where` takes first on its own seam
              // (`lowerWhereFilterArray`, #20121) — first here too, with its
              // object test (`isWhereFilterObject`) and its words, minus the
              // array half (below). A filter that is not a filter object
              // (a string, a number, a boolean, `''`, a `Map`, a `Date`) was
              // stepped around by every door below, each of which walks a filter
              // node's keys, and then dropped: the fork below reads it as "no
              // filter", so the aggregation read every row of its group
              // (`driver-sql`'s native aggregate answered a non-empty string
              // with a 501 instead). The wire door already refuses these shapes
              // through `AggregationNodeSchema`; this closes the in-process one.
              //
              // An ARRAY is refused too, `[]` included — unlike `where`, which
              // lowers the condition-array sugar in its array branch. The slot
              // is declared `FilterConditionSchema` (an object, no array form),
              // the wire door refuses every array here (`VALIDATION_FAILED`),
              // and in-process a condition array counted no row (the walker
              // read its index positions as column names) while `[]` read as
              // no filter. Same ruling as `having`'s condition check (#20099).
              if (Array.isArray(aggFilter)) {
                  let shown: string;
                  try {
                      shown = JSON.stringify(aggFilter) ?? String(aggFilter);
                  } catch {
                      shown = String(aggFilter);
                  }
                  if (shown.length > 80) shown = `${shown.slice(0, 77)}...`;
                  throw invalidFilterError(
                      `aggregate('${object}'): 'aggregations[${i}].filter' must be a filter object, received ` +
                      `an array (${shown}). The condition-array form — [field, operator, value] tuples and ` +
                      `["and", …] groups — is input-only sugar lowered on 'where' alone; a per-aggregation ` +
                      `filter is declared as a filter condition object and does not take it, so an array here ` +
                      `was never applied as the filter it spells. Write the object form, ` +
                      `{ "FIELD": { "$gt": 100 } }, or omit 'filter' for no filter.`,
                  );
              }
              if (!isWhereFilterObject(aggFilter)) {
                  throw invalidFilterError(
                      `aggregate('${object}'): 'aggregations[${i}].filter' must be a filter object, ` +
                      `received ${describeNonFilterWhere(aggFilter)}. It was not applied, and an ` +
                      `unapplied filter would have aggregated every row of each group for that aggregation.`,
                  );
              }
              // …and the drivers' shape gate on `where`, one level down: a
              // `$and` / `$or` operand that is not a list, and an element of
              // one or a `$not` operand that is not a filter node (a condition
              // array, `null`, a string), refused in `where`'s words at
              // `aggregations[i].filter.$and[0]`. The walker read a condition
              // array's index positions as columns (no row counted) and a
              // `null` / string element as no constraint (every row counted).
              // First among the doors below, which step around a non-node.
              assertFilterNodeShapes(aggFilter, `aggregations[${i}].filter`);
              assertListComparandShapes(object, 'aggregate', aggFilter, `aggregations[${i}].filter`);
              assertFilterIsMaterializable(object, 'aggregate', this._registry.getObject(object), aggFilter);
              // [#15661] …and the declared-type door for the text operators: a
              // `$contains` over a numeric column in ONE aggregation's filter is
              // the same silent zero at a second filter position, and a door that
              // spoke on `where` alone would answer one mistake two ways within a
              // single verb. [#20334] Rooted at this position, as the shape door
              // above is: the refusal said `at where.amount.$contains`, a `where`
              // the author did not write.
              assertTextOperatorTargetsAreStringCapable(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20148] …and the TEMPORAL-comparand door, fourth here as it is
              // fourth on `where`'s seam (#8690) — the same function, against the
              // object's declared fields, since this filter reads the object's
              // raw rows. A comparand a declared date / datetime / time field
              // cannot interpret (`'not-a-date'`, the preset name
              // `'last_30_days'`) was compared as written: no row counted, a
              // `$between` with one such endpoint counted EVERY row, and the same
              // bound in a `where` was refused 400 — measured on the base on
              // driver-memory and driver-sql, through the engine and REST.
              // Before the token resolver below, as there, so a `{placeholder}`
              // is stepped around and resolved (or refused) a moment later.
              // [#20334] Rooted at this position too: the refusal said
              // `at where.placed_on.$gt`.
              assertTemporalComparandsInterpretable(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20351] …and the NUMBER-comparand door, fifth here as it is
              // fifth on `where`'s seam: a non-numeric string against a declared
              // numeric field counted no row (every row under `$ne`) where its
              // `where` twin was a 500 on PostgreSQL, and a numeric string is
              // narrowed to its number, copy-on-write, before the in-memory
              // evaluator compares it. Rooted at this position. [#20546] Its
              // walk's no-operator-object arm too: `{ amount: { a: 1 } }` here
              // counted no row, silently, on every driver. [#20745] So did
              // `{ owner: { region: 'NA' } }` beneath a lookup; a JSON object
              // here is refused alike, one answer per filter at every position.
              // [#21333] …and its boolean arm: `"true"` against a declared
              // boolean field counted no row (every row under `$ne`) on both
              // drivers; it is narrowed to `true` here, `"yes"` refused.
              const numeric = narrowNumberComparands(
                  object, 'aggregate', this._registry.getObject(object), aggFilter, `aggregations[${i}].filter`,
              );
              // [#20122] …and the two doors `having` took at its own entry
              // (#20099), so a refusal here is the FILTER's, never the data's:
              //  1. the comparand-TYPE door `where` takes in
              //     `lowerWhereFilterArray`, rooted at this position — a plain
              //     object, a `Map` or a function comparand was compared as it
              //     stood and counted no row (every row under `$ne`), and a
              //     `Symbol` under an ordering operator threw an uncoded
              //     `TypeError`, on a populated table only. An exact-range
              //     bigint is narrowed copy-on-write, as it is there;
              //  2. the walker's own refusals, judged once
              //     (`assertAggregationFilterIsEvaluable`). The fallback below
              //     walks the filter per SOURCE row, so `{ amount: { $median: 1 } }`
              //     was a 400 on a populated table and a `200 []` on an empty one,
              //     and a `$or` whose first branch held counted every row.
              //     [#20148] …then, against the object's DECLARED fields, the two
              //     cross-field rules `where` gets from `driver-sql`'s compiler:
              //     a `{ $field }` names a declared field, and an `addDays` pair
              //     follows `FieldReferenceSchema.addDays`' class rule. Both were
              //     answered by the fallback — no row counted — where `where` is
              //     refused. Refused in `where`'s words for that comparison, which
              //     withhold the fields, the operator and the reason; the
              //     withheld half goes to this log, as the driver writes its own.
              //     [#21007] …and, last, `where`'s JSON-column rule: a scalar
              //     comparison (`$in`, `$nin`, `$eq`, an ordering, implicit
              //     equality, …) on a field declared JSON-stored is refused in
              //     `where`'s words — counted by the fallback, `$nin` counted the
              //     very rows it was asked to exclude. Same withholding, same log.
              const typed = normalizeFilterComparandTypes(numeric, `aggregate('${object}')`, `aggregations[${i}].filter`);
              assertAggregationFilterIsEvaluable(typed, i, {
                  object,
                  fields: (this._registry.getObject(object) as { fields?: unknown } | undefined)?.fields,
                  reportWithheld: (diagnostic) => this.logger.warn(
                      `aggregate('${object}'): INVALID_FILTER — refusal detail withheld from the response, as it `
                      + `is for the same refusal in a where. Full diagnostic: ${diagnostic}`,
                  ),
              });
              if (typed !== aggFilter) {
                  typedAggregations ??= [...aggregations];
                  typedAggregations[i] = { ...(agg as object), filter: typed } as typeof agg;
              }
          }
          if (typedAggregations) query = { ...query, aggregations: typedAggregations };
      }
      // [#19974] `having` is this verb's THIRD filter position, and it walks
      // through the same comparand-shape face the other two take above —
      // called once, here, with the path seeded at `having`. The 2026-09-23
      // ruling on #19757 refuses an array in the equality slot at that face
      // "for every driver at once", and the face refuses it for `where` on
      // every driver. `having` never reaches a driver, though: the engine
      // evaluates it itself (`applyHaving`, having-filter.ts), and that walker
      // ANSWERED every shape the face refuses — `{ total: [5] }` by JS `==`
      // coercion (`5 == [5]` is true), `{ total: { $eq: [5] } }` by `!=`, a
      // scalar `$nin` or a malformed `$between` by keeping every group, a null
      // `$lt` bound by keeping none. Measured on the base through this method,
      // on driver-memory and driver-sqlite-wasm, on both doors below.
      //
      // ONE call covers BOTH `applyHaving` doors — the native
      // `driver.aggregate()` path and the in-memory fallback — because it runs
      // before either is chosen and before any driver is asked for a row. The
      // shape of a comparand is a property of the FILTER, so it is judged once
      // per query, never per aggregated row: an empty grouped set refuses the
      // same `having` a populated one does. ⛔ Not a second face and not a
      // walker-local check in having-filter.ts: the verdicts, the wording and
      // the `INVALID_FILTER` / 400 envelope are the face's own, so a `having`
      // refusal reads byte for byte as the `where` refusal of the same shape,
      // path aside — and whatever arm the face gains next, `having` gains too.
      //
      // [#20099] …and the rest of the doors `where` takes, at the same seam, so
      // the whole clause is judged once, before any row exists. In order:
      //  1. `having` is a filter condition at all — `QuerySchema.having` and
      //     `EngineAggregateOptions.having` declare `FilterConditionSchema`,
      //     which refuses an array or a scalar. The walker read an array's index
      //     keys as columns (`[['total','>',100]]` kept no group) and a scalar
      //     as no condition (every group). ⛔ Not lowered: the `FilterArray`
      //     sugar is declared on `where` alone, and every later door steps
      //     silently around a non-node, so this runs first.
      //  2. the comparand-shape face (above);
      //  3. the comparand-TYPE door — the same `normalizeFilterComparandTypes`
      //     `lowerWhereFilterArray` runs on `where`, path rooted at `having`, so
      //     `{ total: { $eq: { v: 1 } } }` is the `where` refusal of that shape
      //     rather than a silent `[]`, and an exact-range bigint is narrowed
      //     copy-on-write exactly as it is there;
      //  4. the walker's own refusals plus the `{ $field }` reference's
      //     position and name, judged against the aggregated row's column set
      //     read off THIS query (`assertHavingIsEvaluable`). The walker raised
      //     them per aggregated row, so an empty grouped set answered `200 []`
      //     for a `having` a populated one refused. [#20123] The same column
      //     set judges every KEY too: a key naming no column read "no value"
      //     in every group, so a typo for an alias kept no group (every group
      //     under a negation) with no error.
      // A reference that passes is then RESOLVED against each aggregated row
      // (having-filter.ts `compareWithReference`) on both doors below.
      assertHavingIsFilterCondition(query.having);
      // …and one level down, the same shape gate the per-aggregation `filter`
      // takes above: a non-list `$and` / `$or` and a non-node element or `$not`
      // operand are refused in `where`'s words at `having.$and[0]`. A `null` or
      // string element kept every group's rows unconstrained; a condition
      // array was refused as a key naming no column ('0').
      assertFilterNodeShapes(query.having, 'having');
      assertListComparandShapes(object, 'aggregate', query.having, 'having');
      // [#20176] The object's declaration, read once: the per-aggregation
      // `filter` reads a temporal comparand by its column's storage rule
      // (`applyInMemoryAggregation` below), and `having` by its aggregated
      // column's — the rule the drivers apply to the same comparand in a
      // `where`. Before, both positions compared it as written, so an ISO
      // instant against a `date` field counted 1 row where the `where` twin
      // counted 3, over REST, on driver-memory and driver-sql alike.
      const declaredFields = (this._registry.getObject(object) as { fields?: Record<string, unknown> } | undefined)?.fields;
      // [#20127] …and each aggregated column's class, read off the query and the
      // object's declaration, so a `{ $field, addDays }` pair is judged by the
      // rule `FieldReferenceSchema.addDays` declares (two temporal columns of
      // one class) rather than answered by epoch-ms coercion. [#20176] Kept for
      // both `applyHaving` doors below, which read a temporal column's
      // comparands by its storage rule.
      const havingColumnClasses = aggregatedRowColumnClasses(query.groupBy, query.aggregations, declaredFields);
      {
          const having = normalizeFilterComparandTypes(query.having, `aggregate('${object}')`, 'having');
          assertHavingIsEvaluable(
              having,
              aggregatedRowColumns(query.groupBy, query.aggregations),
              havingColumnClasses,
              // [#21255] …and each column's TYPE, which a plain `{ $field }`
              // reference's class rule asks the spec's verdict of — the rule
              // `where` applies to every reference, not only an `addDays` pair.
              aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields),
          );
          // [#20263] …and last, the TEMPORAL-comparand door `where` (#8690) and
          // the per-aggregation `filter` (#20148) take: the same walk and the
          // same `@objectstack/core` predicate, with each column's kind read
          // from the class #20127 derived above (`min` / `max` of a temporal
          // field keeps its kind, a `day` bucket is a date, `count` / `sum` /
          // `avg` are not temporal). A comparand the column's storage rule
          // cannot read (`'not-a-date'`, a `date` year outside 0..9999) was
          // compared as written and kept no group or every group, on both
          // `applyHaving` doors, while its `where` twin answered 400. After
          // every other `having` door, so a clause one of them refuses keeps
          // that refusal's words; on the caller's own clause, before the
          // bigint narrowing, which is what `where`'s object form judges.
          assertHavingTemporalComparandsInterpretable(object, query.having, havingColumnClasses, query);
          // [#20351] …then the NUMBER-comparand door `where` and the
          // per-aggregation `filter` take, over the columns #20127 classes
          // `numeric`: a non-numeric string kept no group (every group under
          // `$ne`) on both `applyHaving` doors, and a numeric string is narrowed
          // to its number. On the bigint-narrowed clause, so the two
          // narrowings compose.
          // [#20546] The same walk's no-operator-object arm judges every column
          // whose TYPE holds scalar values (hence the types, beside the
          // classes): `{ total: { a: 1 } }` kept no group, silently, on every
          // driver, where its `where` twin answered two ways. [#20745] A
          // relation or JSON column's type is judged too (a lookup groupBy's
          // nested-relation `having` kept no group on every driver).
          // [#21333] …and, by the same types, the boolean arm: over a groupBy
          // of a boolean field `"true"` kept no group (`$ne "true"` every
          // group) on both drivers; it is narrowed to `true`, `"yes"` refused.
          const numeric = narrowHavingNumberComparands(
              object, having, havingColumnClasses,
              aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields),
          );
          if (numeric !== query.having) query = { ...query, having: numeric };
      }
      const driver = this.getDriver(object);
      this.logger.debug(`Aggregate on ${object} using ${driver.name}`, query);

      const opCtx: OperationContext = {
        object,
        operation: 'aggregate',
        // On the opCtx so middleware-injected read filters (RLS/sharing) land
        // in `ast.where` — same #2737 hole as count(): a locally-built AST
        // aggregated over rows the caller may not see.
        ast: {
            object,
            where: query.where,
            groupBy: query.groupBy,
            aggregations: query.aggregations,
            // ENFORCED since #4286 (step 3). On the ast so the FLS predicate
            // guard walks its references (predicate-guard.ts) and a future
            // native pushdown has it in hand; the engine's post-aggregation
            // applyHaving() below is authoritative either way.
            having: query.having,
        },
        options: query,
        context: mergeReadContext(query?.context, options?.context),
      };
      // [ADR-0053 D-D1, amended — #5930] Each of this verb's three filter
      // positions resolves, then lowers, through `resolveThenLowerWhere`: `where`
      // and `aggregations[i].filter` narrow the object's raw rows, so they read
      // its declared field types; `having` narrows the aggregated row, so it
      // reads each aggregated column's type (`min` / `max` of a `datetime`
      // field is a `datetime`; a `count` is a number).
      const rowLowering = declaredDatetimeLowering(this._registry.getObject(object));
      await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, rowLowering, 'where', 'aggregate');
      // [#10576] Filter tokens (`{userId}`-style placeholders, #3810) resolve
      // in per-aggregation filters exactly as they do in `where` — a filter
      // position is a filter position, and an unresolved placeholder would be
      // compared as a literal string, silently selecting zero rows for that one
      // aggregation. Copy-on-write like `withResolvedWhere`: the entry objects
      // belong to the caller (view metadata / flow config get reused), so a
      // resolved filter lands on a copied entry, never written back through.
      {
          const astAggs = (opCtx.ast as QueryAST).aggregations;
          if (Array.isArray(astAggs) && astAggs.some((a) => (a as { filter?: unknown })?.filter != null)) {
              (opCtx.ast as QueryAST).aggregations = astAggs.map((a, i) => {
                  const f = (a as { filter?: unknown })?.filter;
                  if (f == null) return a;
                  const resolved = resolveThenLowerWhere(
                      f as any, opCtx.context, rowLowering,
                      whereResolvedTokenJudge(object, 'aggregate', this._registry.getObject(object), `aggregations[${i}].filter`),
                  );
                  return resolved === f ? a : { ...(a as object), filter: resolved } as typeof a;
              });
          }
      }
      // [#20334] …and in `having`, through the resolver `where` takes, so a
      // relative-date token compares as the day it names rather than as its own
      // text, and an unknown one is `FILTER_TOKEN_UNKNOWN` / 400 (it kept no
      // group with a 200). Both `applyHaving` doors below read `ast.having`, so
      // one call covers the native and the rows path, before any driver read.
      // After every `having` door above, as `where`'s resolution follows its
      // doors: the temporal door steps around a `{placeholder}` exactly as
      // `where`'s does (so, as there, the resolved value is judged only for
      // its year, by the resolution stage — #20844), and the other doors
      // judged a string that resolves to a string.
      {
          const havingColumnTypes = aggregatedRowColumnTypes(query.groupBy, query.aggregations, declaredFields);
          await this.resolveWhereTokens(
              opCtx.ast as QueryAST,
              opCtx.context,
              { isDatetimeColumn: (column) => havingColumnTypes.get(column) === 'datetime' },
              'having',
          );
      }

      await this.executeWithMiddleware(opCtx, async () => {
        // [ADR-0139 D2] The executor boundary, once for BOTH driver paths below
        // (they are exclusive, and the rows path keeps this `where` by
        // reference): the AST is final once the chain has run.
        const ast = await this.composeReadableIdsAtBoundary(object, 'aggregate', opCtx.ast as QueryAST, opCtx.context);

        // Prefer driver.aggregate() when available — driver.find() in many
        // drivers (e.g. driver-sql) does not honor `groupBy` / `aggregations`
        // and would silently return ungrouped raw rows. Fall back to find()
        // for drivers that handle aggregations through their query AST.
        const drv = driver as any;
        // Structured groupBy items ({field, dateGranularity}) require the
        // driver to advertise per-granularity native bucket support via
        // `supports.queryDateGranularity[g]`. If every structured item is
        // supported we can push the aggregate down to the driver; otherwise
        // we fall back to driver.find() + in-memory bucketing so the result
        // remains correct on a face that buckets fewer (e.g. the Turso remote
        // transport, which advertises none).
        const groupByItems = Array.isArray(query.groupBy) ? query.groupBy : [];
        const granularityCaps: Record<string, boolean> | undefined =
            drv?.supports?.queryDateGranularity;
        const structuredItems = groupByItems.filter((g) => typeof g !== 'string');
        const allStructuredSupported = structuredItems.every((g) => {
            if (!g?.dateGranularity) return true; // plain {field} object is fine
            return granularityCaps?.[g.dateGranularity] === true;
        });
        // ADR-0053 Phase 2 (D2): native driver date bucketing (driver-sql's
        // `to_char` / `date_format` / `strftime`) is UTC-only — SQLite has no
        // tz database and MySQL needs tz tables loaded,
        // so pushing tz-aware bucketing down splits boundaries per dialect. When
        // a non-UTC reference timezone is in play we therefore force the
        // in-memory path: the date-range `where` still goes to the driver (only
        // matching rows are fetched), but bucketing runs uniformly in JS so a
        // row near a tz day-boundary lands identically on every driver.
        const tz = query.timezone;
        const hasDateBucket = structuredItems.some((g) => !!g?.dateGranularity);
        const tzRequiresInMemory = !!tz && tz !== 'UTC' && hasDateBucket;
        // [#10576] Per-aggregation filters (`aggregations[].filter`, the
        // contract half of #10413) force the in-memory path: no driver compiles
        // a conditional aggregate (SQL `FILTER (WHERE …)` / `CASE WHEN`) from
        // this key today, and pushing it down would aggregate the UNFILTERED
        // rows — the silent drop #10413 measured. Same correct-first two-tier
        // shape as date bucketing and HAVING above: a driver that grows native
        // support must advertise a capability flag, at which point this fork
        // becomes its fallback tier. The driver faces also refuse the key
        // loudly (NOT_IMPLEMENTED/501) if reached directly, so neither seam can
        // drop it in silence. `{}` counts as no filter (the vacuous-filter
        // convention `where` / `having` already follow).
        const hasAggregationFilter = (Array.isArray(ast.aggregations) ? ast.aggregations : [])
            .some((a) => {
                const f = (a as { filter?: unknown })?.filter;
                return f != null && typeof f === 'object' && Object.keys(f).length > 0;
            });
        if (typeof drv.aggregate === 'function' && allStructuredSupported && !tzRequiresInMemory && !hasAggregationFilter) {
            // HAVING is engine-owned (#4286): applied AFTER aggregation, over
            // the aggregated row's own columns (aggregation aliases + groupBy
            // projections), identically on both paths. No driver implements it
            // natively today; one that grows native support must advertise a
            // capability flag, at which point this post-filter becomes the
            // fallback tier — the dateGranularity two-tier pattern.
            const aggregated = await drv.aggregate(object, ast, this.buildDriverOptions(object, opCtx.context, undefined, { recordedVerdict: opCtx.tenantLayer0Verdict }));
            return applyHaving(aggregated, ast.having, havingColumnClasses);
        }
        // In-memory fallback path: ask the driver for raw rows, then bucket +
        // aggregate here. This guarantees `groupBy` (incl. structured items
        // carrying `dateGranularity`) and `aggregations` always work even on
        // drivers that have no native aggregation support (driver-rest,
        // driver-memory, partial SQL drivers), and is the path that honours a
        // non-UTC reference timezone.
        //
        // [#16642] The `find` call asks for ROWS, so the aggregation keys this
        // path is about to evaluate ITSELF are stripped from the AST it sends
        // down. `find()`'s contract says nothing about `groupBy` /
        // `aggregations`, and the drivers disagree about them: `driver-sql`
        // and `driver-rest` ignore both and return rows (which is the only
        // reason this path has ever worked), while `driver-memory` honours
        // them — its `find()` funnels straight into the same
        // `performAggregation` its `aggregate(AST)` door uses, and
        // `driver-mongodb` / `driver-turso` carry the same refusal on their
        // own aggregation faces. Sending the keys to a driver of that kind
        // made this ONE seam answer two different wrong things:
        //
        //   * a per-aggregation `filter` (the key that ROUTED the call here)
        //     was refused NOT_IMPLEMENTED/501 by the driver's own #10413
        //     guard — a refusal aimed at direct callers, raised against the
        //     engine's own lowering, so `service-analytics` answered 501 for
        //     a measure `filter` on the memory driver while sqlite answered
        //     the number (#16642);
        //   * a date-bucketed `groupBy` came back ALREADY grouped, on the raw
        //     timestamp, and `applyInMemoryAggregation` then aggregated those
        //     GROUP rows a second time — a count of buckets reported under
        //     the author's own measure name, i.e. a plausible wrong number
        //     rather than a refusal.
        //
        // Both driver refusals document themselves as "unreachable through
        // `engine.aggregate`, which lowers in memory for every driver"
        // (`driver-memory`'s `refusePerAggregationFilter`, `driver-sql`'s
        // `unsupportedAggregationFilterError`); this is the line that makes
        // that true. `having` goes with them: `applyHaving` below is the
        // authority on it and no driver evaluates it in `find`.
        const rowsAst: QueryAST = { ...ast };
        delete rowsAst.groupBy;
        delete rowsAst.aggregations;
        delete rowsAst.having;
        const raw = await driver.find(object, rowsAst, this.buildDriverOptions(object, opCtx.context, undefined, { recordedVerdict: opCtx.tenantLayer0Verdict }));
        return applyHaving(applyInMemoryAggregation(raw, ast, tz, declaredFields), ast.having, havingColumnClasses);
      });

      return opCtx.result as any[];
  }
}
