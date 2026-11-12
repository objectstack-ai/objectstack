// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Write preparation and insert" section of `ObjectQL`:
 * the bodies of `staticReadonlyCreateStrip`, `updateByIdExpecting`,
 * `ownershipQueueService`, `assignment`, `readUpdatePriorRow`, `insert`,
 * `insertMany` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link InsertFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link InsertHost}: exactly the `ObjectQL`
 * members they read, private ones included. Every stub hands its body, by a
 * `.call`, the same host: `insertHost` in `engine-facet-hosts.ts`, built once
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

import type { DataEngineInsertOptions, EngineCountOptions, EngineQueryOptions, HookContext, QueryAST } from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
import type { PendingSecretRow } from './engine-secret-internal-fields.js';
import { referencesCheckedBeforeRules } from './engine-referential-integrity.js';
import { mergeDriverOptionsIntoHookView } from './engine-driver-options.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataDriver } from '@objectstack/core';
import { ConcurrentUpdateError } from './concurrent-update-error.js';
import { SummaryRecomputeError } from './summary-errors.js';
import { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';
import { DuplicateRecordError } from './duplicate-record-error.js';
import { NotNullRefusalError, envelopeDriverWriteRefusal } from './not-null-refusal-error.js';
import { ASSIGNMENT_RULE_TYPE, AssignmentRuleEvaluator, OWNERSHIP_QUEUE_SOURCE_SLOT } from './assignment-rules.js';
import type { AssignmentQueueService } from './assignment-rules.js';
import { redactBoundStatement } from '@objectstack/types';
import { ORGANIZATION_OBJECT } from './tenancy/system-write-organization.js';
import { assertRecordCurrencyCodes, followParentCurrencyCodes, recordCurrencyPairs } from './validation/record-currency-code.js';
import { planHomeAmounts, projectHomeAmounts } from './home-amount-projection.js';
import { stripSearchCompanion } from './search-companion.js';
import type { EvalPermissions } from '@objectstack/formula';
import { declaredOptionLabels } from './formula-option-labels.js';
import { coerceBooleanFields, normalizeBlankTypedValues, normalizeMultiValueFields, normalizeNumericStringValues, validateRecordInScope } from './validation/record-validator.js';
import { emitValidationAdvisories, evaluateValidationRules, hasParentScopedRequiredWhen, preserveAuditIgnoredOnInsertWarning, stripReadonlyFields, stripRuntimeOwnedFields } from './validation/rule-validator.js';
import type { staticReadonlyInsertSubject } from './validation/rule-validator.js';
import { createBatchSummaryAccumulator } from './summary-batch-accumulation.js';
import { recordHookPayloadWrites } from './hook-write-provenance.js';
import type { HookWriteRecording } from './hook-write-provenance.js';
import { dispatchHooksExplainingWithheldReadonly } from './hook-withheld-readonly-fault.js';
import { declaredColumnSet, rowsWithDeclaredColumnsOnly, selectedStoredColumns, storedColumnsLeftUnwritten, withDeclaredColumnsOnly, withSelectedColumnsAnswered } from './declared-read-columns.js';
import {
  WRITE_PRECONDITION_OPTION, autonumberFieldNames, callerKeySets, callerSuppliedRow, computeStoredExpressions,
  droppedFieldEvents, handBackWithheldInsertReadonly, hydrateWriteFormulas, insertStaticReadonlySubject,
  planStoredExpressions, recomputeAutonumberReaders, replacedStoredExpressionFields, shouldSkipStateMachine,
  storedExpressionsReading, stripComputedWriteFields, undeclaredWriteFieldErrors, withholdInsertReadonlyFromHooks,
  writeFailureLogMeta,
} from './engine-top-level.js';
import type {
  AutonumberReaders, IssuedAutonumber, OperationContext, PermissionResolution, StoredExpressionServing,
} from './engine-top-level.js';
import { ObjectQLStatics as ObjectQL } from './engine.js';
import type { InsertManyRowOutcome, ObjectQL as ObjectQLClass } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link InsertFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface InsertHost {
  readonly _registry: ObjectQLClass['_registry'];
  admittedViolationSink: ObjectQLClass['admittedViolationSink'];
  applyAutonumbers: ObjectQLClass['applyAutonumbers'];
  applyFieldDefaults: ObjectQLClass['applyFieldDefaults'];
  assertReferencesResolve: ObjectQLClass['assertReferencesResolve'];
  assertWriteAllowed: ObjectQLClass['assertWriteAllowed'];
  assignment: ObjectQLClass['assignment'];
  assignmentEvaluator: ObjectQLClass['assignmentEvaluator'];
  readonly autonumberCounters: ObjectQLClass['autonumberCounters'];
  buildDriverOptions: ObjectQLClass['buildDriverOptions'];
  buildEvalUser: ObjectQLClass['buildEvalUser'];
  buildHookApi: ObjectQLClass['buildHookApi'];
  buildProvenance: ObjectQLClass['buildProvenance'];
  buildSession: ObjectQLClass['buildSession'];
  buildUser: ObjectQLClass['buildUser'];
  count: ObjectQLClass['count'];
  createWithAutonumberResync: ObjectQLClass['createWithAutonumberResync'];
  encryptSecretFields: ObjectQLClass['encryptSecretFields'];
  enforceTransactionOrigin: ObjectQLClass['enforceTransactionOrigin'];
  executeWithMiddleware: ObjectQLClass['executeWithMiddleware'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQLClass;
  find: ObjectQLClass['find'];
  formulaFaultSink: ObjectQLClass['formulaFaultSink'];
  formulaOptionLabels: ObjectQLClass['formulaOptionLabels'];
  getDriver: ObjectQLClass['getDriver'];
  getSchema: ObjectQLClass['getSchema'];
  getSummaryDescriptors: ObjectQLClass['getSummaryDescriptors'];
  homeAmountServing: ObjectQLClass['homeAmountServing'];
  inAfterAbortUnit: ObjectQLClass['inAfterAbortUnit'];
  initializeSummaryFields: ObjectQLClass['initializeSummaryFields'];
  insert: ObjectQLClass['insert'];
  readonly insertRecomputeListeners: ObjectQLClass['insertRecomputeListeners'];
  invalidateOrganizationProbe: ObjectQLClass['invalidateOrganizationProbe'];
  isIssuedAutonumberCollision: ObjectQLClass['isIssuedAutonumberCollision'];
  readonly logger: ObjectQLClass['logger'];
  mediaValueShapeStrictFor: ObjectQLClass['mediaValueShapeStrictFor'];
  opensAfterAbortUnit: ObjectQLClass['opensAfterAbortUnit'];
  ownershipQueueService: ObjectQLClass['ownershipQueueService'];
  permissionResolution: ObjectQLClass['permissionResolution'];
  persistSecretRows: ObjectQLClass['persistSecretRows'];
  preconditionDegradedWarned: ObjectQLClass['preconditionDegradedWarned'];
  publishDataEvent: ObjectQLClass['publishDataEvent'];
  readonly realtimeService: ObjectQLClass['realtimeService'];
  recomputeSummaries: ObjectQLClass['recomputeSummaries'];
  refuseEmptyPasswordFields: ObjectQLClass['refuseEmptyPasswordFields'];
  releaseSecretHandles: ObjectQLClass['releaseSecretHandles'];
  resolveDefaultPermissions: ObjectQLClass['resolveDefaultPermissions'];
  resolveFormulaPermissions: ObjectQLClass['resolveFormulaPermissions'];
  resolveFormulaRelated: ObjectQLClass['resolveFormulaRelated'];
  resolveMasterDetailParents: ObjectQLClass['resolveMasterDetailParents'];
  resolveObjectName: ObjectQLClass['resolveObjectName'];
  resolveOptionPermissions: ObjectQLClass['resolveOptionPermissions'];
  resolvePredicateRelated: ObjectQLClass['resolvePredicateRelated'];
  resolveSystemInsertOrganization: ObjectQLClass['resolveSystemInsertOrganization'];
  staticReadonlyCreateStrip: ObjectQLClass['staticReadonlyCreateStrip'];
  triggerHooks: ObjectQLClass['triggerHooks'];
  update: ObjectQLClass['update'];
  validationMessageContext: ObjectQLClass['validationMessageContext'];
  valueShapeStrictFor: ObjectQLClass['valueShapeStrictFor'];
  warnAutonumberReadersUnserved: ObjectQLClass['warnAutonumberReadersUnserved'];
}

/** The bodies of the "Write preparation and insert" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class InsertFacet {
  /**
   * [#20805] The create path's static-`readonly` strip of ONE row, together
   * with the re-default of every key it takes — the door as `insert()` runs it,
   * lifted out so that {@link ObjectQL.validate} runs the same door over its
   * preview rows instead of a copy of it (one function per door). `insert()`
   * owns everything around it: the `isSystem` gate, the per-call
   * `insertDropped` union, the `preserveAudit`-ignored WARN and partial-mode
   * culling; `validate()` passes no logger, because a preview writes nothing
   * and a strip line would say otherwise.
   *
   * The field's `defaultValue` is RE-DERIVED for every key the strip took,
   * which is #3043's stated contract and a guarantee in its own right: a forged
   * `approval_status` becomes `draft` — the enforced initial state — never
   * NULL, so a stripped forgery cannot leave a row in a state the object's own
   * rules (`requiredWhen`, the state machine) were written to exclude. The
   * deleted ingress copy got this for free by running BEFORE
   * `applyFieldDefaults`; a strip that runs after the hooks has to ask. Asked
   * over the STRIPPED row, so a `defaultValue` expression reads the payload it
   * will really be stored beside, and copied back key by key:
   * `applyFieldDefaults` also fills every OTHER absent field, and a hook that
   * deliberately wrote `null` must keep its null (the first defaults pass,
   * ahead of the hooks, is the one that owns those keys).
   *
   * [#20082] A re-derived `can` default takes the write's map too — from the
   * same resolution, so this asks nothing new unless it is the first pass to
   * need it. Scoped to the TAKEN keys: those are the only defaults this pass
   * keeps, so no other field's default can make it ask, or fail.
   *
   * @returns the row as the strip leaves it (the SAME reference when nothing
   *   was taken) and the keys taken, in the row's key order. When the
   *   re-default's permission resolution fails, `error` carries it and `row`
   *   is the row as it arrived: the caller decides whether that fails the
   *   write or culls the row, and the taken keys are still reported.
   */
  static async staticReadonlyCreateStrip(this: Pick<InsertHost, 'applyFieldDefaults' | 'resolveDefaultPermissions'>, object: string, readonlySubject: NonNullable<ReturnType<typeof staticReadonlyInsertSubject>>, row: Record<string, unknown>, supplied: Readonly<Record<string, unknown>>, context: ExecutionContext | undefined, pass: {
      logger: Parameters<typeof stripReadonlyFields>[3];
      strictReadonlyWrites: boolean;
      hookWrittenKeys: ReadonlySet<string> | undefined;
      nowSnap: Date;
      permissionResolution: PermissionResolution | undefined;
    }): Promise<{ row: Record<string, unknown>; taken: string[]; error?: unknown }> {
    const stripped = stripReadonlyFields(
      readonlySubject as any, row, supplied, pass.logger,
      {
        strictReadonlyWrites: pass.strictReadonlyWrites,
        hookWrittenKeys: pass.hookWrittenKeys,
        verb: 'insert',
      },
    ) as Record<string, unknown>;
    if (stripped === row) return { row, taken: [] };
    const taken = Object.keys(row).filter((k) => !(k in stripped));
    if (taken.length > 0) {
      let redefaultPermissions: EvalPermissions | undefined;
      try {
        redefaultPermissions = (await this.resolveDefaultPermissions(
          object, [stripped], context, pass.permissionResolution, taken,
        ))(stripped);
      } catch (err) {
        return { row, taken, error: err };
      }
      const redefaulted = this.applyFieldDefaults(object, stripped, context, pass.nowSnap, redefaultPermissions);
      for (const k of taken) {
        if (redefaulted[k] !== undefined) stripped[k] = redefaulted[k];
      }
    }
    return { row: stripped, taken };
  }

  /**
   * [#22445] The by-id update's prior-row read: the STORED row an update of
   * `id` judges, or `null` when the store holds none. One spelling, read by
   * `update()`'s by-id branch and by the `update`-mode preview
   * ({@link ObjectQL.validate}), so the preview judges the image the write
   * judges rather than a second reading of it.
   *
   * A raw driver read, not the read door: the rules judge the row as STORED,
   * so no formula is evaluated, no file reference resolved, no read hook run.
   * ⛔ It answers no access question — `update()` reaches it only after the
   * write gates in its middleware chain, and the preview asks the read door
   * first (see `storedRows` in `validate()`).
   *
   * `buildDriverOptions` carries the open transaction and the tenant scope onto
   * the raw read, as on every engine read. [#21613] The row is shaped like
   * every other row this engine reads off a driver: the declared field set, so
   * the update's `previous` (bound for its hooks, and the audit ledger's side
   * of every update diff) and its returned row are ONE view. Shaping only the
   * returned row would make every update of a row carrying a retired column
   * record that column as changed, its stored value included.
   */
  /**
   * [ADR-0142 D4] The by-id write under {@link OperationContext.writePrecondition}:
   * the driver's conditional `updateMany` over `{ id, ...expect }`, then a
   * readback by id. Zero rows matched is {@link ConcurrentUpdateError}. A driver
   * with no `updateMany` writes unconditionally, logged once per process.
   */
  static async updateByIdExpecting(this: Pick<InsertHost, 'logger' | 'preconditionDegradedWarned'>, driver: IDataDriver, object: string, id: unknown, data: Record<string, unknown>, expect: Readonly<Record<string, unknown>>, options: Parameters<IDataDriver['findOne']>[2]): Promise<unknown> {
    if (typeof driver.updateMany !== 'function') {
      if (!this.preconditionDegradedWarned) {
        this.preconditionDegradedWarned = true;
        this.logger.warn(
          `[objectql] the driver for '${object}' has no conditional update (updateMany), so a by-id write ` +
            'precondition degrades to the pre-image check and the write goes through unconditionally: two ' +
            'concurrent claims of one record may both land, and the round-robin cursor may repeat a member.',
          { object },
        );
      }
      return driver.update(object, id as string, data, options);
    }
    const affected = await driver.updateMany(object, { object, where: { ...expect, id } } as QueryAST, data, options);
    if (!(Number(affected) > 0)) throw new ConcurrentUpdateError(object, String(id));
    return driver.findOne(object, { object, where: { id }, limit: 1 } as QueryAST, options);
  }

  /** The registered ownership-queue service, through the plugin's slot — `null` on every other state. */
  static ownershipQueueService(this: Pick<InsertHost, 'facade'>): AssignmentQueueService | null {
    const source = (this.facade as unknown as Record<symbol, unknown>)[OWNERSHIP_QUEUE_SOURCE_SLOT];
    if (typeof source !== 'function') return null;
    try {
      const svc = (source as () => unknown)();
      return svc && typeof (svc as AssignmentQueueService).resolveQueue === 'function'
        && typeof (svc as AssignmentQueueService).expandMembers === 'function'
        ? (svc as AssignmentQueueService)
        : null;
    } catch {
      return null;
    }
  }

  /** The body of `ObjectQL#assignment`; the method's docblock there is its contract. */
  static assignment(this: Pick<InsertHost, '_registry' | 'assignmentEvaluator' | 'count' | 'find' | 'insert' | 'logger' | 'ownershipQueueService' | 'update'>): AssignmentRuleEvaluator {
    if (!this.assignmentEvaluator) {
      this.assignmentEvaluator = new AssignmentRuleEvaluator({
        listRules: () => this._registry.listItems(ASSIGNMENT_RULE_TYPE) as unknown[],
        getSchema: (object) => this._registry.getObject(object),
        hasObject: (object) => Boolean(this._registry.getObject(object)),
        queues: () => this.ownershipQueueService(),
        find: async (object, where, context, limit) =>
          (await this.find(object, { where, ...(limit ? { limit } : {}) } as EngineQueryOptions, { context: context as ExecutionContext })) as Record<string, unknown>[],
        count: (object, where, context) => this.count(object, { where } as EngineCountOptions, { context: context as ExecutionContext }),
        insert: (object, data, context) => this.insert(object, data, { context: context as ExecutionContext }),
        updateExpecting: (object, id, data, expect, context) =>
          this.update(object, { ...data, id }, { context: context as ExecutionContext, [WRITE_PRECONDITION_OPTION]: expect } as any),
        logger: this.logger,
      });
    }
    return this.assignmentEvaluator;
  }

  /** The body of `ObjectQL#readUpdatePriorRow`; the method's docblock there is its contract. */
  static async readUpdatePriorRow(this: Pick<InsertHost, '_registry' | 'buildDriverOptions' | 'getDriver'>, object: string, id: unknown, context: ExecutionContext | undefined, base?: unknown): Promise<Record<string, unknown> | null> {
    const priorAst: QueryAST = { object, where: { id }, limit: 1 } as QueryAST;
    const preOpts = this.buildDriverOptions(object, context, base as any);
    return withDeclaredColumnsOnly(
      await this.getDriver(object).findOne(object, priorAst, preOpts) as Record<string, unknown> | null,
      declaredColumnSet(this._registry.getObject(object)),
    );
  }

  /** The body of `ObjectQL#insert`; the method's docblock there is its contract. */
  static async insert(this: Pick<InsertHost, '_registry' | 'admittedViolationSink' | 'applyAutonumbers' | 'applyFieldDefaults' | 'assertReferencesResolve' | 'assertWriteAllowed' | 'assignment' | 'autonumberCounters' | 'buildDriverOptions' | 'buildEvalUser' | 'buildHookApi' | 'buildProvenance' | 'buildSession' | 'buildUser' | 'createWithAutonumberResync' | 'encryptSecretFields' | 'enforceTransactionOrigin' | 'executeWithMiddleware' | 'facade' | 'formulaFaultSink' | 'formulaOptionLabels' | 'getDriver' | 'getSchema' | 'getSummaryDescriptors' | 'homeAmountServing' | 'inAfterAbortUnit' | 'initializeSummaryFields' | 'insert' | 'insertRecomputeListeners' | 'invalidateOrganizationProbe' | 'isIssuedAutonumberCollision' | 'logger' | 'mediaValueShapeStrictFor' | 'opensAfterAbortUnit' | 'permissionResolution' | 'persistSecretRows' | 'publishDataEvent' | 'realtimeService' | 'recomputeSummaries' | 'refuseEmptyPasswordFields' | 'releaseSecretHandles' | 'resolveDefaultPermissions' | 'resolveFormulaPermissions' | 'resolveFormulaRelated' | 'resolveMasterDetailParents' | 'resolveObjectName' | 'resolveOptionPermissions' | 'resolvePredicateRelated' | 'resolveSystemInsertOrganization' | 'staticReadonlyCreateStrip' | 'triggerHooks' | 'validationMessageContext' | 'valueShapeStrictFor' | 'warnAutonumberReadersUnserved'>, object: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any> {
    object = this.resolveObjectName(object);
    // [#22782] An aborting `afterInsert` rolls this write back — see `opensAfterAbortUnit`.
    if (this.opensAfterAbortUnit('afterInsert', object, options?.context)) {
      return this.inAfterAbortUnit(() => this.insert(object, data, options));
    }
    this.logger.debug('Insert operation starting', { object, isBatch: Array.isArray(data) });
    this.assertWriteAllowed(object, 'insert');
    // [#8844] The organization set is about to change. Dropped BEFORE the write
    // rather than after it, so a concurrent read cannot repopulate the memo from
    // a snapshot this insert is in the middle of invalidating.
    if (object === ORGANIZATION_OBJECT) this.invalidateOrganizationProbe();
    const driver = this.getDriver(object);
    // [#5351/#5696] Same-origin gate: refuse a cross-driver BUSINESS write,
    // carve an append-only system ledger out of the transaction. Before any
    // hook, default or validation runs, so a refusal costs nothing.
    this.enforceTransactionOrigin(object, driver, 'insert');

    // [#20308] A blank on a non-string-typed column is `null` from here on —
    // before the middleware, the caller snapshot, the defaults, the hooks and
    // validation read the payload, so all of them see one image (a blank then
    // takes a `defaultValue` exactly as `null` does). See
    // `normalizeBlankTypedValues` for the scope; it never mutates the caller's
    // rows. [#20309] At the same point, a string on a number field that the
    // spec's numeric grammar reads becomes that number, so the validator judges
    // the value the driver stores (`normalizeNumericStringValues`).
    data = normalizeBlankTypedValues(this._registry.getObject(object), data);
    data = normalizeNumericStringValues(this._registry.getObject(object), data);

    // [#21682] What the CALLER sent, recorded before any write middleware
    // fills the payload. See `callerKeySets`.
    const callerKeys = callerKeySets(data);

    const opCtx: OperationContext = {
      object,
      operation: 'insert',
      data,
      options,
      context: options?.context,
    };

    await this.executeWithMiddleware(opCtx, async () => {
      // Resolve field `defaultValue`s (including the `current_user` and
      // `NOW()` tokens)
      // BEFORE the beforeInsert hook runs, so a hook that DERIVES one field
      // from another can read the defaulted value instead of a stale `null`
      // (#2703). The hook still has final say — it runs after and may override
      // any defaulted field. `applyFieldDefaults` returns a fresh copy and only
      // fills fields left `undefined`, so client-supplied values are untouched.
      //
      // [#5749] Roll-up `summary` fields this object OWNS are seeded in the same
      // pass, right after the declared defaults: `count`/`sum` over the empty
      // child collection is 0, and a brand-new parent HAS an empty child
      // collection. Without it the row stored `null` and stayed there until some
      // child write happened to name it — so "never had a child" (null) and
      // "had one, deleted it" (0) read differently and `= 0` filters dropped
      // rows. Same placement rules as the defaults above: caller-supplied values
      // untouched, hooks run after and may override.
      const nowSnap = new Date();
      const isBatch = Array.isArray(opCtx.data);
      // [#21682] Each row's caller key set, looked up NOW, on the row objects
      // the middleware chain handed on. The computed-field door below may
      // replace a row with a copy. Index-aligned from here on: every pass
      // between here and the snapshot keeps the rows' order and count.
      const callerKeysPerRow: Array<ReadonlySet<string> | undefined> =
        (isBatch ? (opCtx.data as unknown[]) : [opCtx.data]).map(
          (row) => (row !== null && typeof row === 'object' ? callerKeys.get(row) : undefined),
        );
      // [#8682] The declared-field door — see `undeclaredWriteFieldErrors` for
      // what used to run below it for a request that was already refused.
      // FIRST, so nothing downstream (defaults, summary seeding, the hooks, the
      // secret writes, validation, the autonumber) happens for a row the schema
      // rejects. Non-partial callers get the refusal thrown here; the
      // partial-success path (`insertMany`) carries it per row into `rowErrors`
      // below, where the culled rows also skip the hooks and every producer.
      const undeclaredPerRow = undeclaredWriteFieldErrors(
        object,
        this._registry.getObject(object) as { fields?: unknown } | undefined,
        isBatch ? (opCtx.data as unknown[]) : [opCtx.data],
      );
      const partialRowMode = isBatch && (options as any)?.__partialRowErrors === true;
      if (!partialRowMode) {
        const refusal = undeclaredPerRow.find((e) => e !== undefined);
        if (refusal) throw refusal;
      }
      // [#20805] The computed-field door, beside the declared-field door and
      // over the rows it did not refuse — see `stripComputedWriteFields`. In
      // EVERY context: unlike the strips further down, no `isSystem` gate,
      // because a `formula` value has no column to land in for any caller.
      // Everything below reads `opCtx.data`, so it is replaced here and the
      // snapshot, the defaults and the hooks all see the payload that will be
      // stored. Reported at `insertDrops`, beside the other strips.
      const computedStrip = stripComputedWriteFields(
        this._registry.getObject(object) as { fields?: unknown } | undefined,
        isBatch ? (opCtx.data as unknown[]) : [opCtx.data],
        undeclaredPerRow,
      );
      const computedDropped = computedStrip.dropped;
      if (computedDropped.length > 0) {
        opCtx.data = (isBatch ? computedStrip.rows : computedStrip.rows[0]) as any;
      }
      // [#4441] The RAW caller payload per row — before `applyFieldDefaults`
      // resolves any `defaultValue` / `current_user` token and before the
      // beforeInsert hooks stamp `created_by`. The reference check consults it
      // to decide WHAT THE CALLER ACTUALLY SENT, so neither a platform stamp
      // nor a backfilled default is ever reported as the caller's bad
      // reference.
      //
      // [#21682] ...and without the keys a write MIDDLEWARE filled, which ran
      // before this step: `organization_id` (`@objectstack/organizations`) and
      // `owner_id` (`@objectstack/plugin-security`) are filled there, not by a
      // hook. Each row keeps only the keys the caller sent (`callerKeySets`,
      // recorded at entry), so the strips below report and take only those.
      // The values stay as the chain handed them on.
      //
      // [#6339] It carries the caller's VALUES, and it is taken HERE — ahead of
      // the hooks — as an explicit shallow COPY. Both halves are load-bearing:
      //  - VALUES, because the runtime-owned strip below runs AFTER
      //    `beforeInsert`, so "the caller named this key" and "this key still
      //    holds the caller's value" are different facts, and only the second
      //    one licenses a delete (see `stripRuntimeOwnedFields`).
      //  - a COPY, taken ahead of the hooks, because `rows[i]` is a different
      //    object from `opCtx.data` only by the grace of two upstream helpers:
      //    `applyFieldDefaults` returns `{ ...record }` — except on its
      //    `!fields` early return, which hands the SAME reference back — and
      //    `initializeSummaryFields` copies only when it actually seeds. Hooks
      //    mutate `ctx.input.data` IN PLACE, so an aliased snapshot would
      //    answer "what did the caller send?" with the post-hook payload.
      //    Measured on `origin/main`: not aliased today, because that early
      //    return lines up with the strip's own `!fields` bail — a coincidence
      //    of three call sites, which the copy turns into an invariant of this
      //    one. Same spread, same reason, as the update path's `suppliedValues`
      //    (#5591).
      const suppliedPerRow: Array<Record<string, unknown>> =
        (isBatch ? (opCtx.data as any[]) : [opCtx.data]).map(
          (row, i) => callerSuppliedRow(row, callerKeysPerRow[i]),
        );
      // ── [#22306] WITHHOLD caller-supplied read-only values from beforeInsert ──
      //
      // The insert side of #16344's invariant, in the ruling's words:「交给生命
      // 周期钩子的记录,就是它打算持久化的那条记录。」— see
      // `withholdInsertReadonlyFromHooks` for the measured defect and for WHICH
      // keys (the post-hook static strip's own function, subject and options).
      //
      // ⭐ WITHHOLD, not strip, exactly as on update. The ENFORCEMENT stays
      // where ruling C (#14147) put it — after the hooks, the only point that
      // can tell a hook's stamp from a caller's forgery (`rowHookWrittenKeys`)
      // — and the caller's values are handed straight back after the seal, so
      // the strips, their re-default, the WARN, `onFieldsDropped` and
      // `strictReadonlyWrites` all judge the payload they judged before.
      //
      // Placed HERE, after `suppliedPerRow` took the caller's values (the
      // strips' evidence) and BEFORE the defaults, the summary seed and the
      // recording: the defaults then fill a withheld key exactly as they fill
      // an absent one, and nothing this pass does can be recorded as a hook
      // write. `opCtx.data` keeps the caller's payload; only the hook view is
      // built from the withheld rows. ⛔ `isSystem` withholds nothing — the
      // strips do not run for it, so every value it sends is stored.
      //
      // [#24822] Read ONCE, here, and by both static-`readonly` passes: whether
      // the Layer 0 wall judges this insert's `organization_id` on the stored
      // rows. The wall declares it on the seam it installed, and the engine
      // reads that member and nothing else (`insertStaticReadonlySubject`).
      // The middleware chain has run by now, so the seam is in place.
      const wallJudgesOrganization =
        !opCtx.context?.isSystem && opCtx.postHookWriteImageCheck?.judgesOrganization === true;
      const insertWithheld: Array<Record<string, unknown> | undefined> = [];
      const hookViewSource: unknown[] = (isBatch ? (opCtx.data as unknown[]) : [opCtx.data]).slice();
      if (!opCtx.context?.isSystem) {
        const preserveAuditForHide = opCtx.context?.preserveAudit === true;
        const hideSchema = this._registry.getObject(object);
        for (let i = 0; i < hookViewSource.length; i++) {
          const row = hookViewSource[i];
          if (undeclaredPerRow[i] !== undefined) continue;
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          const hidden = withholdInsertReadonlyFromHooks(
            hideSchema, row as Record<string, unknown>, suppliedPerRow[i] ?? {}, preserveAuditForHide,
            wallJudgesOrganization,
          );
          insertWithheld[i] = hidden.withheld;
          hookViewSource[i] = hidden.row;
        }
      }
      // [#20082] The write's ONE permission resolution, shared by every consumer
      // below that needs the map: the CEL defaults here, the re-default after
      // the static-`readonly` strip, the option gates at validation, and the
      // formula fields on the response. Asked at most once for the whole write.
      //
      // A CEL default that calls `current_user.can(…)` is evaluated with it. A
      // row whose default NEEDED it when the resolution failed is refused with
      // the resolution's own error (fail CLOSED, see `resolveDefaultPermissions`)
      // before any hook or producer runs for it: the whole write outside partial
      // mode; under partial mode that row alone, carried with the declared-field
      // door's per-row refusals — the array every later pass already reads as
      // "this row is dead on arrival" (no hook, seeded into `rowErrors`).
      const permissionResolution = this.permissionResolution(opCtx.context);
      // [#22306] The hook view's rows: a withheld key is absent here, so a
      // `can` default on it is resolved for this row as for any absent key.
      const payloadRows: unknown[] = hookViewSource;
      const defaultPermissionsFor = await this.resolveDefaultPermissions(
        object, payloadRows.filter((_, i) => undeclaredPerRow[i] === undefined), opCtx.context, permissionResolution,
      );
      const defaultPermissions: Array<EvalPermissions | undefined> = payloadRows.map((row, i) => {
        if (undeclaredPerRow[i] !== undefined) return undefined;
        try {
          return defaultPermissionsFor(row);
        } catch (err) {
          if (!partialRowMode) throw err;
          undeclaredPerRow[i] = err as Error;
          return undefined;
        }
      });
      const defaultedData = isBatch
        ? payloadRows.map((row, i) =>
            this.initializeSummaryFields(
              object,
              this.applyFieldDefaults(object, row as Record<string, unknown>, opCtx.context, nowSnap, defaultPermissions[i]),
            ),
          )
        : this.initializeSummaryFields(
            object,
            this.applyFieldDefaults(object, payloadRows[0] as Record<string, unknown>, opCtx.context, nowSnap, defaultPermissions[0]),
          );
      // [#24619] The stored computed fields ({@link planStoredExpressions}),
      // computed over the defaulted row BEFORE the beforeInsert hooks run, so
      // a hook is handed the value the write stores — the #16344 ruling:
      // 「交给生命周期钩子的记录,就是它打算持久化的那条记录。」 Computed
      // again after the hooks and the strips (beside validation, below),
      // because a hook may change an input, and that pass is the one stored.
      const storedExpressionPlan = planStoredExpressions(this._registry.getObject(object));
      const storedExpressionServing: StoredExpressionServing = {
        permissionsFor: (plan, records) => this.resolveFormulaPermissions(object, plan, records, opCtx.context, permissionResolution),
        onFault: this.formulaFaultSink(object),
        relatedFor: (plan, records) => this.resolveFormulaRelated(this._registry.getObject(object), plan, records, opCtx.context),
        optionLabelsFor: (plan) => declaredOptionLabels(this._registry.getObject(object), plan),
      };
      if (storedExpressionPlan.length > 0) {
        const defaultedRows = (isBatch ? defaultedData : [defaultedData]) as Array<Record<string, unknown>>;
        const live = defaultedRows.filter((row, i) => undeclaredPerRow[i] === undefined && row != null && typeof row === 'object');
        const computed = await computeStoredExpressions(storedExpressionPlan, live, opCtx.context, storedExpressionServing);
        live.forEach((row, k) => Object.assign(row, computed[k]));
      }
      // [#22306] What each withheld key was SHOWN holding — its default, or
      // nothing — read before any hook runs, because the hooks mutate these
      // row objects in place. `handBackWithheldInsertReadonly` reads it to tell
      // "the hook left the default alone" from "the hook removed it".
      const insertShown: Array<ReadonlyMap<string, unknown> | undefined> =
        (isBatch ? (defaultedData as any[]) : [defaultedData]).map((row, i) => {
          const withheld = insertWithheld[i];
          if (!withheld || !row || typeof row !== 'object') return undefined;
          const shown = new Map<string, unknown>();
          for (const key of Object.keys(withheld)) {
            if (Object.prototype.hasOwnProperty.call(row, key)) shown.set(key, (row as Record<string, unknown>)[key]);
          }
          return shown;
        });

      // Batch inserts trigger beforeInsert/afterInsert PER ROW, each with the
      // exact single-record context shape (`input.data` = one row, `result` =
      // its returned record). A single array-shaped context broke every
      // consumer built for the single shape — the flat-input proxy read
      // `undefined`s, declarative `condition`s evaluated against an array,
      // audit rows and flow-trigger contexts came out mangled (#2922).
      //
      // [#6966] Which is exactly why the fan-out has to be STATED rather than
      // inferred: the shape is deliberately identical, so nothing about a
      // context tells a handler whether it is one row of a batch. The scratch
      // is created once per CALL and shared by every row's context, before and
      // after — see `HookContext.dispatch`.
      const insertScope: Record<string, unknown> = {};
      // ── [#14259] ARM the hook-write recording, one PER ROW ───────────────
      //
      // The insert-side twin of the update path's single recording (#14088),
      // and the reason it has to exist here at all: `stripRuntimeOwnedFields`
      // below judges hook-vs-caller by `Object.is`, which cannot separate "the
      // hook re-issued the record number the caller also submitted" from "the
      // hook never touched the key". #6339 moved that judgement from a key SET
      // to values on the argument that the key set made the contract true "only
      // BY ACCIDENT" — and values are accidental in the identical way.
      //
      // PER ROW, not per call: a batch runs `beforeInsert` once per row against
      // its own payload object, so one shared record would let a hook that
      // stamps row 3 exempt row 4's caller-seeded value. One recording per row
      // is what makes the answer mean "a hook assigned THIS key on THIS row".
      //
      // The two ends of the window are load-bearing, exactly as on the update
      // path (the recorder module's own header carries the full argument):
      //
      //  - ARMED HERE, over `defaultedData` — after the caller's payload has
      //    arrived, after `suppliedPerRow` snapshotted it, and after the
      //    engine's own defaulting (`applyFieldDefaults` /
      //    `initializeSummaryFields`) has run, so no engine default and no
      //    caller key can enter the record. A caller cannot execute an
      //    assignment; echoing a key, a value, a `null` or a `Proxy` back is
      //    not a `set` on this object.
      //  - SEALED immediately below, before the post-hook declared-field door
      //    reads the payload and long before `encryptSecretFields` writes to
      //    it. A recorder still armed for an engine-owned pass would report
      //    ENGINE writes as HOOK writes, which on a caller-forged secret column
      //    is precisely the escalation this is built to make impossible.
      //
      // Between those two points the only code that runs is the `beforeInsert`
      // dispatch — server code, by definition. Writes through the recording
      // land on the SAME row object, so a hook mutating `ctx.input.data.x` in
      // place is mutating the engine's row exactly as it always has.
      const rowHookWrites: Array<HookWriteRecording | undefined> = [];
      const rowHookContexts: HookContext[] = (isBatch ? (defaultedData as any[]) : [defaultedData]).map(
        (row, rowIndex) => {
          const recording =
            row !== null && typeof row === 'object'
              ? recordHookPayloadWrites(row as Record<string, unknown>)
              : undefined;
          rowHookWrites[rowIndex] = recording;
          return {
            object,
            event: 'beforeInsert',
            input: { data: recording?.payload ?? row, options: opCtx.options },
            dispatch: { mode: isBatch ? 'per-row' : 'record', index: rowIndex, scope: insertScope },
            session: this.buildSession(opCtx.context),
            provenance: this.buildProvenance(opCtx.context),
            user: this.buildUser(opCtx.context),
            api: this.buildHookApi(opCtx.context),
            transaction: opCtx.context?.transaction,
            ql: this.facade,
          };
        },
      );
      // [#8682] A row the declared-field door refused runs NO hook. In
      // non-partial mode the throw above already returned, so this skip only
      // ever fires for a culled row of a partial batch — where the whole point
      // is that one bad row costs the others nothing, and a hook that stamps a
      // ledger or calls out must not fire for a row that will never be written.
      for (let i = 0; i < rowHookContexts.length; i++) {
        if (undeclaredPerRow[i] !== undefined) continue;
        // [#22306] The update path's wrapper (commit 706ad0fcc), so a hook that
        // faults reaching THROUGH a key this row's hide withheld names that key
        // instead of surfacing as an anonymous crash. Byte-identical to a bare
        // dispatch whenever nothing was withheld or the hook refused on purpose.
        await dispatchHooksExplainingWithheldReadonly(insertWithheld[i], 'beforeInsert',
          () => this.triggerHooks('beforeInsert', rowHookContexts[i]));
      }
      // ── [#14259] SEAL, before anything engine-owned reads or writes a row ──
      //
      // Sealing does two things and the write is wrong without either: it
      // freezes each record before the engine's own passes can be mis-recorded
      // as hook writes, and it puts the RAW row back in `input.data` so no
      // recording view reaches a driver.
      //
      // Every row is sealed, including one the declared-field door culled: that
      // row ran no hook, so its record is legitimately EMPTY, and restoring its
      // raw payload keeps `rows[i]` a plain object on every branch rather than
      // only on the live ones.
      //
      // `hookWrittenKeys` is `undefined` — not empty — for a row whose hook
      // REPLACED the payload object (`ctx.input.data = { …ctx.input.data }`).
      // `stripRuntimeOwnedFields` must read that as "fall back to the #6339
      // value test", never as "no hook wrote anything": a replacement's keys
      // are mostly the CALLER's, so treating them as hook-owned would launder a
      // caller-seeded record number into a platform write.
      const rowHookWrittenKeys: Array<ReadonlySet<string> | undefined> = [];
      for (let i = 0; i < rowHookContexts.length; i++) {
        const sealed = rowHookWrites[i]?.seal(rowHookContexts[i]!.input.data);
        if (sealed) rowHookContexts[i]!.input.data = sealed.data as any;
        rowHookWrittenKeys[i] = sealed?.hookWrittenKeys;
      }

      // ── [#22306] HAND BACK what was withheld from beforeInsert ─────────────
      //
      // The other end of the pre-defaults pass, at the line where each row has
      // stopped being its hooks' (sealed above) and nothing engine-owned has
      // read it yet — the update path's confluence, row by row. AFTER the seal
      // so no hand-back can enter the record as a hook write, and BEFORE the
      // post-hook declared-field door so every pass from here down sees the
      // payload it saw before the hide existed, wherever no hook wrote the key.
      // The per-key rule is `handBackWithheldInsertReadonly`'s. A culled row is
      // handed back too: it ran no hook, so it gets its caller's row back whole.
      //
      // A withheld audit provenance value a hook stamped over (the audit
      // binder's `created_by`) is recorded per row (`insertSuperseded`) and
      // joins the strips' `readonly` drops: reported through `onFieldsDropped`
      // and refused under `strictReadonlyWrites`, like every reported drop.
      // See `handBackWithheldInsertReadonly`.
      const insertSuperseded: string[][] = rowHookContexts.map(() => []);
      for (let i = 0; i < rowHookContexts.length; i++) {
        const withheld = insertWithheld[i];
        if (!withheld) continue;
        const target = rowHookContexts[i]!.input.data as Record<string, unknown> | null | undefined;
        if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
        rowHookWrittenKeys[i] = handBackWithheldInsertReadonly(
          target, withheld, insertShown[i] ?? new Map(), rowHookWrittenKeys[i], insertSuperseded[i],
        );
      }

      // ── [commit b003cf2e8] The POST-hook half of the declared-field door ───────────
      //
      // #8737 moved the door above ahead of the hooks so that no work — no
      // autonumber, no secret row — is done for a payload about to be refused.
      // That is still right, and this does NOT move it (moving it re-opens
      // #8682). What it left uncovered is the payload the HOOKS produce: the
      // door judged the caller's keys, then `beforeInsert` ran and could add
      // any key at all, and from there the three drivers disagreed —
      // `memory` ACCEPTED and stored a shadow column, `driver-sql` threw a raw
      // `SQLITE_ERROR` with no `status`, `sqlite-wasm` threw a bare `Error`
      // with neither. One app, one hook, three meanings decided by which
      // driver a deployment happens to run.
      //
      // So the same function runs a second time over the POST-hook rows. Same
      // predicate, not a second one — a hook-written key and a caller-written
      // key are the same defect (`declared = enforced`, PD #10) and must read
      // identically to a caller: `INVALID_FIELD` / 400, on every driver.
      //
      // ## Why the platform's own stamps survive it
      //
      // The wildcard audit hook (`sys_stamp_audit_insert`, `object: '*'`, in
      // plugin.ts) writes `created_at` and `updated_at` UNCONDITIONALLY —
      // deliberately, because driver-sql creates those two as built-in columns
      // on every table whether or not the object declares them. They are
      // exactly two of `PLATFORM_PROVISIONED_COLUMNS`, which this function has
      // tolerated since #8682 for that same reason, so the platform's own
      // hook is covered by the tolerance that already existed rather than by
      // an exemption invented here. Its other three stamps (`created_by`,
      // `updated_by`, `tenant_id`) are each guarded by an explicit
      // `hasField(objectName, …)`, and every other before-hook that ships in
      // this repo either writes a DECLARED key or is structurally unable to
      // introduce one (pinyin's `__search` returns early unless the object
      // declares the companion; the storage file-reference pass rewrites only
      // keys already present). ⛔ Do not add a per-key exemption list here: the
      // tolerated set is the platform-provisioned one, and a hook that needs
      // more than that is writing a field its object should declare.
      //
      // ## Placement: immediately after the dispatch, before every producer
      //
      // #8682's rule applied one step in — a refusal must cost nothing — so
      // this runs before `resolveSystemInsertOrganization`, before the
      // credential channel (`encryptSecretFields` seals a `sys_secret` row),
      // before validation and before `applyAutonumbers`. Pre-statement, so the
      // driver is never reached: that is also what puts #8682's Half B
      // statement-and-values leak out of reach on this path, since both SQL
      // refusals only ever came from the driver's own error string.
      //
      // Merged into `undeclaredPerRow` rather than thrown directly so partial
      // mode behaves exactly as it does for a caller-written key: the row is
      // culled, its siblings are unaffected, and the seed into `rowErrors`
      // below happens before the first pass with a side effect. A row the
      // PRE-hook door already refused ran no hook, so its verdict is kept as
      // it stands — re-reporting it would replace the original error object
      // with an equal one for no reason.
      const postHookUndeclared = undeclaredWriteFieldErrors(
        object,
        this._registry.getObject(object) as { fields?: unknown } | undefined,
        rowHookContexts.map((rowCtx) => rowCtx.input.data),
      );
      for (let i = 0; i < postHookUndeclared.length; i++) {
        if (undeclaredPerRow[i] === undefined) undeclaredPerRow[i] = postHookUndeclared[i];
      }
      if (!partialRowMode) {
        const postRefusal = postHookUndeclared.find((e) => e !== undefined);
        if (postRefusal) throw postRefusal;
      }

      // ── [commit a016f08b8] EVERY VALUE-CHANGING PASS, AHEAD OF THE SEAM ──────────
      //
      // The two strips below used to run AFTER the seam, and the contract
      // review commit a016f08b8 records measured what that cost: a static-`readonly`
      // scoping field — the natural shape for a server-stamped column, and
      // exactly what an RLS `check` compares (ADR-0055) — was judged by the
      // seam with the CALLER’s value still on the row, then stripped and
      // re-defaulted, so the store received a value the seam never saw. The
      // row that was judged was not the row that was stored, which is this
      // card’s own defect one layer down.
      //
      // So both strips run HERE, ahead of the seam. Neither has a side
      // effect — they read `suppliedPerRow`, `rowHookWrittenKeys`, the
      // schema and `options`, all resolved above, and they log — so moving
      // them costs nothing and buys the seam the final row. What is left
      // between the seam and the driver is engine-owned and named in the
      // seam’s own comment below.
      //
      // ⚠️ The REPORTING half (`insertDropped` → `strictReadonlyWrites` /
      // `onFieldsDropped`) deliberately stays where it was, after the seam:
      // moving it too would put `ReadonlyFieldRejectedError` ahead of the
      // gate’s 403 and change which refusal a caller sees. The strips are
      // value-changing; their report is not.
      const schemaForValidation = this._registry.getObject(object);
      // Defaults are already resolved above (pre-hook, #2703); a hook may
      // have overridden fields or replaced `input.data` — take its data as-is.
      const rows = rowHookContexts.map((rowCtx) => rowCtx.input.data as Record<string, unknown>);
      // [#8682] Rows the declared-field door refused are already dead on
      // arrival — seeded before the strips, before the seam, and so before
      // the credential loop further down, which is the first pass with a
      // real side effect (`encryptSecretFields` seals a `sys_secret` row):
      // a culled row is neither stripped, nor judged, nor able to mint a
      // secret for a write that will never happen.
      const rowErrors: (unknown | undefined)[] = new Array(rows.length);
      for (let i = 0; i < rows.length; i++) rowErrors[i] = undeclaredPerRow[i];
      // [#5503] `autonumber` is RUNTIME-owned: the engine (or the driver's
      // persistent sequence) issues the value, so a non-system caller does not
      // get to supply or rewrite it. Until now nothing enforced that — a POST
      // carrying an explicit record number was stored verbatim, bypassing the
      // sequence, and the SQL driver's `supports.autonumber` path adopted it
      // too (it only fills a slot left empty). Stripping HERE, in the engine
      // and before `applyAutonumbers`, is what makes the fix driver-agnostic:
      // every driver — native-sequence or not — is handed a row with no
      // caller-supplied record number, so no driver had to change.
      //
      // Runs BEFORE validation on purpose: a value the caller was never
      // allowed to send must not be judged by the object's rules either (a
      // `format` rule on the field would otherwise 400 on a payload we are
      // about to discard). Symmetric with the UPDATE strip, which likewise
      // runs before `evaluateValidationRules`. Exemptions are the update
      // path's, unchanged: `isSystem` (seed replay, migration) skips the whole
      // pass, and `preserveAudit` (#3493) lets a historical import reinstate
      // legacy record numbers.
      //
      // [#6339] `suppliedPerRow[i]` is handed over WHOLE — values included —
      // rather than reduced to its key set. This pass runs after the
      // beforeInsert hooks, so a key set could only say "the caller named
      // this", and `delete` then took whatever value was standing there: a
      // hook that RE-ISSUES the record number lost its write to any caller
      // that had also submitted the key, while the same hook's write survived
      // on a caller that had not. The update path's twin (#5591).
      //
      // [#20922] Every key a caller-write strip takes is recorded twice, at
      // the strip: into the batch-level union (`insertDropped`, reported once
      // per call below, unchanged) and into the taking row's own list, which
      // `insertMany` hangs on that row's `ok` outcome. Per row because the
      // rows CAN differ (`hookWrittenKeys` is armed per row), so the union
      // cannot be resolved back to rows after the fact.
      const insertDropped: string[] = [];
      const insertDroppedPerRow: string[][] = rows.map(() => []);
      const recordInsertTaken = (i: number, taken: readonly string[]): void => {
        for (const k of taken) {
          if (!insertDropped.includes(k)) insertDropped.push(k);
          if (!insertDroppedPerRow[i]!.includes(k)) insertDroppedPerRow[i]!.push(k);
        }
      };
      if (!opCtx.context?.isSystem) {
        const preserveAudit = opCtx.context?.preserveAudit === true;
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          // [#8214] The insert side carries the same claim and the same
          // sequencing — this pass logs, the `ReadonlyFieldRejectedError`
          // below throws before any driver dispatch. Measured on
          // `origin/main`: `driverCreates 0` while the line said the write
          // was "COMMITTED WITHOUT IT". The card marked this half UNVERIFIED;
          // it reproduces, so the flag is threaded here too.
          // [#14259] `hookWrittenKeys` — THIS row's sealed record, the other
          // half of the same question `suppliedPerRow[i]` answers. #6339
          // handed values over instead of a key set because "the caller named
          // this key" and "this key still holds the caller's value" are
          // different facts; the record closes the case values cannot reach,
          // where the hook wrote the value the caller also sent. The value
          // test stays as the fallback for any row with no record.
          const stripped = stripRuntimeOwnedFields(
            schemaForValidation as any, rows[i], suppliedPerRow[i] ?? {}, this.logger,
            {
              preserveAudit,
              strictReadonlyWrites: options?.strictReadonlyWrites === true,
              hookWrittenKeys: rowHookWrittenKeys[i],
            },
          ) as Record<string, unknown>;
          if (stripped === rows[i]) continue;
          recordInsertTaken(i, Object.keys(rows[i]).filter((k) => !(k in stripped)));
          rows[i] = stripped;
          rowHookContexts[i].input.data = stripped;
        }
        // [#14147] STATIC author-declared `readonly`, enforced HERE — one
        // semantics, one enforcement point, per the maintainer ruling of
        // 2026-09-03 (option C) which SUPERSEDED the 2026-07-24 row "INSERT
        // (all callers) exempt". Until it landed, a non-system caller
        // reaching `engine.insert` DIRECTLY wrote a read-only column with no
        // refusal, no WARN and no `onFieldsDropped` event, while the very
        // same payload through the DataProtocol was stripped — and
        // `create_record`'s listener (`@objectstack/service-automation`) was
        // wired for a readonly drop it could never receive. The boundary copy
        // that produced that asymmetry (`stripReadonlyForInsert`,
        // metadata-protocol) is DELETED in the same change rather than kept
        // as a second implementation.
        //
        // The strip is {@link stripReadonlyFields} — the SAME function
        // `update` runs, under the SAME `isSystem` gate (the branch above),
        // reporting through the SAME channels: `readonlyStripWarning` at
        // `warn`, `onFieldsDropped` under reason `readonly`, and
        // `strictReadonlyWrites` refusing before any driver dispatch. Its
        // guards therefore come across too, and they are wider than the
        // deleted ingress copy's: a hook stamp is not caller-supplied
        // (`suppliedPerRow`), and a key a `beforeInsert` hook ASSIGNED is the
        // hook's write, not a forgery (`rowHookWrittenKeys`, #14259). The
        // ingress copy ran BEFORE the hooks and could judge neither.
        //
        // ⛔ `preserveAudit` is deliberately NOT forwarded — see
        // {@link preserveAuditIgnoredOnInsertWarning}: the 2026-08-08 ruling
        // narrowed that exemption to the UPDATE path and left `isSystem` as
        // the create side's only one. Ruling C moved WHERE this strip runs;
        // it did not widen WHAT exempts it.
        //
        // WHICH fields it may judge is {@link staticReadonlyInsertSubject}'s
        // (runtime-owned types belong to the pass above; the `sys_` namespace
        // and the PLATFORM-INTERNAL `managedBy` buckets to their own 403
        // guards — #15719 narrowed that second exclusion from "`managedBy` set
        // to anything", so a user-writable bucket is judged here exactly as it
        // is on update); `null` — no such field on this object — is the cheap
        // exit every ordinary insert takes.
        //
        // [#24822] ...without `organization_id` where the Layer 0 wall judges it
        // on this insert's stored rows (`wallJudgesOrganization`, read once
        // above for the withhold too). That value is stored as sent or refused
        // by the wall, never taken here and replaced by the active organization.
        // So it is not reported or refused under `strictReadonlyWrites` either:
        // strict refuses exactly what this strip takes.
        const readonlySubject = insertStaticReadonlySubject(schemaForValidation, wallJudgesOrganization);
        if (readonlySubject) {
          const preserveAuditIgnored: string[] = [];
          for (let i = 0; i < rows.length; i++) {
            if (rowErrors[i] !== undefined) continue;
            // [#20805] One door, two callers: `validate()` runs this same
            // method over its preview rows — see `staticReadonlyCreateStrip`.
            const pass = await this.staticReadonlyCreateStrip(
              object, readonlySubject, rows[i], suppliedPerRow[i] ?? {}, opCtx.context,
              {
                logger: this.logger,
                strictReadonlyWrites: options?.strictReadonlyWrites === true,
                hookWrittenKeys: rowHookWrittenKeys[i],
                nowSnap,
                permissionResolution,
              },
            );
            if (pass.row === rows[i] && pass.taken.length === 0) continue;
            recordInsertTaken(i, pass.taken);
            for (const k of pass.taken) {
              if (preserveAudit && !preserveAuditIgnored.includes(k)) preserveAuditIgnored.push(k);
            }
            if (pass.error !== undefined) {
              if (!partialRowMode) throw pass.error;
              rowErrors[i] = pass.error;
              continue;
            }
            rows[i] = pass.row;
            rowHookContexts[i].input.data = pass.row;
          }
          // One line per CALL, not per row, and only when the exemption was
          // ASKED FOR and something was actually removed. Per CALL because a
          // log line has no per-row slot: the union of what the batch lost is
          // the only view one line can represent — ⛔ NOT because every row
          // lost the same set. `hookWrittenKeys: rowHookWrittenKeys[i]` above
          // is armed per ROW and its only power is to turn a strip into a
          // KEEP, so a hook that stamps a protected key on some rows and not
          // others makes those rows lose DIFFERENT sets. Read a name in this
          // line as "at least one row lost this field", never "every row did".
          if (preserveAuditIgnored.length > 0) {
            this.logger.warn(preserveAuditIgnoredOnInsertWarning(object, preserveAuditIgnored));
          }
        }
      }

      // ── [commit a016f08b8] The INSERT POST-IMAGE seam ──────────────────────────────
      //
      // The enforcement layer's write `check` used to be evaluated in its
      // middleware, against `opCtx.data` — the caller's payload as it arrived.
      // For an `update` that is a merged pre-image, which is the row that will
      // exist; for an `insert` it is the row the caller ASKED for, and the
      // hooks above have since produced the row that will actually be stored.
      // So the judgement is made HERE, on `rowHookContexts[i].input.data` —
      // the same objects `rows` is built from below and the driver is handed.
      //
      // Placement obeys the rule #8682 wrote for the declared-field door and
      // commit b003cf2e8 restated for its post-hook half: a refusal must cost nothing.
      // This sits after that door and BEFORE every producer —
      // `resolveSystemInsertOrganization`, `encryptSecretFields` (which seals
      // a `sys_secret` row), `applyAutonumbers` (which CONSUMES a sequence
      // number), validation and the statement.
      //
      // ## What runs between here and the driver — stated, not waved at
      //
      // The contract review commit a016f08b8 records measured the version of this comment
      // that said "nothing between here and the driver adds a value the caller
      // could have steered" and then let TWO caller-steerable passes run after
      // the seam. Both now run ABOVE (`stripRuntimeOwnedFields` and the static
      // `readonly` strip with its re-default), which is why the seam judges the
      // row the driver is handed on every key a caller can reach. What is left
      // after this point is engine-owned, and it is a CLOSED list rather than a
      // reassurance:
      //
      //  - `resolveSystemInsertOrganization` + the driver's `injectTenantOnInsert`
      //    fill an ABSENT tenant column; an explicit value on the row is left
      //    alone, and after the strips above that value is a hook's or the
      //    caller's own organization. (The Layer 0 tenant wall still judges the
      //    PRE-hook image — filed separately, and the fix's host is this seam.)
      //  - `encryptSecretFields` replaces a `secret` field's plaintext with a
      //    `sys_secret` REFERENCE, and `applyAutonumbers` fills an autonumber
      //    the strips above just guaranteed the caller did not supply. Both
      //    substitute a platform-owned value for a caller-owned one; a `check`
      //    naming either field judges the caller's value and the store receives
      //    the platform's.
      //  - `normalizeMultiValueFields` coerces a declared multi-value field to
      //    its stored array shape.
      //  - [ADR-0142 D5] the assignment seam writes `owner_id` and `queue` onto a
      //    row whose owner and queue are both still EMPTY — routing chosen by a
      //    declared rule, never a value the caller supplied (a supplied one
      //    means the row is not evaluated at all).
      //
      // So the invariant this seam buys is stated to its real edge: a stored row
      // satisfies the insert `check` on every field the CALLER can steer. ⛔ It
      // is not "on every field", and writing it that way is what the review
      // caught. A policy whose `check` names an autonumber, a `secret` or the
      // tenant column is judging a value the platform is about to replace, and
      // that is a boundary rather than a guarantee.
      //
      // A culled row is skipped rather than judged: it will not be written, so
      // refusing it would replace one verdict with another for a row that has
      // already lost. `honoured` is set BEFORE `evaluate`, so a throwing check
      // still reads as honoured — the flag answers "did the seam run", never
      // "did the write pass".
      const postHookWriteImageCheck = opCtx.postHookWriteImageCheck;
      if (postHookWriteImageCheck) {
        postHookWriteImageCheck.honoured = true;
        const live: Record<string, unknown>[] = [];
        for (let i = 0; i < rowHookContexts.length; i++) {
          if (undeclaredPerRow[i] !== undefined) continue;
          live.push(rowHookContexts[i]!.input.data as Record<string, unknown>);
        }
        await postHookWriteImageCheck.evaluate(live);
      }

      // Thread the open transaction (if any) into the driver-facing
      // options so that knex's `.transacting(trx)` is honoured. Without
      // this, calls inside a `engine.transaction(...)` block would deadlock
      // on SQLite's single-connection pool. Also propagates tenantId so
      // the driver can enforce per-tenant isolation.
      // Base the merge on the first row context's options: hooks share the
      // same underlying options object (in-place mutations are visible), and
      // for single inserts this is exactly the pre-#2922 behaviour.
      //
      // [#8844] The system-context organization resolution runs HERE — after
      // the beforeInsert hooks (a hook that stamped the organization has
      // carried it) and before anything reads the resolved options: the
      // credential channel below, `applyAutonumbers`, and the driver dispatch
      // itself. It resolves to the SAME knob a session write sets
      // (`DriverOptions.tenantId`), so the driver stamps the column via
      // `injectTenantOnInsert` and its counter scopes by the real organization
      // instead of the `__global__` pseudo-tenant — one mechanism, both write
      // paths, and no driver had to change (which matters twice over here:
      // `fillAutoNumberFields` is duplicated in `driver-sql` and
      // `driver-turso`). `buildDriverOptions` preserves an explicitly-supplied
      // `base.tenantId`, so passing it in as the base is how the derived value
      // survives the merge.
      const derivedOrganizationId = await this.resolveSystemInsertOrganization(
        object,
        opCtx.context,
        rowHookContexts.map((rowCtx) => rowCtx.input.data as Record<string, unknown>),
      );

      // [ADR-0142 D5] The assignment seam — after every `beforeInsert` hook
      // and the organization the row lands in, before the write. It writes
      // `owner_id` / `queue` onto a row whose owner and queue are both still
      // empty, as the platform, and never refuses: see `assignment-rules.ts`.
      // An engine-owned producer like the two above, so the post-hook `check`
      // (judged above, on the row as the hooks left it) does not see the owner
      // a rule picks — that owner is the platform's routing, not the caller's
      // steering. Free for every object no rule can name (`mayRoute` is a
      // registry read: a declared rule names the object, or organizations can
      // author rules and the object carries the queue column they route by).
      {
        const evaluator = this.assignment();
        if (evaluator.mayRoute(object)) {
          const activeOrg = opCtx.context?.tenantId ? String(opCtx.context.tenantId) : null;
          const candidates = [];
          for (let i = 0; i < rows.length; i++) {
            if (rowErrors[i] !== undefined) continue;
            const row = rows[i];
            if (!row || typeof row !== 'object') continue;
            const own = (row as Record<string, unknown>).organization_id;
            const organizationId = own != null && own !== '' ? String(own) : activeOrg ?? derivedOrganizationId ?? null;
            candidates.push({ row: row as Record<string, unknown>, organizationId });
          }
          await evaluator.apply(object, candidates);
        }
      }
      const optionsBase = rowHookContexts[0]?.input.options as any;
      const driverOptions = this.buildDriverOptions(
        object,
        opCtx.context,
        derivedOrganizationId !== undefined
          ? { ...(optionsBase && typeof optionsBase === 'object' ? optionsBase : {}), tenantId: derivedOrganizationId }
          : optionsBase,
        // The active organization is where the row LANDS, in every posture —
        // not a read scope (ADR-0131 D8 leaves the write target alone).
        { writeTarget: true },
      );
      // Every driver call below is handed `driverOptions` — the declared driver
      // options and nothing else; the hooks keep their additive view of the bag.
      const hookOptions = mergeDriverOptionsIntoHookView(optionsBase, driverOptions);
      for (const rowCtx of rowHookContexts) {
        rowCtx.input.options = hookOptions;
      }
      // [#27495] The credential rows each row's secret fields are sealed into,
      // and the ones this write has actually written to `sys_secret`.
      const sealedSecrets: PendingSecretRow[][] = rows.map(() => []);
      const writtenSecrets: PendingSecretRow[] = [];

      try {
        let result: any;
        // When the driver generates autonumbers natively (persistent SQL
        // sequence), the engine defers to it — see #1603.
        const driverOwnsAutonumber = (driver as any)?.supports?.autonumber === true;
        // Partial-success mode (framework#3172, entered via insertMany): a row
        // that fails validation is culled and reported per-row instead of
        // aborting the whole batch — so a bulkWrite caller never needs the
        // whole-batch degradation that re-runs beforeInsert hooks on the good
        // rows. rowErrors[i] set = row i is dead; only live rows reach the
        // driver / afterInsert / summaries.
        const partialMode = partialRowMode;
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          try {
            // [#8559] Both halves of the credential write door, per row: the
            // password refusal at its own seam, then the secret channel (which
            // carries the secret-arm refusal). Same try, so partial mode
            // reports either refusal per-row instead of killing the batch.
            this.refuseEmptyPasswordFields(object, rows[i]);
            // [#27582] A new record holds no ref of its own: no stored rows.
            sealedSecrets[i] = await this.encryptSecretFields(object, rows[i], opCtx.context, driverOptions, async () => []);
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // Resolved once for the whole batch; dormant unless the object declares
        // a media field, and memoized after the first object that does.
        const mediaValueShapeStrict = await this.mediaValueShapeStrictFor(schemaForValidation);
        const valueShapeStrict = await this.valueShapeStrictFor(schemaForValidation);
        // [#4769] Where a warn-first admission is recorded, so this boot cannot
        // go on to certify a contract it has just written data against.
        const onAdmittedValueShapeViolation = this.admittedViolationSink(object);
        // Locale + translation hooks for the rejection messages (#3957) —
        // resolved once for the batch, identical for every row.
        const msgCtx = this.validationMessageContext(object, opCtx.context);
        // [#3407 / #5126] This is the strip site both standing notes on
        // `insert()` pointed at, so both members of `WriteObservabilityOptions`
        // discharge here — the same one-per-call choice `update` offers, and by
        // the same rule #5126 wrote down: strict adds NO second policy, it
        // refuses exactly what the strip would have taken. A value the strip
        // does not take is not rejected either, so an `isSystem` write and a
        // `preserveAudit` historical import stay accepted under strict — they
        // never reach this branch on a read-only value. ([#20805] A `formula`
        // value does reach it in every context: the computed strip takes it
        // from an `isSystem` write too, so strict refuses it there as well.)
        //
        // Reported under the existing `readonly` reason: from the caller's side
        // an implicitly read-only field is dropped for exactly the reason a
        // declared one is, and inventing a parallel reason code would fork the
        // vocabulary (`packages/spec`) for a distinction no consumer acts on.
        //
        // [#20805] The computed-field door's strip reports HERE too, under its
        // own `computed` reason — it is no lock, and it runs in every context,
        // so `readonly` would lie about it. One event per reason, in the order
        // the strips ran; a payload with no `formula` key reports exactly what
        // it did before.
        //
        // [#24619] The stored computed fields, computed over the FINAL rows —
        // after every hook and strip, before validation judges them and the
        // driver stores them — so the stored value is the declared expression
        // over the stored row, whatever the caller or a hook put in the key.
        // [#24690] Computed HERE, ahead of the report, because a caller value
        // the computation replaces is reported too, under `stored_expression`
        // (`replacedStoredExpressionFields`). A key a strip above already took
        // is that strip's report.
        //
        // [#25000] REFUSED under `strictReadonlyWrites` like every other
        // strip's drop: the strict contract follows what `onFieldsDropped`
        // reports, and a replaced value is one (the amended ruling 「甲」 ships
        // the refusal in 18.x). So the strict check judges the strips' drops
        // AND the replacement, AFTER the computation — one refusal names
        // everything the write would have taken or replaced, rather than a
        // round-trip per class. The computation writes nothing (it evaluates
        // over copies and assigns onto the in-memory rows), so the refusal
        // still lands before validation and before any driver dispatch.
        // [#32278] The `readonly` drops the write reports and strict refuses:
        // the static strip's, plus every audit provenance value a stamp wrote
        // over (`insertSuperseded`) on a row that is written.
        const readonlyReported = (): string[] => {
          const out = [...insertDropped];
          insertSuperseded.forEach((keys, i) => {
            if (rowErrors[i] !== undefined) return;
            for (const k of keys) if (!out.includes(k)) out.push(k);
          });
          return out;
        };
        const storedExpressionReplaced: string[] = [];
        const storedExpressionReplacedPerRow: string[][] = rows.map(() => []);
        if (storedExpressionPlan.length > 0) {
          const liveIndexes = rows
            .map((row, i) => (rowErrors[i] === undefined && row != null && typeof row === 'object' ? i : -1))
            .filter((i) => i >= 0);
          let computed: Array<Record<string, unknown>>;
          try {
            computed = await computeStoredExpressions(
              storedExpressionPlan, liveIndexes.map((i) => rows[i] as Record<string, unknown>), opCtx.context, storedExpressionServing,
            );
          } catch (err) {
            // A pass that THROWS is pre-empted by the strict verdict on the
            // strips' drops (#5126's ordering — the check used to sit ahead
            // of this pass), then rethrown.
            const stripDrops = droppedFieldEvents(object, computedDropped, readonlyReported());
            if (stripDrops.length > 0 && options?.strictReadonlyWrites === true) {
              throw new ReadonlyFieldRejectedError(
                object, [...new Set(stripDrops.flatMap((d) => d.fields))], stripDrops, 'insert',
              );
            }
            throw err;
          }
          liveIndexes.forEach((i, k) => {
            const row = rows[i] as Record<string, unknown>;
            const taken = insertDroppedPerRow[i] ?? [];
            const replaced = replacedStoredExpressionFields(storedExpressionPlan, suppliedPerRow[i], row, [computed[k]!])
              .filter((name) => !taken.includes(name));
            Object.assign(row, computed[k]);
            storedExpressionReplacedPerRow[i] = replaced;
            for (const name of replaced) if (!storedExpressionReplaced.includes(name)) storedExpressionReplaced.push(name);
          });
        }
        const insertDrops = droppedFieldEvents(object, computedDropped, readonlyReported(), storedExpressionReplaced);
        if (insertDrops.length > 0 && options?.strictReadonlyWrites === true) {
          // Before the driver write and before validation — nothing is
          // written, and "you sent a runtime-owned field" should not depend on
          // whether some other field also failed a business rule (#5126's
          // ordering on the update path, mirrored).
          throw new ReadonlyFieldRejectedError(
            object, [...new Set(insertDrops.flatMap((d) => d.fields))], insertDrops, 'insert',
          );
        }
        if (insertDrops.length > 0 && typeof options?.onFieldsDropped === 'function') {
          // A strict write never reaches here with a drop (refused above), so
          // the listener hears only a write that completes. A REFUSED write
          // never fires the listener: it did not complete.
          for (const drop of insertDrops) {
            try {
              options.onFieldsDropped(drop);
            } catch (err) {
              this.logger.warn('onFieldsDropped listener threw — ignored', { object, error: err });
            }
          }
        }
        // [ADR-0144 D5] The write-time home projection — after every hook,
        // strip and re-default, so the values it writes are the ones stored
        // (a `readonly` strip never takes them, and a `defaultValue` on the
        // home or rate field never stands), and before validation, which then
        // judges them like any other stored value (the rate field's `scale`
        // included). In every context: a system writer's value for either
        // field is recomputed over too. A row it refuses (no home currency, no
        // rate in force on the document date) is culled per row under partial
        // mode, and nothing is written for it. Free for an object declaring no
        // `homeAmount` (`planHomeAmounts` is one loop over the field names).
        const homeAmountPlan = planHomeAmounts(schemaForValidation);
        const homeServing = this.homeAmountServing(opCtx.context);
        // [ADR-0144 D2, amended] A child amount that follows its parent's code
        // reads it from the parent: ONE read per master_detail for the whole
        // batch, laid on a copy of each row for the projection below and the
        // blank-code guard in the validation loop. Free (nothing is read) for
        // an object whose amounts name a sibling code or none.
        const followCodes = await followParentCurrencyCodes(
          recordCurrencyPairs((schemaForValidation as { fields?: unknown } | undefined)?.fields),
          rows.filter((_, i) => rowErrors[i] === undefined) as Array<Record<string, unknown>>,
          homeServing.parentRows,
        );
        if (homeAmountPlan.length > 0) {
          for (let i = 0; i < rows.length; i++) {
            if (rowErrors[i] !== undefined) continue;
            const row = rows[i] as Record<string, unknown> | null | undefined;
            if (!row || typeof row !== 'object') continue;
            try {
              Object.assign(row, await projectHomeAmounts(homeAmountPlan, followCodes(row), homeServing, {
                object,
                operation: 'insert',
                organizationId: ObjectQL.homeAmountOrganizationOf(row, opCtx.context, derivedOrganizationId),
              }));
            } catch (e) {
              if (!partialMode) throw e;
              rowErrors[i] = e;
            }
          }
        }
        // [#4977] A `parent`-scoped `requiredWhen` ("once the header is Sent,
        // every line must carry a description") is a SERVER guarantee, and the
        // insert is where a line is first written empty — so unlike the
        // `readonlyWhen` strip, which is an update-path concept, this binding
        // has to exist here too. Gated on the schema actually declaring such a
        // predicate, so an object with only `record`-scoped requirements pays
        // nothing; batched, so N rows under M masters cost ONE header read.
        const insertParentForRow = hasParentScopedRequiredWhen(schemaForValidation as any)
          ? await this.resolveMasterDetailParents(schemaForValidation, null, rows, opCtx.context)
          : undefined;
        // [#18682] The related rows this object's predicate rules read one hop
        // through a reference field. Batched across the whole insert, and free
        // when no rule traverses. Read under SYSTEM authority, bounded by the
        // projection — see `resolvePredicateRelated`.
        const insertRelatedForRow = await this.resolvePredicateRelated(schemaForValidation, rows, opCtx.context);
        // [#25579] Batch equals one-by-one: the related rows above were read
        // ONCE, before any row of this batch is written, so a rule reading a
        // parent roll-up would judge every row against the summary as it stood
        // before the batch. The rows the rules admit are accumulated in memory
        // and overlaid on each later row's binding — never re-read per row.
        // `undefined` (no roll-up aggregates this object exactly) pays nothing.
        const batchSummaries = rows.length > 1
          ? createBatchSummaryAccumulator(this.getSummaryDescriptors(object), (schemaForValidation as any)?.fields)
          : undefined;
        // [#18783] The subject's effective object permissions, for an option
        // gated on `current_user.can(…)`: ONE resolution for the whole batch,
        // and none at all unless a row picks such an option. A resolution
        // failure refuses exactly the rows that needed it (per-row under
        // partial mode, like every other row error here).
        const insertPermissionsFor = await this.resolveOptionPermissions(
          schemaForValidation, rows.filter((_, i) => rowErrors[i] === undefined), permissionResolution,
        );
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          try {
            // [#21663] `'include'`: the readonly strip ran above, so every
            // readonly value still on the row is one the driver will store —
            // a system writer's (seed, migration), a hook's or a stamp — and
            // its SHAPE is judged here like any other field's. See
            // `ReadonlyValueScope` (record-validator.ts).
            normalizeMultiValueFields(schemaForValidation, rows[i], 'include');
            // [#22183] `keptOptionValues`: the option values an import kept for this write.
            validateRecordInScope(schemaForValidation, rows[i], 'insert', 'include', { mediaValueShapeStrict, valueShapeStrict, messages: msgCtx, onAdmittedValueShapeViolation, keptOptionValues: opCtx.context?.keptOptionValues });
            // [ADR-0144 D8 rule 4] A `record`-mode amount is stored with its
            // currency code, or the row is refused (`ERR_CURRENCY_CODE_REQUIRED`).
            // [ADR-0144 D2, amended] A child amount's code is its parent's, laid on a copy of the row.
            assertRecordCurrencyCodes(object, (schemaForValidation as { fields?: unknown } | undefined)?.fields, rows[i] && typeof rows[i] === 'object' ? followCodes(rows[i]) : rows[i], 'insert', undefined, undefined, msgCtx);
            // [#29029] A write that is not a system write has its references
            // checked BEFORE the record's validation rules: a reference the
            // caller cannot read answers `reference_not_found`, whatever a rule
            // would answer. A system write keeps the rules first
            // (`referencesCheckedBeforeRules`).
            const referencesFirst = referencesCheckedBeforeRules(opCtx.context);
            const checkReferences = () => this.assertReferencesResolve(
              schemaForValidation, rows[i], suppliedPerRow[i], opCtx.context, msgCtx,
            );
            if (referencesFirst) await checkReferences();
            emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(schemaForValidation as any, rows[i], 'insert', { logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: msgCtx, parent: insertParentForRow?.(rows[i]), related: batchSummaries ? batchSummaries.overlay(insertRelatedForRow(rows[i])) : insertRelatedForRow(rows[i]), permissions: insertPermissionsFor(rows[i]) }), this.logger, object);
            if (!referencesFirst) await checkReferences();
            // [#25579] Admitted: a later row of this batch reads it in the summary.
            batchSummaries?.accept(rows[i]);
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // Autonumbers are assigned AFTER validation (framework#3152): in the
        // batch path a bulkWrite retry / per-row degradation re-runs the whole
        // engine.insert, and a batch that dies in validation would otherwise
        // have already consumed a sequence value for every good row on the
        // failed attempt, leaving gaps. Required-validation exempts autonumber
        // fields either way (they are engine-assigned), and a driver that owns
        // autonumber issues here only through `issueAutonumbers` (#25073), at
        // this same point — so no validation rule can depend on the value,
        // making this reorder safe. In partial mode dead rows are skipped, so
        // they never consume a sequence value either.
        // [#6806] What each row's autonumbers were ISSUED from, so a
        // unique-violation on the write below can be attributed to a counter
        // and answered by re-seeding it. Empty for every row when the driver
        // owns autonumber, and for any row the engine numbered nothing on.
        const issuedPerRow: IssuedAutonumber[][] = new Array(rows.length).fill(null).map(() => []);
        // [#25073] A stored field whose `expression` reads the record number
        // was computed above, before the number existed. Where the ENGINE
        // issues (the fallback drivers) it is computed again right after
        // `applyAutonumbers`. Where the DRIVER owns the counter, the number
        // used to appear only inside `create()`, too late for anything to read
        // it, so for an object with such a field the driver is asked for it
        // HERE, at the same point after validation, through
        // `IDataDriver.issueAutonumbers`; the row then reaches `create()` /
        // `bulkCreate()` carrying it, and the write stays one statement. An
        // object no stored expression reads a number on keeps the driver's
        // own issue-at-write path, unchanged (and its in-driver batch re-seed,
        // #6943, which the engine cannot take over: it never re-issues a batch).
        const autonumberReaders: AutonumberReaders | undefined = (() => {
          const plan = storedExpressionsReading(storedExpressionPlan, autonumberFieldNames(schemaForValidation));
          if (plan.length === 0) return undefined;
          const listeners = [...this.insertRecomputeListeners.values()];
          const recomputed = listeners.length === 0 ? undefined : async (row: Record<string, unknown>, fields: string[]) => {
            for (const listener of listeners) await listener({ object, row, fields });
          };
          return { plan, execCtx: opCtx.context, serving: storedExpressionServing, recomputed };
        })();
        const issueThroughDriver = driverOwnsAutonumber && autonumberReaders !== undefined
          && typeof (driver as any)?.issueAutonumbers === 'function';
        if (driverOwnsAutonumber && autonumberReaders !== undefined && !issueThroughDriver) {
          this.warnAutonumberReadersUnserved(object, autonumberReaders.plan, driver);
        }
        // [#25073] The fields the DRIVER issued on each row, through the member.
        const driverIssuedPerRow: string[][] = rows.map(() => []);
        for (let i = 0; i < rows.length; i++) {
          if (rowErrors[i] !== undefined) continue;
          try {
            if (issueThroughDriver) {
              driverIssuedPerRow[i] = (await (driver as any).issueAutonumbers(object, [rows[i]], driverOptions))?.[0] ?? [];
            } else {
              issuedPerRow[i] = await this.applyAutonumbers(object, rows[i], opCtx.context, driverOwnsAutonumber);
            }
          } catch (e) {
            if (!partialMode) throw e;
            rowErrors[i] = e;
          }
        }
        // [#25073] The readers, computed again over every live row that now
        // carries a number it did not carry when they were last computed.
        await recomputeAutonumberReaders(
          autonumberReaders,
          rows.filter((_, i) => rowErrors[i] === undefined && (issuedPerRow[i].length > 0 || driverIssuedPerRow[i].length > 0)),
        );
        // Live rows = the ones that survived per-row preparation. In
        // non-partial mode rowErrors is all-empty, so this is exactly `rows`.
        const liveIndexes: number[] = [];
        for (let i = 0; i < rows.length; i++) if (rowErrors[i] === undefined) liveIndexes.push(i);
        const liveRows = liveIndexes.map((i) => rows[i]);
        // [#27495] The live rows' credential rows, and only theirs, written now:
        // every pass that can refuse a row has run, so a refused write or a
        // culled row never reaches `sys_secret`. A statement that then fails
        // takes them back in the `catch` below.
        await this.persistSecretRows(liveIndexes.flatMap((i) => sealedSecrets[i]), writtenSecrets);
        if (isBatch) {
          if (liveRows.length === 0) {
               result = [];
          } else {
            // [#6806] A batch is re-seeded but never re-issued. `bulkCreate` may
            // be partially applied by a driver without a transaction, so
            // re-writing the batch could DUPLICATE the rows that did land —
            // strictly worse than the collision. What must not survive is the
            // stale counter: leaving it is what makes the very next insert
            // collide too, one number at a time, which is the storm. So the
            // counters this batch drew on are dropped and the batch is NOT
            // re-issued.
            //
            // [#14095] What is rethrown is no longer the driver's raw error.
            // The batch door answers the same contract as the single-row one:
            // a recognised unique violation leaves as the `DUPLICATE_RECORD`
            // envelope carrying the driver's error as `cause`, and everything
            // else leaves untouched. A batch caller reading these errors —
            // bulkWrite's per-row degradation, the import runner — reads a
            // BETTER answer than before, because the row report's `code` was
            // previously whatever dialect token the driver happened to use
            // (`SQLITE_CONSTRAINT_UNIQUE`, `11000`), which is precisely the
            // coupling this card exists to remove.
            //
            // What an author gets, stated plainly: `insert(object, rows[])` and
            // `insertMany` both REJECT with `DUPLICATE_RECORD` — never
            // `ERR_AUTONUMBER_COLLISION`, which remains the single-row path's
            // identity for "re-issued and still refused". Whether any row was
            // written is the driver's answer, not this method's. The one thing
            // the engine guarantees is that the NEXT write re-seeds instead of
            // walking into the same collision, so a retry by the caller
            // converges. Pinned in engine-autonumber-resync.test.ts.
            try {
              if (driver.bulkCreate) {
                result = await driver.bulkCreate(object, liveRows, driverOptions);
              } else {
                // Fallback loop
                result = await Promise.all(liveRows.map((item) => driver.create(object, item, driverOptions)));
              }
            } catch (error) {
              const batchIssued = liveIndexes.flatMap((i) => issuedPerRow[i]);
              if (this.isIssuedAutonumberCollision(error, batchIssued)) {
                for (const one of batchIssued) this.autonumberCounters.delete(one.counterKey);
                this.logger.warn('Autonumber collided in a batch insert — counter dropped, batch not re-issued', {
                  object, fields: [...new Set(batchIssued.map((one) => one.field))],
                });
              }
              // [#25073] The same answer for numbers the driver issued: the
              // member re-seeds the counters it proves stale, and the batch is
              // not re-issued, for the reason above.
              if (liveIndexes.some((i) => driverIssuedPerRow[i].length > 0)) {
                const emptied: string[][] = (await (driver as any).issueAutonumbers(object, liveRows, driverOptions, error)) ?? [];
                if (emptied.some((fields) => fields.length > 0)) {
                  this.logger.warn('Autonumber collided in a batch insert — counter re-seeded, batch not re-issued', {
                    object, fields: [...new Set(emptied.flat())],
                  });
                }
              }
              throw envelopeDriverWriteRefusal(error, object, this.getSchema(object), 'insert', msgCtx);
            }
          }
        } else {
          result = await this.createWithAutonumberResync(
            driver, object, liveRows[0], driverOptions, issuedPerRow[liveIndexes[0]],
            opCtx.context, driverOwnsAutonumber, driverIssuedPerRow[liveIndexes[0]], autonumberReaders,
          );
        }

        // Driver-result contract guard (framework#3151): a batch write must
        // return one record per input row. A short / non-array return would
        // otherwise be padded with `undefined` below and fed to afterInsert
        // hooks (`ctx.result === undefined`) and back to the caller as phantom
        // records — corrupting seed externalId→id maps and import undo logs.
        // Refuse it: throw so the caller sees a real failure rather than
        // silent data loss. (Every driver in this repo already returns
        // one-per-row in order; this defends against third-party drivers.)
        if (isBatch && (!Array.isArray(result) || result.length !== liveRows.length)) {
          throw Object.assign(
            new Error(
              `bulkCreate for '${object}' returned ${
                Array.isArray(result) ? `${result.length} record(s)` : String(typeof result)
              } for ${liveRows.length} input row(s) — refusing to fabricate afterInsert contexts`,
            ),
            { code: 'ERR_BULK_RESULT_MISMATCH' },
          );
        }

        // [#21613] A write's returned row is a served row, so it carries the
        // read verbs' default projection: the DECLARED field set
        // (`declared-read-columns.ts`). A table column no metadata declares —
        // a field retired in an upgrade, whose column additive sync leaves
        // behind — rides back in `returning('*')` on driver-sql, and on a new
        // row it reads null. Shaped HERE, on the rows as the driver returned
        // them and after the one-row-per-input guard, so the formulas, the
        // `afterInsert` hooks, the roll-up, the `data.record.created` events
        // (and the webhooks that deliver them), the partial-mode outcomes and
        // the door's own ingress strip all see the declared record — one
        // decision for every door, never a per-door strip. Declared fields
        // keep their treatment: `internal: true` fields stay whole on this
        // engine-level result (the A-prime ruling, below), because an
        // undeclared column is no field at all.
        const declaredInsertColumns = declaredColumnSet(schemaForValidation);
        result = isBatch
          ? rowsWithDeclaredColumnsOnly(result as unknown[], declaredInsertColumns)
          : withDeclaredColumnsOnly(result, declaredInsertColumns);
        // [#29538] …and answered on every stored declared column, as the next
        // read of the row answers it (#29408): a column the driver did not
        // echo (driver-mongodb and driver-memory store only written keys) is
        // `null`. A write names no projection, so it selects the whole stored
        // record. Before the formulas, so a formula over an unwritten column
        // evaluates against `null` as the read's does; inside the verb, so the
        // security middleware's field mask still deletes an FLS-refused key.
        // A column the row's payload carried a value for is stored, so it is
        // never answered `null`: a driver that did not echo it leaves it
        // absent (`storedColumnsLeftUnwritten`). Rows pair with `liveRows` by
        // index, which the one-row-per-input guard above holds.
        const insertAnswerColumns = selectedStoredColumns(schemaForValidation, undefined);
        result = isBatch
          ? (result as unknown[]).map((row, i) =>
              withSelectedColumnsAnswered(row, storedColumnsLeftUnwritten(insertAnswerColumns, liveRows[i])))
          : withSelectedColumnsAnswered(result, storedColumnsLeftUnwritten(insertAnswerColumns, liveRows[0]));

        // Coerce `boolean` fields (SQLite/libsql return 0/1) to real booleans on
        // the after-hook view so flow trigger conditions (`record.is_escalated
        // != true`) and `{record.<bool>}` interpolation see JS booleans, not
        // ints. A shallow copy — the value returned to the caller is untouched.
        // Only live rows have results — dead (partial-mode) rows never reach
        // afterInsert.
        const resultRows: any[] = isBatch ? (Array.isArray(result) ? result : [result]) : [result];
        // [#5504] Evaluate `formula` virtual fields onto what this write hands
        // back, so a create response is the same materialization the following
        // GET produces. Placed HERE for three reasons, all load-bearing:
        //  - AFTER every strip / refusal above (#5503's runtime-owned strip,
        //    #5126's `strictReadonlyWrites` throw): a payload the engine
        //    refuses never reaches a driver, so there is nothing to hydrate,
        //    and a stripped field must not reappear via a formula that read it.
        //  - AFTER the bulk contract guard, so `resultRows` is already known to
        //    be one row per live input row — no `undefined` slot to evaluate a
        //    formula against.
        //  - BEFORE the afterInsert dispatch, mirroring the read path's
        //    `applyFormulaPlan` → `afterFind` order. An after-hook therefore
        //    observes the same complete record on a write as it does on a read,
        //    and — because `coerceBooleanFields` copies the row it is handed —
        //    the caller-facing `rowCtx.result` carries the values too.
        // Batch (`insertMany` / `createManyData`) is covered by construction:
        // one hydration pass over every returned row, not one per call site.
        await hydrateWriteFormulas(
          schemaForValidation, resultRows, opCtx.context,
          (plan, records) => this.resolveFormulaPermissions(object, plan, records, opCtx.context, permissionResolution),
          this.formulaFaultSink(object),
          (plan, records) => this.resolveFormulaRelated(schemaForValidation, plan, records, opCtx.context),
          // [#26608] The 201 body is what the save toast names the record from.
          (plan) => this.formulaOptionLabels(schemaForValidation, plan, opCtx.context),
        );
        for (let k = 0; k < liveIndexes.length; k++) {
          const rowCtx = rowHookContexts[liveIndexes[k]];
          rowCtx.event = 'afterInsert';
          rowCtx.result = coerceBooleanFields(schemaForValidation as any, resultRows[k] as any);
          await this.triggerHooks('afterInsert', rowCtx);
          // [#7642] The 201 create body is the surface most likely to be missed
          // on this card, and the one no read-path fix reaches: `createData`
          // returns `engine.insert`'s value verbatim as `record`, so the
          // companion the `beforeInsert` stamp just wrote came straight back to
          // the client. A write has no projection to consult, so there is no
          // "asked for it by name" case to honour — the strip is unconditional.
          // AFTER the hook dispatch, matching the read path: `afterInsert`
          // handlers still observe the whole stored row.
          stripSearchCompanion(rowCtx.result);
          // [#7823] `internal` fields are deliberately NOT stripped here. An
          // earlier revision omitted them from this create result (#7728's
          // "two write-response sites"), which conflated two different
          // guarantees: "never returned on the generic data path" (the flag's
          // sentence) and "never returned to the engine-level caller that
          // performed the write". For `sys_session.token` those are OPPOSITE
          // requirements — better-auth's `createWithHooks` reads the minted
          // session row back off exactly this result, so the strip here broke
          // `signIn`/`signUp` outright (measured: `verify signIn: no token in
          // response`). Maintainer ruling 2026-08-13 (A-prime, #7823): the
          // write-response strip lives at the GENERIC-DATA-PATH INGRESS —
          // `omitInternalFieldsFromWriteResponse` in
          // `@objectstack/metadata-protocol`, applied by every `*Data` write
          // face and held there by a tripwire test — while engine-level write
          // results keep the stored row whole for the privileged server-side
          // caller that just wrote it. The generic READ path is unchanged:
          // {@link omitInternalFields} still runs on every find/findOne.
        }

        // Roll-up: recompute parent summary fields that aggregate this object.
        const summaryFailures = await this.recomputeSummaries(object, result, null, opCtx.context);

        // Publish one data.record.created DataEvent per written record (#4626).
        // A batch insert is N record events, not one event about N records —
        // `DataEvent.recordId` is per record.
        if (this.realtimeService) {
          const createdRows: any[] = Array.isArray(result) ? result : [result];
          for (const record of createdRows) {
            await this.publishDataEvent('created', object, {
              recordId: record?.id,
              after: record,
              // [#14970] The written row names its own organization.
              organizationRow: record,
              context: opCtx.context,
            });
          }
        }

        // Return the (possibly hook-mutated) after-view: the array of per-row
        // results for batch, the single record otherwise. In partial mode the
        // batch return is instead one outcome PER INPUT ROW ({ok,record} /
        // {ok:false,error}), in input order (framework#3172).
        //
        // [#20922] An `ok` outcome also carries what the strips took from
        // THAT row (`droppedFields`, absent when nothing was taken), from
        // their own per-row record — the same report `validate` answers the
        // row's dry run with. A failed outcome carries none: its write did
        // not complete, and a drop is "completed without them".
        const written = isBatch
          ? (partialMode
              ? rows.map((_r, i): InsertManyRowOutcome => {
                  if (rowErrors[i] !== undefined) return { ok: false as const, error: rowErrors[i] };
                  const rowReadonly = [...(insertDroppedPerRow[i] ?? [])];
                  for (const k of insertSuperseded[i] ?? []) if (!rowReadonly.includes(k)) rowReadonly.push(k);
                  const droppedFields = droppedFieldEvents(
                    object, computedStrip.droppedPerRow[i] ?? [], rowReadonly,
                    storedExpressionReplacedPerRow[i] ?? [],
                  );
                  return {
                    ok: true as const,
                    record: rowHookContexts[i].result,
                    ...(droppedFields.length > 0 ? { droppedFields } : {}),
                  };
                })
              : rowHookContexts.map((rowCtx) => rowCtx.result))
          : rowHookContexts[0].result;
        // Records ARE written; a summary that could not be recomputed after
        // retries must not be silent (framework#3147). Thrown after realtime
        // publish, carrying the written records so a bulk caller (seed/import)
        // can treat it as a warning rather than re-writing.
        if (summaryFailures.length > 0) throw new SummaryRecomputeError(summaryFailures, written);
        return written;
      } catch (e) {
        // [#8682] Same message, same ERROR level, same `object` — only the
        // driver's inlined statement and its bound values are cut, from BOTH
        // `message` and `stack` (the logger serializes exactly those two, and
        // the stack re-opened with the statement a second time). What the
        // database itself said, including the failing column, is kept. See
        // `redactBoundStatement`. [#21274] The error rethrown below is cut too,
        // but one frame out, where it leaves the engine (`executeWithMiddleware`),
        // so this line is still computed from the raw error and is unchanged.
        //
        // [#14095] …and the line still carries what the DATABASE said, even now
        // that the door hands the CALLER an envelope instead. The platform
        // logger serializes an error's `message` and `stack` and nothing else,
        // so logging the envelope in the driver error's place would silently
        // drop exactly the diagnosis this line exists to carry — the failing
        // column, MySQL's index name, the driver's own frames. So the log takes
        // the `cause`; the caller's answer does not move, because `e` is what
        // is rethrown one line down, with that same error still on it.
        //
        // [#17052] …and the LEVEL is `warn`, not `error`. The next statement is
        // `throw e`: the requester was told, so AGENTS.md's third legal answer
        // applies — "a failure handed to the CALLER is not a degradation at
        // all". Both properties above survive the move, because
        // `writeFailureLogMeta` rebuilds the `{ error: { message, stack } }`
        // context the `error` slot used to build (see its header: `warn` has no
        // slot, and an Error's fields are non-enumerable).
        // [#24768] A NOT NULL refusal's `ValidationError` carries the driver's
        // error the same way, for the same reason.
        const logged = e instanceof DuplicateRecordError || e instanceof NotNullRefusalError ? e.cause : e;
        this.logger.warn(
          'Insert operation failed',
          writeFailureLogMeta(redactBoundStatement(logged), { object }),
        );
        // [#27495] A write that did not complete takes back the credential rows
        // it wrote; one a stored row names after all (a batch the driver
        // partially applied, an after-hook refusal of a landed row) is kept.
        await this.releaseSecretHandles(object, writtenSecrets, opCtx.context, 'refused');
        throw e;
      }
    });

    return opCtx.result;
  }

  /** The body of `ObjectQL#insertMany`; the method's docblock there is its contract. */
  static async insertMany(this: Pick<InsertHost, 'insert'>, object: string, rows: any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<InsertManyRowOutcome[]> {
    if (!Array.isArray(rows)) throw new Error('insertMany expects an array of rows');
    return this.insert(object, rows, { ...(options ?? {}), __partialRowErrors: true } as any);
  }
}
