// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryAST, QueryInput, HookContext, ServiceObject } from '@objectstack/spec/data';
// [commit 74155c735] The defaulting node schema `fillQueryAstDefaults` runs author input
// through — the declared `.default()` stays in `packages/spec`, the engine
// only invokes it.
import { SortNodeSchema } from '@objectstack/spec/data';
import {
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  type DroppedFieldsEvent,
} from '@objectstack/spec/data';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
// The validate-only result IS the protocol's response shape (commit 18189983d): the
// engine is what `metadata-protocol.validateData` returns, so letting the two
// drift would put a translation layer between a verdict and its contract.
import type { ValidateDataResponse } from '@objectstack/spec/api';
import { parseAutonumberFormat, resolveAutonumberFormat, FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES, referenceTargetOf, driverSupportsTransactions } from '@objectstack/spec/data';
// [#5158] Door 2's lowering sink — the SAME pair the protocol face (Door 1)
// runs, so `FilterArray` has exactly one lowering in the product.
// [ADR-0053 D-D1, amended 2026-09-30 — #5930] The shared `FilterCondition →
// FilterCondition` lowering, run once per filter position after the doors and
// after token resolution (`resolveThenLowerWhere`), so every driver and the
// in-process `having` / per-aggregation evaluator receive the lowered filter.
import { lowerFilterCondition, type FilterCondition, type FilterLoweringOptions } from '@objectstack/spec/data';
// [#5574] D6, executable. The ceiling and the refusal message live in
// `packages/spec/src/data/bulk-write-hook-conformance.ts` so BOTH phases and
// both verbs enforce one definition; the engine raises, the contract decides.
import { MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';
// [ADR-0126 §8] The packaged-action activation ledger: its row contract, its
// stores and the engine-held projection the dispatch doors consult.
import {
  ActionActivationProjection,
  type ActionActivationRow,
  type ActionActivationStore,
  type ActionActivationWriteOptions,
} from './action-activation.js';
import {
  collectComposableReadableIds,
  type ComposableReadableIdsSite,
} from './filter-comparand-shape.js';
import {
  type RELATION_FILTER_ID_CAP,
} from './relation-filter-lowering.js';
// Seek pagination for the walks that must read EVERY row — the autonumber seed
// scan is one (#6249). Shared with `summary-backfill` rather than re-rolled:
// the cursor merge is the part that is easy to get subtly wrong.
import {
  DATA_MIGRATION_FLAG_OBJECT,
  FILE_REFERENCES_MIGRATION_ID,
  isDataMigrationFlagVerified,
  SystemFieldName,
} from '@objectstack/spec/system';
// [#25522 cut 1] The validation-message localisation helpers; the methods of the
// same names below hand each body the members it reads (`ValidationMessageHost`).
import { negotiatedMessageLocale, objectDisplayLabel, validationMessageContext } from './engine-validation-messages.js';
// [#25522 cut 2] The datasource-routing bodies; the methods of the same names
// below hand each body the members it reads (`DatasourceRoutingHost`).
import { getDriver, matchPattern, resolveDatasourceFromMapping } from './engine-datasource-routing.js';
// [#25522 cut 3] The lifecycle health bodies; the methods of the same names
// below hand each body the members it reads (`LifecycleHealthHost`).
import { checkDriversHealth, resolvePrimaryDatasource } from './engine-lifecycle-health.js';
// [#25522 cut 4] The realtime publish bodies and the event helpers only they
// call; the methods of the same names below hand each body the members it
// reads (`RealtimePublishHost`).
import { publishBulkDataEvent, publishDataEvent } from './engine-realtime-publish.js';
// [#25522 cut 5] The secret and internal-field bodies; the methods of the same
// names below hand each body the members it reads (`SecretInternalFieldsHost`).
import {
  deletedSecretColumns,
  deletedSecretSlots,
  encryptSecretFields,
  maskSecretFields,
  omitInternalFields,
  persistSecretRows,
  privilegedReadDriverOptions,
  refuseEmptyPasswordFields,
  releaseSecretHandles,
  resolveInternalField,
  resolveSecret,
  resolveSecretField,
  retiredSecretSlots,
  secretFieldsWritten,
  stripSearchCompanionFromRead,
  type PendingSecretRow,
  type SecretHandleSlot,
  type StoredRowsReader,
} from './engine-secret-internal-fields.js';
// [#25522 cut 6] The predicate-write hook dispatch bodies; the methods of the
// same names below hand each body the members it reads (`HookDispatchHost`).
import {
  assertBulkPerRowHookBudget,
  buildPerRowAfterContexts,
  dispatchPerRowBeforeHooks,
  inAfterAbortUnit,
} from './engine-hook-dispatch.js';
// [#25522 cut 7] The raw-command and transaction-routing bodies; the methods of
// the same names below hand each body the members it reads (`ExecuteTransactionsHost`).
import { enforceTransactionOrigin, execute, warnTransactionUnsupported } from './engine-execute-transactions.js';
// [#25522 cut 8] The compatibility-API bodies; the methods of the same names
// below hand each body the members it reads (`CompatibilityApiHost`).
import { getConfigs, introspectDatasource, registerObject, removePackage, syncObjectSchema, syncSchemas } from './engine-compatibility-api.js';
// [#25522 cut 9] The hook-context caller-envelope builders; the methods of the
// same names below call them, and none of the bodies reads a member.
import { buildEvalUser, buildProvenance, buildSession, buildUser } from './engine-execution-plumbing.js';
// [#25522 cut 10] The write path's reference check and the caller's read of a
// master-detail header; the methods of the same names below hand each body the
// members it reads (`ReferentialIntegrityHost`).
import { assertReferencesResolve, masterDetailHeadersCallerReads, type StoredReferenceRows } from './engine-referential-integrity.js';
// [#25522 cut 11] File-field hydration on read; the methods of the same names
// below hand each body the members it reads (`FileReferenceHydrationHost`).
import { callerMayReadSysFile, readParentDerivedFiles, resolveFileReferences, servableFileRows, serveRefusedFileHydration } from './engine-file-reference-hydration.js';
// [#29460] A `referenceNameVisible` reference's refused targets served by name
// and id on the expanded read; the method of the same name below hands the body
// the members it reads (`ReferenceNameVisibleHost`).
import { serveReferenceNames } from './engine-reference-name-visible.js';
// [#25522 cut 12] The driver options every driver call receives, and the tenancy
// posture and Layer 0 verdict they are scoped by; the methods of the same names
// below hand each body the members it reads (`DriverOptionsHost`).
import { buildDriverOptions, driverReadScope, driverWriteTarget, engineLayer0Verdict, resolveEnginePosture, wallExemptedOperation } from './engine-driver-options.js';
// [#25522 cut 13] The `sys_migration` flag reads, the certification question a
// driver is handed, and the admitted-violation tally and boot advisory; the
// methods of the same names below hand each body the members it reads (`MigrationFlagsHost`).
import { announceOpenMigrationGates, isOrganizationOwnershipCertified, isValueShapesMigrationVerified, noteAdmittedValueShapeViolation, readFileReferencesFlagRow, readMigrationFlagVerified, supplyTenantKeyCertifiedResolver, wasDatastoreCreatedFromEmpty } from './engine-migration-flags.js';
import { ExecutionContext, ExecutionContextSchema, type InstalledPackageSource } from '@objectstack/spec/kernel';
import { isStoredMetadataBodyObject } from '@objectstack/spec/kernel';
// [#27884] The stored-row read gate, registered on the family's tables below.
import { STORED_METADATA_TYPE_READ_GATE_OBJECTS, storedMetadataTypeReadGate } from './stored-metadata-type-read-gate.js';
// Imported from spec directly rather than through `@objectstack/core`'s
// re-export block: that block is labelled backward-compatibility, and this
// contract is new (#5945).
import type { IPubSub, IScopedContext, IScopedObjectRepository, IntrospectedSchema as SpecIntrospectedSchema } from '@objectstack/spec/contracts';
// [#20157] The judge-only filter-admission member's verdict and options.
import type { EngineFilterJudgement, EngineFilterJudgementOptions, InternalFieldEvaluationOptions, InternalFieldEvaluationQuery } from '@objectstack/spec/contracts';
import {
  IDataDriver,
  IDataEngine,
  type IObjectQLEngine,
  type EngineTransactionInfo,
  type EngineTransactionOptions,
  Logger,
  createLogger,
  withTransientRetry,
  type RetryOptions,
  resolveFilterTokens,
  recordNotFoundError,
  objectNotFoundError,
  resolveUserAuthzGrants,
  markAppAutomationElevation,
  carryAppAutomationElevation,
  appAutomationElevationOf,
} from '@objectstack/core';
import { WriteEpoch } from './write-epoch.js';
import { bridgeAuthzInvalidation } from './authz-invalidation-bridge.js';
import { SummaryRecomputeError, cascadeStoppedRefusal, hookStoppedRefusal, rollbackFailedRefusal, rolledBackRefusal, type SummaryRecomputeFailure } from './summary-errors.js';
import { TransactionUnsupportedError } from './transaction-errors.js';
import {
  aggregateSummaryValue,
  summaryEmptySetValue,
  withoutDeletedSelfParents,
  type SummaryDescriptor,
} from './summary-aggregate.js';
import { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { FindHookResultNotArrayError } from './find-hook-result-shape.js';
import {
  isFindOneResultShape,
  isUpdateResultShape,
  isDeleteResultShape,
  FindOneHookResultNotRecordError,
  UpdateHookResultNotWriteShapeError,
  DeleteHookResultNotWriteShapeError,
} from './verb-hook-result-shape.js';
import {
  DriverConnectError,
  DatasourceUnavailableError,
  emitDegradedBootBanner,
  type DriverConnectFailure,
  type DriverHealth,
  type DatasourceUnavailableInfo,
  type DatasourceUnavailableKind,
  type PrimaryDatasourceVerdict,
} from './driver-connect-errors.js';
import { resolveAllowDriverConnectFailure } from '@objectstack/types';
// [#5979] The ONE shared "which read failure is benign?" predicate (#4825
// family). Imported from the leaf `/errors` subpath — which exists precisely
// so a cross-package consumer gets the 40-line predicate without the manager,
// the loaders or the YAML/filesystem machinery behind `@objectstack/metadata`'s
// root entry. Asking the shared predicate rather than hand-rolling a
// `code === '42P01'` test here is load-bearing, not stylistic: a second
// vocabulary of "benign driver error" is the exact debt that module exists to
// retire, and `check:durability-log-level` exempts only this declared name.
import { isMissingTableError } from '@objectstack/metadata/errors';
// [#25522 cut 17] The registration door's forward conversion, the
// nested-plugin registration and its navigation resolution; the methods of the
// same names below hand each body the members it reads
// (`PackageRegistrationHost`). Imported where this file imported
// `@objectstack/metadata-core`, which only those bodies read, so the
// evaluation order of every module and external package is what it was.
import { convertPackageBodyForward, registerPlugin, resolveNavObjectNames } from './engine-package-registration.js';
// [#6806] The ONE shared "is this driver error a unique-constraint violation?"
// predicate, and its narrower companion "which column conflicted" (#6250 /
// #6544, both landed in `@objectstack/types`). The engine's autonumber
// collision resync asks exactly the two questions those exports were named to
// answer, so it asks THEM — hand-writing a fifth dialect word-list inside the
// engine is the consumer-side tolerant parsing PD #12 forbids and precedent
// #5841 retired.
import { DuplicateRecordError } from './duplicate-record-error.js';
import { NotNullRefusalError, envelopeDriverWriteRefusal } from './not-null-refusal-error.js';
import { ConcurrentUpdateError } from './concurrent-update-error.js';
import { AssignmentRuleEvaluator, ASSIGNMENT_RULE_TYPE, OWNERSHIP_QUEUE_SOURCE_SLOT, type AssignmentQueueService } from './assignment-rules.js';
// [#8682] The write-path loggers' redaction — bound values never reach the log.
// [#21274] …and its boundary face — nor the error that leaves the engine.
// [#21385] It lives in `@objectstack/types` now, so `driver-sql`'s own log lines
// call the same cut; nothing about it changed in the move.
import { redactBoundStatement, redactPropagatedDriverFault } from '@objectstack/types';
// [#8844] The runtime half of #8686's ruling: a system-context write on a
// tenant-scoped object resolves the install's organization the way a session
// write does, or is refused rather than filed under the `__global__`
// pseudo-tenant. The decision is a pure function of measured facts; this file
// supplies the facts and turns a `refuse` into the throw.
import {
  resolveTenantFieldName,
  SystemWriteOrganizationRequiredError,
  ORGANIZATION_OBJECT,
} from './tenancy/system-write-organization.js';
import {
  type TenancyPosture,
  type TenantLayer0Verdict,
  postureUsesUnionScope,
} from '@objectstack/spec/security';

/**
 * Per-row outcome of {@link ObjectQL.insertMany} (framework#3172). One entry
 * per input row, in input order: written rows carry the after-hook record,
 * failed rows carry the per-row error (validation / autonumber / encryption).
 *
 * [#20922] A written row also carries `droppedFields`: the caller-supplied
 * fields the engine LEGALLY stripped from THAT row, one `DroppedFieldsEvent`
 * per reason — the per-row channel, recorded at the strips. Present only when
 * at least one field was taken from the row. The batch-level `onFieldsDropped`
 * events are unchanged and still name no row; this key is not a resolution of
 * them. A failed row carries none: its write did not complete.
 */
export type InsertManyRowOutcome =
  | { ok: true; record: any; droppedFields?: DroppedFieldsEvent[] }
  | { ok: false; error: unknown };
import { CoreServiceName, StorageNameMapping } from '@objectstack/spec/system';
import { IRealtimeService } from '@objectstack/spec/contracts';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
import {
  collectInternalReadFields,
  collectCredentialFields,
} from './secret-fields.js';
// [#25522 cut 18] `count` and `aggregate()`'s credential guard
// (`rejectCredentialAggregation`); the methods of the same names below hand
// each body the members it reads (`CountAggregateHost`).
import { count, rejectCredentialAggregation } from './engine-count-aggregate.js';
// ADR-0100: the credential-column guard's filter / sort half, beside the
// aggregate half above — one collector, one envelope.
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { assertNoInternalFieldEvaluated, rejectInternalFieldEvaluation } from './internal-field-evaluation-guard.js';
import { assertProjectionNamesAField, refuseProjectionOfUnknownColumns } from './empty-projection-door.js';
import { assertRecordCurrencyCodes, touchesRecordCurrency } from './validation/record-currency-code.js';
import {
  EXCHANGE_RATE_OBJECT,
  homeAmountsTouched,
  memoizeHomeAmountServing,
  planHomeAmounts,
  projectHomeAmounts,
  settleBulkHomeAmounts,
  type HomeAmountPlanEntry,
  type HomeAmountServing,
  type HomeLocalization,
  type HomeLocalizationResolver,
} from './home-amount-projection.js';
import { SchemaRegistry, type ArtifactInstallScope } from './registry.js';
import { stripSearchCompanion } from './search-companion.js';
import { type EvalError, type EvalOptionLabels, type EvalPermissions } from '@objectstack/formula';
import { declaredOptionLabels, readerOptionLabels } from './formula-option-labels.js';
// [commit 3c1bbd2a8] The ONE spelling of "which object does an aggregated `defineView`
// container bind to", imported rather than re-spelled — from the LEAF subpath,
// for the reason the `/errors` import above states (commit 3bd9b3498). See
// `resolveMetadataItemName` below for why this registrar lost its fourth copy.
// [#20331] The divergent view-container `name` refusal — the ONE judge this
// registrar and `os validate` both call.
import { bindHooksToEngine, type BindHooksOptions } from './hook-binder.js';
import { declaredHookCondition } from './hook-wrappers.js';
import { validateRecord, validateRecordInScope, normalizeMultiValueFields, normalizeBlankTypedValues, normalizeNumericStringValues, coerceBooleanFields, ValidationError, isScannableValueShapeField } from './validation/record-validator.js';
import type { AdmittedValueShapeViolation, AdmittedValueShapeViolationSink, ValidationMessageContext } from './validation/record-validator.js';
import type { RelatedFieldBinding, RelatedRecordBinding } from './validation/rule-validator.js';
import { createBatchSummaryAccumulator } from './summary-batch-accumulation.js';
import { collectReferenceTraversals, evaluateValidationRules, emitValidationAdvisories, optionVisibilityReadsPermissions, readsPermissionPredicate, needsPriorRecord, stripReadonlyWhenFields, stripReadonlyWhenFieldsMulti, hasReadonlyWhenInPayload, hasParentScopedReadonlyWhenInPayload, hasParentScopedRequiredWhen, stripReadonlyFields, stripRuntimeOwnedFields, staticReadonlyInsertSubject, preserveAuditIgnoredOnInsertWarning } from './validation/rule-validator.js';
// [#14088] The before-phase write recorder — the provenance channel the static
// `readonly` strip needs to tell a hook's write from a caller's echo of the
// SAME value. Armed and sealed in `update()`; the module owns the argument for
// why neither end may move.
import { recordHookPayloadWrites } from './hook-write-provenance.js';
// [commit 706ad0fcc] The hide pass's other half: when a hook faults reaching THROUGH a
// key that pass withheld, this names the key, says the platform withheld it,
// and points at `ctx.previous` — the module owns the measurement and the
// reason the explanation cannot be composed any further downstream.
import { dispatchHooksExplainingWithheldReadonly } from './hook-withheld-readonly-fault.js';
import { UnscopedHookApi, SEED_USER_GRANTS, APP_AUTHORED_HOOK_API, type HookRunAs, type HookRunAsRef, type RunAsDerivableApi } from './hook-run-as.js';
import type { HookWriteRecording } from './hook-write-provenance.js';
import { resolveMasterDetailRelation } from './master-detail.js';
// [#6457] The master-detail header a `parent`-scoped predicate reads is made
// total over the MASTER's declared fields before it leaves this engine — the
// same helper every other server seam materialises with (#1871/#4649/#4953).
import { materializeDeclaredFields } from './declared-fields.js';
// [#21571] The declared column set — the read verbs' default projection, their
// explicit-projection filter and the write path's undeclared-key door, one list.
import {
  PLATFORM_PROVISIONED_COLUMNS,
  declaredColumnSet,
  rowsWithDeclaredColumnsOnly,
  rowsWithSelectedColumnsAnswered,
  selectedStoredColumns,
  storedColumnsLeftUnwritten,
  withDeclaredColumnsOnly,
  withSelectedColumnsAnswered,
} from './declared-read-columns.js';
// [#21777] "Is this schema the remote's?" One predicate, shared with the boot sync.
// [#21910, #21918] And its injected-column refinement, which both cascade walks ask.
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';
// [#27277] The correctness floor over a plugin driver on an external datasource.
import {
  externalPredicateWriteRefusal,
  isExternalDriverFloor,
  unwrapExternalDriverFloor,
} from './external-driver-floor.js';
// [#25522 cut 14] The master-detail landing, the preview's parents and the
// related reads a validation rule makes; the methods of the same names below
// hand each body the members it reads (`MasterDetailRelatedHost`). Imported after
// every module those bodies import, so the engine's module evaluation order
// is what it was.
import { resolveOneHopRelated, resolvePredicateRelated, resolvePreviewParents, settleMasterDetailLanding } from './engine-master-detail-related.js';
// [#25522 cut 15] The `ReadableIds` chain composition, the controlled-by-parent
// boot screen, and the permission and formula resolutions an operation shares;
// the methods of the same names below hand each body the members it reads
// (`ReadableIdsPermissionFormulaHost`). Imported after every module those bodies import, so
// the engine's module evaluation order is what it was.
import { composeReadableIdsChain, findUnservableControlledByParentMasters, permissionResolution, readableIdsScopeOf, reportFormulaFault, resolveDefaultPermissions, resolveFormulaPermissions, resolveOptionPermissions } from './engine-readable-ids-permission-formula.js';
// [#25522 cut 16] Type-only, for the `{@link}`s on `composeReadableIdsAtBoundary`'s and
// `composeReadableIdsChain`'s docblocks: the constant moved with its reader in cut 15.
import type { READABLE_IDS_MAX_CHAIN_DEPTH } from './engine-readable-ids-permission-formula.js';
// [#25522 cut 19] The delete cascade's collection walk, the in-cascade
// `restrict` judge, the `DELETE_RESTRICTED` refusal, the reference-probe
// filter and the reference-check elevation record; the methods of the same
// names below hand each body the members it reads (`DeleteCascadeHost`).
// Imported after every module those bodies import, so the engine's module
// evaluation order is what it was.
// [#28001] …and the object-level closure of that walk the metadata read serves.
import { collectCascadeDeleteObjects, collectCascadeDeleteSet, deleteRestrictedError, recordReferenceCheckElevation, referenceProbeFilter, refuseRestrictsInsideOwnCascade } from './engine-delete-cascade.js';
import {
  resolveEngineDeleteDispatch,
  ENGINE_DELETE_REJECT_MESSAGE,
  type EngineDeleteDispatchInput,
} from './engine-delete-dispatch.js';
import {
  resolveEngineUpdateDispatch,
  ENGINE_UPDATE_REJECT_MESSAGE,
  // [#11142] The one reject thrower, shared with assertEngineUpdateDispatch,
  // so a refusal that declares an ADR-0112 code/status (the conflicting-id
  // reject) carries it identically from the real engine and from every
  // pinned fake.
  engineUpdateDispatchRejectError,
  type EngineUpdateDispatchData,
  type EngineUpdateDispatchInput,
} from './engine-update-dispatch.js';
// [#25522 cut 16] The write preview's body; `validate` below hands it the
// members it reads (`ValidateHost`). Imported after every module that body
// imports, so the engine's module evaluation order is what it was.
import { validate } from './engine-validate.js';
import { bindHookNotice } from './hook-notice.js';
// [#25522 cut 20] The `where`-lowering bodies (`QueryLoweringHost`), imported
// after every module they import, so module evaluation order is unchanged.
import { lowerRelationConditions, resolveSearchQueryableFields, resolveWhereTokens } from './engine-query-lowering.js';
import {
  auditDanglingReferences,
  type DanglingReferenceAuditOptions,
  type DanglingReferenceReport,
} from './integrity/dangling-reference-audit.js';
// [#29986 codemod] The top-level declarations that moved whole to `engine-top-level.ts`, as this file still reads them.
import {
  AUTONUMBER_COLLISION_ATTEMPTS, DISPATCHABLE_HOOK_EVENTS, ENGINE_DELETE_OPTION_KEYS, ENGINE_FIND_OPTION_KEYS,
  ENGINE_QUERY_SLOTS, ENGINE_UPDATE_OPTION_KEYS, ENGINE_WHERE_SLOTS, ENGINE_WIRE_ONLY_SLOTS,
  SECURITY_SERVICE_SOURCE_SLOT, WIRE_ONLY_CANONICAL_SHAPES, WRITE_PRECONDITION_OPTION, applyFormulaPlan,
  applyStoredExpressionsToPatch, assertDispatchableHookEvent, assertHookScopeNotSelfCancelling,
  assertOrderByIsMaterializable, assertProjectionHasNoDottedPaths, assertValidHookExcludeObjects,
  assertValidHookObject, assertValidUnscopedMultiWriteFlag, autonumberFieldNames, callerKeySets, callerSuppliedRow,
  cascadeMemberKey, cascadeSetAdd, cascadeSetHas, computeStoredExpressions, declaredDatetimeLowering,
  declaredMultiValued, deleteWalkTargetOf, droppedFieldEvents, foldEngineOptionAliases, formulaPlanEntry,
  handBackWithheldInsertReadonly, hookMatchesObject, hydrateWriteFormulas, insertStaticReadonlySubject,
  judgeWhereAdmission, lowerWhereFilterArray, masterIdOf, mergeReadContext, organizationPredicateDeleteRefusal,
  packageBodyCollectionRefusal, packageBodyObjectAndAppOwnerStampRefusal, packageBodySeedDataRefusal,
  planFormulaProjection, planStoredExpressions, recomputeAutonumberReaders, rejectUnknownEngineOptions,
  replacedStoredExpressionFields, resolveWhereFilterTokens, rowsWithoutFormulaWidening, settleBulkStoredExpressions,
  shouldSkipStateMachine, statesDeleteSemantics, staticReadonlyStoredView, storedExpressionsReading,
  stripComputedWriteFields, undeclaredWriteFieldErrors, updateStaticReadonlySubject, whereResolvedTokenJudge,
  withFileOwnerKey, withholdInsertReadonlyFromHooks, withoutFormulaWidening, writeFailureLogMeta,
} from './engine-top-level.js';
import type {
  AdmittedValueShapeViolationTally, AutonumberReaders, CascadeDeleteSet, CascadeIssuedDelete, DatasourceDef,
  EngineMiddleware, EngineReadOptions, FieldOwnedFileReadAuthorizer, FormulaFaultSink, FormulaPlanEntry,
  FormulaRelated, FunctionEntry, FunctionRegistrationOptions, HeldFileResolver, HookEntry, HookHandler,
  IssuedAutonumber, MigrationFlagRead, OperationContext, PermissionResolution, ReadableIdsChain, ReadableIdsSecurity,
  ReadableIdsSecurityResolution, StoredExpressionServing, TransactionScope, UnservableControlledByParentMaster,
  WriteWallVerdict,
} from './engine-top-level.js';
// [#29986 codemod] Re-exported by name, so every importer of `./engine.js` reads what it read.
export {
  type AdmittedValueShapeViolationTally, type CascadeDeleteSet, type DatasourceDef, ENGINE_COUNT_OPTION_KEYS,
  ENGINE_OPTION_KEY_SETS, ENGINE_WHERE_SLOTS, type EngineMiddleware, type EngineReadOptions,
  type FieldOwnedFileReadAuthorizer, type FormulaPlanEntry, type FunctionEntry, type FunctionRegistrationOptions,
  HOOK_EVENT_DISPATCH_VOCABULARY, type HeldFileResolver, type HookEntry, type HookHandler, type MigrationFlagRead,
  type OperationContext, type PermissionResolution, type PostHookWriteImageCheck, type ReadableIdsChain,
  type ReadableIdsSecurity, SECURITY_SERVICE_SOURCE_SLOT, type UnservableControlledByParentMaster,
  type WriteWallRowVerdict, type WriteWallVerdict, assembledViewItemRefusal, cascadeMemberKey, cascadeSetAdd,
  cascadeSetHas, collectionItemOwnerStampRefusal, declaredDatetimeLowering, declaredMultiValued, droppedFieldEvents,
  evaluateFormulaField, foldEngineOptionAliases, hookMatchesObject, insertStaticReadonlySubject, isExpressionDefault,
  lowerWhereFilterArray, masterIdOf, mergeReadContext, packageBodyCollectionRefusal,
  packageBodyObjectAndAppOwnerStampRefusal, packageBodySeedDataRefusal, permissionSetOwnerRegistrationRefusal,
  registerAppNotingStamp, rejectUnknownEngineOptions, relationSitesOf, resolveThenLowerWhere, servedAsStored,
  shouldSkipStateMachine, stampObjectPackage, stampPackage, staticReadonlyStoredView, stripComputedWriteFields,
  undeclaredRelatedFields, undeclaredWriteFieldErrors, updateStaticReadonlySubject, viewsEntryNotContainerRefusal,
  writeFailureLogMeta,
} from './engine-top-level.js';
// [#29986 codemod] Class head: units, hooks, functions, body runners, hook dispatch: the methods of the same names below hand the bodies what they read (`HooksAndFunctionsHost`).
import {
  dispatchUnscopedMultiWriteHooks, unregisterFunctionsByPackage, unregisterHooksByPackage,
} from './engine-hooks-and-functions.js';
// [#29986 codemod] Action system and packaged-action activation: the methods of the same names below hand the bodies what they read (`ActionsHost`).
import { listRegisteredActions, registerAction } from './engine-actions.js';
// [#29986 codemod] Registration seams, readable-ids security, formula and default permissions: the methods of the same names below hand the bodies what they read (`SecurityResolversHost`).
import { refuseUncomposableReadableIdsClasses, resolveFormulaRelated } from './engine-security-resolvers.js';
// [#29986 codemod] Authz invalidation, middleware, session, driver options, posture, organization probe: the methods of the same names below hand the bodies what they read (`MiddlewareAndContextHost`).
import { executeWithMiddleware, resolveSystemInsertOrganization } from './engine-middleware-and-context.js';
// [#29986 codemod] Field defaults and autonumbers: the methods of the same names below hand the bodies what they read (`DefaultsAndAutonumbersHost`).
import {
  adoptExplicitAutonumber, applyAutonumbers, applyFieldDefaults, defaultFieldEntries, isIssuedAutonumberCollision,
  resolveNowDefault, resolveOptionDefault, seedAutonumber, warnAutonumberReadersUnserved,
} from './engine-defaults-and-autonumbers.js';
// [#29986 codemod] Package, app, plugin, driver and datasource registration: the methods of the same names below hand the bodies what they read (`RegistrationHost`).
import {
  applyExternalDriverFloor, assertWriteAllowed, registerDatasourceDef, registerMetadataCollections,
  registerPackageBody, supplyFileColumnsMovedResolver,
} from './engine-registration.js';
// [#29986 codemod] Realtime, i18n, home amounts, validation messages, references, master-detail: the methods of the same names below hand the bodies what they read (`ReferencesAndMasterDetailHost`).
import { inspectCascadeDelete, inspectDanglingReferences } from './engine-references-and-master-detail.js';
// [#29986 codemod] Crypto, secrets, internal fields, schema and datasource routing, init: the methods of the same names below hand the bodies what they read (`SecretsAndRoutingHost`).
import { resolveDatasourceBinding } from './engine-secrets-and-routing.js';
// [#29986 codemod] Summary indexes, related-record expansion, file and reference hydration: the methods of the same names below hand the bodies what they read (`SummariesAndExpansionHost`).
import { buildSummaryIndex, initializeSummaryFields } from './engine-summaries-and-expansion.js';
// [#29986 codemod] Query lowering, search, find and findOne: the methods of the same names below hand the bodies what they read (`FindHost`).
import { expandSearchOnAst, reportFindFailure, requireFindOnePredicate } from './engine-find.js';
// [#29986 codemod] Write preparation and insert: the methods of the same names below hand the bodies what they read (`InsertHost`).
import { staticReadonlyCreateStrip } from './engine-insert.js';
// [#29986 codemod] Cascade and referential delete planning: the methods of the same names below hand the bodies what they read (`CascadePlanningHost`).
import {
  cascadeRelationBehavior, isTenantColumnSetNull, organizationCountIsDisclosable, referenceProbeFilterOfSet,
  warnCascadeNotAtomic,
} from './engine-cascade-planning.js';
// [#29986 codemod] Delete, count, aggregate and execute: the methods of the same names below hand the bodies what they read (`DeleteAndAggregateHost`).
import { aggregate } from './engine-delete-and-aggregate.js';

export class ObjectQL implements IObjectQLEngine {
  /**
   * Ambient transaction store (ADR-0034). While a `transaction()` callback
   * runs, the active transaction handle lives here so that EVERY data
   * operation — including internal reads done during a write (reference
   * checks, hooks, expand) — automatically binds to the same connection
   * instead of asking the pool for another one and deadlocking on the
   * single-connection SQLite pool.
   */
  private readonly txStore = new AsyncLocalStorage<{
    transaction: unknown;
    /**
     * Which driver actually owns this transaction, when the engine opened it
     * (#4619). `transaction()` covers the DEFAULT datasource only — a caveat
     * that is part of the declared contract (ADR-0119 D1) — so a write routed
     * elsewhere by `setDatasourceMapping` runs OUTSIDE it and cannot be rolled
     * back with it. Carrying the owner here is what lets the write path SAY so
     * ({@link enforceTransactionOrigin}) — and, since #5351, to DECIDE what
     * happens to it: a business write is refused, a system ledger is carved out.
     *
     * Absent on the sandbox runner's explicitly-threaded handles (the
     * `beginTransaction`/`commit`/`rollback` trio never POPULATES this store —
     * since #6406 it reads it, to join an ambient transaction, but a
     * transaction the trio opens still cannot be published: there is no closure
     * spanning begin→commit to hand `run`) and on any store entry an outside
     * caller populated, so every reader must treat it as optional.
     */
    scope?: TransactionScope;
  }>();

  /**
   * [#22855] The units {@link runOpenedUnit} published, keyed by their handle.
   * The value is the very entry {@link txStore} holds, so the one write that
   * closes a unit answers both of its readers: the ambient one finds the entry
   * empty, and {@link buildDriverOptions} looks an explicitly threaded handle up
   * here ({@link isClosedUnitHandle}). Weak, so a finished unit's handle stays
   * collectable.
   */
  private readonly openedUnits = new WeakMap<object, { transaction: unknown }>();

  /**
   * [#22305] The {@link CascadeDeleteSet} of the by-id cascade delete in
   * progress, ambient for the same reason as {@link txStore}: the cascade
   * recurses through the public `delete()`, and each level must judge its
   * refusals against the set its root collected. A context key would be the
   * other carrier, and it is not used: it would turn a caller's absent context
   * into a present one on every nested delete.
   */
  private readonly cascadeDeleteSets = new AsyncLocalStorage<CascadeDeleteSet>();

  /**
   * [#23221] The child delete {@link walkReferencingRelations} is issuing right
   * now, so that `delete()` can tell the cascade's own child delete from every
   * other delete and project the fact onto the DECLARED
   * `HookContext.referentialCascadeDelete` (see
   * {@link claimReferentialCascadeDelete}).
   *
   * Ambient, for {@link cascadeDeleteSets}' reason — a context key would change
   * what the child delete is handed (where no transaction is opened, an absent
   * caller context would become a present one, and both `buildSession` and
   * `buildHookApi` branch on its absence) — and for one more
   * the update twin's `__referentialFieldClear` never had to weigh, because its
   * envelope semantics predated its declared projection: the child delete's
   * context is the very object `buildHookApi` hands to `ScopedContext`, so a
   * key stamped on it would ride into every write that child's hooks issue
   * through `ctx.api`, and a hook's own delete during the cascade would read
   * as cascade-issued. Keyed on the exact object and id the walk issues, and
   * claimed once, the marker reaches that one delete's dispatches and no other.
   * Engine-private: nothing a request carries can name a record into it.
   */
  private readonly cascadeIssuedDeletes = new AsyncLocalStorage<CascadeIssuedDelete>();

  private drivers = new Map<string, IDataDriver>();
  private defaultDriver: string | null = null;
  private logger: Logger;

  /**
   * Datasources already reported by {@link warnTransactionUnsupported}, so the
   * "no `beginTransaction`" degrade says its piece ONCE per engine instance per
   * driver instead of once per `transaction()` call (#4619). Test doubles and
   * foreign engines hit that path on every call; a per-call warning would be
   * skimmed, which is the same unreadability that made the #4420 `warn`
   * worthless.
   */
  private readonly transactionUnsupportedReported = new Set<string>();

  /** [#25073] Objects already reported by {@link warnAutonumberReadersUnserved}: once per engine instance. */
  private readonly autonumberReadersUnservedReported = new Set<string>();

  /**
   * Objects already reported by {@link warnCascadeNotAtomic} — the `'split'`
   * verdict of {@link planCascadeAtomicity} — so a cascade that cannot be one
   * unit of work says so ONCE per engine instance per object rather than on
   * every delete (#7413). Same "say it once" discipline, and same reason, as
   * {@link transactionUnsupportedReported} above.
   */
  private readonly cascadeNotAtomicReported = new Set<string>();

  // Datasource mapping rules (imported from defineStack)
  private datasourceMapping: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }> = [];

  // Package manifests registry (for defaultDatasource lookup)
  private manifests = new Map<string, any>();

  // [#28534] Where each ADR-0130 residual owner came from — see
  // {@link recordResidualOwner}.
  private readonly residualOwnerSources = new Map<string, 'code' | 'marketplace'>();

  /**
   * [#28534] Record the origin of an artifact's RESIDUAL owner: the id the
   * residual rule files a multi-package stack's unclaimed top-level items
   * under (`unclaimedTopLevel`, `@objectstack/metadata`), as the door that
   * registered the artifact states it — `'code'` for the deployment's own
   * boot, `'marketplace'` for an install.
   *
   * The residual is not a package, so no package row records that id (unless
   * a body carries it, and then the body's row answers), yet its items wear it
   * as their `_packageId`. Without this record a reader asking an item's
   * origin could not tell the host's own residual from an installed bundle's.
   * Called by the `manifest` service, the one place that knows both the
   * residual's id and the door's statement. Once an id is recorded as
   * `'marketplace'` it stays so for this engine: an install can never turn
   * into the host's own by re-registering under the same id.
   */
  recordResidualOwner(ownerId: string, source: 'code' | 'marketplace'): void {
    if (this.residualOwnerSources.get(ownerId) === 'marketplace') return;
    this.residualOwnerSources.set(ownerId, source);
  }

  /**
   * [#28534] The origin {@link recordResidualOwner} recorded for a residual
   * owner id, or `undefined` when no artifact this engine registered named it
   * as its residual's owner.
   */
  residualOwnerSource(ownerId: string): 'code' | 'marketplace' | undefined {
    return this.residualOwnerSources.get(ownerId);
  }

  // Datasource definitions by name (ADR-0015): carries schemaMode +
  // external.allowWrites so the write gate (Gate 3) can enforce federation
  // ownership, and external.credentialsRef so a sys_secret reference sweep can
  // see the handle a code-declared datasource holds. Populated from manifests
  // in registerApp and via registerDatasourceDef. Absent entry ⇒ treated as
  // managed (default DB).
  private datasourceDefs = new Map<string, Omit<DatasourceDef, 'name'>>();

  // Declared-but-unusable datasources, keyed by name (framework#3828). Written
  // by the datasource connection layer via markDatasourceUnavailable; read only
  // by getDriver, to explain a missing driver instead of blaming a typo. Empty
  // is the normal state — an entry here means a connect was refused or failed.
  private unavailableDatasources = new Map<string, DatasourceUnavailableInfo>();

  // Per-object hooks with priority support
  private hooks: Map<string, HookEntry[]> = new Map([
    ['beforeFind', []], ['afterFind', []],
    ['beforeInsert', []], ['afterInsert', []],
    ['beforeUpdate', []], ['afterUpdate', []],
    ['beforeDelete', []], ['afterDelete', []],
  ]);

  // Middleware chain (onion model)
  private middlewares: Array<{
    fn: EngineMiddleware;
    object?: string;
  }> = [];

  // Action registry: key = "objectName:actionName"
  private actions = new Map<string, { handler: (ctx: any) => Promise<any> | any; package?: string }>();

  /**
   * [ADR-0126 §8] The packaged-ACTION activation ledger's local projection —
   * which declared actions this installation has switched OFF.
   *
   * It sits beside the handler registry above deliberately: the ledger governs
   * what that map is allowed to dispatch, and ADR-0110 D5 already settled that
   * action-adjacent boot work belongs to the engine plugin (the one component
   * unconditionally present wherever actions execute). Hydrated at boot by
   * `ObjectQLPlugin`; consulted by the dispatch doors through
   * {@link isActionEnabled}. See `./action-activation.ts` for the row contract
   * and for why identity is the declarative action NAME.
   */
  private readonly actionActivation = new ActionActivationProjection();

  // Function registry: name → handler, each entry stamped with its owning
  // package. Used by `bindHooksToEngine` to resolve string-named hook
  // handlers (the JSON-safe form) — only against entries the hook's OWN
  // package registered. Populated by `defineStack({ functions })` via
  // `AppPlugin`, or directly via `engine.registerFunction(...)`.
  private functions = new Map<string, FunctionEntry>();

  // Realtime service for event publishing
  private realtimeService?: IRealtimeService;

  // i18n service backing validation-message + field-label localization (#3957).
  // Optional: without it, messages render from the built-in catalog against the
  // declared labels.
  private i18nService?: {
    t?: (key: string, locale: string, params?: Record<string, unknown>) => string;
    // [#15757] `II18nService` requires `getLocales()`; it is optional HERE for
    // the same reason `t` is — the setter accepts any partial shim, and a shim
    // that cannot say what it holds is simply not negotiated against.
    getLocales?: () => string[];
    // [#26608] What a formula's `label()` is translated through: the bundle
    // and the declared locale chain, read as the metadata route reads them
    // (`formula-option-labels.ts`). Optional for the same reason.
    getTranslations?: (locale: string) => Record<string, unknown>;
    getFallbackLocale?: () => string | undefined;
    getDefaultLocale?: () => string | undefined;
  };

  // Crypto provider backing `secret`-typed fields. Optional: when absent,
  // writing an object that declares a secret field fails closed (never
  // persists cleartext). Injected by the host via setCryptoProvider().
  private cryptoProvider?: ICryptoProvider;

  // [#8022] Listeners notified when a crypto provider is (re)registered.
  // Server-side consumers that dereference a secret at BOOT — the webhook
  // auto-enqueuer's subscription cache is the one this was built for — run
  // inside `kernel:ready`, which every host completes BEFORE its composition
  // root injects a provider. Their first read therefore fails closed against a
  // capability that is about to exist, and without a notification the only way
  // back is to poll. The engine is the sole party that knows the moment it
  // arrives, so the notification belongs here.
  private readonly cryptoProviderListeners = new Set<() => void>();

  // [ADR-0105 D2 / #3623] Posture accessor for driver-scope widening under the
  // `group` posture. Injected by SecurityPlugin via setTenancyPostureProvider();
  // absent = equality scoping (fail toward isolation).
  private tenancyPostureProvider?: () => string | undefined;

  // [#8844] The install's organizations, capped at two — memoised across system
  // writes and dropped whenever `sys_organization` is written through this
  // engine. See `probeInstallOrganizations` for the stale window this accepts.
  private organizationProbeMemo?: readonly string[];

  // Per-engine SchemaRegistry instance.
  //
  // Historically SchemaRegistry was a process-wide singleton of static state,
  // which broke multi-environment servers: a project kernel would inherit every
  // object registered by the control plane (e.g. sys_metadata), and
  // getDriver()'s owner lookup would route CRUD to the wrong database. Each
  // engine now owns its registry so kernels are fully isolated.
  private _registry: SchemaRegistry = new SchemaRegistry();

  constructor(hostContext: Record<string, any> = {}) {
    // Use provided logger or create a new one
    this.logger = hostContext.logger || createLogger({ level: 'info', format: 'pretty' });
    // Pick up production hardening switches from env so deployers can
    // enforce strict-body without code changes:
    //   OBJECTQL_STRICT_HOOKS=1 → unresolved hooks throw at bind time
    //   OBJECTQL_WARN_LEGACY_HANDLER=1 → log a deprecation per legacy bind
    if (process?.env?.OBJECTQL_STRICT_HOOKS === '1') {
      (this as any)._strictHookBinding = true;
    }
    if (process?.env?.OBJECTQL_WARN_LEGACY_HANDLER === '1') {
      (this as any)._warnLegacyHandler = true;
    }
    // [#27884] The stored-row read gate: a caller-context read of a
    // stored-metadata table serves a capability-gated type's documents only to
    // holders of that capability — the row the `/meta` type gate reads. In the
    // constructor, so no engine serves those tables without it. See
    // `stored-metadata-type-read-gate.ts`.
    for (const object of STORED_METADATA_TYPE_READ_GATE_OBJECTS) {
      this.registerMiddleware(storedMetadataTypeReadGate, { object });
    }
    this.logger.info('ObjectQL Engine Instance Created');
  }

  /**
   * Service Status Report
   * Used by Kernel to verify health and capabilities.
   */
  getStatus() {
      return {
          name: CoreServiceName.enum.data,
          status: 'running',
          version: '0.9.0',
          features: ['crud', 'query', 'aggregate', 'transactions', 'metadata']
      };
  }

  /**
   * Expose the SchemaRegistry for plugins to register metadata.
   *
   * Returns the per-engine instance, NOT the class. Each ObjectQL engine
   * owns its registry so multi-environment kernels remain isolated.
   */
  get registry(): SchemaRegistry {
    return this._registry;
  }

  /**
   * Register a hook
   *
   * [#17713] `event` must be one of {@link DISPATCHABLE_HOOK_EVENTS}, or a name
   * outside the engine's lifecycle namespace entirely (a custom event a plugin
   * dispatches itself through {@link ObjectQL.triggerHooks}). An engine
   * lifecycle name the engine never dispatches — `beforeCount`, `beforeFindOne`
   * and their siblings — is REFUSED here rather than registered inert; see
   * {@link assertDispatchableHookEvent}.
   *
   * @param event The event name (e.g. 'beforeFind', 'afterInsert')
   * @param handler The handler function
   * @param options Optional: target object(s), objects to exclude, and priority
   */
  registerHook(event: string, handler: HookHandler, options?: {
    object?: string | string[];
    /**
     * [#5928] Object name(s) subtracted from what `object` admits — the way to
     * say "global, except these". See {@link HookEntry.excludeObjects} for why
     * an allow list cannot express it, and
     * {@link assertValidHookExcludeObjects} for the two refused shapes.
     */
    excludeObjects?: string | string[];
    priority?: number;
    packageId?: string;
    /**
     * [#9719, widened by #9974] Opt-in whole-operation dispatch for an
     * UNSCOPED predicate write (`multi: true`, no `where`) — see
     * {@link HookEntry.dispatchUnscopedMultiWrite}. Valid on `beforeUpdate` /
     * `beforeDelete` registrations only.
     */
    dispatchUnscopedMultiWrite?: boolean;
    /** Original metadata Hook definition (set by `bindHooksToEngine`). */
    meta?: any;
    /** Stable name from metadata (set by `bindHooksToEngine`). */
    hookName?: string;
  }) {
    // Refuse a scope that is statically decidable as meaningless before
    // anything is registered or reported. Each face is checked on its own
    // first, so the combined check below can assume well-formed names.
    // [#5928] An exclusion face that subtracts nothing (`''`) or everything (`'*'`).
    assertValidHookExcludeObjects(options?.excludeObjects, event);
    // [commit 708431313] An allow face that names nothing (`''` → global, `[]`/`['']` → never fires).
    assertValidHookObject(options?.object, event);
    // [commit 708431313] Two well-formed faces that cancel out (`'account'` minus `'account'`).
    assertHookScopeNotSelfCancelling(options?.object, options?.excludeObjects, event);
    // [#9719/#9974] The unscoped-multi-write flag on an event whose dispatch never reads it.
    assertValidUnscopedMultiWriteFlag(options?.dispatchUnscopedMultiWrite, event);
    // [#17713] An event inside the engine's OWN lifecycle namespace that the
    // engine never dispatches — `beforeCount`, `beforeFindOne` and their four
    // siblings. #3195 warned and registered anyway; the handler then never ran,
    // which on a read filter is a guardrail the author believes they armed.
    // Refused at the door, with the per-seam repair named.
    assertDispatchableHookEvent(event);
    // [#3195] Guard against enum-vs-dispatch drift for every OTHER unknown
    // name: a hook on an event the engine never triggers would register
    // "successfully" and then silently never fire. Warn loudly rather than
    // swallow it. Still not a hard reject here — a custom driver/plugin may
    // dispatch its own events via `triggerHooks`, and outside the engine's own
    // vocabulary that is the likely reading (#17713 keeps it intact).
    if (!DISPATCHABLE_HOOK_EVENTS.has(event)) {
      this.logger.warn(
        `Hook registered for '${event}', which the engine never dispatches — it will never fire. ` +
          `Dispatchable events: ${[...DISPATCHABLE_HOOK_EVENTS].join(', ')}. ` +
          `(Read filtering → RLS/permissions; field masking → field metadata; delete guards → beforeDelete.)`,
        { event, object: options?.object, hookName: options?.hookName },
      );
    }
    if (!this.hooks.has(event)) {
        this.hooks.set(event, []);
    }
    const entries = this.hooks.get(event)!;
    entries.push({
      handler,
      object: options?.object,
      excludeObjects: options?.excludeObjects,
      priority: options?.priority ?? 100,
      packageId: options?.packageId,
      dispatchUnscopedMultiWrite: options?.dispatchUnscopedMultiWrite,
      meta: options?.meta,
      hookName: options?.hookName,
    });
    // Sort by priority (lower runs first)
    entries.sort((a, b) => a.priority - b.priority);
    // The exclusion face is reported alongside the allow face: a registration's
    // scope is BOTH halves (#5928), and a log that printed only `object` would
    // describe a global hook for an entry that is global-minus-twenty-tables.
    this.logger.debug('Registered hook', { event, object: options?.object, excludeObjects: options?.excludeObjects, priority: options?.priority ?? 100, totalHandlers: entries.length });
  }

  /**
   * Remove all hooks registered under a given `packageId`. Used by
   * `bindHooksToEngine` to make re-binding (hot reload, app reinstall)
   * idempotent, and by app uninstall flows.
   */
  unregisterHooksByPackage(packageId: string): number {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    const readHooks = () => this.hooks;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof unregisterHooksByPackage> = {
      get hooks() { return readHooks(); },
      get logger() { return readLogger(); },
    };
    return unregisterHooksByPackage.call(host, packageId);
  }

  /**
   * Register a named function handler that can later be referenced by
   * string from a `Hook.handler` field, an `Action.target`, or a flow
   * `script` node's `config.function`. This is the JSON-safe form of
   * handler binding — declarative metadata persisted to disk or shipped
   * over the wire only carries the name. A `Hook.handler` reaches the entry
   * only from a hook of the same `packageId` (`bindHooksToEngine`).
   *
   * The third parameter accepts either the owning `packageId` (its original
   * shape, unchanged for every existing caller) or a
   * {@link FunctionRegistrationOptions} record that also carries what the
   * function DECLARES about itself — today its data `effect` (#4396).
   */
  registerFunction(
    name: string,
    handler: HookHandler,
    packageIdOrOptions?: string | FunctionRegistrationOptions,
  ): void {
    if (!name || typeof handler !== 'function') return;
    const opts: FunctionRegistrationOptions =
      typeof packageIdOrOptions === 'string' ? { packageId: packageIdOrOptions } : (packageIdOrOptions ?? {});
    const { packageId, effect } = opts;
    this.functions.set(name, { handler, packageId, ...(effect ? { effect } : {}) });
    this.logger.debug('Registered function', { name, packageId, effect });
  }

  /** Look up a registered function by name. */
  resolveFunction(name: string): HookHandler | undefined {
    return this.functions.get(name)?.handler;
  }

  /**
   * Look up a registered function's FULL entry — the handler plus whatever it
   * declared about itself (#4396). `resolveFunction` above answers "can I call
   * it"; a caller that must also report what the call did (the automation
   * engine's `script` node, feeding the #4354 run summary) needs the
   * declaration, and reading it off the same registry keeps the two from
   * drifting.
   */
  resolveFunctionEntry(name: string): Readonly<FunctionEntry> | undefined {
    return this.functions.get(name);
  }

  /** Remove all functions registered under a given `packageId`. */
  unregisterFunctionsByPackage(packageId: string): number {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    const readFunctions = () => this.functions;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof unregisterFunctionsByPackage> = {
      get functions() { return readFunctions(); },
      get logger() { return readLogger(); },
    };
    return unregisterFunctionsByPackage.call(host, packageId);
  }

  /**
   * Bind a list of declarative `Hook` metadata definitions to this engine.
   *
   * Convenience proxy to the canonical `bindHooksToEngine` so callers do
   * not need a separate import. Use `import { bindHooksToEngine } from
   * '@objectstack/objectql'` directly when you want the result object.
   */
  bindHooks(hooks: any[] | undefined, opts?: {
    packageId?: string;
    functions?: Record<string, HookHandler>;
    bodyRunner?: any;
    strict?: boolean;
    warnLegacyHandler?: boolean;
    metrics?: any;
    /** Wraps each in-process handler after its name resolves — see {@link BindHooksOptions.wrapHandler}. */
    wrapHandler?: BindHooksOptions['wrapHandler'];
  }): void {
    const merged = { ...(opts ?? {}), logger: this.logger } as any;
    if (!merged.bodyRunner && this._defaultBodyRunner) {
      merged.bodyRunner = this._defaultBodyRunner;
    }
    if (merged.strict === undefined && (this as any)._strictHookBinding) {
      merged.strict = true;
    }
    if (merged.warnLegacyHandler === undefined && (this as any)._warnLegacyHandler) {
      merged.warnLegacyHandler = true;
    }
    if (!merged.metrics && (this as any)._hookMetricsRecorder) {
      merged.metrics = (this as any)._hookMetricsRecorder;
    }
    bindHooksToEngine(this, hooks, merged);
  }

  /** Default hook body-runner — see {@link setDefaultBodyRunner}. */
  private _defaultBodyRunner?: any;
  /** Default action body-runner factory — see {@link setDefaultActionRunner}. */
  private _defaultActionRunner?: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined;

  /**
   * Install a default body-runner used when `bindHooks` is called without
   * an explicit one. The runtime layer sets this once on each per-project
   * engine so every binding path (template seed, metadata sync, AppPlugin)
   * can execute hook `body.source` consistently.
   *
   * FIRST-WINS (#4251): "set once per engine" is this method's own contract,
   * so the method enforces it — a second call is ignored and returns `false`.
   * Callers used to implement the guard themselves by probing the private
   * `_defaultBodyRunner` field through `any` (multiple AppPlugin instances on
   * one kernel must not clobber each other's runner), which meant the
   * invariant lived in every caller and belonged to none. Nobody replaces a
   * runner on a live engine: every setter call site either owns a fresh
   * engine or wants exactly this keep-the-first behaviour.
   *
   * @returns `true` when this call installed the runner, `false` when one was
   * already present (kept unchanged).
   */
  setDefaultBodyRunner(runner: any): boolean {
    if (this._defaultBodyRunner) {
      this.logger.debug('Default body runner already installed — keeping the first');
      return false;
    }
    this._defaultBodyRunner = runner;
    return true;
  }

  /** The installed default body-runner, if any — the public read the first-wins guard implies. */
  getDefaultBodyRunner(): any {
    return this._defaultBodyRunner;
  }

  /**
   * Install a default ACTION body-runner factory: `(actionDef) => handler |
   * undefined`. The runtime layer sets this once per engine (same boot point
   * as {@link setDefaultBodyRunner}) so runtime-authored `action` metadata —
   * which registers through paths that have no sandbox access of their own,
   * notably ObjectQLPlugin's metadata-service re-sync — can turn a declarative
   * `body` into an executable `registerAction` handler. The factory returns
   * `undefined` for actions it cannot run (no `body`, invalid shape), which
   * callers must treat as "skip", not an error.
   *
   * FIRST-WINS (#4251) — same contract and rationale as
   * {@link setDefaultBodyRunner}.
   *
   * @returns `true` when this call installed the runner, `false` when one was
   * already present (kept unchanged).
   */
  setDefaultActionRunner(runner: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined): boolean {
    if (this._defaultActionRunner) {
      this.logger.debug('Default action runner already installed — keeping the first');
      return false;
    }
    this._defaultActionRunner = runner;
    return true;
  }

  /** The installed default action-runner factory, if any. */
  getDefaultActionRunner(): ((actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined) | undefined {
    return this._defaultActionRunner;
  }

  /**
   * Toggle strict hook-binding mode for this engine. When enabled, every
   * subsequent `bindHooks` call rejects on the first unresolved hook
   * instead of silently warning. Production runtimes should enable this.
   */
  setStrictHookBinding(strict: boolean): void {
    (this as any)._strictHookBinding = strict;
  }

  /** Toggle deprecation warnings for hooks still using legacy `handler` ref. */
  setWarnLegacyHandler(warn: boolean): void {
    (this as any)._warnLegacyHandler = warn;
  }

  /**
   * Install a metrics recorder used by every subsequent `bindHooks` call.
   * The recorder's methods are invoked per-execution to count outcomes
   * (success / error / timeout / capability_rejected), skips, and retries.
   * Defaults to no-op so the engine pays zero cost when nobody is observing.
   */
  setHookMetricsRecorder(recorder: any): void {
    (this as any)._hookMetricsRecorder = recorder;
  }

  /** Read the engine's installed metrics recorder, if any. */
  getHookMetricsRecorder(): any {
    return (this as any)._hookMetricsRecorder;
  }

  /**
   * Dispatch `event` to every registered handler that covers `context.object`,
   * in priority order, awaiting each in turn.
   *
   * ⚠️ This runs wherever the caller calls it — it does NOT wait for a commit.
   * An `after*` dispatch made from inside an open transaction therefore fires
   * for a write that can still be rolled back; that is the declared semantics
   * (#7477), stated in full on {@link DISPATCHABLE_HOOK_EVENTS}. Anything
   * added here that defers a dispatch past the enclosing unit of work would be
   * changing that ruling, not implementing it.
   */
  public async triggerHooks(event: string, context: HookContext) {
    const entries = this.hooks.get(event) || [];
    // [#28251] `ctx.notice` — the write's own `onNotice` listener, bound here
    // so every insert / update dispatch site carries it (see hook-notice.ts).
    bindHookNotice(event, context);

    if (entries.length === 0) {
      this.logger.debug('No hooks registered for event', { event });
      return;
    }

    this.logger.debug('Triggering hooks', { event, count: entries.length });

    // `session.skipAutomations` (set from ExecutionContext.skipAutomations —
    // import with "run automations & triggers" unchecked, import undo)
    // suppresses hooks bound FROM METADATA (`bindHooksToEngine` stamps
    // `entry.meta`). Hooks registered in code by plugins — audit, capability
    // gates, sharing projection — have no `meta` and always run: the opt-out
    // must never bypass security or audit (#2922).
    const skipAutomations =
      (context.session as { skipAutomations?: boolean } | undefined)?.skipAutomations === true;

    for (const entry of entries) {
      // Per-object matching — allow face minus exclusion face, the one shared
      // rule `hasHooksFor` also reads (#5928).
      if (!hookMatchesObject(entry, context.object)) {
        continue; // Skip non-matching hooks
      }
      if (skipAutomations && entry.meta) {
        this.logger.debug('Skipping metadata-bound hook (skipAutomations)', { event, hook: entry.hookName });
        continue;
      }
      // [#29422] A stale-roll-up refusal a hook's own `ctx.api` write raised
      // describes THAT write, not this one: `hookStoppedRefusal`.
      try {
        await entry.handler(context);
      } catch (e) {
        throw hookStoppedRefusal(e, event, context.object, entry.hookName);
      }
    }
  }

  /**
   * [#5038] Would `triggerHooks(event, ctx)` reach ANY handler for `object`?
   *
   * Applies the SAME per-object rule the dispatch loop applies — literally the
   * same function, {@link hookMatchesObject}, since #5928 — because this answer
   * gates a READ of the whole matched row set on the bulk write path. Getting
   * it looser than the dispatch loop only costs a wasted query; getting it
   * TIGHTER would silently drop hooks that were going to fire. Until #5928 the
   * two were separate hand-written copies of one semantic and this comment
   * asked the reader to keep them in step; sharing the function is what
   * actually keeps them in step, and the property test in
   * `hook-exclude-objects.test.ts` pins the direction that matters.
   *
   * `session.skipAutomations` is deliberately NOT consulted: it suppresses only
   * metadata-bound entries, and code-registered hooks (audit, sharing) still
   * run, so the row set is still needed. Over-reading in that case is a cost,
   * never a correctness loss — and it is the SAFE side of the asymmetry above,
   * which is why the pin asserts an implication rather than an equality.
   */
  private hasHooksFor(event: string, object: string): boolean {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) return false;
    return entries.some((entry) => hookMatchesObject(entry, object));
  }

  /**
   * [#22782] Does this write need its own unit of work? Yes when its `after*`
   * dispatch can ABORT and no unit is open, so the abort rolls back what
   * `HookSchema.onError` says: the row and every `ctx.api` write the chain made. "Can abort"
   * is a metadata-bound hook (`meta` — the only entries with a declared
   * `onError`) on `event` for `object`, automations not skipped, that either
   * is blocking (not `async`) with `onError` `abort` (the default), or carries
   * a `condition` (#22856): a condition that cannot be evaluated aborts the
   * operation whatever `onError` says, and before an `async` hook detaches
   * (#4775, `HookConditionError`), so it is read by the wrapper's own
   * {@link declaredHookCondition}. Hook count and order are untouched (#7413);
   * only the boundary around them moves.
   *
   * No unit — the pre-#22782 path — when one is open (ambient or threaded: the
   * caller's unit decides; a threaded handle whose unit has closed is not open,
   * #22855 `isClosedUnitHandle`), when `object` is off the default driver
   * (`transaction()` covers that one alone and would refuse the write), or when
   * that driver has no transactions (ADR-0119 D1; asking would only warn).
   * `SummaryRecomputeError` means "the records WERE written": it is rethrown
   * after the commit, never through the rollback. Only the write's OWN refusal
   * arrives here: one a hook's `ctx.api` write raised was already converted
   * where it left the handler (#29422, `hookStoppedRefusal`), so it rolls back.
   */
  private opensAfterAbortUnit(event: 'afterInsert' | 'afterUpdate' | 'afterDelete', object: string, context: ExecutionContext | undefined): boolean {
    const threaded = context?.transaction;
    if ((threaded !== undefined && !this.isClosedUnitHandle(threaded)) || this.txStore.getStore()?.transaction !== undefined) return false;
    if ((context as { skipAutomations?: unknown } | undefined)?.skipAutomations) return false;
    const aborting = (this.hooks.get(event) ?? []).some((entry) =>
      entry.meta && hookMatchesObject(entry, object)
      && ((!entry.meta.async && (entry.meta.onError ?? 'abort') === 'abort') || declaredHookCondition(entry.meta) !== undefined));
    if (!aborting) return false;
    const defaultDriver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    try {
      return this.getDriver(object) === defaultDriver && driverSupportsTransactions(defaultDriver);
    } catch {
      return false; // the write itself reports an unroutable object
    }
  }

  /** [#22782] The unit {@link opensAfterAbortUnit} asked for; `write` re-enters the door, which joins it. */
  private async inAfterAbortUnit<T>(write: () => Promise<T>): Promise<T> {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts` (see `HookDispatchHost`).
    const host: ThisParameterType<typeof inAfterAbortUnit> = {
      transaction: (...a) => this.transaction(...a),
    };
    return (inAfterAbortUnit<T>).call(host, write);
  }

  /**
   * [#5038] The per-row after-hook contexts a predicate (`multi: true`) write
   * dispatches, one per matched row.
   *
   * ## Why per row at all
   *
   * ADR-0058's bulk-write addendum (the 2026-08-04 ruling on #4800 / #4862)
   * records the contract: **a bulk write is N record changes, so after-hooks
   * and the record-change flow triggers riding them evaluate and fire PER
   * ROW**, with `previous` = that row's pre-write state and `record` = that
   * row's actual state. Before it, the engine fired the hook ONCE, never
   * assigned `previous`, and left `record` degraded to the bare payload — so
   * the transition condition both the docs and ten showcase flows teach
   * (`status == "done" && previous.status != "done"`) was unevaluable on a
   * bulk write, and the audit/notification flows behind it silently did not
   * happen.
   *
   * ## The shape is the SINGLE-RECORD shape, deliberately
   *
   * Each context is exactly what a single-id write builds — `input.id` is the
   * row, `input.data` is this write's payload, `result` is the row's state,
   * `previous` is its pre-image. That is #2922's ruling for batch INSERT
   * restated: a single array-shaped context "broke every consumer built for
   * the single shape", so a per-row context must be indistinguishable from a
   * record-scoped one. It is also what makes this fix land at the PRODUCER:
   * `hook-wrappers`' `record`/`previous` bindings, the record-change trigger's
   * `buildContext`, and plugin-audit's diff all read these same four fields and
   * need no bulk-aware branch of their own.
   *
   * `input.data` is a shallow COPY per row: the batch has one payload, but an
   * after-handler that writes through the flat-input proxy must not have its
   * mutation leak into the next row's view.
   *
   * ## `result` is composed, not re-read
   *
   * The row's post-write state is `row ⊕ payload` — the pre-image the matched
   * set already gave us, overlaid with the payload the driver just applied.
   * Composing keeps the issue's performance guardrail literal: the matched row
   * set is read ONCE and reused for every per-row evaluation. Re-reading the
   * batch after the write to capture driver-side stamps would be a second
   * full-set query for fields the after-view has never carried on this path.
   *
   * For a DELETE there is no post-state, so `result` is left unset and
   * `input` carries no `data`: consumers fall back to `previous` (the deleted
   * row), which is what `record` means for a delete.
   */
  private buildPerRowAfterContexts(
    object: string,
    event: 'afterUpdate' | 'afterDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
    payload?: Record<string, unknown>,
  ): HookContext[] {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts` (see `HookDispatchHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof buildPerRowAfterContexts> = {
      get _registry() { return readRegistry(); },
    };
    return buildPerRowAfterContexts.call(host, object, event, rows, batchCtx, payload);
  }

  /**
   * [#5574] The per-row `before*` dispatch of a predicate (`multi: true`)
   * write — ADR-0058 Addendum II, clauses D1–D4.
   *
   * ## D1/D2 — one dispatch per matched row, on the SINGLE-RECORD shape
   *
   * `input.id` names the row, `previous` is that row's pre-image, and
   * `input.options` is still the CALLER's bag (the PHASE rule in `hook.zod.ts`
   * is unchanged: the `before*` phase reads the pre-merge view, `where` and
   * `multi` visible). `result` stays ABSENT — the before phase has no
   * post-state, and a value assigned to `ctx.result` here is overwritten by the
   * write's own result before any `after*` handler could see it.
   *
   * Zero matched rows is zero dispatches, and `[]` is meaningful: a batch that
   * changed nothing is not a record change. The caller checks that BEFORE
   * calling in, so an empty row set never reaches this loop.
   *
   * ## D3 — the payload is BATCH-scoped, and that IS the merge rule
   *
   * Every per-row context carries THE payload, not a copy — deliberately
   * unlike {@link buildPerRowAfterContexts}, which copies because an
   * after-handler's mutation has nowhere legitimate to go. There is exactly one
   * payload for a predicate update (`driver.updateMany` takes one SET clause
   * for N rows), so:
   *
   *  - a rewrite takes effect on the WHOLE batch, whichever row's dispatch made
   *    it, and rewrites ACCUMULATE across the N dispatches in dispatch order;
   *  - N post-hook payloads cannot diverge, so nothing is reconciled, no
   *    payload is discarded, and no predicate write is ever split into N
   *    single-row writes.
   *
   * Two ways a handler can write the payload and both must accumulate: mutating
   * it in place (`ctx.input.data.x = 1`) needs no help, while REPLACING it
   * (`ctx.input.data = {…}`) would otherwise be lost with the row context that
   * held it. So each row reads the batch payload fresh and writes it back after
   * its dispatch — that write-back is what makes "accumulate in dispatch order"
   * true for both spellings rather than only the first.
   *
   * A rewrite CONDITIONED on the row (`ctx.previous`, `ctx.input.id`) cannot
   * scope itself to the row it was decided on: it widens to every matched row.
   * Per-row `previous` is supplied so a guard can REFUSE the write (throw),
   * and — ruled on #16074 — so a hook can make a ROW-INVARIANT-IN-EFFECT
   * rewrite: one whose written KEY SET is the same on every matched row AND is
   * assigned IN PLACE (`ctx.input.data.x = 1`, never `ctx.input.data = {…}`,
   * which the recording below cannot attribute). A rewrite AIMED at one row
   * stays outside the contract, and what makes the admitted shape safe is that
   * enforcement rather than the hook's good faith.
   *
   * ## D3, ENFORCED — divergent key sets refuse the batch [#14099]
   *
   * That last paragraph used to end "a contract statement, not an enforcement
   * — no static rule can decide whether a rewrite is row-invariant". The second
   * half is still true and the conclusion no longer follows: nothing STATIC can
   * decide it, but the dispatch can MEASURE it. #14088's recorder is armed once
   * more per row here, so each dispatch reports the set of payload keys THAT
   * row's hook chain assigned; if two rows disagree, the batch is refused whole
   * before any write ({@link MultiUpdateHookKeyDivergenceError}).
   *
   * Maintainer ruling of 2026-09-02, on the corruption `duly` measured against
   * published 17.2.0 — a `completed_at` transition stamp moved an
   * already-completed row's timestamp, silently, on a two-row batch. The
   * criterion is the key SET and never the values, which is what lets the
   * clock-reading audit stamp through: every row writes `updated_at`, so an
   * honest batch is never refused non-deterministically. The full argument,
   * both rejected value-comparison variants, and the blind spot the ruling
   * carries openly (same key, per-row VALUES) live on
   * `multi-update-hook-key-divergence.ts`.
   *
   * ## D4 — `input.id` is not a reroute lever here
   *
   * On the old batch dispatch it was: `input.id` was present-but-`undefined`,
   * and binding it moved the write onto the single-id branch. A per-row context
   * arrives with `id` already bound and the dispatch already decided, so
   * rebinding retargets nothing — and is refused rather than ignored.
   */
  private async dispatchPerRowBeforeHooks(
    object: string,
    event: 'beforeUpdate' | 'beforeDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
  ): Promise<void> {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts` (see `HookDispatchHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof dispatchPerRowBeforeHooks> = {
      get _registry() { return readRegistry(); },
      triggerHooks: (...a) => this.triggerHooks(...a),
    };
    return dispatchPerRowBeforeHooks.call(host, object, event, rows, batchCtx);
  }

  /**
   * [#9719, widened to `beforeUpdate` by #9974] The whole-operation
   * `beforeUpdate` / `beforeDelete` dispatch for an UNSCOPED predicate write —
   * `multi: true` with no caller predicate at all (`options.where` absent or
   * `null`) — delivered ONLY to registrations that declared
   * {@link HookEntry.dispatchUnscopedMultiWrite} on `event`.
   *
   * ## Why this dispatch exists
   *
   * The per-row contract (#5038 / #5574) made the operation's SHAPE invisible
   * to `before*` handlers on the predicate path: every per-row context arrives
   * with `input.id` bound, and a zero-match predicate dispatches nothing at
   * all ([D1]). A guard whose rule is about the shape — #4757's "refuse a
   * predicate-less multi-delete outright, regardless of what it matches" on
   * `sys_attachment`, and #4630's twin on `sys_comment` — therefore could not
   * fire through the wired engine: with rows matched its by-id branch shadowed
   * the check, and with none matched it never ran. Both limbs need a dispatch
   * that happens BEFORE the matched-row read, keyed on the operation's shape
   * alone.
   *
   * ## Why one helper, both verbs
   *
   * The update half was measured as a PARTIAL guard rather than a total
   * fail-open (#9974): an unscoped `multi: true` update was refused only when
   * it happened to sweep a row the caller lacked rights to — the per-row gate
   * catching the shape by accident — and resolved silently when the caller was
   * entitled to every row, zero-match included. A guard that fires by accident
   * reads as enforcement while enforcing nothing, which is why the ruling
   * closed it rather than narrowing the declaration. `event` is the ONLY thing
   * that differs between the two verbs here, so it is a parameter and not a
   * second copy of this method.
   *
   * ## What the handler receives
   *
   * The whole-operation context: `input.id` undefined, `input.options` the
   * caller's raw options — the contractual upper-bound read `hook.zod.ts`
   * blesses for `before*` handlers (`input.options.where` / `.multi`) — and
   * `session` built by the engine, so the handler's own bypass rules (system
   * context, no identity envelope) apply unchanged. It is a DERIVED context,
   * not the batch-level one (`hook.zod.ts`: no handler is dispatched on that),
   * carrying `dispatch: { mode: 'record', index: 0 }` — this call stands for
   * the caller's whole write, not for one row of it — with the batch `scope`
   * object kept identity-shared so a stash still reaches the after phase.
   *
   * ## Deliberately opt-in
   *
   * Undeclared registrations see NO new dispatch: generalizing an unscoped-
   * multi-write refusal to every guarded object is a product decision this
   * mechanism does not take (#9719 commissions the `sys_attachment`
   * restoration, #9974 the `sys_comment` update half — neither commissions an
   * engine-wide rule). The engine stays neutral; the policy — who is refused,
   * with which error — lives in the declaring handler.
   *
   * ## The id slot is not a lever here either
   *
   * The old batch dispatch's `input.id` was present-but-`undefined`, and
   * binding it rerouted the write onto the by-id branch. The ladder is now
   * resolved before any handler runs, so a handler binding `input.id` on this
   * context would retarget nothing — refused rather than ignored, the same
   * rule as D4 and #6752 (`HookTargetRebindError`, path `'unscoped-multi'`).
   */
  private dispatchUnscopedMultiWriteHooks(
    event: 'beforeUpdate' | 'beforeDelete',
    object: string,
    batchCtx: HookContext,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    const readHooks = () => this.hooks;
    const host: ThisParameterType<typeof dispatchUnscopedMultiWriteHooks> = {
      get hooks() { return readHooks(); },
    };
    return dispatchUnscopedMultiWriteHooks.call(host, event, object, batchCtx);
  }

  /**
   * [#5038, one ceiling for both phases since #5574] Ceiling on the matched-row
   * set a predicate write fires per-row hooks over.
   *
   * The consequence ADR-0058's addendum told this implementation to price: a
   * hook that used to run once per batch now runs once per row, so a
   * notification hook sends N messages and a cache-invalidation hook runs N
   * times. Unbounded, a single `multi: true` update matching a whole table
   * turns into an unbounded fan-out of handler executions inside one write.
   *
   * Exceeding it REJECTS the write, before the FIRST per-row dispatch and
   * before `updateMany`/`deleteMany` runs, so nothing is written and no handler
   * ran for a batch that was going to be refused anyway. The alternative —
   * quietly falling back to firing once for the batch — is the silent
   * degradation this whole family exists to abolish (#4649/#4775): the hooks
   * would not fire for N-1 rows and nothing would say so.
   *
   * [#5574] The rule itself is `resolveBulkPerRowHookBudget` in
   * `packages/spec/src/data/bulk-write-hook-conformance.ts` (D6), not a copy
   * kept in step by a pin. This method is the RAISING half only: the contract
   * is pure and total (no clock, no I/O, no throw), the engine turns a
   * `refused` verdict into the thrown error. Splitting it that way is what lets
   * `before*` and `after*`, update and delete, share one ceiling and one
   * message with nothing to keep synchronised.
   */
  private assertBulkPerRowHookBudget(object: string, event: string, matched: number): void {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts`; it reads no member.
    return assertBulkPerRowHookBudget(object, event, matched);
  }

  // ========================================
  // Action System
  // ========================================

  /**
   * Register a named action on an object.
   * Actions are custom business logic callable via `repo.execute(actionName, params)`.
   *
   * @param objectName Target object
   * @param actionName Unique action name within the object
   * @param handler Handler function. Authoring sites should annotate it with
   *   `ActionHandler` from `@objectstack/spec/ui` (ADR-0104 D2) rather than an
   *   inline `(ctx: any)`; the params on `ctx` are validated against the
   *   action's declared param contract at dispatch before the handler runs.
   *   The seam itself stays untyped so existing untyped handlers keep working.
   * @param packageName Optional package owner (for cleanup)
   *
   * [#24472] A key another package already holds is still replaced — the last
   * registration runs, as before — but no longer silently: the replacement is
   * warned, naming both owners. The same owner re-registering (a re-bind, a
   * reload, the authored-action resync, which tears its set down first) is
   * not. A registration with no `packageName` is its own owner here, so it
   * replacing a package's handler, or the reverse, is warned too.
   */
  registerAction(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    const readActions = () => this.actions;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof registerAction> = {
      get actions() { return readActions(); },
      get logger() { return readLogger(); },
    };
    return registerAction.call(host, objectName, actionName, handler, packageName);
  }

  /**
   * Execute a named action on an object.
   */
  async executeAction(objectName: string, actionName: string, ctx: any): Promise<any> {
    const entry = this.actions.get(`${objectName}:${actionName}`);
    if (!entry) {
      throw new Error(`Action '${actionName}' on object '${objectName}' not found`);
    }
    return entry.handler(ctx);
  }

  /**
   * Every action handler currently registered, as `{ objectName, actionName }`
   * pairs (plus the owning package when one was given).
   *
   * [ADR-0110 D5] The handler registry is one half of the
   * declaration↔executable bijection; with no way to enumerate it, the other
   * half could only be checked when someone happened to invoke a route. The
   * boot reconciliation reads this to list handlers no declaration covers —
   * which since D3 are refused at dispatch, so having the inventory is what
   * makes that refusal a checklist instead of a support ticket.
   */
  listRegisteredActions(): Array<{ objectName: string; actionName: string; package?: string }> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    const readActions = () => this.actions;
    const host: ThisParameterType<typeof listRegisteredActions> = {
      get actions() { return readActions(); },
    };
    return listRegisteredActions.call(host);
  }

  /**
   * Remove all actions registered by a specific package.
   */
  removeActionsByPackage(packageName: string): void {
    for (const [key, entry] of this.actions.entries()) {
      if (entry.package === packageName) {
        this.actions.delete(key);
      }
    }
  }

  // ========================================
  // [ADR-0126 §8] Packaged-action activation
  // ========================================
  //
  // Seven thin members over {@link ActionActivationProjection}. They are on the
  // engine — rather than reached as a free-standing service — because the
  // dispatch doors already hold `ql` and nothing else they hold is
  // per-environment, unconditional and alive at boot at the same time.
  //
  // ⛔ None of them is a consult POINT. `executeAction` above deliberately does
  // not call `isActionEnabled`: it receives a HANDLER KEY (ADR-0110 D2 — the
  // key may be the declaration's `target`, not its `name`), and the ledger
  // addresses an action by its declarative name, so a check there would ask a
  // question the arguments cannot answer and would miss every target-bound
  // action. The consult lives where a resolved DECLARATION exists — the two
  // dispatch doors in `@objectstack/runtime` — and each one is pinned.

  /**
   * Attach the durable activation ledger (ADR-0126 §4). Hosts call this at
   * start(), once the datasource behind `sys_metadata_activation` is reachable
   * — see `ObjectQLPlugin`, which probes the table before attaching so a
   * missing ledger degrades visibly instead of at the first flip.
   */
  setActionActivationStore(store: ActionActivationStore): void {
    this.actionActivation.attach(store);
  }

  /**
   * [ADR-0126 §8] Load the ledger into the engine's projection, returning the
   * names it switched off so the host can report them in its boot audit.
   *
   * Called once per boot AFTER the authored-action re-sync, for the reason the
   * governance inventory runs there: the registry is final for the boot, so the
   * audit line describes the deployment that will actually serve requests.
   */
  async hydrateActionActivations(): Promise<string[]> {
    return this.actionActivation.hydrate();
  }

  /**
   * Is this DECLARED action armed for this installation (ADR-0126 §8)?
   * Absence of a ledger row means the packaged default — active — so a stock
   * boot answers `true` for everything, exactly as it always has.
   */
  isActionEnabled(actionName: string): boolean {
    return this.actionActivation.isEnabled(actionName);
  }

  /** Every action name the ledger currently switches off (operability reads). */
  listDisabledActions(): string[] {
    return this.actionActivation.disabledNames();
  }

  /**
   * [#27842] `IObjectQLEngine.getDisabledActions` — what the metadata read
   * serves beside an object as `disabledActions`: the names the projection
   * the doors consult switches off, or `undefined` while no ledger is
   * attached, so the read serves no key rather than claiming that nothing is
   * off. {@link listDisabledActions} answers `[]` for both cases, and keeps
   * that answer.
   */
  getDisabledActions(): string[] | undefined {
    return this.actionActivation.durable ? this.actionActivation.disabledNames() : undefined;
  }

  /**
   * The `ACTION_DISABLED` refusal SENTENCE, produced by the projection so both
   * dispatch doors state one refusal rather than two that agree today.
   *
   * [#27842] The sentence is written for the person who clicked, so it names
   * no table and no ADR. Those, with the code and the action's name, go to
   * the log line written here: both doors ask for the sentence exactly when
   * they refuse (`disabledActionRefusal` in `@objectstack/runtime`), so this
   * is the one place every refusal passes that holds the host's logger. It is
   * `info`, not `warn`: the refusal is handed to the caller, and nothing is
   * degraded (AGENTS.md "Degradation log levels").
   */
  describeDisabledAction(actionName: string): string {
    this.logger.info(
      `ACTION_DISABLED: packaged action '${actionName}' refused — it is switched off in the activation ledger ` +
        '(sys_metadata_activation, ADR-0126 §8 item 2).',
      { action: actionName, refusal: 'ACTION_DISABLED' },
    );
    return this.actionActivation.describeDisabled(actionName);
  }

  /**
   * [ADR-0126 §8] Flip a packaged action's activation — the durable row FIRST,
   * the projection only after that write returns. Throws (503
   * `SERVICE_UNAVAILABLE`) when no ledger is attached rather than reporting a
   * durable switch that did not persist; the write AUTHORITY (§5) is enforced
   * one tier up, at the route, because it needs the caller. That route also
   * names the caller in `options.context` (elevated), so the ledger row and
   * its audit row record who switched the action.
   */
  async setActionActive(row: ActionActivationRow, options?: ActionActivationWriteOptions): Promise<void> {
    await this.actionActivation.setActive(row, options);
  }

  /**
   * "Which of these tombstoned `sys_file` rows is something still holding?"
   * (commit c3c72a4bc) — supplied by the storage plugin, never derived here.
   *
   * File-field hydration must answer the same question the download path
   * answers (#10246) or one row gets two answers. That question has exactly one
   * definition, `findFileHolder`, and it lives in `@objectstack/service-storage`
   * — a package this one does not and must not depend on. So the engine
   * declares the seam and the storage plugin fills it, the same handover
   * `resolveFileHolder` makes to the download routes.
   *
   * BATCHED on purpose: hydration runs over many rows per read, so a per-row
   * holder check would be N queries per read. The resolver takes the whole
   * tombstoned set and returns the ids still held.
   */
  private _heldFileResolver?: HeldFileResolver;

  /**
   * Wire the batched holder question (commit c3c72a4bc). Last registration wins; leaving
   * it unwired keeps tombstoned files un-hydrated, which is what this engine
   * did before the seam existed.
   */
  registerHeldFileResolver(fn: HeldFileResolver): void {
    this._heldFileResolver = fn;
    this.logger.debug('Registered held-file resolver for sys_file hydration');
  }

  /**
   * "May this caller read the files these records' fields own?" (#22637) —
   * supplied by the storage plugin, never decided here.
   *
   * Asked only by file-field hydration, and only when the caller's own
   * `sys_file` read was refused: a field's metadata then follows the same
   * parent-derived verdict the download door applies to the bytes (ADR-0104
   * D3, maintainer ruling B on #22624). That verdict has exactly one
   * definition — the field-owned arm of `@objectstack/service-storage`'s
   * download authorizer, which consults a declared `fileAccessDelegate` and
   * otherwise the caller's read of the owner record — and it lives in a package
   * this one does not and must not depend on. So the engine declares the seam
   * and the storage plugin fills it, the same handover as
   * {@link registerHeldFileResolver}.
   */
  private _fieldOwnedFileReadAuthorizer?: FieldOwnedFileReadAuthorizer;

  /**
   * Wire the field-owned file read verdict (#22637). Last registration wins;
   * leaving it unwired keeps every id a refused caller holds marked
   * `{ id, metadataRefused: true }`, which is what this engine did before the
   * seam existed.
   */
  registerFieldOwnedFileReadAuthorizer(fn: FieldOwnedFileReadAuthorizer): void {
    this._fieldOwnedFileReadAuthorizer = fn;
    this.logger.debug('Registered field-owned file read authorizer for refused sys_file hydration');
  }

  /**
   * [#18682] "May this context CREATE or UPDATE this object?" — supplied by the
   * security plugin, never decided here.
   *
   * ## What it protects
   *
   * A validation rule reads its related record under SYSTEM authority, and the
   * accepted cost of that is an inference channel: a caller can learn something
   * about a value they cannot read by observing which of THEIR WRITES are
   * refused.
   *
   * `validate()` runs NO middleware for the target object, by design.
   * Its network ingress (the `dryRun` import) checks auth and
   * API access but not the caller's CRUD grant on the object. So the elevated
   * read, wired into the preview without this gate, would hand the same
   * one-bit-per-row oracle to any authenticated caller with no permission on the
   * object and no ability to write it at all — a strictly wider channel than the
   * one that was accepted.
   *
   * ## The payload is part of the question — and so are the limits
   *
   * The write decision is not object-level. The middleware also refuses a write
   * for reasons that depend on THE PAYLOAD, before any rule runs: the
   * field-level-security write gate refuses a caller who holds the object's
   * CRUD grant but is not `editable` on a field the payload names. So the
   * caller's rows are handed to the probe, and the plugin answers over them —
   * an editor of the child object who is FLS-locked out of the lookup column is
   * refused by `insert()` and refused the elevated read here, alike.
   *
   * ⭐ What this gate closes, stated POSITIVELY — by NAMING WHAT IT RUNS, ⛔
   * never by naming a category of the write decision. An elevated read is
   * issued only for a caller that passes, in the middleware's own order: the
   * ADR-0103 engine-owned affordance gate and the ADR-0090 D12 delegated-admin
   * gate (both BEFORE any permission set resolves, both the middleware's own
   * primitives), the fail-closed postures (#3545's unresolvable posture and the
   * D10 dangling delegator), the ADR-0066 D3 capability AND-gate for both
   * principals, the `allowCreate`/`allowEdit` CRUD grant, the ADR-0090 D10
   * delegator's independent grant, the middleware's own step 2.5 FLS write gate
   * over the keys THIS payload names, and its ADR-0123 D2 no-active-organization
   * refusal (step 3.7's scope pre-test, asked with no row, so it refuses a
   * caller class). The gate says nothing about any refusal not in that list.
   * [#25062] ⛔ In particular it is not step 3.7's judgement of a ROW's
   * organization (the forge guard, an emptied organization, an insert with
   * nowhere to land): it is handed no row to judge, and it answers `true` for
   * a caller whose payload names an organization the write refuses. That is
   * the write-wall verdict's question, asked per row
   * ({@link registerWriteWallVerdict}).
   * `@objectstack/plugin-security`'s `can-write-object-admission.test.ts` pins
   * the probe's answer equal to the registered middleware's on its equivalence
   * block's cases, and pins one D12 UPDATE case as a direction: the probe
   * `false`, the middleware `true`.
   *
   * ⛔ A `true` here is NOT a promise that the write would succeed, and ⛔ no
   * enumeration of the distance to success is attempted — the middleware
   * refuses both before and after `next()` for reasons this gate is never
   * asked. The families nearest to hand, named so the arms above are not read
   * as the whole write decision:
   *
   *  - **The remaining PRE-RESOLUTION gates, which run beside the two named
   *    above.** Two judge a row's PROVENANCE, which the preview holds no row to
   *    carry: the ADR-0086/0094 package-managed write gate and the ADR-0066
   *    system-row write gate. One judges a payload VALUE: the ADR-0066 D1
   *    curated-capability-name refusal (the ADR-0090 D5/D9 audience-anchor
   *    binding guard retired with `sys_position_permission_set`, C3 stage 8).
   *    And the ADR-0056 `publicFormGrant` scope, which admits
   *    create plus read-back on exactly the granted object and refuses
   *    everything else — not asked because no wire caller and no constructor
   *    in the tree presents that grant here (only the public form-submit route
   *    constructs one, and it goes to the real write, never to a preview) and
   *    because it has no extracted primitive to call, so an arm would be a
   *    second spelling of its scope.
   *  - **Row-level and post-image refusals — the preview names no stored row.**
   *    The step 2.7 `using` pre-image, the ADR-0055 controlled-by-parent
   *    master-edit check (step 2.8), the RLS `check` post-image (step 3.6) and
   *    the Layer 0 tenant post-image (step 3.7) each judge a ROW: a prior
   *    image, a master record, or a pre-image merged with the change set. This
   *    gate is handed none of them, so it judges none of them. [#25062] The
   *    tenant wall's judgement of the row the preview holds comes through
   *    {@link registerWriteWallVerdict} instead: it decides what the preview
   *    answers for that row, never whether this gate's related read happens.
   *  - **Payload-VALUE refusals — the same caller passes by not sending the
   *    value.** The masked-echo write refusal (step 2.5a) and the `owner_id`
   *    ownership forge (step 3.5) refuse a VALUE, not a caller: the identical
   *    caller sending the identical row without the echoed or forged value is
   *    admitted. They widen the caller class by nothing, which is why this gate
   *    does not ask them — measured, with the CRUD grant held and the column
   *    editable and `owner_id` naming another user, `insert()` refuses at step
   *    3.5 with ZERO related reads while the preview issues ONE.
   *  - **The caller's own PREDICATE.** Step 2.9's anti-filter-oracle guard
   *    refuses an update whose `where` names a field the caller may not read.
   *    The preview carries no predicate, so that guard is never asked here.
   *  - **After `next()`.** The fail-closed assertion that the engine honoured
   *    `OperationContext.postHookWriteImageCheck` — that the insert `check`
   *    seam really ran — refuses a write that already executed, which no
   *    preview can be asked about at all.
   *  - **The static `readonly` strip.** `insert()` strips an author-declared
   *    `readonly` reference field inside the write's executor, so the real
   *    write resolves NO related row for it and a traversing rule refuses;
   *    the preview runs no strip, resolves the caller's own foreign key and
   *    answers the rule against it — an id the write path never carries.
   *
   * ## Unwired
   *
   * A composition with no security plugin has no CRUD gate on the write path
   * either, so there is no bound to restore and the preview resolves. That is
   * the same behaviour such a composition already has everywhere else.
   */
  private _writeGateProbe?: (
    object: string,
    operation: 'insert' | 'update',
    context: unknown,
    data: unknown,
  ) => Promise<boolean>;

  /**
   * Wire the create/update gate question (#18682). Last registration wins.
   *
   * `data` is the caller's RAW payload for this preview — the rows exactly as
   * they arrived, before `applyFieldDefaults` and before any hook, which is the
   * same image the middleware's own field-level gate reads off `opCtx.data`.
   * ⛔ Not the defaulted rows: a default the runtime fills is not a field the
   * caller wrote, and judging it would refuse writes the real path accepts.
   */
  registerWriteGateProbe(
    fn: (
      object: string,
      operation: 'insert' | 'update',
      context: unknown,
      data: unknown,
    ) => Promise<boolean>,
  ): void {
    this._writeGateProbe = fn;
    this.logger.debug('Registered write-gate probe for validate() relationship resolution');
  }

  /**
   * [#25062] The Layer 0 tenant write wall's verdict on each row of a write
   * preview — supplied by the security plugin, never decided here.
   *
   * `validate()` runs no middleware, so the wall's judgement of a row's
   * `organization_id` never reached it: the preview ran the static-`readonly`
   * strip unconditionally, reported a caller's organization DROPPED where the
   * write stores it as sent (the wall judges it, `judgesOrganization`), and
   * answered VALID a row naming an organization the write refuses 403. The
   * write-gate probe cannot carry this: it answers whether a CALLER may write,
   * one boolean for the set; the wall judges a VALUE a row carries. Two
   * questions, two members. ⛔ Nor is the verdict derived here from the posture,
   * `tenantId` or `accessible_org_ids`: that would be a mirror of the wall.
   *
   * `rows` are the preview's own: after the defaults (insert) and before any
   * hook, the caller's rows on an update. `validate()` reads each row's verdict
   * and nothing else: an admitted row whose organization the wall judges keeps
   * the column out of the static-`readonly` strip, exactly where
   * `insert()` / `update()` keep it; a refused row is answered `valid: false`
   * with the write's code and message, on its own, as the preview answers
   * every other refusal.
   *
   * Unregistered is a DEFINED state, as for the members beside it: no wall, no
   * verdict, and the strip runs as it always has, which is also what the write
   * does in a composition without the security plugin. A seam that throws
   * rejects the preview, as a refusal to resolve fails the write.
   */
  private _writeWallVerdict?: WriteWallVerdict;

  /** Wire the write wall's per-row verdict for `validate()` (#25062). Last registration wins. */
  registerWriteWallVerdict(fn: WriteWallVerdict): void {
    this._writeWallVerdict = fn;
    this.logger.debug('Registered write-wall verdict for validate() organization judgement');
  }

  /**
   * [#18783] Where the acting subject's EFFECTIVE object permissions come from —
   * the map `current_user.can(object, verb)` is answered from: in a per-option
   * `visibleWhen`, and since #20082 in a `formula` field and a CEL
   * `defaultValue`. Registered by the security plugin (the one producer,
   * `ISecurityService.getEffectiveObjectPermissions`), the same way it
   * registers {@link registerWriteGateProbe}; last registration wins.
   *
   * Unregistered is a DEFINED state, not a fault: the engine then passes NO
   * permission data — ⛔ never an empty map and never one it merged itself — so
   * a `can` expression stays loudly unevaluable, exactly as the contract member
   * prescribes for an absent method. See {@link permissionResolution} for how
   * one operation asks at most once, and each consumer
   * ({@link resolveOptionPermissions}, {@link resolveDefaultPermissions},
   * {@link resolveFormulaPermissions}) for when it asks and what a throw does.
   */
  private _effectiveObjectPermissionsResolver?: (context: unknown) => Promise<unknown>;

  /** Wire the effective object-permission source (#18783). Last registration wins. */
  registerEffectiveObjectPermissionsResolver(fn: (context: unknown) => Promise<unknown>): void {
    this._effectiveObjectPermissionsResolver = fn;
    this.logger.debug('Registered effective object-permission resolver for current_user.can()');
  }

  /** [#25073] {@link registerInsertRecomputeListener}'s listeners, by registrant id. */
  private readonly insertRecomputeListeners = new Map<
    string,
    (event: { object: string; row: Record<string, unknown>; fields: string[] }) => void | Promise<void>
  >();

  /**
   * [#25073] Be told, per row, when an insert computes stored fields again
   * after issuing the row's record number, so a value DERIVED from those
   * fields can be derived again before the row is written.
   *
   * A stored field whose `expression` reads an `autonumber` is computed once
   * before the `beforeInsert` hooks, when the number does not exist yet, and
   * again right after the number is issued (after validation). A
   * `beforeInsert` hook that derived something from the field saw the first
   * value: `plugin-pinyin-search` stamps the `__search` companion from the
   * name field there, so a name field reading the number was searchable
   * without it. The listener runs at the second computation, on the very
   * row the driver is handed, with the names of the fields computed again
   * (`fields`), and on every re-issue after a collision too. What it writes
   * on `row` is written; a throw fails the insert, as a hook's does.
   *
   * Keyed by `id`, so a registrant that binds again replaces itself rather
   * than running twice.
   */
  registerInsertRecomputeListener(
    id: string,
    fn: (event: { object: string; row: Record<string, unknown>; fields: string[] }) => void | Promise<void>,
  ): void {
    this.insertRecomputeListeners.set(id, fn);
    this.logger.debug('Registered insert recompute listener', { id });
  }

  /**
   * The states {@link composeReadableIdsAtBoundary} has already reported for
   * this engine. It records only that the report was made and caches no
   * verdict: every composition resolves the service afresh.
   */
  private readonly readableIdsSecurityReported = new Set<'absent' | 'unusable'>();

  /**
   * [ADR-0139 D2] The three resolutions of the `security` service, kept apart
   * because they are logged apart — and answered alike: only `usable` is
   * asked anything.
   *
   *  - **absent** — no source is in the engine slot, or it answered nothing;
   *  - **unusable** — the slot holds something that is not a function, the
   *    source threw (the in-repo kernels throw on a name nothing registered),
   *    or the service exposes no `getReadFilter`, or neither `canReadObject`
   *    nor `explain`;
   *  - **usable** — ask it.
   */
  private resolveReadableIdsSecurity(): ReadableIdsSecurityResolution {
    // Read from the engine slot at use (see SECURITY_SERVICE_SOURCE_SLOT), never cached.
    const source = (this as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT];
    if (source === undefined || source === null) return { kind: 'absent' };
    if (typeof source !== 'function') {
      return { kind: 'unusable', why: `the security-service source slot holds ${Array.isArray(source) ? 'an array' : `a ${typeof source}`}, not a function` };
    }
    let svc: unknown;
    try {
      svc = source();
    } catch (e) {
      return { kind: 'unusable', why: `resolving the "security" service threw (${String((e as Error)?.message ?? e)})` };
    }
    if (svc === undefined || svc === null) return { kind: 'absent' };
    const candidate = svc as Partial<ReadableIdsSecurity>;
    if (typeof candidate.getReadFilter !== 'function') {
      return { kind: 'unusable', why: 'the registered "security" service exposes no getReadFilter()' };
    }
    if (typeof candidate.canReadObject !== 'function' && typeof candidate.explain !== 'function') {
      return { kind: 'unusable', why: 'the registered "security" service exposes neither canReadObject() nor explain()' };
    }
    return { kind: 'usable', svc: candidate as ReadableIdsSecurity };
  }

  /**
   * [ADR-0139 D2, D5] The executor boundary: every `ReadableIds` leaf in the
   * FINAL `where` of a read is replaced by its composed form immediately
   * before the driver call — after the comparand doors, the middleware chain
   * and the before-hooks, so a leaf the caller, a middleware or a hook wrote
   * meets the same composition. Returns `ast` by reference when it holds no
   * leaf, which is every read today; otherwise a shallow copy whose `where` is
   * rewritten copy-on-write (the hooks' `input.ast` is never edited).
   *
   * Per parent object `P`, once per call, in this order:
   *
   *  1. **D5's two remaining classes are refused, by name** (`INTERNAL_ERROR`
   *     / 500), before the security service is asked anything: a parent an
   *     object-scoped read middleware narrows ({@link hasObjectMiddleware}); a
   *     parent bound to another datasource than `object`
   *     ({@link resolveDatasourceBinding}).
   *  2. **A parent the registry does not hold** ⇒ `$in: []`, unasked.
   *  3. **The security service** — absent or unusable ⇒ `$in: []`.
   *  4. **`canReadObject(P)`** (its `explain` fallback when the method is
   *     absent) — false or a throw ⇒ `$in: []`.
   *  5. **`getReadFilter(P)`** — `undefined` ⇒ composed, no row restriction;
   *     the deny sentinel `RLS_DENY_FILTER`, by identity, or a throw ⇒
   *     `$in: []`; any other filter ⇒ composed with it as the scope, marked
   *     `'policy'` and otherwise passed exactly as `P`'s own read passes its
   *     injected scope. The tenant wall is the driver's (D3).
   *
   * [ADR-0139 D5.1, as amended] A **delegated (on-behalf-of) caller** is
   * composed, not refused: both halves are asked with the caller's context
   * exactly as it stands — `onBehalfOf` intact — and the security service
   * answers each half for the delegated principal, which under ADR-0090 D10
   * is the INTERSECTION of the principal's leg and the delegator's. The
   * engine composes what it is answered and derives no second intersection
   * of its own: it has one context, the delegated one, and the delegator's
   * grants are the security service's to resolve. A service that cannot
   * answer that context answers the deny sentinel, and step 5 turns it into
   * `$in: []`, closed.
   *
   * [ADR-0139 D6, as amended — the nested master chain] A scope the service
   * answers in step 5 may itself carry a leaf: a parent whose own read scope
   * is derived from ITS master (a `controlled_by_parent` detail whose master
   * is `controlled_by_parent` too) is scoped `{ master_fk: { $in:
   * ReadableIds.of(G) } }`, and a leaf handed to a driver uncomposed is
   * refused there (D3), never read as "no restriction". So every leaf a
   * composed scope carries is composed the same way, BEFORE the leaf that
   * encloses it — the same five steps, the same caller context at every level,
   * recursively ({@link composeReadableIdsChain}). The driver then receives one
   * composed leaf whose scope holds composed leaves, and compiles one statement
   * with the subqueries nested. Each parent is asked once per read, at
   * whichever level it first appears; a chain that returns to a parent already
   * on its branch, or runs deeper than {@link READABLE_IDS_MAX_CHAIN_DEPTH}
   * scopes, is refused by name (D5's envelope), not composed partway.
   *
   * Nothing is memoised across calls. `aggregate`'s `having` and its
   * aggregations' own filters are judged here too, so a leaf a middleware
   * wrote there is refused rather than evaluated in memory.
   */
  private async composeReadableIdsAtBoundary<A extends QueryAST>(
    object: string,
    operation: 'find' | 'findOne' | 'count' | 'aggregate',
    ast: A,
    context: ExecutionContext | undefined,
  ): Promise<A> {
    if (operation === 'aggregate') {
      collectComposableReadableIds(object, operation, ast.having, 'having');
      const aggregations = Array.isArray(ast.aggregations) ? ast.aggregations : [];
      aggregations.forEach((agg, i) => {
        collectComposableReadableIds(object, operation, (agg as { filter?: unknown } | undefined)?.filter, `aggregations[${i}].filter`);
      });
    }
    const sites = collectComposableReadableIds(object, operation, ast.where, 'where');
    if (sites.length === 0) return ast;

    const security = this.resolveReadableIdsSecurity();
    if (security.kind !== 'usable' && !this.readableIdsSecurityReported.has(security.kind)) {
      this.readableIdsSecurityReported.add(security.kind);
      this.logger.warn(
        `[ObjectQL] ${operation}('${object}') composes a ReadableIds leaf with no usable "security" service ` +
        `(${security.kind === 'absent' ? 'none is registered' : security.why}): every such leaf is answered ` +
        '$in: [], no row of its parent, fail-closed. Register a security service for the leaf to serve rows. ' +
        'Reported once for this engine; later leaves are answered the same way.',
      );
    }
    const chain: ReadableIdsChain = { object, operation, security, context, answers: new Map() };
    const where = await this.composeReadableIdsChain(chain, ast.where, sites, []);
    return { ...ast, where };
  }

  /**
   * [ADR-0139 D2, D6 as amended] Compose the leaves at `sites` in `node` —
   * the read's `where` at the top level, a parent's composed scope below it —
   * and, first, every leaf a scope answered for one of their parents carries,
   * recursively. Returns `node` rewritten copy-on-write, every leaf replaced
   * by its composed form or `[]`.
   *
   * `ancestors` are the parents whose scopes enclose `node`, outermost first:
   * empty for the read's own `where`, `[P]` inside P's scope, `[P, G]` inside
   * the scope G answered within it. Per distinct parent of `sites`, in walk
   * order:
   *
   *  1. D5's two classes are refused by name, exactly as at the top level
   *     ({@link refuseUncomposableReadableIdsClasses}): a nested parent an
   *     object-scoped middleware narrows, or one bound to another datasource
   *     than the read's object, is refused — the whole chain compiles into the
   *     read's one statement, on the read's datasource.
   *  2. A parent already answered on this read — at any level — is not asked
   *     again: its composed scope is reused by reference.
   *  3. A parent already on `ancestors` is a cycle (its own scope, or a scope
   *     inside it, reaches back to it); a parent whose scope would be the
   *     chain's scope number {@link READABLE_IDS_MAX_CHAIN_DEPTH} + 1 is past
   *     the bound. Both are refused by name, `INTERNAL_ERROR` / 500, before
   *     the service is asked about that parent: a chain the engine cannot
   *     compose whole is not composed partway, and ⛔ never answered "no
   *     restriction".
   *  4. The parent is asked both halves ({@link readableIdsScopeOf}) with the
   *     read's context as it stands; a scope that carries leaves is composed
   *     through this method first, under `[...ancestors, parent]`, and the
   *     rewritten scope is what the parent's leaf is composed with. The
   *     provenance mark the scope carries (`'policy'`) survives the rewrite.
   *
   * A nested leaf outside a `$in` comparand, or a composed leaf the engine did
   * not compose, inside an answered scope is refused by the same walk that
   * refuses it in a caller's `where` ({@link collectComposableReadableIds}):
   * the scope is the `where` of a read of its parent and is judged as one.
   */
  private async composeReadableIdsChain<N>(
    chain: ReadableIdsChain,
    node: N,
    sites: readonly ComposableReadableIdsSite[],
    ancestors: readonly string[],
  ): Promise<N> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const host: ThisParameterType<typeof composeReadableIdsChain> = {
      refuseUncomposableReadableIdsClasses: (...a) => this.refuseUncomposableReadableIdsClasses(...a),
      readableIdsScopeOf: (...a) => this.readableIdsScopeOf(...a),
      composeReadableIdsChain: (...a) => this.composeReadableIdsChain(...a),
    };
    return (composeReadableIdsChain<N>).call(host, chain, node, sites, ancestors);
  }

  /**
   * [ADR-0139 D5] Refuse D5's two remaining classes (D5.2 and D5.3), by name,
   * and return the distinct parent objects of `sites` the security service is
   * asked about, in walk order (every one but a parent the registry does not
   * hold). Reads the registry and the middleware registrations only — no
   * security call, and no reading of the caller's context: a delegated
   * (on-behalf-of) caller is no longer a class of its own (D5.1, as amended),
   * it is composed like any other through the security service's answers.
   */
  private refuseUncomposableReadableIdsClasses(
    object: string,
    operation: string,
    sites: readonly ComposableReadableIdsSite[],
  ): string[] {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    const read_registry = () => this._registry;
    const host: ThisParameterType<typeof refuseUncomposableReadableIdsClasses> = {
      get _registry() { return read_registry(); },
      uncomposableReadableIdsParent: (...a) => this.uncomposableReadableIdsParent(...a),
    };
    return refuseUncomposableReadableIdsClasses.call(host, object, operation, sites);
  }

  /**
   * [ADR-0139 D5.2 / D5.3] Which of D5's two remaining classes a leaf over
   * `parent` in a read of `object` falls in, or `undefined` when it falls in
   * neither — the ONE predicate behind both the read-time refusal
   * ({@link refuseUncomposableReadableIdsClasses}) and the boot-time refusal of
   * a `controlled_by_parent` detail over such a master
   * ({@link findUnservableControlledByParentMasters}), so the two rules cannot
   * drift. D5.2 is judged first, as the read path always has.
   */
  private uncomposableReadableIdsParent(object: string, parent: string):
    | { class: 'object-scoped-read-middleware' }
    | { class: 'other-datasource'; objectDatasource: string | undefined; parentDatasource: string | undefined }
    | undefined {
    if (this.hasObjectMiddleware(parent)) return { class: 'object-scoped-read-middleware' };
    const objectDatasource = this.resolveDatasourceBinding(object)?.datasource;
    const parentDatasource = this.resolveDatasourceBinding(parent)?.datasource;
    if (parentDatasource !== objectDatasource) return { class: 'other-datasource', objectDatasource, parentDatasource };
    return undefined;
  }

  /**
   * [ADR-0139 D5.2 / D5.3 · ADR-0049] Every registered `controlled_by_parent`
   * detail whose master the engine composes no `ReadableIds` leaf over — a
   * master an object-scoped read middleware narrows, or one bound to another
   * datasource than the detail — judged by the read path's own predicate
   * ({@link uncomposableReadableIdsParent}). A detail's access derives from its
   * one required `master_detail` (ADR-0055 §1), so such a declaration is one
   * the runtime cannot honour: `ObjectQLPlugin` refuses the boot on any entry.
   *
   * Both facts are deployment facts (the datasource mapping, a package's
   * default datasource, lifecycle routing, the middleware registrations), so
   * the answer is final only once every plugin has registered its middleware —
   * which several do inside their own `kernel:ready` handler. Asked earlier, it
   * is short. A detail with no single required master, or whose master the
   * registry does not hold, is no entry: other rules own those.
   */
  findUnservableControlledByParentMasters(): UnservableControlledByParentMaster[] {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof findUnservableControlledByParentMasters> = {
      get _registry() { return readRegistry(); },
      uncomposableReadableIdsParent: (...a) => this.uncomposableReadableIdsParent(...a),
    };
    return findUnservableControlledByParentMasters.call(host);
  }

  /**
   * [ADR-0139 D2 steps 1-2] The scope a leaf over `parent` is composed with,
   * or `null` for `$in: []`. Fails closed on every answer that is not a
   * positive one, and on every throw.
   */
  private async readableIdsScopeOf(
    object: string,
    operation: string,
    parent: string,
    svc: ReadableIdsSecurity,
    context: ExecutionContext | undefined,
  ): Promise<{ scope: FilterCondition | undefined } | null> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof readableIdsScopeOf> = {
      get logger() { return readLogger(); },
    };
    return readableIdsScopeOf.call(host, object, operation, parent, svc, context);
  }

  /**
   * [#18783] The permission map one write's option gates are evaluated with —
   * resolved at most ONCE for the whole write (a batch insert, a by-id update,
   * an N-row bulk update, a `validate()` preview), never per row and never per
   * predicate, and never kept past the call: the contract member is
   * request-scoped, and a map held across writes would serve a grant that may
   * since have been revoked.
   *
   * Asked ONLY when the write can need it — a resolver is registered, the write
   * has an acting user (`current_user` is otherwise unbound and `can` asks
   * about nobody), and some payload PICKS an option whose `visibleWhen` calls
   * `can` ({@link optionVisibilityReadsPermissions}, the evaluator's own
   * picker). Every other write pays nothing, and cannot be refused by a
   * resolution it never depended on.
   *
   * The answer goes through `toEvalPermissions`, formula's one door into
   * `EvalContext.permissions`, so a map that is not the published shape is
   * refused here rather than answering `can()` confidently wrong.
   *
   * Returns a per-payload accessor, the shape {@link resolvePredicateRelated}
   * hands back:
   *
   *  - a payload that picks no `can`-gated option gets `undefined`;
   *  - one that does gets the map;
   *  - when the resolution THREW (or the map was refused), one that does gets
   *    the throw, re-raised untouched: the write fails CLOSED, with the
   *    resolution's own error. ⛔ It is never read as "no grants", which would
   *    publish a failure as a measured denial of everything.
   */
  private async resolveOptionPermissions(
    schema: unknown,
    payloads: ReadonlyArray<Record<string, unknown> | null | undefined>,
    resolution: PermissionResolution | undefined,
  ): Promise<(payload: Record<string, unknown> | null | undefined) => EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`; it reads no member of the class.
    return resolveOptionPermissions(schema, payloads, resolution);
  }

  /**
   * [#20082] ONE operation's effective-permission resolution — the single
   * resolver ask every consumer inside that operation shares. On a write those
   * are its CEL `defaultValue`s ({@link resolveDefaultPermissions}), its option
   * gates ({@link resolveOptionPermissions}) and the formula fields on its
   * response ({@link resolveFormulaPermissions}); on a read, its formula fields.
   * The contract member's "resolve it ONCE per request" is kept per engine
   * operation: a write that carries a `can` default, a `can` option gate and a
   * `can` formula asks the resolver once, not three times.
   *
   * `undefined` when there is nothing to ask — no resolver registered, or no
   * acting user (`current_user` is then unbound, and `can` asks about nobody).
   * Every consumer then passes NO permission data: ⛔ never an empty map, which
   * is a real answer ("holds nothing") and would deny confidently.
   *
   * Lazy and memoised for the operation: the ask happens when the first consumer
   * NEEDS the map, never earlier, and a later consumer awaits the same promise —
   * its rejection included, so one failed resolution is the same failure
   * everywhere in the operation rather than a second, possibly different, ask.
   * The answer goes through `toEvalPermissions`, formula's one door into
   * `EvalContext.permissions`, so an off-shape map fails here like a throw.
   * ⛔ Never kept past the operation: each operation mints its own, because a map
   * held across operations would serve a grant that may since have been revoked.
   */
  private permissionResolution(context: ExecutionContext | undefined): PermissionResolution | undefined {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const readEffectiveObjectPermissionsResolver = () => this._effectiveObjectPermissionsResolver;
    const host: ThisParameterType<typeof permissionResolution> = {
      get _effectiveObjectPermissionsResolver() { return readEffectiveObjectPermissionsResolver(); },
      buildEvalUser: (...a) => this.buildEvalUser(...a),
    };
    return permissionResolution.call(host, context);
  }

  /**
   * [#20082] The permission map a batch of `formula` fields is evaluated with —
   * a read's (`find`, `findOne`) or a write response's
   * ({@link hydrateWriteFormulas}).
   *
   * Asked only when it can change an answer: the context binds an acting user
   * (the way {@link applyFormulaPlan} binds `current_user` — a truthy `userId`),
   * some planned formula CALLS `can` ({@link readsPermissionPredicate}, the same
   * reading the option gate uses), and there is a record to evaluate. Every
   * other read pays nothing, and a whole `find` asks at most once, never per row.
   *
   * A read cannot refuse a row because one computed field lacks data, so when
   * the map cannot be had the formula keeps the rule every formula that does not
   * evaluate follows on this path — it reads `null` — and this method says so,
   * once per operation, at `warn`, naming the object, the fields and the reason:
   *
   *  - `no-permission-source`: no resolver is registered. NO map is passed (the
   *    contract member's rule for an absent method), so `can()` keeps its own
   *    loud refusal and the field reads `null`.
   *  - `permission-resolution-failed`: the resolution threw, or answered a map
   *    that is not the published shape. Fail CLOSED: ⛔ never read as "no
   *    grants" (an empty map would publish a confident `false`) and ⛔ never a
   *    grant — the field reads `null`, with the resolution's error in the line.
   *
   * `warn`, not `error`: a formula is computed on read and nothing is persisted
   * from it, so the degradation is visible to whoever reads the field.
   */
  private async resolveFormulaPermissions(
    object: string,
    plan: readonly FormulaPlanEntry[],
    records: readonly unknown[],
    context: ExecutionContext | undefined,
    resolution: PermissionResolution | undefined,
  ): Promise<EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof resolveFormulaPermissions> = {
      get logger() { return readLogger(); },
    };
    return resolveFormulaPermissions.call(host, object, plan, records, context, resolution);
  }

  /**
   * [#24197] The query objects {@link resolveOneHopRelated} issues to read a
   * formula's hop. A `find` handed one of them computes the related object's
   * formulas but serves them no hop of their own — see
   * {@link resolveFormulaRelated}. Keyed on the object identity, so the marker
   * never rides a context, a hook or a middleware anywhere else.
   */
  private readonly formulaHopReads = new WeakSet<object>();

  /**
   * [#24197] The related rows a formula plan reads ONE hop through a
   * reference field, resolved for a whole page of `rows` at once — the
   * formula half of {@link resolveOneHopRelated}, read under the CALLER's
   * own authority.
   *
   * ## What it costs
   *
   * Nothing for a plan that traverses nothing (no query, no closure). For one
   * that does: one batched read per reference field per call — per PAGE of a
   * `find` (the rows the driver returned, after `limit` / `offset`), per row of
   * a `findOne`, per write response — never one per row. A formula whose
   * traversal cannot be served (`hopConflict`) asks for nothing.
   *
   * ## One hop, and only one
   *
   * A `find` that IS a hop read ({@link formulaHopReads}) serves no hop of its
   * own: the related object's own formulas over its own columns are computed,
   * one that reads through a reference of ITS own reads `null` and says so.
   * That is the declared depth (a second hop is not loaded — the lint refuses
   * one written out, this refuses one reached through a formula), and it is
   * what keeps two objects whose titles read each other from recursing.
   */
  private resolveFormulaRelated(
    schema: any,
    plan: readonly FormulaPlanEntry[],
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
    query?: EngineQueryOptions,
  ): Promise<FormulaRelated | undefined> {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    const read_registry = () => this._registry;
    const readFormulaHopReads = () => this.formulaHopReads;
    const host: ThisParameterType<typeof resolveFormulaRelated> = {
      get _registry() { return read_registry(); },
      get formulaHopReads() { return readFormulaHopReads(); },
      resolveOneHopRelated: (...a) => this.resolveOneHopRelated(...a),
    };
    return resolveFormulaRelated.call(host, schema, plan, rows, context, query);
  }

  /**
   * [#24197] Materialize ONE declared `formula` field against a record already
   * in hand, SERVED the way a read serves it: the one hop the formula reads
   * through a reference field ({@link resolveFormulaRelated}), the `can()`
   * permission map ({@link resolveFormulaPermissions}) and the fault report
   * ({@link formulaFaultSink}), all under `context`.
   *
   * The asynchronous twin of the module's {@link evaluateFormulaField}, which
   * is synchronous and so serves none of the three. It exists for a record the
   * engine never read back — a hook's in-flight state (stored ⊕ payload), whose
   * foreign keys may name records the stored row does not — so the title a hook
   * body asks for (`ctx.title()`) is the title a read of that state would show.
   *
   * ## Under which authority, on which connection
   *
   * `context` is the reader's own: every hop is the reader's own `find`, through
   * every enforcement layer a read applies, exactly as the read path's hop is
   * (`authority: 'caller'`). A related record that read does not return leaves
   * the formula `null` with the read path's reason — never a fallback. A context
   * carrying a `transaction` reads on that transaction's connection, so a body
   * that opened one never asks the pool for a second (a deadlock on SQLite's
   * `pool max=1`). Call it through {@link ScopedContext.serveFormulaField},
   * which hands in the context the body's own `ctx.api` reads with.
   *
   * ## What it costs
   *
   * One batched read per reference field the formula reads through — the read
   * path's own cost for one row — and nothing for a formula over the record's
   * own columns. A read that is itself a formula's hop serves no hop of its own,
   * so a second hop reads `null` with its reason here as it does on a read.
   *
   * Returns `undefined` when `field` is not a declared formula field on
   * `objectName`, as {@link evaluateFormulaField} does. Evaluates against a
   * shallow COPY of `record`.
   */
  async serveFormulaField(
    objectName: string,
    record: Record<string, unknown>,
    field: string,
    context?: ExecutionContext,
  ): Promise<unknown> {
    const schema = this._registry.getObject(objectName);
    const { plan } = planFormulaProjection(schema, [field]);
    if (plan.length === 0) return undefined;
    const scratch: Record<string, unknown> = { ...record };
    applyFormulaPlan(plan, [scratch], context, await this.resolveFormulaPermissions(
      objectName, plan, [scratch], context, this.permissionResolution(context),
    ), this.formulaFaultSink(objectName), await this.resolveFormulaRelated(schema, plan, [scratch], context),
    this.formulaOptionLabels(schema, plan, context));
    return scratch[field];
  }

  /**
   * [#26608] The option labels `label(record.<field>)` reads on a read or a
   * write response of `schema`'s object: in the reader's locale
   * (`ExecutionContext.locale`, which the request's `Accept-Language` sets),
   * translated through the bridged i18n service as `GET /meta/object/:name`
   * serves the object to the same reader — see {@link readerOptionLabels}.
   * `undefined` when no formula of `plan` calls `label()`.
   */
  private formulaOptionLabels(
    schema: unknown,
    plan: FormulaPlanEntry[],
    context: { locale?: string } | undefined,
  ): EvalOptionLabels | undefined {
    return readerOptionLabels(schema, plan, context?.locale, this.i18nService);
  }

  /**
   * [#22019] The (object, field) pairs whose formula fault this engine instance
   * has already reported — see {@link reportFormulaFault}.
   */
  private readonly formulaFaultReported = new Set<string>();

  /**
   * [#22019] The sink a read or a write response of `object` hands to
   * {@link applyFormulaPlan}, bound to the object so a report names the pair.
   */
  private formulaFaultSink(object: string): FormulaFaultSink {
    return (field, error) => this.reportFormulaFault(object, field, error);
  }

  /**
   * [#22019] A formula field that did not evaluate, reported ONCE per
   * (object, field) per engine instance.
   *
   * ## What it closes
   *
   * {@link applyFormulaPlan} answers `null` for a formula it cannot evaluate,
   * and said nothing. A formula calling an unregistered function
   * (`sqrt(record.amount)`) therefore read `null` on every row of every read
   * and every write response, with no line anywhere to say why — the silent
   * swallow ADR-0032 forbids at a call site. The answer stays `null` (what a
   * read returns is protocol); the fault is now said.
   *
   * ## Level and rate
   *
   * `warn`, on AGENTS.md's one question: a formula is computed on read and
   * nothing is persisted from it, so the degradation is a field reading `null`
   * — visible to whoever reads it — never a write that claims to land and does
   * not. That is the reading {@link resolveFormulaPermissions} makes for the
   * same `null`.
   *
   * Once per pair per engine instance, as {@link warnCascadeNotAtomic} says its
   * piece once per object: a list read evaluates a faulting formula once per
   * row, and a line per row is the volume that gets a log skimmed. A later
   * fault on the same pair is not re-reported, even with a different error —
   * the first line already names the field to fix.
   */
  private reportFormulaFault(object: string, field: string, error: EvalError): void {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const readFormulaFaultReported = () => this.formulaFaultReported;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof reportFormulaFault> = {
      get formulaFaultReported() { return readFormulaFaultReported(); },
      get logger() { return readLogger(); },
    };
    return reportFormulaFault.call(host, object, field, error);
  }

  /**
   * [#20082] The permission map a write's CEL `defaultValue`s are evaluated with
   * — a per-row accessor, the shape {@link resolveOptionPermissions} hands back,
   * over the write's ONE {@link permissionResolution}.
   *
   * Asked only when a row will really be defaulted by an expression that calls
   * `can`: the write has an acting user (the way {@link applyFieldDefaults}
   * binds `current_user` — a truthy `userId`), and the row leaves such a field
   * without a value (`applyFieldDefaults`' own `!= null` test). A row that
   * supplies the field, and an object whose defaults never call `can`, pay
   * nothing and cannot be refused by a resolution they never depended on.
   *
   *  - no resolution (no resolver registered): every row gets `undefined` — NO
   *    map. The default then does not evaluate and is left unset with
   *    `applyFieldDefaults`' existing warn, which carries formula's own "carries
   *    no permission data" refusal; a `required` field so defaulted is refused
   *    by required-validation, exactly as before this seam existed.
   *  - the resolution threw (or its map was refused): a row that needs it gets
   *    the throw, re-raised untouched — the write fails CLOSED with the
   *    resolution's own error, as an option gate's does. ⛔ Never read as "no
   *    grants", which would STORE `false` as though it had been measured.
   */
  private async resolveDefaultPermissions(
    object: string,
    rows: ReadonlyArray<unknown>,
    context: ExecutionContext | undefined,
    resolution: PermissionResolution | undefined,
    /** Only these fields' defaults count — the insert's re-default pass keeps no others. */
    onlyFields?: readonly string[],
  ): Promise<(row: unknown) => EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts` (see `ReadableIdsPermissionFormulaHost`).
    const host: ThisParameterType<typeof resolveDefaultPermissions> = {
      defaultFieldEntries: (...a) => this.defaultFieldEntries(...a),
    };
    return resolveDefaultPermissions.call(host, object, rows, context, resolution, onlyFields);
  }


  /**
   * [#11968] The engine-seam write epoch — the invalidation substrate of the
   * ruled authorization caching design (#11633 §2.1, §3).
   *
   * A monotonic counter advanced by {@link executeWithMiddleware} on every
   * `insert` / `update` / `delete` that passes the middleware chain. It is a
   * generalisation of the private counter `@objectstack/plugin-security` has
   * carried since #10757: the mechanism was always the engine's, and hoisting
   * it here is what lets a second consumer share ONE signal instead of minting
   * a parallel one that watches a different set of writes.
   *
   * ⭐ It is a SEAM, not a call-site list. A path that grants a capability
   * cannot forget to invalidate, because writing through this engine is the
   * only way to write at all. See `write-epoch.ts` for why that property is the
   * one to protect when editing, and for what the epoch deliberately does not
   * carry (anything about WHICH entry to drop).
   *
   * ⛔ The epoch alone is not a licence to cache. It sees writes THIS process
   * makes; a peer node's grant revocation is invisible to it. A cached
   * authorization answer additionally needs a TTL bound — see
   * `authz-invalidation-channel.ts` in `@objectstack/core`.
   */
  readonly writeEpoch = new WriteEpoch();

  /** Disposer for the `authz.invalidated` bridge, when one is attached. */
  private authzInvalidationDetach?: () => void;
  /** The `(pubsub, nodeId)` pair currently bridged, for idempotent re-attach. */
  private authzInvalidationBinding?: { pubsub: unknown; nodeId: string };

  /**
   * [#11968] Attach a cluster pub/sub transport so this engine's write epoch
   * fans out on the `authz.invalidated` channel and peers' hints advance it
   * locally. Mirrors `MetadataManager.attachClusterPubSub()`, including its
   * idempotency on the `(pubsub, nodeId)` pair, and is called the same way — by
   * a bridge plugin in `@objectstack/service-cluster`, once per kernel boot,
   * after both services exist.
   *
   * ⚠️ Attach only when something is actually caching authorization answers.
   * The bridge publishes one message per write, which buys nothing with no
   * consumer — and the substrate's acceptance criterion is that runtime
   * behaviour is unchanged until leg B (#11967) lands.
   *
   * ⭐ Attaching this does NOT make a cached answer safe. Delivery is
   * at-most-once on every shipped driver, so a missed message is expected and
   * the consuming TTL remains the correctness bound. The channel module in
   * `@objectstack/core` carries the full statement.
   *
   * @returns a disposer that detaches the bridge.
   */
  attachAuthzInvalidationPubSub(pubsub: IPubSub, nodeId: string): () => void {
    if (
      this.authzInvalidationBinding?.pubsub === pubsub &&
      this.authzInvalidationBinding?.nodeId === nodeId
    ) {
      return () => this.detachAuthzInvalidationPubSub();
    }
    this.detachAuthzInvalidationPubSub();
    this.authzInvalidationDetach = bridgeAuthzInvalidation({
      epoch: this.writeEpoch,
      pubsub,
      nodeId,
      logger: this.logger,
    });
    this.authzInvalidationBinding = { pubsub, nodeId };
    this.logger.info('ObjectQL attached to the authz.invalidated cluster channel', {
      nodeId,
    });
    return () => this.detachAuthzInvalidationPubSub();
  }

  /** Tear down the `authz.invalidated` bridge. Safe to call multiple times. */
  detachAuthzInvalidationPubSub(): void {
    const detach = this.authzInvalidationDetach;
    this.authzInvalidationDetach = undefined;
    this.authzInvalidationBinding = undefined;
    detach?.();
  }

  /**
   * Register a middleware function
   * Middlewares execute in onion model around every data operation.
   * @param fn The middleware function
   * @param options Optional: target object filter
   */
  registerMiddleware(fn: EngineMiddleware, options?: { object?: string }): void {
    this.middlewares.push({ fn, object: options?.object });
    this.logger.debug('Registered middleware', { object: options?.object, total: this.middlewares.length });
  }

  /**
   * [#21080] Whether a middleware is registered FOR `objectName` — a
   * {@link registerMiddleware} call whose `object` names it
   * (`IObjectQLEngine.hasObjectMiddleware`).
   *
   * A read of what the registrations above recorded, and nothing else: it
   * runs no middleware and registers none. A global registration (no
   * `object`, or `'*'`) matches every object in {@link executeWithMiddleware}
   * but is keyed to none, so it is not counted.
   *
   * Asked by a read path that runs no engine operation — the analytics
   * native-SQL strategy, which executes raw SQL through the driver — so it can
   * decline an object whose gates live here and let this engine serve it.
   */
  hasObjectMiddleware(objectName: string): boolean {
    return this.middlewares.some((m) => !!m.object && m.object !== '*' && m.object === objectName);
  }

  /**
   * Execute an operation through the middleware chain
   */
  private executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    const readMiddlewares = () => this.middlewares;
    const readWriteEpoch = () => this.writeEpoch;
    const host: ThisParameterType<typeof executeWithMiddleware> = {
      get middlewares() { return readMiddlewares(); },
      get writeEpoch() { return readWriteEpoch(); },
    };
    return executeWithMiddleware.call(host, ctx, executor);
  }

  /**
   * Build a HookContext.session from ExecutionContext — WHO is calling.
   *
   * Returns `undefined` when the context yields nothing session-worthy, which
   * keeps `!ctx.session` meaning exactly one thing for hooks: "no identity
   * envelope was supplied" — the bare-kernel / programmatic call that
   * caller-gating hooks skip for. A context carrying only write PROVENANCE
   * (`{ flowRunId }`, all an identity-less flow run has — #3712) is such a
   * case: it says what produced the write, not who is calling, and surfaces
   * through {@link buildProvenance} instead. Every real transport resolves
   * `positions` into the context, so an anonymous HTTP request still yields a
   * session and stays gated.
   */
  private buildSession(execCtx?: ExecutionContext): HookContext['session'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`; it reads no member.
    return buildSession(execCtx);
  }

  /**
   * Build the HookContext.provenance envelope — WHERE this write came from.
   *
   * Deliberately separate from {@link buildSession}: provenance is server-
   * stamped, evaluated by no security middleware, and can exist with no
   * identity beside it. A schedule-triggered flow run resolves no principal
   * yet still owns its writes, and that is the case the approvals record lock
   * needs to recognize (#3456 / #3712).
   *
   * `attributedUserId` rides the SAME envelope for the same reason (#4586):
   * a better-auth-originated write authorizes as the system, so the human who
   * triggered it must reach the audit writer WITHOUT appearing in `session` —
   * where every caller-gating hook would read them as the caller. Attribution
   * here, authorization in `session`/`isSystem`, never the two mixed.
   *
   * `performedByClientId` rides it for the THIRD time on the same reasoning
   * (#17022, ADR-0090 D10 rule 4): an MCP OAuth agent's write authorizes as
   * the human it acts for, so the acting client can only reach the audit
   * writer through a channel that is not `session` — putting it there would
   * make every caller-gating hook read the client as the caller, which is the
   * opposite of what the delegation means. This copy list is the whole reason
   * the field is not inert: `HookContext` is built from a CLOSED literal whose
   * `provenance` value is exactly what this function returns, so a key
   * declared on `hook.zod.ts` and missing here is declared and never
   * populated (ADR-0049).
   */
  private buildProvenance(execCtx?: ExecutionContext): HookContext['provenance'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`; it reads no member.
    return buildProvenance(execCtx);
  }

  /**
   * [commit 34ce8e7db] Build the declared `HookContext.referentialFieldClear` marker —
   * the read-only hook-context projection of the operation-private
   * `__referentialFieldClear` that {@link ObjectQL.cascadeDeleteRelations}
   * stamps on the cleanup write's ExecutionContext (#3023).
   *
   * `true | undefined`, never `false`: the key is ABSENT from every dispatch
   * whose envelope does not carry the marker, so a handler reads it as
   * `ctx.referentialFieldClear === true` and an absent key keeps meaning "not
   * a referential cleanup" — the same back-compatible direction as `dispatch`.
   *
   * Why a projection of the ENVELOPE rather than a fresh per-call-site signal:
   * the `__` key's semantics have always been operation-scoped — the cleanup
   * context is `{ ...callerContext, transaction, __referentialFieldClear: true }`,
   * plugin-security's ownership-anchor exemption keys on the envelope, and a
   * write a hook issues through `ctx.api` during a cleanup dispatch inherits
   * it — so the declared face projects the fact faithfully instead of quietly
   * re-scoping it. Consumed by `update()`'s hook-context assembly only: every
   * reference-cleanup write the engine issues is an update, and the per-row /
   * after-phase contexts ride the batch context's spread.
   */
  private buildReferentialFieldClear(execCtx?: ExecutionContext): true | undefined {
    return (execCtx as any)?.__referentialFieldClear === true ? true : undefined;
  }

  /**
   * [#23221] Build the declared `HookContext.referentialCascadeDelete` marker,
   * the delete twin of {@link buildReferentialFieldClear}: `true` when THIS
   * `delete()` of `object`/`id` is the child delete
   * {@link walkReferencingRelations} issued for a `cascade` relation, and
   * `undefined` for every other delete — the same "absent unless true"
   * contract, so a handler reads `ctx.referentialCascadeDelete === true`.
   *
   * Reads {@link cascadeIssuedDeletes}, not the envelope (that field says why),
   * and CLAIMS the token it matches. Called once per `delete()`, below the
   * `afterDelete` unit re-entry (`opensAfterAbortUnit`): a call that re-enters
   * itself returns before reaching here, so the claim is made by the inner
   * call, the one that dispatches the hooks, and nothing later inside it can
   * match the same token again.
   */
  private claimReferentialCascadeDelete(object: string, id: unknown): true | undefined {
    const issued = this.cascadeIssuedDeletes.getStore();
    if (!issued || issued.claimed || id == null) return undefined;
    if (issued.object !== object || issued.id !== String(id)) return undefined;
    issued.claimed = true;
    return true;
  }

  /**
   * Build the acting-user object (ADR-0068 EvalUser shape) surfaced to
   * validation-time predicates as `current_user` — notably per-option
   * `visibleWhen` authorization gating (objectui#2284). Returns undefined for
   * system / unauthenticated writes, where membership predicates then fail-open.
   */
  private buildEvalUser(
    execCtx?: ExecutionContext,
  ): { id: string; positions: string[]; organizationId: string | null } | undefined {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`; it reads no member.
    return buildEvalUser(execCtx);
  }

  /**
   * Build the `HookContext.user` shortcut — the ergonomic "current user"
   * object surfaced to JS hooks. Carries `organizationId` (the blessed name
   * for the caller's active org, identical to `session.organizationId` and
   * `current_user.organizationId`) so a hook author who needs "the current org
   * to filter by" writes `ctx.user.organizationId` with zero relearning (#3280).
   *
   * Returns undefined for system / unauthenticated writes (no acting user) —
   * hooks that need an org regardless of a resolved user read
   * `ctx.session.organizationId`, which is populated whenever a session is.
   */
  private buildUser(execCtx?: ExecutionContext): HookContext['user'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`; it reads no member.
    return buildUser(execCtx);
  }

  /**
   * Build the DriverOptions blob passed to every IDataDriver call.
   *
   * # The tenant read scope is the wall's verdict (ADR-0131 D8)
   *
   * The driver's native tenant scope — `tenantId` (equality) and `tenantIds`
   * (the `group` union), which `applyTenantScope` compiles — is the Layer 0
   * verdict projected onto `DriverOptions`, never a second derivation beside
   * it. One function decides ({@link computeTenantLayer0Verdict},
   * `@objectstack/core`), and the engine reads it from one of two places:
   *
   * - **the verdict the wall RECORDED on this operation**
   *   ({@link OperationContext.tenantLayer0Verdict}, passed in as
   *   `scope.recordedVerdict`) — present where the security layer composed its
   *   wall onto the predicate: a read, or a predicate write. It already carries
   *   what only that layer can know (the exempt `PLATFORM_ADMIN` on a
   *   posture-permitting object, the verified platform owner's read, the
   *   delegator's intersection), so the driver reaches exactly the rows Layer 0
   *   admits;
   * - **otherwise, the same function over the engine's own facts** — the
   *   posture in force ({@link resolveEnginePosture}), the context's active
   *   organization and access set, the object's tenancy — with no admin
   *   exemption, since the engine holds no permission sets. That covers a
   *   system context, a by-id write, and a composition with no security layer
   *   mounted.
   *
   * Projected: `none` (the `single` posture; a non-tenant, tenancy-disabled or
   * federated object; an exempt platform admin) → no scope; `organization` →
   * `tenantId`; `organizations` → `tenantIds`, with the active organization as
   * `tenantId` (the driver keys its scope on `tenantId` being present); `deny`
   * → the active organization if there is one — the narrowest scope a driver
   * can express, and where the wall ran its deny sentinel is already in the
   * predicate. Under `single` the driver therefore no longer narrows a read to
   * the active organization: the posture is one tenant, and isolation inside it
   * was never the driver's to add (ADR-0131 D11).
   *
   * # The write target is not a read scope
   *
   * An insert (`scope.writeTarget`) keeps the active organization as
   * `tenantId` in EVERY posture — `injectTenantOnInsert` stamps the row with
   * it, the counter scopes by it, and an upsert's identity probe refuses a
   * merge into another organization's row by it — and the `group` membership
   * set beside it, unchanged.
   *
   * # Withheld for two object postures
   *
   * 1. **`tenancy.enabled: false`** (ADR-0066 platform-global posture, e.g.
   *    `sys_license`): stamping the caller's active-org tenantId there would
   *    org-scope a global catalog at the driver, and its NULL-org rows would
   *    vanish for authenticated org-context reads while anonymous reads still
   *    see them (#3249).
   *
   * 2. **`external != null`** — a federated object (ADR-0015), whose schema
   *    is owned by the REMOTE database (#7738). The driver turns `tenantId`
   *    into `organization_id = :tenant`, and
   *    against a remote table that carries no such column that is a SQL error
   *    on Postgres/MySQL — or worse on SQLite, whose quoted-identifier
   *    fallback reinterprets the unresolvable identifier as the string
   *    literal `'organization_id'`, makes both disjuncts constant-false, and
   *    answers **0 rows with HTTP 200**: a correctly-bound external object
   *    silently reads empty.
   *
   *    Note the reason is NOT "the remote happens to lack the column". The
   *    column the driver detects is the platform's OWN: `applySystemFields`
   *    (`resolveInjectedSystemColumns`) injects `organization_id` into every
   *    object it registers, with no `external` branch, and
   *    `SqlDriver.registerExternalObject` is DDL-free by design and runs no
   *    introspection — so it computes the tenant column from the platform's
   *    field set, never from the remote's. On a federated object
   *    `organization_id`'s presence is therefore always the injection and
   *    never evidence about the remote, which leaves the engine no ground on
   *    which to scope by it. Tenant isolation for federated data belongs to
   *    the remote and to the layers above (RBAC/RLS, the datasource binding),
   *    not to a predicate the platform guesses onto someone else's table.
   *
   * Existing user-supplied shapes (transactions, AST extras) are preserved by
   * spreading them first — an explicitly-passed `base.tenantId` is deliberate
   * caller intent and still wins, under every verdict. System / isSystem
   * callers may still cross tenants by clearing `tenantId` themselves on the
   * resulting object; this helper does not mask the system path.
   */
  private buildDriverOptions(
    object: string,
    execCtx?: ExecutionContext,
    base?: any,
    scope: { writeTarget?: boolean; recordedVerdict?: unknown } = {},
  ): any {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const readTxStore = () => this.txStore;
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof buildDriverOptions> = {
      isClosedUnitHandle: (...a) => this.isClosedUnitHandle(...a),
      get txStore() { return readTxStore(); },
      transactionCoversDriverFor: (...a) => this.transactionCoversDriverFor(...a),
      get _registry() { return readRegistry(); },
      driverWriteTarget: (...a) => this.driverWriteTarget(...a),
      driverReadScope: (...a) => this.driverReadScope(...a),
      wallExemptedOperation: (...a) => this.wallExemptedOperation(...a),
    };
    return buildDriverOptions.call(host, object, execCtx, base, scope);
  }

  /**
   * [ADR-0131 D8] The driver's native read scope for one operation — the Layer
   * 0 verdict projected onto `DriverOptions` (see {@link buildDriverOptions}).
   * `undefined` is "no scope"; the caller has already excluded a
   * tenancy-disabled or federated object.
   *
   * A recorded verdict that does not parse as `TenantLayer0VerdictSchema`
   * reads as absent — never as an organization — and the engine then decides
   * over its own facts, which carry no admin exemption: fail toward the wall.
   */
  private driverReadScope(
    execCtx: ExecutionContext | undefined,
    recordedVerdict: unknown,
  ): { tenantId: string; tenantIds?: string[] } | undefined {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof driverReadScope> = {
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return driverReadScope.call(host, execCtx, recordedVerdict);
  }

  /**
   * The Layer 0 verdict over the engine's OWN facts — what {@link driverReadScope}
   * falls back to where no wall was recorded. The one ladder,
   * `computeTenantLayer0Verdict`, with the exemption's facts withheld.
   */
  private engineLayer0Verdict(
    execCtx: ExecutionContext | undefined,
    activeOrganization: string | undefined,
  ): TenantLayer0Verdict {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof engineLayer0Verdict> = {
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return engineLayer0Verdict.call(host, execCtx, activeOrganization);
  }

  /**
   * [ADR-0131 D8 · 8c-1] Did the wall's EXEMPTION lift this operation's scope?
   * True when the recorded verdict is `none` while the same ladder over the
   * engine's own facts — every rung but the exemption — would have walled it.
   * That is plugin-security's own `crossedByPlatformAdmin` test (the ladder
   * asked a second time with only the exemption withheld), with the engine's
   * existing fallback ({@link engineLayer0Verdict}, what an unrecorded
   * operation is scoped by) as the second asking: no rung is computed beside
   * the one ladder, and a `single` posture answers `none` both ways, so it is
   * no crossing. The #12974 owner bypass records `none` on READS only, where
   * the declaration is inert.
   *
   * Absence is not exemption: a by-id write, a system context or a stack with
   * no security layer records nothing, and answers false. A recorded value
   * that does not parse answers false too — junk never lifts anything.
   */
  private wallExemptedOperation(execCtx: ExecutionContext | undefined, recordedVerdict: unknown): boolean {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof wallExemptedOperation> = {
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return wallExemptedOperation.call(host, execCtx, recordedVerdict);
  }

  /**
   * The write target of an insert or upsert: the active organization, in every
   * posture, with the `group` membership set beside it — the scope the
   * driver's insert readback and upsert identity probe narrow by (ADR-0105 D5:
   * the active organization is where a write lands).
   */
  private driverWriteTarget(
    execCtx: ExecutionContext | undefined,
  ): { tenantId: string; tenantIds?: string[] } | undefined {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof driverWriteTarget> = {
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return driverWriteTarget.call(host, execCtx);
  }

  /**
   * [#8844] The tenancy posture IN FORCE for this engine, by the same two-step
   * `app-plugin.organizationWallActive` uses and for the same reason: the
   * injected provider is the `tenancy` service's answer (what is actually
   * ENFORCED, degraded boots included), and the env resolution is what the
   * operator ASKED for — the best fact available to a lean embedding that
   * mounts no SecurityPlugin.
   *
   * ⛔ Never `resolveMultiOrgEnabled()`: ADR-0105 D1 demoted that boolean to a
   * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
   * deployment configured the documented way and would put a fully walled
   * install on the single-tenant branch below — the third recurrence of that
   * shape is what `app-plugin` documents.
   *
   * Read live per call, never cached: nothing here may freeze a verdict a later
   * boot phase can still change. `resolveTenancyPosture()` THROWS on an
   * unrecognized `OS_TENANCY_POSTURE` (deliberately — a typo'd posture must not
   * silently remove the wall); a write is not the place that refusal belongs,
   * and an unreadable posture is exactly the case where guessing `single` would
   * be worst, so it degrades to the walled reading and the write is refused.
   */
  private resolveEnginePosture(): TenancyPosture {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts` (see `DriverOptionsHost`).
    const readTenancyPostureProvider = () => this.tenancyPostureProvider;
    const host: ThisParameterType<typeof resolveEnginePosture> = {
      get tenancyPostureProvider() { return readTenancyPostureProvider(); },
    };
    return resolveEnginePosture.call(host);
  }

  /**
   * [#8844] The install's organizations, capped at two — only "none / exactly
   * one / several" changes any decision.
   *
   * Memoised because a cron loop inserting N rows would otherwise pay N probes
   * for an answer that changes only when `sys_organization` itself is written,
   * and every such write passes through this engine's own write faces, which
   * clear it ({@link invalidateOrganizationProbe}). The stale window is
   * therefore an organization created by ANOTHER process against the same
   * database — and on the `single` posture this memo serves, a second
   * organization appearing is the ambiguous topology the next boot refuses
   * anyway.
   *
   * `isSystem` on the read: resolving the install's organization must not
   * depend on the caller's own reach, and this runs on writes that have no
   * caller reach at all.
   *
   * [#9261] "The probe found no organizations" and "the probe could not run"
   * are different facts (ADR-0110 D3), and this returns the FIRST one only when
   * it measured it. The `catch {}` this replaces answered both with `[]`, which
   * `resolveSystemWriteOrganization` then read as "no organization yet" (a
   * branch that landed the row; since ADR-0131 D9 a registered-but-empty
   * organization object is refused instead) — so one
   * transient failure silently skipped both halves of the #8844 ruling: the
   * single-organization stamp (rows land untenanted and fork exactly the
   * counter the ruling exists to protect) and the multi-organization REFUSAL
   * (fail-open on a guard that must be loud, the #8895 shape). The memo made
   * the damage outlive the outage — the invented answer was cached until an
   * organization write happened to clear it.
   *
   * **Exactly one cause is benign, and it was measured rather than assumed.**
   * `sys_organization` ROUTES but its TABLE was never provisioned (schema sync
   * not run yet): it cannot hold a row, so zero really is the count. Asked
   * through the shared `isMissingTableError` predicate
   * (`@objectstack/metadata/errors`, #4825) — the same call
   * `resolveFileReferences` and `cascadeDeleteRelations` make — never a
   * hand-rolled code test.
   *
   * A SECOND benign cause, now that an unresolved name is refused rather than
   * handed to the driver: `sys_organization` is not registered at all (a lean
   * embedding, a bare-kernel test). Before an in-process verb refused an
   * unresolved name, that install reached the driver and read `[]` on a
   * tolerant one or a MISSING TABLE on a strict one — the one driver cause
   * above. It now resolves to the engine's own `OBJECT_NOT_FOUND` before any
   * driver is asked, so this probe asks the REGISTRY first and treats an
   * absent `sys_organization` as the lean-install case it always was: there is
   * no organization object here, so there is no organization to derive. This
   * is the probe handling absence itself, on a path a body cannot reach — it
   * never relies on the resolver's old raw-table fall-through, which is now
   * gone. It is not a spelling allow-list: the question is "is the object
   * provisioned," asked of the one registry, not "is this one of N names."
   *
   * Everything else — connection loss, pool exhaustion, a timeout mid-boot, a
   * datasource that never connected ({@link DatasourceUnavailableError}), a
   * permission denial — means organizations may well exist and simply were not
   * seen. It PROPAGATES, envelope intact, and ⛔ nothing is memoised on that
   * path: the write that asked fails loudly instead of being filed under a
   * guessed topology, and the next write re-probes rather than inheriting the
   * guess. No new error code and no new response field — the caller receives
   * the probe's own failure, the same disposition #8895 gave the
   * referential-integrity probe.
   */
  private async probeInstallOrganizations(): Promise<readonly string[]> {
    if (this.organizationProbeMemo) return this.organizationProbeMemo;
    // The lean-install case: no `sys_organization` object is registered, so
    // there is no organization to derive. Asking the registry first keeps the
    // probe off the resolver's refusal for an unregistered name (a path a body
    // cannot reach), exactly as the old raw-table fall-through read `[]`.
    if (!this._registry.getObject(ORGANIZATION_OBJECT)) {
      this.organizationProbeMemo = [];
      return this.organizationProbeMemo;
    }
    let ids: readonly string[] = [];
    try {
      const rows = await this.find(ORGANIZATION_OBJECT, {
        fields: ['id'],
        limit: 2,
        context: { isSystem: true },
      });
      ids = (Array.isArray(rows) ? rows : [])
        .map((r: any) => (r?.id ?? r?._id))
        .filter((id: unknown) => id != null && String(id) !== '')
        .map((id: unknown) => String(id));
    } catch (error) {
      // The one benign cause only — anything else is an outage, not an
      // emptiness, and must not be memoised as one.
      if (!isMissingTableError(error, ORGANIZATION_OBJECT)) throw error;
      ids = [];
    }
    this.organizationProbeMemo = ids;
    return ids;
  }

  /** [#8844] Drop the memo — any write that can change the organization set. */
  private invalidateOrganizationProbe(): void {
    this.organizationProbeMemo = undefined;
  }

  /**
   * [#8844] Resolve the organization a SYSTEM-context insert carries, per the
   * 2026-08-15 ruling (Option 1) — or refuse it.
   *
   * Returns the organization id to thread as `DriverOptions.tenantId` (the same
   * knob a session write sets, so the driver stamps the column and the counter
   * scopes by it), or `undefined` when there is nothing to resolve. Throws
   * {@link SystemWriteOrganizationRequiredError} wherever no owner is
   * derivable (ADR-0131 D9): a wall, several organizations, or — under
   * `single`, in a composition that registers the organization object — none.
   *
   * Called AFTER the beforeInsert hooks on purpose: a hook that stamps the
   * organization itself has carried it, and must not then be refused for a
   * value it just supplied.
   *
   * Every early return below is a population the refusal must not touch — see
   * the module header for why each is outside the rule by construction rather
   * than by exemption. They are ordered cheapest-first, so an ordinary write
   * pays two property reads and a regexp.
   */
  private resolveSystemInsertOrganization(
    object: string,
    execCtx: ExecutionContext | undefined,
    rows: readonly Record<string, unknown>[],
  ): Promise<string | undefined> {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    const read_registry = () => this._registry;
    const host: ThisParameterType<typeof resolveSystemInsertOrganization> = {
      get _registry() { return read_registry(); },
      probeInstallOrganizations: (...a) => this.probeInstallOrganizations(...a),
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return resolveSystemInsertOrganization.call(host, object, execCtx, rows);
  }

  /**
   * Does the open transaction `tx` actually cover the driver `object` resolves
   * to? — the same-origin question, asked by instance IDENTITY (#5351).
   *
   * Answers `true` in two cases: the resolved driver IS the transaction's
   * owner, or the engine cannot tell who the owner is. The second case is the
   * DECLARED LIMIT of this gate, not an oversight, and it is exactly one
   * shape: a handle the engine never opened and cannot attribute.
   *
   * `TransactionScope` (#5724) records the owner for every transaction the
   * engine opens, and `transaction()` also threads that same handle down as
   * `execCtx.transaction`, so the dominant explicit-threading path is covered
   * by identity-matching the handle back to the store entry. What is NOT
   * covered:
   *
   * - `ScopedContext`'s discrete `beginTransaction`/`commit`/`rollback` trio,
   *   which threads the handle across `setImmediate` boundaries where
   *   AsyncLocalStorage does not survive, and so never populates txStore;
   * - any handle an outside caller obtained elsewhere and passed in as
   *   `execCtx.transaction`.
   *
   * For those the engine holds an opaque driver object with no back-reference
   * to its driver, so there is no honest comparison to make. Guessing — say,
   * assuming an unattributed handle belongs to the default driver — would
   * refuse legitimate single-datasource work on one side and carve out writes
   * that were genuinely covered on the other. So the gate declines to judge and
   * the pre-#5351 behaviour stands on that path: recorded in the ADR-0067/0119
   * revision, and closable only by making handle ownership discoverable on
   * `IDataDriver` (filed separately).
   */
  private transactionCoversDriverFor(object: string, tx: unknown): boolean {
    const store = this.txStore.getStore();
    // The scope describes the handle in the store. An explicitly-threaded
    // handle is covered by it only when it IS that handle.
    const scope = store !== undefined && tx === store.transaction ? store.scope : undefined;
    if (!scope) return true;
    return this.getDriver(object) === scope.driver;
  }

  /**
   * Resolve the `NOW()` runtime token into the value the field's declared type
   * actually stores (#4597).
   *
   * The engine — not the driver — owns this resolution, exactly as it owns
   * `current_user`. `NOW()` is the mirror of #4560's crack: `current_user` was
   * known to the engine and not to the DDL, so the DDL stored the token text;
   * `NOW()` was known to the SQL driver and not to the engine, so every
   * non-SQL datasource got the token text instead of a time. Resolving here
   * makes one answer serve every driver.
   *
   * The shapes below are NOT invented: they are the canonical storage forms
   * ADR-0053 already fixed and `SqlDriver.nowColumnDefault` already emits
   * per type. Producing a full instant for a `Field.date` would trade the old
   * cross-driver drift for a new one (SQL would keep collapsing it to a
   * calendar day in `formatInput`, memory/mongodb would not), so the token
   * resolves per declared type:
   *
   * | field type | stored form | matches |
   * |---|---|---|
   * | `date` | `YYYY-MM-DD` (UTC day) | `toDateOnly` / the `date` column DEFAULT |
   * | `time` | `HH:MM:SS[.fff]` (UTC wall clock, `.000` trimmed) | `canonicalTimeOfDay` |
   * | anything else | `YYYY-MM-DDTHH:MM:SS.sssZ` | `canonicalUtcDatetime` |
   *
   * "Anything else" deliberately includes non-temporal fields: a `text` field
   * that opts into `NOW()` gets the instant, which is what the SQL column
   * DEFAULT gives it today.
   *
   * `instant` is the caller's per-insert `now` snapshot when the `NOW()` token
   * is what asked, so two defaulted fields on one record cannot straddle a
   * millisecond boundary.
   *
   * It is NOT only the token's, though (#7373): this is the one place that
   * knows what shape a declared type stores an instant in, so the CEL branch's
   * {@link normalizeExpressionDefault} routes its own `Date` results through
   * the SAME table rather than growing a second copy of it. Hence the
   * parameter is an arbitrary `instant`, not "now" — `daysFromNow(7)` is a
   * week out and takes the identical per-type treatment.
   */
  private resolveNowDefault(fieldType: unknown, instant: Date): string {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`.
    return resolveNowDefault(fieldType, instant);
  }

  /**
   * Put a CEL `defaultValue`'s evaluated result into the storage shape the
   * field's declared type contracts for (#7373).
   *
   * The counterpart the expression branch was missing. `applyFieldDefaults`
   * has three ways to produce a default and, before this, only two of them
   * honoured the stored-value contract: the `NOW()` token routed through
   * {@link resolveNowDefault}, a literal is checked against
   * `valueSchemaFor(def, 'stored')` at AUTHOR time (#7127), and the expression
   * envelope's result was assigned verbatim. But the temporal stdlib returns a
   * JS `Date` — ADR-0053 D1 fixes `today()` / `daysFromNow(n)` / `daysAgo(n)`
   * as UTC-midnight of the reference-tz calendar day, and `now()` as the raw
   * instant — while `valueSchemaFor` says a stored instant is an ISO-8601
   * STRING. So `{ dialect: 'cel', source: 'daysFromNow(7)' }` on a `datetime`
   * put a `Date` object in the column: a value the platform's own
   * `os migrate value-shapes` scan reports as a violation.
   *
   * Why NORMALIZE rather than refuse the `Date` — the two shapes this could
   * have taken, decided on measurement:
   *
   *  - **The drivers already agree with this answer.** Handed a `Date`,
   *    `SqlDriver.formatInput` coerces it through `canonicalUtcDatetime`
   *    (`toISOString()`) and `toDateOnly` (`YYYY-MM-DD`); mongodb's
   *    `storageDatetimeValue` keeps the BSON `Date`, which is what parsing the
   *    ISO string produces anyway, and its `storageDateValue` collapses to the
   *    same `YYYY-MM-DD`. Normalizing here is therefore byte-identical on
   *    every SQL and mongodb-backed store and changes exactly one thing: the
   *    memory driver, which applies its temporal canon to filter comparands
   *    only (`coerceTemporalValue`) and stores writes as handed. That is the
   *    whole defect, and this is the smallest change that closes it.
   *  - **Refusal would single out one writer.** `validateRecord` accepts a
   *    `Date` on `date`/`datetime` from ANY caller by explicit decision
   *    (`if (value instanceof Date) return null`), and temporal types are not
   *    in ADR-0104's strict value-shape block at all. Refusing a `Date` only
   *    when a CEL default produced it would make the rule depend on who wrote
   *    the value rather than on what the value is — and would break the
   *    documented envelope (#7244) on precisely the SQL backends where it
   *    stores correctly today.
   *
   * This is the `NOW()` crack of #4597 / #4560 in its third form: a value the
   * SQL driver silently repaired at the wire and non-SQL datasources did not,
   * so one declaration stored two shapes depending on the datasource. Resolved
   * engine-side, one answer serves every driver; the driver coercions stay as
   * defence in depth for writes that bypass the engine.
   *
   * No day can shift here. ADR-0053 D1's `Date` is UTC-midnight OF the
   * reference-tz calendar day, and {@link resolveNowDefault} reads it back
   * with `toISOString()` — UTC getters, the same `getUTC*` reading the ADR
   * names for the driver filter path. Reading those parts in LOCAL time is the
   * move that would shift a day, and nothing here does it.
   *
   * Non-`Date` results (a string, a number, a bool, a list) pass through
   * untouched: this normalizes temporal FORM, it does not police the contract,
   * and a CEL default is documented as "result type is a runtime concern".
   * An `Invalid Date` passes through too — the same totality the driver
   * canons keep, so a value nothing can interpret is never silently rewritten
   * into a wrong one.
   */
  private normalizeExpressionDefault(fieldType: unknown, value: unknown): unknown {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
    return this.resolveNowDefault(fieldType, value);
  }

  /**
   * Build a HookContext.api: a ScopedContext that hooks can use to
   * read/write other objects within the same execution context.
   * Falls back to a system-elevated empty context when no execCtx
   * is supplied (e.g. system-triggered hooks).
   */
  private buildHookApi(execCtx?: ExecutionContext): ScopedContext {
    const safeCtx: ExecutionContext = execCtx ?? ({ isSystem: true } as any);
    return new ScopedContext(safeCtx, this as unknown as IDataEngine);
  }

  /**
   * The initial value a field's OPTION LIST declares — the option marked
   * `default: true` — or `undefined` when it declares none (#7246).
   *
   * `SelectOption.default` has been authorable and spec-valid since the schema
   * was written, and until this method nothing on the insert path read it: a
   * create that omitted the field stored `null`, not the marked option. The one
   * consumer anywhere was lint's `isNullableField`, which concluded the column
   * was always-valued — a **build-breaking** verdict resting on a declaration
   * the engine did not honour. Enforcing it here is what makes that heuristic
   * true rather than merely asserted.
   *
   * Deliberate decisions, each of which could reasonably have gone the other
   * way:
   *
   *  - **Precedence: `defaultValue` wins.** Not decided here — decided by the
   *    caller, which only reaches this method when `defaultValue == null`. The
   *    field-level key is the more specific declaration (it names a value for
   *    THIS field; the option flag describes the shared option list), and it is
   *    the spelling every other consumer already honours. When both are
   *    declared and disagree, the option flag is inert exactly as it is today.
   *
   *  - **Type-agnostic, like the lint heuristic.** `options` is a field-level
   *    key on `FieldSchema`, not gated on `type: 'select'`, and
   *    `isNullableField` reads it without a type test. Matching that keeps the
   *    two sides honest BY CONSTRUCTION: there is no field the lint calls
   *    always-valued that this method leaves empty.
   *
   *  - **A MULTI-VALUED field assembles an ARRAY.** That field stores an
   *    Array/JSON, so the shape of its default follows the field, not the
   *    number of marked options — one marked option on a multi-select defaults
   *    to a one-element array, never a bare scalar that the driver would then
   *    store with the wrong shape. [#18408] Multi-valued is
   *    {@link declaredMultiValued}, ⛔ not a raw `field.multiple`: the flag is
   *    inert on a type outside the two multi sets and redundant on a
   *    `multiselect` / `checkboxes` / `tags`, which stores an array with or
   *    without it — so reading the flag made this method disagree with the
   *    validator one frame later (`normalizeMultiValueFields` has asked the
   *    predicate all along) and with the column the driver builds.
   *
   *    Refusing (throwing) was rejected: the metadata is
   *    spec-valid, and a runtime throw on spec-valid input is a worse answer
   *    than a well-defined value. Ignoring it was rejected too — it would
   *    preserve, for multi-selects only, precisely the inertness this change
   *    removes, and an author cannot see that carve-out from the schema.
   *
   *  - **Several options marked on a SINGLE-valued field: the FIRST wins.**
   *    There is one slot, so declaration order decides — deterministic, and
   *    the same option a picker preselects when it takes the first match.
   *    Neither the `Field.select` builder nor the schema dedupes the flag, so
   *    this case is reachable; the alternative (throw) again fails a
   *    spec-valid declaration at runtime. Nothing in the shipped corpus marks
   *    more than one.
   *
   *  - **Only the canonical `default` spelling is read.** The authoring
   *    aliases (`isDefault`, `selected`) are normalized by
   *    `SelectOptionSchema`'s alias layer before metadata reaches the engine,
   *    and lint reads the canonical key only. Reading the aliases here would
   *    make the engine honour raw shapes lint calls nullable — the two would
   *    disagree in the direction that produces a false "always-valued".
   */
  private resolveOptionDefault(field: { type?: unknown; options?: unknown; multiple?: unknown }): unknown {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`.
    return resolveOptionDefault(field);
  }

  /**
   * Apply field defaults to an incoming insert payload. Defaults that are
   * Expression envelopes (e.g. `{ dialect: 'cel', source: 'today()' }`,
   * `{ dialect: 'cel', source: 'os.user.id' }`) are evaluated via
   * `ExpressionEngine` against the calling user/org/now snapshot. The
   * `defaultValue` runtime TOKENS (`@objectstack/spec/data`'s
   * `DEFAULT_VALUE_TOKENS` — `current_user` and `NOW()`, the whole family) are
   * resolved here, so one declaration behaves identically on every driver.
   * Static defaults are applied verbatim. Records that already supplied a value
   * for a field are left untouched.
   *
   * "Supplied a value" means the field is present with a non-null value. Both an
   * OMITTED field (`undefined`) and an EXPLICIT `null` are treated as "not
   * supplied" and get the default. This runs on the INSERT path only, where a
   * `null` from a form (an unpicked control serializes to `null`, not omission)
   * unambiguously means "no value"; the UPDATE path never calls this, so a
   * deliberate "set to null" on update is preserved (#2706). Empty string `''`
   * is a real, user-entered value and is left as-is.
   *
   * Implements ROADMAP §M9.9b — `defaultValue` accepts Expression so authors
   * can replace "write a hook to default to today/current-user" with a
   * declarative `defaultValue: cel\`today()\``.
   *
   * A field that declares NO `defaultValue` falls back to the option marked
   * `default: true` ({@link resolveOptionDefault}, #7246) — the select idiom,
   * which until then was authorable, spec-valid, and read by nothing on this
   * path.
   *
   * [#20082] `permissions` is the acting subject's effective object-permission
   * map, which an expression default calling `current_user.can(object, verb)`
   * answers from. This method is synchronous, so the CALLER resolves it — once
   * per write, only for a row that will be defaulted by such an expression
   * ({@link resolveDefaultPermissions}, which also owns what a failed resolution
   * does: it refuses the write before this runs). `undefined` is "no permission
   * data": a `can` default then does not evaluate and takes this method's rule
   * for every expression default that does not — left unset, with the warn below.
   */
  private applyFieldDefaults(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    nowSnapshot?: Date,
    permissions?: EvalPermissions,
  ): Record<string, unknown> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyFieldDefaults> = {
      defaultFieldEntries: (...a) => this.defaultFieldEntries(...a),
      get logger() { return readLogger(); },
      normalizeExpressionDefault: (...a) => this.normalizeExpressionDefault(...a),
      resolveNowDefault: (...a) => this.resolveNowDefault(...a),
      resolveOptionDefault: (...a) => this.resolveOptionDefault(...a),
    };
    return applyFieldDefaults.call(host, object, record, execCtx, nowSnapshot, permissions);
  }

  /**
   * The field entries {@link applyFieldDefaults} walks — one reading of an
   * object's `fields`, shared with {@link resolveDefaultPermissions} so the
   * planner and the evaluator see the same defaults. `undefined` when the object
   * declares no fields, which is `applyFieldDefaults`' early return (it hands
   * the SAME record reference back, and the insert path relies on knowing that).
   */
  private defaultFieldEntries(object: string): Array<{
    name: string; type?: unknown; defaultValue?: unknown; options?: unknown; multiple?: unknown;
  }> | undefined {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const host: ThisParameterType<typeof defaultFieldEntries> = {
      getSchema: (...a) => this.getSchema(...a),
    };
    return defaultFieldEntries.call(host, object);
  }

  /**
   * Generate values for empty `autonumber` fields on insert — ONLY for drivers
   * that do not generate them natively (memory, mongodb). For SQL-backed objects
   * the driver owns a persistent, atomic `_objectstack_sequences` table and
   * advertises `supports.autonumber === true`; the engine then defers entirely
   * and never pre-fills (so the persistent sequence is the single source of
   * truth — see #1603). Required-validation exempts `autonumber` either way, so
   * a `required` record number is never rejected for "missing" — the runtime
   * owns the value, not the client.
   *
   * That ownership is now ENFORCED rather than merely asserted (#5503): the
   * insert path strips a caller-supplied value before this runs, so the "respect
   * explicit value" skip below is reached only by writers the strip exempts —
   * `isSystem` (seed replay, migration) and an opt-in historical import
   * (`preserveAudit`), plus values a `beforeInsert` hook computed server-side.
   * For every other caller the slot arrives empty and the sequence issues the
   * number. Do NOT "fix" a forged value here by overwriting it: the strip must
   * stay upstream of this method, because a driver with
   * `supports.autonumber === true` returns above without ever entering the loop.
   *
   * In the fallback path the next value is `max(existing) + 1`, seeded once per
   * `object.field.<scope>` from the store then incremented in memory (monotonic
   * within the process, resilient to deletions). The shared `autonumberFormat`
   * renderer is honored end-to-end, so date tokens (`AD{YYYYMMDD}{0000}`), field
   * interpolation (`{island_zone}{000}`) and per-scope reset behave identically
   * to the SQL driver's persistent sequence (#1603). NOTE: this in-memory seeding
   * is single-instance.
   *
   * # A format-LESS field renders through the contract default, not bare (#6555)
   *
   * "Identically to the SQL driver" was true of every DECLARED format and false
   * of the one case nobody declares: with no format at all this method used to
   * hand `parseAutonumberFormat` the empty string, whose empty token list
   * `renderAutonumber` renders through its no-slot branch as a BARE counter —
   * `1`, `2`, …. The SQL driver substituted `'{0000}'` in the same case and
   * issued `0001`, `0002`, …. One metadata document, two number shapes, decided
   * by which driver happened to serve it; the counter VALUE always agreed
   * (#6468 pinned that), so what forked was rendering width alone.
   *
   * The maintainer ruling of 2026-08-08 (#6555, route 3) puts the default in the
   * contract instead of in either fallback, and this method now reads it:
   * {@link resolveAutonumberFormat} answers the canonical `autonumberFormat`,
   * then the `format` shorthand (#1603), then `DEFAULT_AUTONUMBER_FORMAT`
   * (`{0000}`). Two consequences, both deliberate:
   *
   *   - A format-less field on this path now issues `0001` where it issued `1`.
   *     `{0000}` was chosen because it is the shape SQL deployments already
   *     store, so the flip lands on engine-fallback deployments only.
   *   - "Declared" is now a NON-EMPTY string (the SQL driver's long-standing
   *     truthiness rule) rather than the `??` this method used, so
   *     `autonumberFormat: ''` resolves to the default too instead of rendering
   *     bare — and an empty canonical key no longer masks a declared `format`
   *     shorthand. The bare counter is still reachable, by declaring a format
   *     with no `{0..0}` slot (`'PRE-'` → `PRE-1`).
   *
   * Seeding is untouched by all of this: `{0000}` renders prefix `''` and suffix
   * `''`, so {@link readStoredAutonumberCounter} stays on its UNANCHORED legacy
   * branch and reads already-stored bare values exactly as before.
   *
   * # Keeping the seeded counter in sync (#6806)
   *
   * Seeding "once per counter key" is only the truth while the engine is the
   * ONLY writer of the field. It is not: the `continue` below is reached by
   * every exempt writer (`isSystem` seed replay, a `preserveAudit` historical
   * import, a `beforeInsert` hook stamp), and each of those persists a record
   * number the counter never saw. The counter then keeps issuing from where the
   * one-time seed left it — below the store's real max — and every number it
   * issues up to that max is a duplicate business identifier. Two resyncs
   * close that, from opposite ends:
   *
   *   - **Adopt, here.** An exempt value passes through this very loop, so the
   *     counter can be lifted from it for FREE — one string parse, no query.
   *     {@link adoptExplicitAutonumber} does it, which makes the warm in-memory
   *     counter converge on what a cold re-seed of the same store would answer.
   *     This is the whole fix for in-process drift, and it costs nothing on the
   *     generating path (a caller-supplied value never reaches this method
   *     unless the writer is exempt).
   *   - **Re-seed on collision**, at the write. Adoption cannot see a writer
   *     outside this process (another instance, a direct driver write, a
   *     restore). Those surface as a unique-constraint failure on the create,
   *     and {@link createWithAutonumberResync} answers it by dropping the stale
   *     counter, re-seeding from the store and re-issuing — bounded. It costs
   *     nothing until a collision actually happens.
   *
   * Both are required and neither subsumes the other: adoption covers drift the
   * engine can observe but the store cannot report, collision-resync covers
   * drift the store reports but the engine could not observe.
   *
   * @returns the autonumbers this call ISSUED, in field order — the input
   * {@link createWithAutonumberResync} needs to decide whether a unique
   * violation is one of its own numbers. An adopted (caller-supplied) value is
   * deliberately NOT listed: it is not the engine's to re-issue.
   */
  private applyAutonumbers(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    driverOwnsAutonumber?: boolean,
  ): Promise<IssuedAutonumber[]> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const readAutonumberCounters = () => this.autonumberCounters;
    const host: ThisParameterType<typeof applyAutonumbers> = {
      adoptExplicitAutonumber: (...a) => this.adoptExplicitAutonumber(...a),
      get autonumberCounters() { return readAutonumberCounters(); },
      getSchema: (...a) => this.getSchema(...a),
      seedAutonumber: (...a) => this.seedAutonumber(...a),
    };
    return applyAutonumbers.call(host, object, record, execCtx, driverOwnsAutonumber);
  }

  /**
   * Lift the in-memory counter to a record number an EXEMPT writer supplied
   * (#6806) — the free half of the resync, and the one that closes the shape
   * #5495's PROBE1 measured on a warm database.
   *
   * The value is parsed with {@link readStoredAutonumberCounter}, i.e. by
   * exactly the anchoring rules #6468 gave the seeding scan, against the
   * prefix/suffix this record's own format renders. So adopting is the same reading a cold re-seed
   * would perform over the same row — which is the invariant to hold on to: a
   * warm counter must answer what a restart would answer.
   *
   * Four deliberate refusals, each one a way this could do harm:
   *
   *   - **Never throws.** An exempt write is not the engine's to reject, and it
   *     was not rejected before this method existed. A format whose `{field}`
   *     interpolation is empty, or a value that parses to nothing, simply
   *     teaches the counter nothing.
   *   - **Only LIFTS a counter that is already seeded.** With no seed in hand,
   *     writing this value in would SKIP the seeding scan and answer from one
   *     row — below the real max whenever the store holds a higher number, i.e.
   *     the duplicate-number defect itself. Doing nothing is correct: the row is
   *     persisted, so the first generating insert's own scan reads it.
   *   - **Never lowers.** A counter that has already issued numbers must not go
   *     back over them; the max is a floor that only rises.
   *   - **Only within this record's scope.** The reading returns `undefined`
   *     for a value that does not carry the rendered prefix, so a
   *     historical import into last month's date scope cannot lift THIS
   *     month's counter. Its own scope's counter is left untouched, which is
   *     harmless: a scope is derived from the write instant, so a past scope's
   *     counter is not one a subsequent generating insert can reach.
   *
   * Adoption runs BEFORE the driver write, so an exempt insert that then fails
   * leaves the counter lifted over a number nobody took — a gap. Gaps are
   * already the documented cost of this path (a failed attempt consumes its
   * value; the counter is "resilient to deletions"), and the direction is the
   * safe one: a gap is a cosmetic surprise, a duplicate is a corrupted business
   * identifier.
   */
  private adoptExplicitAutonumber(
    object: string,
    field: string,
    tokens: ReturnType<typeof parseAutonumberFormat>,
    record: Record<string, unknown>,
    value: string,
    now: Date,
    timezone?: string,
  ): void {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const readAutonumberCounters = () => this.autonumberCounters;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof adoptExplicitAutonumber> = {
      get autonumberCounters() { return readAutonumberCounters(); },
      get logger() { return readLogger(); },
    };
    return adoptExplicitAutonumber.call(host, object, field, tokens, record, value, now, timezone);
  }

  /**
   * Create ONE record, re-seeding and re-issuing when the driver rejects an
   * autonumber the engine itself issued as a duplicate (#6806).
   *
   * # What this is for
   *
   * A counter that sits below the store's real max — because a writer outside
   * this process took numbers the engine could not observe — collides on every
   * insert until it has walked past that max one number at a time. Before this,
   * each of those inserts failed with the driver's raw error AND advanced the
   * counter, so a warm-database storm burned a number per failed create and
   * never converged on its own (#5495's PROBE3). Dropping the counter on the
   * collision is what converges it: the re-seed reads the true max back, and
   * the next attempt is issued from it.
   *
   * # Which failures qualify
   *
   *   - The engine must have ISSUED an autonumber on this row. A row whose
   *     numbers all came from an exempt writer has nothing here to re-issue.
   *   - The error must be a unique violation, per `isUniqueViolationError`
   *     (#6250) — never a word-list of this method's own.
   *   - When the dialect names the conflicting COLUMN (`uniqueViolationColumn`,
   *     #6544), it must be one of the fields the engine issued. A conflict on
   *     some other unique field is the caller's business error and is NOT
   *     re-issued, exactly as #5495's disposition ruled («非本字段的冲突原样上抛»);
   *     since #14095 it leaves the door as the `DUPLICATE_RECORD` envelope
   *     (`DuplicateRecordError`) carrying that same driver error as `cause` —
   *     the disposition is about not RE-ISSUING, and the envelope changes
   *     nothing about which failures qualify.
   *     When the dialect names no determinable column the attribution falls back
   *     to "the engine issued a number on this row, and the row was refused as a
   *     duplicate" — deliberately, because `uniqueViolationColumn` answers
   *     `undefined` for every index-named dialect, which includes MongoDB's
   *     `E11000 ... index: doc_no_1`, i.e. the ONE fallback driver that can
   *     raise this at all. Requiring a named column would make the resync
   *     unreachable on exactly the driver that needs it. The cost of the
   *     fallback is a wasted re-issue when an unrelated unique field is what
   *     actually conflicted: the second attempt fails the same way, and the
   *     original error is what the caller finally sees.
   *
   * # ⚠ The guarantee is STORAGE-DEPENDENT — say so, do not imply otherwise
   *
   * This whole branch is triggered by the storage layer REJECTING the duplicate,
   * so it reaches only drivers that (1) take this fallback path at all and
   * (2) enforce uniqueness. Measured across all five in-repo drivers:
   *
   * | driver | `supports.autonumber` | fallback path? | uniqueness on the column | a collision appears as |
   * |:---|:---|:---|:---|:---|
   * | driver-memory | `supports = {}` | **yes** | field-level `unique`, since commit 56c093c4d (ADR-0120 D1/D3 scoping) | `UNIQUE_VIOLATION` / 409 → re-seed + re-issue, here |
   * | driver-mongodb | absent (`{ batchSchemaSync: true }`) | **yes** | single-field unique index when the field declares `unique` | `E11000 duplicate key` → re-seed + re-issue, here |
   * | driver-sql | `autonumber: true` | no | — | — (but see #25073 below) |
   * | driver-sqlite-wasm | inherited (`extends SqlDriver`, no `supports` override) | no | — | — (inherited) |
   * | driver-turso | inherited (`...super.supports`) | no | — | — (inherited) |
   *
   * # Numbers the DRIVER issued ahead of the write (#25073)
   *
   * For an object whose stored `expression` reads its record number, a driver
   * that owns its counter issues the number through
   * `IDataDriver.issueAutonumbers` before this method runs, and the row
   * arrives here carrying it (`driverIssued`). The driver's own retry inside
   * `create()` cannot answer a collision on it any more — it reserved
   * nothing — and must not: a number re-issued there would leave the stored
   * expression computed from the old one. So the retry is this loop's, the
   * same loop the fallback drivers use. The member decides whether the error
   * is a collision on its numbers (never a duplicate the caller typed, never
   * inside a caller's transaction) and re-seeds the stale counter; this loop
   * then issues again, recomputes the readers and writes again, under the
   * same {@link AUTONUMBER_COLLISION_ATTEMPTS} bound.
   *
   * So the retry protects the TWO fallback backends — and it protected only one
   * of them until commit 56c093c4d, because `driver-memory` enforced no uniqueness at all
   * and had nothing to reject with. Which driver ISSUES the number is a
   * separate question and is unmoved by that: it is the reading the repo
   * already ruled and gates, in
   * `scripts/driver-memory-census.ledger.json`'s disposition for
   * `packages/runtime/src/autonumber-seed-cross-side-parity.integration.test.ts`
   * (axis `ruled-permanent`, «#6664 A, maintainer 2026-08-08 — inherits #5704
   * Q2 = B»), which states it as: "InMemoryDriver declares `supports = {}`, so
   * the ENGINE's autonumber seeding owns the counter. No SQL backend can stand
   * in — SqlDriver advertises the capability and its own sequence bootstrap
   * answers instead". This comment cites that ruling rather than restating it:
   * a second answer to "who owns the autonumber counter" is the same
   * one-contract-two-numbers defect this lane keeps closing (#6832).
   *
   * ⚠️ **This paragraph used to record a live defect; commit 56c093c4d closed it, and the
   * ⛔ below is why the closure went where it did.** `InMemoryDriver.create` was
   * a `table.push()` storing no constraints of any kind (#4065's WEAK-oracle
   * docstring), so an out-of-process duplicate raised nothing for this method to
   * catch and the number landed twice in the rendered field with no error
   * anywhere. Since commit 56c093c4d that driver enforces field-level `unique`
   * (`driver-memory`'s `memory-unique-constraint.ts`, with `driver-sql`'s
   * ADR-0120 D1/D3 scoping) and refuses the collision in the ADR-0112 envelope,
   * which `isUniqueViolationError` reads — so the branch below is reachable
   * there and the number converges instead of duplicating.
   *
   * What covers driver-memory in ADDITION is the other half of this resync —
   * {@link adoptExplicitAutonumber} — which needs no constraint at all because it
   * never waits for a rejection. Between them: drift the engine can observe is
   * fixed on every driver; drift only the store can report is fixed wherever the
   * store reports it.
   *
   * ⛔ The remedy for the silent-duplicate row is uniqueness enforcement in the
   * driver, NOT a pre-issue existence probe here: a probe costs a query on every
   * insert (the cost this resync was designed to avoid) and is still racy, so it
   * would trade a silent duplicate for a rarer silent duplicate at double the
   * read cost. That argument is UNCHANGED by commit 56c093c4d and is not a historical
   * note — it is the standing reason no probe is added here, and it is what the
   * driver-side fix was chosen over. (`packages/drivers/**` was under the #5499
   * investment freeze when this comment was first written, which is why the work
   * was deferred rather than misplaced; the freeze lifted on 2026-08-11 and the
   * remedy landed where it always belonged, in the driver.)
   *
   * # And when it does not converge
   *
   * After {@link AUTONUMBER_COLLISION_ATTEMPTS} the write fails with a named
   * engine error (`code: 'ERR_AUTONUMBER_COLLISION'`) carrying the driver's
   * error as `cause`. The raw driver error is deliberately NOT the contract
   * here: "your record number collided three times after re-seeding" is an
   * engine-level condition a caller can act on, and the driver's prose is
   * preserved rather than replaced.
   */
  private async createWithAutonumberResync(
    driver: any,
    object: string,
    row: Record<string, unknown>,
    driverOptions: any,
    issued: IssuedAutonumber[],
    execCtx: ExecutionContext | undefined,
    driverOwnsAutonumber: boolean,
    driverIssued: string[] = [],
    readers?: AutonumberReaders,
  ): Promise<any> {
    // [#25073] Who issued this row's numbers decides who judges a collision on
    // them: the driver, through the member that issued them, or this engine.
    const byDriver = driverIssued.length > 0;
    let attempt = 1;
    for (;;) {
      try {
        return await driver.create(object, row, driverOptions);
      } catch (error) {
        // [#14095] Not OUR collision to re-issue — so this is where a driver's
        // refusal leaves the single-row door, and where it stops being the
        // driver's error. `envelopeUniqueViolation` returns everything that is
        // not a unique violation untouched (a deadlock, a NOT NULL, an
        // unreachable store), so only the recognised conflict changes shape.
        // [#24768] …and a NOT NULL refusal on a declared field becomes the
        // validator's own `ValidationError` (`envelopeDriverWriteRefusal`).
        // [#25073] On a driver-issued number the member answers instead, and
        // in answering re-seeds the counter it proved stale.
        const collided: string[] = byDriver
          ? ((await driver.issueAutonumbers(object, [row], driverOptions, error)) as string[][] | undefined)?.[0] ?? []
          : this.isIssuedAutonumberCollision(error, issued) ? issued.map((one) => one.field) : [];
        if (collided.length === 0) {
          throw envelopeDriverWriteRefusal(error, object, this.getSchema(object), 'insert', this.validationMessageContext(object, execCtx));
        }
        // Whatever happens next, the stale counter must not survive this call:
        // leaving it in place is what turned one collision into a storm.
        for (const one of issued) this.autonumberCounters.delete(one.counterKey);
        if (attempt >= AUTONUMBER_COLLISION_ATTEMPTS) {
          const fields = collided.join(', ');
          throw Object.assign(
            new Error(
              `Autonumber collision on '${object}' field(s) [${fields}]: the record number was ` +
                `re-seeded from the store and re-issued ${AUTONUMBER_COLLISION_ATTEMPTS} times and the ` +
                `driver rejected each one as a duplicate. No record was written.`,
            ),
            { code: 'ERR_AUTONUMBER_COLLISION', cause: error },
          );
        }
        attempt += 1;
        this.logger.warn('Autonumber collided — re-seeding the counter and re-issuing', {
          object, fields: collided, attempt,
        });
        let renumbered: boolean;
        if (byDriver) {
          // [#25073] The member emptied the slots it proved stale; issue them again.
          renumbered = (((await driver.issueAutonumbers(object, [row], driverOptions)) as string[][] | undefined)?.[0] ?? []).length > 0;
        } else {
          // Clear the slots so `applyAutonumbers` treats them as empty again —
          // leaving the burned value in place would read as an exempt writer's
          // and be adopted rather than re-issued.
          for (const one of issued) delete row[one.field];
          issued = await this.applyAutonumbers(object, row, execCtx, driverOwnsAutonumber);
          renumbered = issued.length > 0;
        }
        // [#25073] A new number is a new input to every stored field that reads it.
        await recomputeAutonumberReaders(readers, [row]);
        // Nothing left to re-issue (the field vanished from the schema
        // mid-flight) — the next failure is the caller's to see, enveloped on
        // the same terms as the exit above (#14095): this call is OUTSIDE the
        // loop's own `try`, so its rejection is a second driver-error exit and
        // not a path the branch above covers.
        if (!renumbered) {
          try {
            return await driver.create(object, row, driverOptions);
          } catch (retryError) {
            throw envelopeDriverWriteRefusal(retryError, object, this.getSchema(object), 'insert', this.validationMessageContext(object, execCtx));
          }
        }
      }
    }
  }

  /**
   * Whether `error` is a unique violation attributable to one of the
   * autonumbers this insert issued (#6806). See
   * {@link createWithAutonumberResync} for why an unnamed column counts as
   * attributable and a differently-named one does not.
   */
  private isIssuedAutonumberCollision(error: unknown, issued: IssuedAutonumber[]): boolean {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`.
    return isIssuedAutonumberCollision(error, issued);
  }

  /**
   * [#25073] A driver that owns the record-number counter
   * (`supports.autonumber`) but cannot issue a number ahead of the write
   * (no `IDataDriver.issueAutonumbers`) still fills it inside `create()`, so a
   * stored field whose `expression` reads it is stored as computed WITHOUT
   * it, and every insert looks successful. That is a stored value that is
   * not what its declaration says (AGENTS.md, degradation log levels: `error`),
   * said once per object per engine instance, with the remedy.
   */
  private warnAutonumberReadersUnserved(object: string, plan: readonly FormulaPlanEntry[], driver: unknown): void {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const readAutonumberReadersUnservedReported = () => this.autonumberReadersUnservedReported;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof warnAutonumberReadersUnserved> = {
      get autonumberReadersUnservedReported() { return readAutonumberReadersUnservedReported(); },
      get logger() { return readLogger(); },
    };
    return warnAutonumberReadersUnserved.call(host, object, plan, driver);
  }

  /**
   * Seed the autonumber counter from the current max in store, scoped to
   * `prefix`. With a non-empty prefix (date/field formats) only rows in the
   * same scope count.
   *
   * # Locating the counter inside a stored value (#6468)
   *
   * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, and
   * `suffix` is a DECLARED return value: every token after the `{0..0}` slot
   * renders behind the counter (`{000}-{YYYY}` → `001-2026`). So the counter is
   * NOT "the digits at the end of the string" — reading it that way took the
   * year for the counter and seeded `2026` against a true counter of `1`, which
   * jumps the next issued number to `2027-2026` and burns the band in between.
   *
   * Both the rendered `prefix` and the rendered `suffix` therefore come in from
   * the caller (they are `renderAutonumber`'s own output — this method does not
   * re-derive any format understanding of its own, and neither does the SQL
   * driver's `scanMaxNumericTail`, which is handed the same two strings):
   *
   *   - **Either one declared ⇒ the slot is ANCHORED**: the counter is the digit
   *     run at the START of what follows the prefix, after removing the declared
   *     suffix when this row carries it. That half is spec's
   *     `readAutonumberCounter` — the declared inverse of `renderAutonumber`,
   *     which the SQL driver's scan calls too, so one edit moves both sides
   *     (#6560).
   *   - **Neither declared ⇒ UNANCHORED**: the legacy reading is kept — the LAST
   *     digit run of the whole value. A format with no `{0..0}` slot renders a
   *     bare trailing counter, and values predating any format have no anchor to
   *     read from, so this stays exactly as it was. The SQL driver's legacy
   *     reading of this case differs on purpose, which is why it stays per-side.
   *
   * The two together are {@link readStoredAutonumberCounter}, module-level
   * rather than inline, because #6806's resync must read an exempt writer's
   * supplied value by exactly these rules.
   *
   * The suffix is *stripped when it matches*, never *required* to match: a
   * dynamic suffix renders differently per row (`{000}-{YYYY}` is `-2025` on
   * last year's rows) while the counter scope is the rendered PREFIX — here `''`
   * — so those rows share this very counter and must still be counted. Skipping
   * them would seed BELOW the real max, which is the duplicate-record-number
   * harm #6249 fixed on the scan side. Reading the leading digit run gets them
   * right regardless; the strip only adds precision when a suffix begins with a
   * digit (`{0000}{YYYY}`, whose values are ambiguous by construction — the
   * compile lint nudges authors to a delimiter).
   *
   * # Why this walks every row in the scope (#6249)
   *
   * The seed used to be one `find` with `limit: 5000`, no `orderBy` and no
   * filter: the max of an ARBITRARY 5000-row window (on SQL, typically the
   * oldest 5000 rows), which for any object past that size — or any scope
   * whose rows sit outside the window because other scopes filled it — seeds
   * BELOW the real MAX. The counter then issues numbers from an already-taken
   * band, and on a `unique` record-number field that is a duplicate business
   * identifier: a value written wrong, which no retry and no restart repairs
   * (the same class of harm as the read-outage half fixed in #5979/#6114).
   *
   * The scan is therefore complete rather than windowed, in the shape the
   * SQL driver's own seeding already uses (`scanMaxNumericTail` pushes
   * `like 'prefix%'` down with NO limit). Two deliberate choices:
   *
   *   - **The numeric max is computed here, never delegated to an ORDER BY or
   *     an aggregate `max`.** Both of those rank the stored value as TEXT, and
   *     lexicographic order equals numeric order only when every value in the
   *     scope is zero-padded to one fixed width — which the format language
   *     does not guarantee (`{0}` pads to nothing, and any width OVERFLOWS
   *     once the counter passes it, putting `CASE-99999` above `CASE-100000`).
   *     The empty-prefix legacy path, which reads the LAST digit run of the
   *     whole value, has no lexicographic reading at all. Parsing every value
   *     keeps one code path correct for every format instead of a fast path
   *     guarded by assumptions a format author can silently break.
   *   - **Seek pagination, not `offset`** — `keysetWalk`'s own rationale
   *     (#4363): an offset walk cannot promise it visited every row, and a
   *     row it skips is exactly a number this seed must not miss.
   *
   * `prefix` is pushed down as `$startsWith` so a date/`{field}` scope reads
   * its own rows instead of paging through every other scope's. The JS-side
   * `startsWith` re-check below is kept as the authority: a driver whose
   * matching is LOOSER (a case-insensitive `LIKE`) must not be able to inflate
   * the max with another scope's rows.
   */
  private seedAutonumber(
    object: string,
    field: string,
    prefix: string,
    suffix: string,
    execCtx?: ExecutionContext,
  ): Promise<number> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts` (see `DefaultsAndAutonumbersHost`).
    const host: ThisParameterType<typeof seedAutonumber> = {
      find: (...a) => this.find(...a),
    };
    return seedAutonumber.call(host, object, field, prefix, suffix, execCtx);
  }

  /**
   * The (package id, conversion id) pairs this engine has already warned
   * about at the registration door — one line per pair per process, as the
   * artifact door prints its summaries (`MetadataPlugin`).
   */
  private registrationConversionWarned = new Set<string>();

  /**
   * ADR-0087 D2 at the kernel's package REGISTRATION door: a package body that
   * declares its protocol range replays the versioned forward conversion
   * before anything of it registers.
   *
   * ## Why this door converts
   *
   * A compiled artifact is data at rest with a version stamp, and the
   * artifact FILE doors replay the conversion chain inside the window its
   * `engines.protocol` opens (`loadArtifactBundle`, the metadata plugin's
   * artifact door, `AppPlugin`). An INSTALLED package reaches this engine by
   * other roads too: a hosted environment's kernel registers the package
   * bodies it holds through `manifest.register` / {@link registerApp} with no
   * parse and no file door in between, and a marketplace install hands the
   * fetched bundle straight to `manifest.register`. On those roads the registry
   * was the first and only judge, so a declaration a newer spec retires —
   * `isDefault: true` on a `home` page, say — stopped the kernel build of every
   * environment holding a package built before the retirement, with no operator
   * remedy short of upgrading each one. This is the one door every package
   * registration reaches (`SchemaRegistry.installPackage` and the per-item
   * seam both sit behind it), so the window is opened here, once.
   *
   * ## Why only a body that declares a range
   *
   * The policy function reads the body's own `engines.protocol` (the manifest
   * half of a package body carries it; every `os build` stamps it). A body
   * with NO declared range is, at this door, a manifest a plugin built in code
   * (`manifest.register({ … })` in its `init`), not data at rest: it has an
   * author, and it meets the registry's refusals exactly as before — nothing
   * is replayed for it. That keeps the registry's own refusals the authority
   * for code-registered metadata while an installed body converts under the
   * same versioned window every artifact door opens, decided by the same
   * function (`applyArtifactForwardConversions`, `@objectstack/metadata-core`),
   * never by a second table.
   *
   * Idempotent: a body an artifact door already converted comes back by
   * reference with no notice, so the two doors never print one conversion
   * twice. Copy-on-write: untouched branches (`plugins`, code) are shared.
   *
   * Loud: one `warn` per (package, conversion) names the conversion id, the
   * sites and the remedy, the way the artifact door's summary does — the named
   * warning an operator reads in the boot log. The notices themselves are the
   * structured `OS_METADATA_CONVERTED` record every conversion emits.
   */
  convertPackageBodyForward(body: any): any {
    // [#25522 cut 17] The body moved to `engine-package-registration.ts` (see `PackageRegistrationHost`).
    const readRegistrationConversionWarned = () => this.registrationConversionWarned;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof convertPackageBodyForward> = {
      get registrationConversionWarned() { return readRegistrationConversionWarned(); },
      get logger() { return readLogger(); },
    };
    return convertPackageBodyForward.call(host, body);
  }

  /**
   * Register contribution (Manifest)
   * 
   * Installs the manifest as a Package (the unit of installation),
   * then decomposes it into individual metadata items (objects, apps, actions, etc.)
   * and registers each into the SchemaRegistry.
   * 
   * Key: Package ≠ App. The manifest is the package. The apps[] array inside
   * the manifest contains UI navigation definitions (AppSchema).
   *
   * [#23972] `source` is where the package came from, stamped on its registry
   * row (`InstalledPackageSchema.source`). This is the door the deployment's
   * own code registers through — a `defineStack()` host, a plugin's bundled
   * manifest, a platform package — so `'code'` is what the door means when the
   * caller says nothing. The one other producer on this door, the marketplace
   * install-local plugin, states `'marketplace'` through the `manifest`
   * service's `register(artifact, { source })`. An authored package never
   * comes through here (it is installed by `installPackage` in
   * `@objectstack/metadata-protocol`), so `'authored'` is not accepted.
   */
  registerApp(registeredBody: any, scope?: ArtifactInstallScope, source: Exclude<InstalledPackageSource, 'authored'> = 'code') {
      // The CONVERTED body, for everything below — the package record, the
      // live manifest, every item it registers (see {@link convertPackageBodyForward}).
      // [#23972] Refused before anything registers — see the docblock: an
      // untyped caller handing this door `'authored'` (or any other value)
      // would record a row whose origin contradicts the read-only verdict
      // this door's `manifests` entry produces.
      if (source !== 'code' && source !== 'marketplace') {
          throw new TypeError(
              `[ObjectQL] registerApp: source must be 'code' or 'marketplace'; received ${JSON.stringify(source)}. `
              + `An authored package is installed through the protocol's installPackage, not registered here.`,
          );
      }
      const manifest = this.convertPackageBodyForward(registeredBody);
      const id = manifest.id || manifest.name;
      const namespace = manifest.namespace as string | undefined;
      // Stamped beside `id` on every item below ({@link stampPackage}), so an
      // item served from this path tells an upgrade's new item from its old one.
      const version = manifest.version as string | undefined;
      // [#28697] The owner-stamp refusal for the objects and apps below, which
      // file through verbs of their own (steps 2-4), asked before anything of
      // this body registers. See {@link packageBodyObjectAndAppOwnerStampRefusal}.
      {
          const refusal = packageBodyObjectAndAppOwnerStampRefusal(manifest, id, {
              apps: true,
              selfAsApp: Boolean(manifest.name && manifest.navigation && !manifest.apps?.length),
          });
          if (refusal) throw refusal;
          // …and each nested plugin's objects and plugin-as-app (step 7, which
          // registers them under this package after everything above), so a
          // nested plugin's stamp is refused before this body registers too.
          // `registerPlugin` asks the same of the plugin it is handed.
          if (Array.isArray(manifest.plugins)) {
              for (const plugin of manifest.plugins) {
                  if (!plugin || typeof plugin !== 'object') continue;
                  const nested = packageBodyObjectAndAppOwnerStampRefusal(plugin, id, {
                      apps: false,
                      selfAsApp: Boolean(plugin.name && plugin.navigation),
                  });
                  if (nested) throw nested;
              }
          }
          // [#28697] …and every refusal the collection seam (steps 5 and 7)
          // and the seed step (step 6) can judge from the body alone, so a
          // body refused there leaves nothing of itself behind either, and a
          // refused re-register of an installed id leaves that install as it
          // was. See {@link packageBodyCollectionRefusal}.
          const collections = packageBodyCollectionRefusal(manifest, id, 'manifest');
          if (collections) throw collections;
          const seed = packageBodySeedDataRefusal(manifest, id);
          if (seed) throw seed;
          if (Array.isArray(manifest.plugins)) {
              for (const plugin of manifest.plugins) {
                  if (!plugin || typeof plugin !== 'object') continue;
                  const nested = packageBodyCollectionRefusal(plugin, id, 'nested plugin');
                  if (nested) throw nested;
              }
          }
      }
      this.invalidateSummaryIndex(); // new objects may add/change summary fields
      this.logger.debug('Registering package manifest', { id, namespace });

      // [#28697] What remains can only be refused part-way, by the registry's
      // own verbs (an object another package owns, a field with no `type`, a
      // picklist value already added, …). Refused, the registry puts back
      // exactly the entries this registration wrote: a first install leaves no
      // package record, object, app, item or namespace of itself, and a
      // re-register of an installed id (an upgrade) leaves the installed
      // version serving whole. Whatever sat there before — a tenant's object
      // or overlay this package layers over (ADR-0029 D9 §6.1), another
      // package's extension of its objects — reads as it did. Never through
      // uninstall, which refuses an extended object and drops a tenant's
      // overlay with its owner (D9.7). See {@link SchemaRegistry.restoringOnRefusal}.
      this._registry.restoringOnRefusal(() => this.registerPackageBody(manifest, id, namespace, version, source, scope));

      // [#28697] Written only once nothing above threw, so a refused body
      // leaves none of them. Nothing above reads any of them.

      // Store manifest for defaultDatasource lookup
      if (id) {
        this.manifests.set(id, manifest);
      }

      // Index datasource definitions (ADR-0015) so the write gate can read
      // schemaMode + external.allowWrites. Manifests may carry `datasources`
      // as an array or a name-keyed map.
      if (manifest.datasources) {
        const dsList = Array.isArray(manifest.datasources)
          ? manifest.datasources
          : Object.entries(manifest.datasources).map(([name, def]) => ({ name, ...(def as any) }));
        for (const ds of dsList) {
          if (ds?.name) this.registerDatasourceDef(ds);
        }
      }

      // Register navigation contributions (ADR-0029 D7) — nav items this
      // package injects into apps owned by other packages (e.g. a capability
      // plugin adding its menu into the `setup` app). Merged into the target
      // app's navigation on read by group id + priority, so registration order
      // does not matter.
      if (Array.isArray((manifest as any).navigationContributions) && (manifest as any).navigationContributions.length > 0) {
          for (const contribution of (manifest as any).navigationContributions) {
              this._registry.registerAppNavContribution(contribution, id);
          }
          this.logger.debug('Registered navigation contributions', {
              from: id,
              count: (manifest as any).navigationContributions.length,
          });
      }

      // Register contributed kinds (owned by no package, so written last).
      if (manifest.contributes?.kinds) {
          this.logger.debug('Registering kinds from manifest', { id, kindCount: manifest.contributes.kinds.length });
          for (const kind of manifest.contributes.kinds) {
            this._registry.registerKind(kind);
            // [commit 10485009a] Name the kind by its declared `id`. `contributes.kinds`
            // items are `{ id, description? }` (`manifest.zod.ts`; `globs` was
            // retired unread, #11169) and
            // `registerKind` keys the item on `id` (`registerItem('kind', kind, 'id')`),
            // so `id` is BOTH the only identifying field the schema declares and the
            // exact key the item is stored under — a reader of this line can look the
            // item straight back up. The previous `kind.name || kind.type` reached for
            // two fields NEITHER shape declares, so every conforming manifest logged
            // `kind: undefined`. Do not re-add those as a fallback: reading undeclared
            // aliases here is the consumer-side tolerance Prime Directive #12 rejects.
            this.logger.debug('Registered Kind', { kind: kind.id, from: id });
          }
      }
  }

  /**
   * [#28697] The part of {@link registerApp} a registry verb can refuse
   * part-way: the package record, its objects, extensions, apps, collections,
   * seed data and nested plugins, in that order. Every body-only refusal was
   * judged before this runs; what is written after it is in `registerApp`.
   */
  private registerPackageBody(
      manifest: any,
      id: string,
      namespace: string | undefined,
      version: string | undefined,
      source: Exclude<InstalledPackageSource, 'authored'>,
      scope: ArtifactInstallScope | undefined,
  ): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const read_registry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof registerPackageBody> = {
      get _registry() { return read_registry(); },
      get logger() { return readLogger(); },
      registerMetadataCollections: (...a) => this.registerMetadataCollections(...a),
      registerPlugin: (...a) => this.registerPlugin(...a),
      resolveNavObjectNames: (...a) => this.resolveNavObjectNames(...a),
    };
    return registerPackageBody.call(host, manifest, id, namespace, version, source, scope);
  }

  /**
   * Deep-clone an app definition, resolving objectName references in navigation
   * items via the registry. Object names are canonical identifiers — no FQN
   * expansion is applied.
   */
  private resolveNavObjectNames(app: any, namespace: string): any {
    // [#25522 cut 17] The body moved to `engine-package-registration.ts`; it reads no member of the class.
    return resolveNavObjectNames(app, namespace);
  }

  /**
   * Register a nested plugin's metadata (objects, actions, views, etc.)
   *
   * Unlike registerApp(), this does NOT call SchemaRegistry.installPackage()
   * because plugins are not formal manifests — they are lightweight config
   * bundles with objects, actions, triggers, and navigation.
   *
   * @param plugin - The plugin config object
   * @param parentId - The parent package ID (for ownership tracking)
   * @param parentNamespace - The parent package's namespace (for FQN resolution)
   */
  private registerPlugin(plugin: any, parentId: string, parentNamespace?: string, parentVersion?: string) {
    // [#25522 cut 17] The body moved to `engine-package-registration.ts` (see `PackageRegistrationHost`).
    const readLogger = () => this.logger;
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof registerPlugin> = {
      get logger() { return readLogger(); },
      get _registry() { return readRegistry(); },
      resolveNavObjectNames: (...a) => this.resolveNavObjectNames(...a),
      registerMetadataCollections: (...a) => this.registerMetadataCollections(...a),
    };
    return registerPlugin.call(host, plugin, parentId, parentNamespace, parentVersion);
  }

  /**
   * Register one source's stack collections into the registry — the SINGLE
   * body both registration seams run.
   *
   * ## Why this is one method and not two loops (#7163)
   *
   * It used to be two, and #7049 only got halfway: that card hoisted the
   * ENUMERATION (`METADATA_ARRAY_KEYS`) out of the two seams after they had
   * drifted four collections apart, and measured the loop bodies against each
   * other on the way past — recording that they still differed in a per-key
   * `debug` line, the manifest seam's aggregated-view expansion, and its
   * warn-on-nameless-item. Sharing the list made "which collections does a
   * seam see?" unanswerable-differently; it left "what does a seam DO with a
   * collection both see?" still answered in two places.
   *
   * `views` is where that cost was measurable. "Object has-many View"
   * (ADR-0017 §2, §3.2) makes the loader **dual-read**: an aggregated
   * `defineView` container is registered under the bare `<object>` key for
   * back-compatible reads AND expanded into independent `ViewItem`s under
   * `<object>.<viewKey>`. Only the expanded items carry `viewKind`, and
   * `getViewsByObject()` (`metadata-manager.ts`) filters on exactly that — so
   * a container that is registered but never expanded is invisible to it, and
   * to `GET /meta/view?object=` and the view switcher above it. The manifest
   * seam expanded; the nested-plugin seam did not, so one container registered
   * `['account', 'account.all_accounts', 'account.form']` through the manifest
   * and `['account']` through a nested plugin. No refusal, no diagnostic: a
   * package shipping its views through `manifest.plugins[]` simply had no
   * views, as far as every reader of the expanded layer was concerned.
   *
   * Both differences had the same structure — a loop body copied, then
   * improved on one side only — so the body is shared rather than reconciled,
   * for the reason #7049 gave for the list: a divergence that cannot be
   * written down cannot be re-introduced by the next hand patch. What legally
   * varies between the seams is passed in: which object is read, which package
   * id is stamped (both resolve to the SAME owning package — a nested plugin
   * contributes under its parent's ownership), and the label the `debug` line
   * names the source with.
   *
   * @param source   The manifest or nested-plugin config to read collections from.
   * @param ownerId  The owning package id — stamped as ADR-0010 provenance.
   * @param sourceLabel Human-readable source name for the `debug` line.
   */
  private registerMetadataCollections(source: any, ownerId: string, sourceLabel: string, ownerVersion?: string) {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const read_registry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof registerMetadataCollections> = {
      get _registry() { return read_registry(); },
      get logger() { return readLogger(); },
    };
    return registerMetadataCollections.call(host, source, ownerId, sourceLabel, ownerVersion);
  }

  /**
   * Register a new storage driver.
   *
   * **Re-registering the SAME driver instance is by design, not an anomaly**
   * (#4773). Every standalone boot does it exactly once, on two legs of one
   * round trip:
   *
   *  1. `DatasourceConnectionService.attemptConnect()` builds the `default`
   *     datasource's driver and registers it here with `isDefault: true`
   *     (`service-datasource/src/datasource-connection-service.ts`), driven by
   *     `DefaultDatasourcePlugin.init()`;
   *  2. that plugin then republishes **the very object it just read back out of
   *     this engine** as the `driver.<name>` kernel service — the surface
   *     `os migrate` and serve's storage detection resolve the primary DB
   *     through — and `ObjectQLPlugin.start()`'s `driver.*` discovery loop
   *     bridges every such service into the engine, handing us back the
   *     instance we already hold.
   *
   * So this guard has to answer two different questions, and the whole point of
   * splitting it is that they deserve different voices:
   *
   *  - **Same instance** → leg 2 above. Nothing is decided and nothing is
   *    discarded, and it happens on every boot: `debug`. Reporting a
   *    no-anomaly, every-boot event at `warn` only teaches operators that
   *    `warn` means nothing, which is what makes the next real one unreadable
   *    (the degradation-log-level rule, #4632).
   *  - **A DIFFERENT driver under a name we already hold** → two distinct
   *    configurations claim one name and exactly one of them is silently
   *    dropped. Whatever the loser carried — connection string, pool, tenant
   *    scoping, capability set — is simply not in force, while every query
   *    bound to that name keeps working against the winner. That is a real
   *    caller-side defect and stays loud, now saying *which* config survived.
   *  - **Same instance, but the caller asked for `isDefault` and something
   *    else already is the default** → the caller's intent is being dropped,
   *    so it is loud too rather than folded into the quiet path.
   */
  registerDriver(driver: IDataDriver, isDefault: boolean = false) {
    const existing = this.drivers.get(driver.name);
    if (existing) {
      // [#27277] The entry may be the floored instance of this very driver.
      if (unwrapExternalDriverFloor(existing) !== unwrapExternalDriverFloor(driver)) {
        this.logger.warn(
          'Driver name collision — KEEPING the already-registered driver and DISCARDING the one just supplied. ' +
            'Two different driver instances claim one name, so whatever configuration the discarded instance carried ' +
            '(connection string, pool, capabilities) is NOT in force, while queries routed to this name keep working ' +
            'against the one that was kept. Fix the caller: give the second datasource a name of its own.',
          {
            driverName: driver.name,
            keptVersion: existing.version,
            discardedVersion: driver.version,
          },
        );
      } else if (isDefault && this.defaultDriver !== driver.name) {
        this.logger.warn(
          'Driver re-registered as DEFAULT but another driver already holds that role — the request is IGNORED and ' +
            'the existing default stands. Unregister the current default first if the switch was intended.',
          { driverName: driver.name, currentDefault: this.defaultDriver },
        );
      } else {
        // The by-design round trip documented above — expected on every boot,
        // so it must not reach the boot-diagnostics warning list.
        this.logger.debug('Driver already registered — re-registering the same instance is a no-op', {
          driverName: driver.name,
        });
      }
      return;
    }

    this.drivers.set(driver.name, driver);
    this.supplyFileColumnsMovedResolver(driver);
    this.supplyTenantKeyCertifiedResolver(driver);
    this.applyExternalDriverFloor(driver.name);
    this.logger.info('Registered driver', {
      driverName: driver.name,
      version: driver.version
    });

    if (isDefault || this.drivers.size === 1) {
      this.defaultDriver = driver.name;
      this.logger.info('Set default driver', { driverName: driver.name });
    }
  }

  /**
   * Hand a freshly-registered driver the ADR-0104 media arm — the kernel→driver
   * supply seam (#15989, sequencing step 2 of ADR-0104's 2026-09-05 addendum).
   *
   * ## Why here, and why a closure rather than a value
   *
   * `registerDriver` is the one funnel every driver this engine will ever
   * route to passes through, and it is early: the resolver is installed before
   * `init()` connects and long before schema sync calls `initObjects`, which
   * is where a SQL driver asks the closure exactly once and freezes the
   * answer. A VALUE could not be supplied here at all — the fact lives in a
   * `sys_migration` row this very driver has not connected to yet — so what is
   * handed over is the question, not the answer.
   *
   * ## Duck-typed, and silent when the driver has no such seam
   *
   * A driver with no media arm (memory, mongodb, a third-party one) exposes no
   * `setFileColumnsMovedResolver` and is left alone. That is not a degradation
   * to report: a driver that never asks the question keeps whatever encoding
   * it always had.
   *
   * ## ⛔ A host declaration WINS — this only ever fills an empty slot
   *
   * If the host passed `fileColumnsMoved` to the driver's own config, the
   * driver refuses this resolver and says so on its own terms. The asymmetry
   * is deliberate and the safety argument runs one way only: a host that
   * declared `true` while the ledger says otherwise is a host that knows
   * something about its own storage that the ledger does not yet record, and
   * the engine silently overruling it to `false` would have the driver write
   * JSON into columns that have already been retyped. The reverse — the engine
   * overruling a declared `false` to `true` — writes bare ids into a JSON
   * column, which is the failure direction the whole mechanism exists to
   * prevent. Neither is acceptable, so the more specific authority wins and
   * the engine never contradicts an explicit composition.
   */
  private supplyFileColumnsMovedResolver(driver: IDataDriver): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof supplyFileColumnsMovedResolver> = {
      haveFileColumnsMoved: (...a) => this.haveFileColumnsMoved(...a),
      get logger() { return readLogger(); },
    };
    return supplyFileColumnsMovedResolver.call(host, driver);
  }

  /**
   * Evict a driver from the registry — the removal counterpart of
   * {@link registerDriver} (#13578).
   *
   * ## Why the registry owns this rather than each lifecycle path
   *
   * #13578 named the fork explicitly: the delete path calling the registry, or
   * the registry owning its own liveness. This is the second, and the reason is
   * structural rather than stylistic — removing a driver is not one deletion
   * but THREE pieces of private engine state that must move together, and a
   * caller can reach none of them:
   *
   *  1. `drivers` — the Map {@link checkDriversHealth} iterates, and therefore
   *     the one a readiness probe reports. This is the entry #13578 watched
   *     survive a `DELETE /api/v1/datasources/:name` on every replica.
   *  2. `defaultDriver` — a NAME, not a reference. Dropping the entry without
   *     clearing it leaves the default pointing at a driver that is gone, and
   *     {@link getDefaultDriverName} would answer with a name nothing backs.
   *     `engine-primary-datasource.test.ts` wrote the required reading down
   *     before this method existed: after an eviction that removes the default,
   *     the primary verdict must read "cannot tell", never a name.
   *  3. `datasourceDefs` — the declarative `schemaMode` / `external` record
   *     {@link assertWriteAllowed} consults. It has a `registerDatasourceDef`
   *     door and no removal door at all, so a def outliving its driver keeps
   *     judging writes for a datasource that no longer exists.
   *
   * Only (1) is even visible from outside, and no public door removed it. So
   * "every future lifecycle path remembers to clear three maps in the right
   * order" is a rule with nowhere to live where it would be read — the shape
   * this repo has already paid for. One primitive owns the invariant instead,
   * and every path calls it exactly once.
   *
   * ⛔ Deliberately does NOT clear `unavailableDatasources`. That map already
   * has its own door ({@link clearDatasourceUnavailable}) and its own caller,
   * and the two acts are ordered OPPOSITELY on the failed-start path: a connect
   * that fails after registering evicts the driver and then MARKS the
   * datasource unavailable. Folding the clear in here would have eviction wipe
   * the explanation the very next step writes.
   *
   * ⛔ Deliberately does NOT disconnect the driver. Eviction and teardown are
   * separate acts: the pool's owner decides whether to close it — an ADOPTED
   * host-owned instance outlives this kernel by design (ADR-0062 D5) — while
   * the registry decides only whether this engine still routes to it. Folding
   * them would make eviction close a pool the host still holds.
   *
   * @returns `true` when a driver entry was removed, `false` when the name held
   *          none — so an idempotent caller (a retried delete, a teardown sweep
   *          following a partial one) can tell a removal from a no-op.
   */
  unregisterDriver(name: string): boolean {
    const removed = this.drivers.delete(name);
    // Cleared regardless of `removed`: a datasource that never connected has a
    // def and no driver, so keying this off the driver entry would strand
    // exactly the rows a failed datasource leaves behind.
    this.datasourceDefs.delete(name);
    if (this.defaultDriver === name) {
      this.defaultDriver = null;
      this.logger.info(
        'Evicted the DEFAULT driver — this engine has no default until one is registered',
        { driverName: name },
      );
    }
    if (removed) this.logger.info('Unregistered driver', { driverName: name });
    return removed;
  }

  /**
   * Register a Datasource *definition* (ADR-0015).
   *
   * Distinct from {@link registerDriver}, which registers a live connection.
   * This captures the declarative {@link DatasourceDef}: `schemaMode` +
   * `external.allowWrites` so the write gate ({@link assertWriteAllowed}) can
   * enforce external-datasource ownership, and `external.credentialsRef` so
   * {@link listDatasourceDefs} can hand a credentials sweep the handle a
   * code-declared datasource holds. Safe to call repeatedly; last write wins,
   * except an absent `driver` keeps the id stored before it.
   */
  registerDatasourceDef(def: DatasourceDef): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const readDatasourceDefs = () => this.datasourceDefs;
    const host: ThisParameterType<typeof registerDatasourceDef> = {
      applyExternalDriverFloor: (...a) => this.applyExternalDriverFloor(...a),
      get datasourceDefs() { return readDatasourceDefs(); },
    };
    return registerDatasourceDef.call(host, def);
  }

  /**
   * [#27277] Put the registered driver of datasource `name` behind the engine's
   * correctness floor when its definition calls for one, or take it back out
   * when a later definition no longer does (`external-driver-floor.ts`).
   *
   * Called from both doors — {@link registerDriver} and
   * {@link registerDatasourceDef} — because either can come first. The floored
   * driver REPLACES the entry in `drivers`, once, so every reader of the map
   * (`getDriver`, `getDriverByName`, the default-driver and transaction-scope
   * identity checks) holds one instance.
   */
  private applyExternalDriverFloor(name: string): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const read_registry = () => this._registry;
    const readDatasourceDefs = () => this.datasourceDefs;
    const readDrivers = () => this.drivers;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyExternalDriverFloor> = {
      get _registry() { return read_registry(); },
      get datasourceDefs() { return readDatasourceDefs(); },
      get drivers() { return readDrivers(); },
      get logger() { return readLogger(); },
    };
    return applyExternalDriverFloor.call(host, name);
  }

  /**
   * Every datasource DEFINITION this engine holds — from BOTH entry routes,
   * {@link registerDatasourceDef} and the package-manifest install path in
   * {@link registerApp}.
   *
   * Exists because a datasource declared IN CODE never reaches the metadata
   * store, so a `sys_secret` reference sweep reading `sys_metadata` alone
   * cannot see the handle such a datasource holds at `external.credentialsRef`
   * and must be handed the list by its caller instead. A completeness
   * guarantee that depends on every caller remembering to pass a list is
   * weaker than one the engine can answer.
   *
   * ⛔ Deliberately UNFILTERED: every definition, whatever its `schemaMode` and
   * whether or not it carries a reference. `credentialsRef` is valid on a
   * managed datasource too (#8153), so filtering by schema mode here would hide
   * live handles from the sweep — and under-reporting is the direction that
   * deletes live credentials.
   *
   * Each entry is a fresh object with a COPIED `external` block. The index
   * stores the caller's `external` by reference, and a reader must not be able
   * to reach through this accessor and mutate the write gate's own input.
   *
   * [#27727] The stored `driver` id is answered too: it is what decides whether
   * the datasource's driver is floored, so a sweep asking "which datasources
   * name a plugin driver" can be written against the contract's read-back.
   */
  listDatasourceDefs(): DatasourceDef[] {
    return Array.from(this.datasourceDefs, ([name, def]) => ({
      name,
      ...(def.driver !== undefined ? { driver: def.driver } : {}),
      ...(def.schemaMode !== undefined ? { schemaMode: def.schemaMode } : {}),
      ...(def.external ? { external: { ...def.external } } : {}),
    }));
  }

  /**
   * Record that a **declared** datasource has no live driver, and why
   * (framework#3828). Called by `DatasourceConnectionService` when a connect is
   * refused by the host policy or fails while the operator has opted into a
   * degraded boot.
   *
   * The engine only needs this to answer a query well: without it
   * {@link getDriver} cannot tell a refused datasource from a misspelled one and
   * says `is not registered` to both. Deliberately carries no operator-facing
   * cause — see {@link DatasourceUnavailableError}.
   */
  markDatasourceUnavailable(info: { name: string; kind: DatasourceUnavailableKind; publicDetail?: string }): void {
    if (!info?.name) return;
    this.unavailableDatasources.set(info.name, {
      kind: info.kind,
      ...(info.publicDetail ? { publicDetail: info.publicDetail } : {}),
    });
  }

  /** Drop a {@link markDatasourceUnavailable} record (successful (re)connect / pool removal). */
  clearDatasourceUnavailable(name: string): void {
    this.unavailableDatasources.delete(name);
  }

  /**
   * Name of the DEFAULT driver, when one is registered (#3826). The default
   * driver keeps its natural name (`registerDriver(driver, true)` — nothing
   * routes by `drivers.get('default')`), so the datasource connection layer's
   * `asDefault` idempotency guard needs this rather than a name lookup.
   */
  getDefaultDriverName(): string | undefined {
    return this.defaultDriver ?? undefined;
  }

  /**
   * Datasources that were declared but are NOT usable, with the reason class.
   *
   * Distinct from {@link checkDriversHealth}, which answers "can a REGISTERED
   * driver serve a query right now" and therefore cannot see these at all — a
   * datasource that never connected was never registered (framework#3827).
   */
  listUnavailableDatasources(): Array<{ name: string } & DatasourceUnavailableInfo> {
    return Array.from(this.unavailableDatasources, ([name, info]) => ({ name, ...info }));
  }

  /**
   * Write gate — Gate 3 of ADR-0015 §5.3.
   *
   * Blocks insert/update/delete against a federated datasource
   * (`schemaMode !== 'managed'`) unless BOTH the datasource opts in
   * (`external.allowWrites`) AND the object opts in (`external.writable`).
   * Managed datasources (the common case, including the absence of any
   * definition) are unaffected.
   */
  private assertWriteAllowed(objectName: string, operation: 'insert' | 'update' | 'delete'): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    const read_registry = () => this._registry;
    const readDatasourceDefs = () => this.datasourceDefs;
    const host: ThisParameterType<typeof assertWriteAllowed> = {
      get _registry() { return read_registry(); },
      get datasourceDefs() { return readDatasourceDefs(); },
    };
    return assertWriteAllowed.call(host, objectName, operation);
  }

  /**
   * Set the realtime service for publishing data change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    this.realtimeService = service;
    this.logger.info('RealtimeService configured for data events');
  }

  /**
   * Publish a realtime {@link DataEvent} for a record write (#4626 —
   * contract-first, the data-side twin of #4602/#4628).
   *
   * What reaches a `subscribeData` callback must BE the spec's `DataEvent`
   * (`@objectstack/spec/api`): top-level `id` (uuid), `type`, `object`,
   * `recordId` (REQUIRED), plus `changes`/`after`/`userId` when they apply.
   * The transport keeps its `RealtimeEventPayload` envelope — `payload`
   * carries the complete `DataEvent`, and the client SDK unwraps + validates
   * it at the boundary instead of double-casting the envelope.
   *
   * Only per-record writes reach here. A predicate (`multi: true`) write has
   * its own contract — see {@link publishBulkDataEvent} (#4639) — and the
   * multi branches of `update()`/`delete()` route to it directly, so they
   * never arrive at the identity gate below.
   *
   * Two loud-by-design gates:
   *  - **No record identity → no event.** `DataEvent.recordId` is required, so
   *    a write that names no record has no truthful per-record event to
   *    publish. It publishes NONE (warn log) instead of the pre-#4626
   *    fabrication (`recordId: ''`, `after: <affected count>`) that every
   *    schema-compliant consumer must reject. Reaching this gate now means a
   *    single-id write whose driver returned no usable primary key — a driver
   *    bug — because the bulk callers no longer come through here.
   *  - The event body is `DataEventSchema.parse`d before publish, so a
   *    malformed producer fails here (warn log, event not published) rather
   *    than delivering a lie downstream.
   *
   * Never throws and never fails the write: a realtime transport problem must
   * not roll back a committed record.
   */
  private async publishDataEvent(
    action: 'created' | 'updated' | 'deleted',
    object: string,
    input: {
      recordId: unknown;
      changes?: unknown;
      after?: unknown;
      /**
       * The row whose tenant column names this event's `organizationId`
       * (#14970) — the written record on `created`, the post-state on
       * `updated`, the PRE-IMAGE on `deleted` (a delete has no post-state, and
       * `previous` is what every other delete-side consumer already falls back
       * to). Passed explicitly rather than inferred from `after` so the delete
       * path, the one with no `after`, cannot silently publish the key absent.
       */
      organizationRow?: unknown;
      context?: ExecutionContext;
    },
  ): Promise<void> {
    // [#25522 cut 4] The body moved to `engine-realtime-publish.ts` (see `RealtimePublishHost`).
    const readRealtimeService = () => this.realtimeService;
    const readLogger = () => this.logger;
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof publishDataEvent> = {
      get realtimeService() { return readRealtimeService(); },
      get logger() { return readLogger(); },
      get _registry() { return readRegistry(); },
    };
    return publishDataEvent.call(host, action, object, input);
  }

  /**
   * Publish a realtime {@link BulkDataEvent} for a predicate write (#4639).
   *
   * The `multi: true` branches of `update()`/`delete()` reach
   * `IDataDriver.updateMany`/`deleteMany`, which resolve an affected COUNT and
   * nothing else. That is too little for the per-record `DataEvent` contract
   * (`recordId` is required), so those writes were silent from #4626 until now
   * — honest, but it meant webhooks and every other event consumer saw
   * nothing at all when a predicate write emptied half a table.
   *
   * They now get their own event instead of impersonating a per-record one:
   * `data.records.updated` / `data.records.deleted`, carrying the object and
   * the count. A consumer reading the type knows immediately that no
   * `recordId` is coming — the failure mode of the pre-#4626 fabrication,
   * where `recordId: ''` looked like a record until you tried to use it.
   *
   * Deliberately NOT carried: the query predicate. The only one in hand here
   * is the middleware-composed AST, whose `where` embeds the security layer's
   * injected row scoping (RLS, sharing) — publishing it would ship tenant
   * internals to whatever external URL a webhook points at. See
   * `BulkDataEventSchema`'s TSDoc for the full reasoning.
   *
   * [#15225 / #15813] `organizationId` — the ONE organization the tenant
   * wall named for this batch, read off the Layer 0 verdict the enforcement
   * layer RECORDED on the operation context ({@link OperationContext.tenantLayer0Verdict})
   * — ⛔ no second query on the publish path, and ⛔ no re-derivation of the
   * wall from posture, context or schema (the #15706 mirror) — and OMITTED
   * whenever the producer cannot assert one. See {@link bulkEventOrganizationId}
   * for what is read, what is deliberately not, and for why `absent` here
   * means "not asserted", not the per-record "belongs to no organization".
   *
   * Same two disciplines as the per-record twin: validate before publish, and
   * never throw — a realtime transport problem must not roll back a committed
   * write.
   */
  private async publishBulkDataEvent(
    action: 'updated' | 'deleted',
    object: string,
    input: { matched: unknown; context?: ExecutionContext; tenantLayer0Verdict?: unknown },
  ): Promise<void> {
    // [#25522 cut 4] The body moved to `engine-realtime-publish.ts` (see `RealtimePublishHost`).
    const readRealtimeService = () => this.realtimeService;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof publishBulkDataEvent> = {
      get realtimeService() { return readRealtimeService(); },
      get logger() { return readLogger(); },
    };
    return publishBulkDataEvent.call(host, action, object, input);
  }

  /**
   * Set the i18n service used to localize write-path validation messages and
   * the field labels inside them (#3957). Bridged by `ObjectQLPlugin` on start,
   * the same way the realtime service is.
   *
   * Optional by design: with no service the built-in message catalog
   * (`@objectstack/spec/system`) still renders each message in the caller's
   * locale against the field's DECLARED label. The service adds two things —
   * a deployment's `validation.field.*` message overrides, and the field's
   * TRANSLATED label for apps whose declared labels are in another language.
   * [#26608] It is also what a formula's `label(record.<field>)` is translated
   * through on a read and a write response (`getTranslations` plus the
   * declared locale chain); without it `label()` reads the declared labels.
   */
  setI18nService(service: {
    t?: (key: string, locale: string, params?: Record<string, unknown>) => string;
    getLocales?: () => string[];
    getTranslations?: (locale: string) => Record<string, unknown>;
    getFallbackLocale?: () => string | undefined;
    getDefaultLocale?: () => string | undefined;
  }): void {
    this.i18nService = service;
    this.logger.info('I18nService configured for validation messages');
  }

  /**
   * [ADR-0144 D4, Open item 4] Where the write-time home projection reads an
   * organization's localization: its `localization.currency` setting (the
   * home currency) and its `localization.timezone` setting (the zone a
   * `datetime` document date is dated in; ruling 6539345871, letter B), each
   * `undefined` when unset. Bridged by `ObjectQLPlugin`, which resolves the
   * settings service when a write asks, not when it starts. With no resolver
   * every organization's home currency is unset, so a write of an amount
   * declaring `homeAmount` is refused `ERR_HOME_CURRENCY_UNSET` — the engine
   * never assumes one — and an unset timezone reads UTC.
   */
  setHomeLocalizationResolver(resolver: HomeLocalizationResolver | undefined): void {
    this.homeLocalizationResolver = resolver;
  }

  private homeLocalizationResolver?: HomeLocalizationResolver;

  /**
   * [ADR-0144 D5, Open item 2] What one write's home projection reads, memoized
   * for that write: each organization's home currency once, and each
   * (organization, currency, document date) rate once, however many rows ask.
   *
   * The rate is the `sys_exchange_rate` row of that currency with the latest
   * `effective_date` on or before the document date, in the organization the
   * row lands in. Read `sudo()`-shaped (`{ ...context, isSystem: true }`): a
   * rank-and-file writer cannot read the rate table (parameter 2 makes it an
   * administrator's object), yet every write of theirs is converted through
   * it; the caller's transaction rides along, and `tenantId` is the row's own
   * organization, so one organization's rate never converts another's
   * amount. An install without the rate object registered has no rate for any
   * currency.
   */
  private homeAmountServing(context: ExecutionContext | undefined): HomeAmountServing {
    // One settings read per organization per write answers both the home
    // currency and the timezone.
    const localizations = new Map<string, Promise<HomeLocalization | undefined>>();
    const localizationOf = (organizationId: string | undefined) => {
      const key = organizationId ?? '';
      let hit = localizations.get(key);
      if (!hit) {
        hit = Promise.resolve(this.homeLocalizationResolver?.(organizationId));
        localizations.set(key, hit);
      }
      return hit;
    };
    return memoizeHomeAmountServing({
      homeCurrency: async (organizationId) => (await localizationOf(organizationId))?.currency,
      timezone: async (organizationId) => (await localizationOf(organizationId))?.timezone,
      rateOn: async (organizationId, currency, onOrBefore) => {
        if (!this._registry.getObject(EXCHANGE_RATE_OBJECT)) return undefined;
        const rows = await this.find(EXCHANGE_RATE_OBJECT, {
          where: { currency, effective_date: { $lte: onOrBefore } },
          orderBy: [{ field: 'effective_date', order: 'desc' }],
          limit: 1,
          fields: ['rate', 'effective_date'],
          context: {
            ...(context ?? {}),
            isSystem: true,
            ...(organizationId !== undefined ? { tenantId: organizationId } : {}),
          } as ExecutionContext,
        });
        const row = rows[0] as { rate?: unknown; effective_date?: unknown } | undefined;
        if (!row) return undefined;
        const effective = row.effective_date;
        return {
          rate: row.rate,
          effectiveDate: effective instanceof Date ? effective.toISOString().slice(0, 10) : (typeof effective === 'string' ? effective : undefined),
        };
      },
    });
  }

  /**
   * [ADR-0144 D5] The organization a written row belongs to, for its home
   * projection: the row's own `organization_id`, else the writer's active
   * organization, else the organization a system insert resolved — the
   * assignment seam's reading, so both seams convert and route one row under
   * one organization.
   */
  private static homeAmountOrganizationOf(
    row: Record<string, unknown> | null | undefined,
    context: ExecutionContext | undefined,
    derived?: string | undefined,
  ): string | undefined {
    const own = row?.organization_id;
    if (own !== undefined && own !== null && own !== '') return String(own);
    if (context?.tenantId) return String(context.tenantId);
    return derived ?? undefined;
  }

  /**
   * [ADR-0144 D5] The `validate()` preview's run of the home projection: the
   * write's own computation over the preview's image (the insert row, or the
   * stored row with the patch over it), answering nothing and writing
   * nothing — it throws exactly the refusal the write would.
   */
  private async previewHomeAmounts(
    object: string,
    schema: unknown,
    mode: 'insert' | 'update',
    row: Record<string, unknown>,
    image: Record<string, unknown>,
    context: ExecutionContext | undefined,
    recordId: unknown,
  ): Promise<void> {
    const plan = planHomeAmounts(schema);
    const entries = mode === 'insert' ? plan : homeAmountsTouched(plan, row);
    if (entries.length === 0) return;
    await projectHomeAmounts(entries, image, this.homeAmountServing(context), {
      object,
      operation: mode,
      organizationId: ObjectQL.homeAmountOrganizationOf(image, context),
      recordId,
    });
  }

  /**
   * [ADR-0144 D5] Project a by-id update's home amounts onto its FINAL patch:
   * only the declarations the patch touches ({@link homeAmountsTouched}),
   * computed over the stored row with the patch laid over it. Shared by the
   * write and its `validate()` preview, so a dry run refuses what the write
   * refuses.
   */
  private async projectHomeAmountsOntoPatch(
    object: string,
    plan: readonly HomeAmountPlanEntry[],
    prior: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown>,
    context: ExecutionContext | undefined,
    recordId: unknown,
    serving: HomeAmountServing = this.homeAmountServing(context),
  ): Promise<void> {
    const touched = homeAmountsTouched(plan, patch);
    if (touched.length === 0) return;
    const image = { ...(prior ?? {}), ...patch };
    Object.assign(patch, await projectHomeAmounts(touched, image, serving, {
      object,
      operation: 'update',
      organizationId: ObjectQL.homeAmountOrganizationOf(image, context),
      recordId,
    }));
  }

  /**
   * Locale + translation hooks handed to the validators so a rejected write is
   * reported in the caller's language (#3957).
   *
   * `ExecutionContext.locale` is resolved once per request from the
   * `localization` settings (ADR-0053 Phase 2) and its contract already reads
   * "Drives message catalogs" — this is the consumer that makes that true.
   * Undefined locale (anonymous / programmatic / system write) leaves the
   * built-in `en` rendering in place.
   */
  private validationMessageContext(
    objectName: string,
    // Only `locale` is read — narrower than `ExecutionContext` so both the
    // resolved and the input-shaped envelope satisfy it.
    context?: { locale?: string },
  ): ValidationMessageContext & { objectName: string } {
    // [#25522 cut 1] The body moved to `engine-validation-messages.ts` (see `ValidationMessageHost`).
    const readI18nService = () => this.i18nService;
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof validationMessageContext> = {
      get i18nService() { return readI18nService(); },
      get registry() { return readRegistry(); },
      negotiatedMessageLocale: (...a) => this.negotiatedMessageLocale(...a),
    };
    return validationMessageContext.call(host, objectName, context);
  }

  /**
   * The locale the bridged i18n service can actually ANSWER in, for the locale
   * the caller asked for (#15757).
   *
   * `ExecutionContext.locale` is the `Accept-Language` header's first tag
   * verbatim — `preferredLocaleFromHeader` reports what was ASKED FOR and
   * expands nothing, deliberately, because every one of its callers negotiates
   * differently. Handing that tag straight to `II18nService.t()` made this the
   * one consumer that never negotiated at all: a served adapter resolves a
   * locale EXACTLY and then falls to its declared fallback
   * (`FileI18nAdapter.t()` is `resolveFromLocale(key, locale)` then
   * `resolveFromLocale(key, fallbackLocale)`), so a bare `zh` missed a `zh-CN`
   * bundle and the caller read an English refusal — on the same response whose
   * dataset, view and object labels were Chinese, because those go through
   * `pickData` and `pickData` negotiates.
   *
   * ⛔ The rule is NOT re-implemented here. `resolveBundleLocale`
   * (`@objectstack/spec/system`) is the single negotiation rule the document
   * translators already run — exact → case-insensitive → base language →
   * variant expansion, which is the step that reaches `zh-CN` from `zh` — and
   * this asks it the same question about a different set of available locales:
   * the translators' set is the bundle's keys, and the service's set is what
   * `getLocales()` reports it holds. A second rule living here is the defect,
   * not the fix.
   *
   * Passes the requested tag through untouched whenever there is nothing to
   * negotiate against — no service, no `getLocales`, an empty or non-array
   * answer, a throwing one, or no match. Negotiation needs a list of what
   * EXISTS; inventing one is how a second rule gets born.
   */
  private negotiatedMessageLocale(requested: string | undefined): string | undefined {
    // [#25522 cut 1] The body moved to `engine-validation-messages.ts` (see `ValidationMessageHost`).
    const readI18nService = () => this.i18nService;
    const host: ThisParameterType<typeof negotiatedMessageLocale> = {
      get i18nService() { return readI18nService(); },
    };
    return negotiatedMessageLocale.call(host, requested);
  }

  /**
   * An OBJECT's display name in the caller's locale: translation bundle →
   * declared `label` → API name (#7307).
   *
   * The object-level twin of `resolveFieldLabel` (`record-validator.ts`), and
   * deliberately the same three-step ladder with the same last resort: the API
   * name is what a user must not be shown, so it is where the ladder ENDS, not
   * where it starts. It stays available to clients on the structured fields
   * (`object` / `dependentObject`) and on `developerMessage`.
   */
  private objectDisplayLabel(
    objectName: string,
    declaredLabel: unknown,
    ctx: { locale?: string; translate?: (key: string, locale: string, params?: Record<string, unknown>) => string },
  ): string {
    // [#25522 cut 1] The body moved to `engine-validation-messages.ts`; it reads no member.
    return objectDisplayLabel(objectName, declaredLabel, ctx);
  }

  /**
   * [#4441] Referential integrity on the WRITE path: a `lookup` (or any
   * reference-typed field) may not be given an id that exists in no row of the
   * object it declares.
   *
   * The field metadata is unambiguous — `{"type":"lookup","required":true,
   * "reference":"sys_permission_set"}` — and the DELETE side already reasons
   * about the edge (`deleteBehavior: 'set_null'`). Only the insert side never
   * checked, so `POST /data/sys_position_permission_set
   * {"permission_set_id":"ps_does_not_exist_at_all"}` created the row.
   *
   * On the RBAC link tables that is a security-surface record that resolves to
   * nothing: an administrator auditing permissions sees a binding whose target
   * cannot be inspected, and the audience-anchor gate had to resolve that very
   * set to evaluate the grant — so a dangling row was an unevaluable gate input,
   * not merely an untidy one. (That gate and `sys_position_permission_set` are
   * retired since C3 stage 8; the check stands for the link tables that remain.)
   *
   * ## Scope, deliberately narrow
   *
   * - **Caller-supplied keys only.** Server stamps (`owner_id`,
   *   `organization_id`, `created_by`/`updated_by`) are lookups too; they are
   *   written by hooks and middleware, not by the request, and re-validating
   *   them here would turn a platform stamp into a caller-facing rejection.
   * - **Non-system writes only**, like every other write-path guard in this
   *   engine (`stripReadonlyFields` — which since #14147 runs on the create
   *   path as well as the update one — and `stripRuntimeOwnedFields`). Seed
   *   replay,
   *   package install and boot-time provisioning legitimately write rows in an
   *   order that resolves only once the batch completes; failing them closed
   *   would turn an ordering detail into a boot failure. This leaves a real
   *   residual — an `isSystem` caller can still write a dangling reference —
   *   which is recorded on the issue rather than silently accepted.
   *   [#28881] ⛔ Except a flow run's elevated write (`runAs: 'system'`):
   *   its context carries the flow-write mark (`keepsFlowWriteReferenceCheck`,
   *   `@objectstack/core`, set by `resolveRunDataContext` in
   *   service-automation) and is checked like a user write. Its elevation is
   *   for authorization (other people's rows, past RLS and FLS), never for a
   *   link to a row that does not exist, and it keeps every authorization
   *   exemption `isSystem` gives it. A write it sets off (a hook's `ctx.api`,
   *   its `sudo()`, a cascade leg) spreads that context and is checked as
   *   the flow's own.
   * - **Empty values are not references.** `null` / `undefined` / `''` mean
   *   "no link", which is what `deleteBehavior: 'set_null'` produces.
   * - **Already-expanded objects are skipped.** A read round-trip can hand back
   *   `{id, name, …}` in the slot; that is not an id write.
   * - **A value the row already stores is not the write's (#29062).** The
   *   check judges only the references a write ADDS. An update's `storedRows`
   *   (the by-id prior row; a predicate update's matched rows) forgive a
   *   refused value, or a multi-valued member, that every one of those rows
   *   already holds: an edit form carries the whole record back, and a stored
   *   id that has since stopped resolving (the delete walk leaves a `user`
   *   value in place, `DELETE_SEMANTICS_REFERENCE_TYPES`) is not the editor's
   *   to answer for. A value new to any of the rows is refused as before, and
   *   an insert has no stored rows, so every value it supplies is judged.
   *
   * ## Why the probe bypasses RLS — and why it keeps the tenant wall
   *
   * Existence is a fact about the database, not about the caller's ROW-LEVEL
   * visibility — the same distinction the #4435 existence probe turns on. A
   * probe under the caller's own context would refuse a link to a permission
   * set the caller cannot READ, which is ordinary in an RLS-scoped deployment
   * and would make the platform's own admin flows fail. Whether the caller may
   * create the binding at all is the RBAC/RLS layer's decision, made where it
   * already is. So the probe is elevated: `isSystem` bypasses RBAC, RLS and FLS.
   *
   * That argument is about visibility, never about TENANCY, and the elevation
   * is therefore `sudo()`-shaped — `{ ...context, isSystem: true }`, see
   * {@link referenceExists} — not a bare `{ isSystem: true }` (#19808). The
   * bare spelling carried no `tenantId`, so the probe spanned every
   * organization: an org-bound caller could store a reference to another
   * organization's row, and could tell "exists in another organization" (the
   * write committed) from "exists nowhere" (refused) — a cross-tenant existence
   * oracle. With the caller's context spread first, `buildDriverOptions`
   * forwards its `tenantId` to the driver, a row stamped with another
   * organization is not found, and both cases answer the same
   * `reference_not_found`. The tenancy exemptions stay where they are decided:
   * `buildDriverOptions` withholds `tenantId` for a `tenancy.enabled: false`
   * (platform-global) object and for a federated one, so a reference to either
   * still resolves from an org-bound caller. A row with no organization is no
   * tenant's (ADR-0131 D1): the driver's scope is the organization equality,
   * with no `IS NULL` arm, so an org-bound caller's probe does not find one.
   *
   * ## …except a master-detail header, which the caller must be able to read (#22519)
   *
   * A `master_detail` field names the detail's HEADER, and a write of a detail
   * whose header the caller cannot read answers exactly what a write naming a
   * header that exists nowhere answers. Nothing upstream of this check settles
   * that: ADR-0055 §3 gates a detail write on its header (master edit) only for
   * a `controlled_by_parent` detail, so an elevated probe alone would tell such
   * a caller "exists" apart from "exists nowhere". So for a `master_detail`
   * field the caller's read door is asked first ({@link masterDetailHeaderExists}),
   * and a header it does not return is `reference_not_found`. ⛔ A plain
   * `lookup` keeps the elevated probe above, unchanged.
   *
   * Fails OPEN when the target cannot be checked (unregistered object, no
   * driver, a probe that throws): an integrity check that cannot run must not
   * invent a rejection, and the alternative — refusing every write to an object
   * whose target lives on an unreachable datasource — converts a connectivity
   * problem into data loss. A master-detail header's read door that fails is
   * the exception: it did not return the header, so the header is missing
   * (see {@link masterDetailHeadersCallerReads}).
   */
  private async assertReferencesResolve(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    supplied: Record<string, unknown> | null | undefined,
    context: any,
    msgCtx?: { locale?: string; translate?: any; objectName?: string },
    storedRows?: StoredReferenceRows,
  ): Promise<void> {
    // [#25522 cut 10] The body moved to `engine-referential-integrity.ts` (see `ReferentialIntegrityHost`).
    const host: ThisParameterType<typeof assertReferencesResolve> = {
      masterDetailHeaderExists: (...a) => this.masterDetailHeaderExists(...a),
      referenceExists: (...a) => this.referenceExists(...a),
    };
    return assertReferencesResolve.call(host, schema, data, supplied, context, msgCtx, storedRows);
  }

  /**
   * Does `id` name a row in `target`? `false` only when the probe RAN and found
   * nothing; `null` when it could not run at all (see the fail-open note on
   * {@link assertReferencesResolve}).
   *
   * `context` is the CALLER's execution context. The probe runs under
   * {@link ObjectQL.referenceCheckContext} — the same `sudo()`-shaped elevation
   * the pre-delete reference check uses, so the two reference checks share one
   * spelling: RLS/FLS bypassed, the caller's `tenantId` (and, under the `group`
   * posture, its membership set) forwarded to the driver by
   * `buildDriverOptions`. A row outside the caller's tenant scope is therefore
   * `false` here, exactly like a row that exists nowhere (#19808).
   *
   * Without a `context` the elevation is the bare `{ isSystem: true }` and the
   * probe spans every organization. {@link inspectDanglingReferences}, which
   * has no caller, passes the SCANNED row's own organization as the context's
   * `tenantId` instead (#19837), and no context only for a row that carries
   * none or under a union (`group`) posture — so outside `group` the audit
   * reports a stored reference into another organization, the class this guard
   * now refuses.
   */
  private async referenceExists(target: string, id: unknown, context?: ExecutionContext): Promise<boolean | null> {
    try {
      const resolved = this.resolveObjectName(target);
      if (!this._registry.getObject(resolved)) return null;
      const row = await this.findOne(resolved, {
        where: { id },
        fields: ['id'],
        context: ObjectQL.referenceCheckContext(context),
      } as any);
      return !!row;
    } catch {
      return null;
    }
  }

  /**
   * [#22519] The write's reference check for a `master_detail` field: does `id`
   * name a header THIS CALLER can read? The write's two header reads, as
   * {@link resolveMasterDetailParent} reads them: the caller's read door
   * ({@link masterDetailHeadersCallerReads}), then the elevated, tenant-kept
   * {@link referenceExists} for a header it returned. A header the read door
   * does not return is `false` — `reference_not_found`, exactly as a header
   * that exists nowhere.
   *
   * `null` (fail-open) only where {@link referenceExists} answers it, and for
   * an unregistered master, which has no read door to ask either. A SYSTEM
   * caller reaches it only as a flow run's elevated write, or a write that
   * write sets off (#28881): its read door returns every header
   * ({@link masterDetailHeadersCallerReads}), so the header's existence in the
   * caller's tenant is what is asked.
   *
   * ⛔ `master_detail` only — the plain `lookup` probe is not this rule's.
   */
  private async masterDetailHeaderExists(
    target: string,
    id: unknown,
    context: ExecutionContext | undefined,
  ): Promise<boolean | null> {
    const master = this.resolveObjectName(target);
    if (!this._registry.getObject(master)) return null;
    const readable = await this.masterDetailHeadersCallerReads(master, [id], context);
    if (!readable.has(String(id))) return false;
    return this.referenceExists(target, id, context);
  }

  /**
   * [#22519] Read 1 of the write's master-detail header read: which of `ids`
   * the caller's READ DOOR returns — one `find` for the whole batch, under the
   * caller's own context, so every enforcement layer in the middleware chain
   * (RBAC, RLS, sharing, row scope) answers it, as it answers the preview's
   * first read ({@link resolvePreviewParents}). Projected to `id`: what the
   * header HOLDS is read 2's question, never this one's.
   *
   * A header it does not return binds as a header that exists nowhere binds:
   * the reference check answers `reference_not_found` for it
   * ({@link masterDetailHeaderExists}), and the write's header resolution
   * leaves `parent` unbound for it ({@link resolveMasterDetailParent},
   * {@link resolveMasterDetailParents}). A read that fails — a refusal of the
   * read itself included — returned no header, so every header binds as
   * missing, as the preview binds them and as the write's own failed header
   * read does; ⛔ never as readable.
   *
   * A SYSTEM caller (seed replay, boot) has no read door to ask: every id goes
   * straight to read 2, and its write resolves exactly as before.
   */
  private async masterDetailHeadersCallerReads(
    master: string,
    ids: ReadonlyArray<unknown>,
    context: ExecutionContext | undefined,
  ): Promise<ReadonlySet<string>> {
    // [#25522 cut 10] The body moved to `engine-referential-integrity.ts` (see `ReferentialIntegrityHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof masterDetailHeadersCallerReads> = {
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
    };
    return masterDetailHeadersCallerReads.call(host, master, ids, context);
  }

  /**
   * [#19853] Settle whether an UPDATE lands the master-detail FK its payload
   * names, BEFORE any `parent`-scoped lock is judged — so `parent` is the
   * header the write STORES, not merely the one it NAMES. Shared by the by-id
   * and bulk paths, which differ only in how a header is resolved and how the
   * FK's own lock is judged (one row, or "locked in ≥1 matched row").
   *
   * #4889's rule — a repoint is judged against the master it lands on — is
   * right only when the repoint LANDS. Two strips can take the FK back out
   * after `parent` was resolved from it, and the row then keeps the header it
   * had while every other parent-scoped lock was judged against one it never
   * reached. Measured on the card's shape: `update(l1, { amount: 999, invoice:
   * 'inv_b' })` with `invoice` statically `readonly` and `l1` under a PAID
   * `inv_a` committed `{ amount: 999, invoice: 'inv_a' }` — the frozen line
   * rewritten, still under the paid invoice. The strips, in the order they run
   * after this point:
   *
   *  ① the FK's OWN `readonlyWhen` lock. Judged here first, against the
   *    header the FK names — #4889's rule for the FK itself, unmoved.
   *    [#19911] Judged WITH the other caller-supplied locks, not alone, and
   *    settled with them (`settleReadonlyWhenDrops`), so a value one of them
   *    drops can no longer unlock it — but only the FK is TAKEN here (`only`).
   *    That moves the FK's verdict in BOTH directions: a repoint its lock
   *    used to let through can now stay home, and a repoint it used to hold
   *    can now LAND, when the value its `record` lock reads is itself locked
   *    under the header the FK names — that value is dropped, the FK's lock
   *    reads the stored one, and the rest are then judged under the header
   *    the row lands on. When that verdict keeps the FK off the landing it is final:
   *    the returned `supplied` no longer holds the FK, so the strip that
   *    judges the other fields never re-asks it against the header the row
   *    keeps, where it could flip and land the FK after the rest were judged
   *    against the header it left. When the FK lands, that strip re-judges it
   *    on the same landing and reaches the same verdict.
   *  ② the static `readonly` strip (`staticReadonlyStripTakes`), which runs
   *    after the conditional one and takes a non-system caller's forged FK.
   *
   * Nothing else on either path moves the FK after this point, and what moves
   * it before this point (a `beforeUpdate` hook, the post-hook payload) is
   * already in `data`. Field-level security refuses a forbidden FK outright
   * rather than stripping it, so it never leaves a payload that names one
   * header and stores another.
   *
   * Returns:
   *  - `subject` — the payload the `readonlyWhen` strip judges next: `data`,
   *    or `data` without the FK when ①'s verdict locked it;
   *  - `supplied` — the entry snapshot that strip judges against: without the
   *    FK when the FK does not land (its verdict is in), whole when it does;
   *  - `view` — the payload the header id is read from: `data` when the FK
   *    lands, else `data` without it, so `masterIdOf` falls through to the
   *    prior row's FK;
   *  - `header` — what `resolve(view)` answers. ① needs the NAMED header only
   *    when judging the FK's lock reads `parent` — its own predicate, or
   *    [#19911] a `record`-reading one whose view another payload key's
   *    `parent`-scoped lock shapes (`readonlyWhenFkJudgementReadsParent`);
   *    when the FK then lands that is the same header and is reused, so the
   *    write still reads one header — two only when ① read the named header
   *    and the FK does not land.
   */
  private async settleMasterDetailLanding<H>(args: {
    schema: unknown;
    data: Record<string, unknown>;
    supplied: Readonly<Record<string, unknown>>;
    staticStrip: { runs: boolean; preserveAudit: boolean; hookWrittenKeys: ReadonlySet<string> | undefined };
    resolve: (view: Record<string, unknown>) => Promise<H>;
    judgeFkLock: (named: H | undefined, fk: string) => Record<string, unknown>;
  }): Promise<{
    subject: Record<string, unknown>;
    supplied: Readonly<Record<string, unknown>>;
    view: Record<string, unknown>;
    header: H;
  }> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts`; it reads no member of the class.
    return settleMasterDetailLanding<H>(args);
  }

  /**
   * [#4889] The master-detail header a detail row's `parent`-scoped
   * `readonlyWhen` reads, or `null` when this write cannot resolve one.
   *
   * `readonlyWhen: parent.status == 'paid'` is a documented **server**
   * guarantee (ADR-0124 D1 puts enforcement here; the client grid is
   * courtesy), but the strip is a pure function over the payload and the prior
   * row — it has no driver and cannot fetch a header. So the engine resolves it
   * and passes it in.
   *
   * The header id comes from the payload first, then the prior row: a write that
   * REPOINTS the detail at another master must be judged against the master it
   * is landing on, not the one it is leaving.
   *
   * ## Two reads: may the caller see the header, then what it holds (#22519)
   *
   * A write of a detail whose header the caller cannot read answers exactly
   * what a write naming a header that exists nowhere answers — for every
   * detail, `controlled_by_parent` or not, on insert, update (a repoint
   * included) and the bulk paths. The caller's right to write the detail does
   * NOT settle its right to read the header: ADR-0055 §3 gates a detail write
   * on its header (master edit, which implies read) only for a
   * `controlled_by_parent` detail, and a detail with a sharing model of its own
   * meets no header check on write. So the header is read twice, each read
   * answering one question, in the shape the preview reads it in
   * ({@link resolvePreviewParents}):
   *
   *  1. ⛔ MAY THIS CALLER SEE THE HEADER — the read door, under the caller's
   *     own context ({@link masterDetailHeadersCallerReads}). A header it does
   *     not return binds as a missing header binds: `null`, so a parent-scoped
   *     `requiredWhen` / `readonlyWhen` meets an unbound `parent`, and the
   *     reference check answers `reference_not_found` for it
   *     ({@link masterDetailHeaderExists}).
   *  2. WHAT THE HEADER HOLDS — the write's own ELEVATED read below, for a
   *     header read 1 returned only. The lock is a data-integrity property of
   *     the header's state, so a header the caller can read is judged on its
   *     STORED values, a column field-level security hides from or masks for
   *     this caller included: author-defined integrity rules run on true data.
   *     The preview's per-column masking is the preview's own, not the write's.
   *
   * A SYSTEM caller (seed replay, boot) asks no read door: read 2 alone, as
   * before.
   *
   * ## The elevation keeps the tenant wall (#19837)
   *
   * Read 2's argument is about the VALUES of a header the caller may see, never
   * about TENANCY, so the
   * read runs under {@link ObjectQL.referenceCheckContext} — the `sudo()`-shaped
   * `{ ...context, isSystem: true }` both reference checks share — and never a
   * bare `{ isSystem: true }`. The bare spelling carried no `tenantId`, so the
   * header was found in ANY organization and a `parent.*` predicate was judged
   * against another organization's row: an org-bound caller naming that row's
   * id learned one bit of it per write (`requiredWhen` answered `required` for a
   * `locked` header and `reference_not_found` for an `open` one; `readonlyWhen`
   * dropped or kept the field). With the caller's context spread first,
   * `buildDriverOptions` forwards its `tenantId` (and, under the `group`
   * posture, its membership set as `tenantIds`), a header stamped with an
   * organization outside that scope — another organization, or under `group`
   * one outside the caller's membership set — is not found, and it binds
   * exactly as a header that exists nowhere does — absent. The tenancy exemptions stay where they are decided:
   * a `tenancy.enabled: false` or federated master gets no `tenantId`. A
   * header with no organization is no tenant's (ADR-0131 D1): the driver's
   * scope carries no `IS NULL` arm, so a scoped read does not find it. A system
   * caller with no `tenantId` (seed replay, boot) still reads unscoped.
   *
   * `null` on any failure — no relation, no id, header not returned by the
   * caller's read door, header gone or outside the caller's tenant scope, read
   * threw. It is NOT read as "unlocked": an
   * unresolved binding leaves `parent` unbound, and `isReadonlyWhenLocked`
   * treats a predicate that needs it as LOCKED.
   *
   * [#6457] A header that IS resolved is handed over TOTAL over the MASTER
   * object's declared fields — see {@link materializeParentHeader} for why that
   * had to happen here and nowhere else, and for the verdict table it moves.
   */
  private async resolveMasterDetailParent(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRow: Record<string, unknown> | null | undefined,
    context: ExecutionContext | undefined,
  ): Promise<Record<string, unknown> | null> {
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return null;
    // [#24358] ⛔ A header in the stored-metadata-body family is never read,
    // under either authority. Read 2 below is a whole-row read the family's
    // projection never reaches, so a `parent.*` predicate would be judged over
    // the stored body and its content hash unprojected: one bit of material the
    // family's own door withholds, per write. `parent` stays unbound, the
    // fail-closed signal (#4889) an unreadable header already gives, so the
    // verdict says nothing about the row.
    if (isStoredMetadataBodyObject(rel.master)) return null;
    const parentId = masterIdOf(rel.fk, data, priorRow);
    if (parentId == null) return null;
    // [#22519] 1. The caller's read door: a header it does not return binds as
    // a missing header binds.
    const readable = await this.masterDetailHeadersCallerReads(rel.master, [parentId], context);
    if (!readable.has(String(parentId))) return null;
    // 2. The write's own elevated, tenant-kept read, for a header read 1 returned.
    try {
      const row = await this.findOne(rel.master, { where: { id: parentId }, context: ObjectQL.referenceCheckContext(context) } as any);
      // `null` stays `null` — the fail-CLOSED signal (#4889) is the ABSENCE of
      // the binding, and materialising a row we do not have would destroy it.
      return row == null ? null : this.materializeParentHeader(rel.master, row as Record<string, unknown>);
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, id: parentId, error: err,
      });
      return null;
    }
  }

  /**
   * Bulk counterpart of {@link resolveMasterDetailParent}: one read for the
   * whole matched set, then a per-row lookup for
   * `stripReadonlyWhenFieldsMulti`. A bulk update of N details under M masters
   * costs ONE extra query, not N — the same "read the match set once" discipline
   * the #3106 prior-row fetch follows.
   *
   * [#4977] Serves three callers now, unchanged: the bulk `readonlyWhen` strip,
   * the bulk `requiredWhen` evaluation, and the INSERT path — where `data` is
   * passed as `null` and each inserted row supplies its own FK, so
   * `masterIdOf(fk, null, row)` reads `row[fk]` and the batch costs one header
   * read for the whole `insert()` call.
   *
   * [#6457] Every header this resolves is materialised over the MASTER's
   * declared fields, exactly as the single-id twin does — the declared-field
   * table is read ONCE for the batch, not per row. A row this map has no entry
   * for still answers `null` (unbound, fail-CLOSED for `readonlyWhen`).
   *
   * [#19837] Read under the same tenant-keeping elevation as the single-id twin,
   * for the same reason: a header outside the caller's tenant scope gets no
   * entry here, so it binds as absent rather than lending its fields to a
   * `parent.*` predicate.
   *
   * [#22519] The same two reads as the single-id twin, each once for the batch:
   * the caller's read door ({@link masterDetailHeadersCallerReads}), then the
   * elevated read for the headers it returned only. A header the read door does
   * not return gets no entry, so it binds as a missing header binds.
   */
  private async resolveMasterDetailParents(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRows: ReadonlyArray<Record<string, unknown>> | null | undefined,
    context: ExecutionContext | undefined,
  ): Promise<(row: Record<string, unknown> | undefined) => Record<string, unknown> | null> {
    const unbound = () => null;
    const rel = resolveMasterDetailRelation(schema);
    if (!rel) return unbound;
    // [#24358] ⛔ The single-id twin's family guard, for the batch: a
    // stored-metadata-body header is never read, and every row binds unbound.
    if (isStoredMetadataBodyObject(rel.master)) return unbound;
    const ids = new Set<string>();
    for (const row of priorRows ?? []) {
      const id = masterIdOf(rel.fk, data, row);
      if (id != null) ids.add(String(id));
    }
    if (ids.size === 0) return unbound;
    // [#22519] 1. The caller's read door, once for the batch.
    const readable = await this.masterDetailHeadersCallerReads(rel.master, [...ids], context);
    if (readable.size === 0) return unbound;
    const byId = new Map<string, Record<string, unknown>>();
    try {
      // 2. The write's own elevated, tenant-kept read, for the headers read 1 returned.
      const rows = await this.find(rel.master, {
        where: { id: { $in: [...readable] } },
        context: ObjectQL.referenceCheckContext(context),
      } as any) as Array<Record<string, unknown>>;
      // [#6457] One declared-field lookup for the whole batch, then one shallow
      // copy per header. A master the registry does not know leaves `fields`
      // undefined and every header passes through untouched — see
      // {@link materializeParentHeader}.
      const masterFields = this.masterDeclaredFields(rel.master);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id != null) byId.set(String(row.id), materializeDeclaredFields({ ...row }, masterFields));
      }
    } catch (err) {
      this.logger?.warn?.('readonlyWhen parent lookup failed — parent stays unbound', {
        object: rel.master, error: err,
      });
      return unbound;
    }
    return (row) => {
      const id = masterIdOf(rel.fk, data, row);
      return id == null ? null : (byId.get(String(id)) ?? null);
    };
  }

  /**
   * [#22474] The master-detail headers a `validate()` preview binds, per row:
   * `parents[i]` is the header row `i` is judged under (`parent`), and
   * `previousParents[i]` the header its stored row hangs off when the row
   * REPOINTS it (`previousParent`, for the ADR-0113 pre-check), else
   * `undefined`, which the evaluator reads as "the same header", as the
   * write's own `undefined` is read.
   *
   * The header ids are read the way the write reads them ({@link masterIdOf}):
   * `views[i]` is the judged view, the row on an insert and the stored row
   * merged with the patch on an update, so the patch's FK wins over the stored
   * one; `storedRows[i]` names the header a repoint leaves.
   *
   * ## Read under the caller's access, not elevated
   *
   * A header read elevated here would answer a predicate over a row the caller
   * may not read. Two reads, each answering one question, as the preview's
   * stored-row read does — and, since #22519, as the write's own header read
   * does ({@link resolveMasterDetailParent}):
   *
   *  1. ⛔ MAY THIS CALLER SEE THE HEADER — the READ DOOR, under the caller's
   *     own context, one `find` for the whole batch. A header it does not
   *     return binds as a missing header binds: `null`, so a predicate that
   *     reads `parent` refuses as unevaluable, whatever the header holds. A
   *     failed read binds every header as missing, as the write's own failed
   *     header read does.
   *  2. WHAT THE WRITE WOULD JUDGE — the write's own header read
   *     ({@link resolveMasterDetailParents}, whose own read door returns the
   *     same headers), for the headers read 1 returned only.
   *
   * ⛔ The column rule is the preview's own; the write judges a header the
   * caller can read on its stored values. A header column is kept only where
   * the read door served this caller
   * that very value ({@link servedAsStored}); every other column, hidden or
   * served transformed (a partial mask keeps the key and replaces the value),
   * is judged as empty: the header is materialised over the master's declared
   * fields after the columns are kept, so such a column reads `null`. So the
   * verdict never depends on a header value the caller could not have read in
   * full.
   */
  private async resolvePreviewParents(
    schema: unknown,
    views: ReadonlyArray<Record<string, unknown>>,
    storedRows: ReadonlyArray<Record<string, unknown> | undefined>,
    context: ExecutionContext | undefined,
  ): Promise<{
    parents: Array<Record<string, unknown> | null>;
    previousParents: Array<Record<string, unknown> | null | undefined>;
  }> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts` (see `MasterDetailRelatedHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof resolvePreviewParents> = {
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
      resolveMasterDetailParents: (...a) => this.resolveMasterDetailParents(...a),
      materializeParentHeader: (...a) => this.materializeParentHeader(...a),
    };
    return resolvePreviewParents.call(host, schema, views, storedRows, context);
  }

  /**
   * [#18682] Resolve the related rows this object's PREDICATE rules read one
   * hop through a reference field, for a whole batch of rows at once.
   *
   * Returns a per-row lookup the validation seams hand to
   * `evaluateValidationRules` as `related`. When no rule traverses anything the
   * schema says so up front and this costs NOTHING — no query, no closure work
   * — which is what bounds the N+1: one hop, only the fields a rule names, one
   * batched read per reference field per write (two for a caller that is not
   * SYSTEM where a read door bounds the rows, below), and only when a rule asks.
   *
   * ## Which related rows a caller's rule may read, and how their values are read
   *
   * The VALUES are read as SYSTEM: a validation rule's output is a pass/fail the
   * SYSTEM enforces, not data handed to the caller — categorically unlike an
   * access-control rule, which is why RLS predicates are excluded from this
   * capability altogether. Reading the columns as the acting user instead made
   * the rule unauthorable for exactly the persona it exists to constrain. What
   * bounds that elevation is the PROJECTION: only the columns the predicate
   * names, intersected with the related object's declared fields. ⛔ Never the
   * whole row.
   *
   * Which ROWS a caller that is not SYSTEM may have read is a different
   * question, answered before any value is read:
   *
   *  - ⛔ Through a `master_detail` FK the related row is the detail's HEADER,
   *    and ruling A on #22519 holds here as on the write's own header read
   *    ({@link resolveMasterDetailParent}): an unreadable header is a header
   *    that exists nowhere (#22892). The caller's read door first, under the
   *    caller's own context ({@link masterDetailHeadersCallerReads}); a header
   *    it does not return is `unresolved`, exactly as a header that exists
   *    nowhere is, so the rule's answer never depends on what an unreadable
   *    header holds. The elevated, tenant-kept read follows for the headers the
   *    door returned only, and a header the caller CAN read is judged on its
   *    stored values, as the write judges it.
   *  - On a related object no organization wall scopes, the own read of the
   *    caller bounds the rows, and any other id is `unreadable`, stored or not.
   *  - ⛔ A plain `lookup` to a walled object keeps the tenant-kept elevated read
   *    alone: no ruling extends the header rule to it.
   *
   * A SYSTEM caller (seed replay, boot) asks no read door: the elevated read
   * alone, as before.
   *
   * ## An unresolved row is left UNAVAILABLE, and it says which kind
   *
   * No reference stored, the related record not found, the related object
   * declares no such column, or the row could not be read: each is its own reason, and
   * {@link checkPredicate} turns it into a refusal naming the related object and
   * column. The write is REJECTED rather than judged on a rule that produced no
   * verdict. ⛔ Never silently true, and never silently false.
   *
   * The projection always names `id` alongside the fields the rules read:
   * the map below is keyed on `row.id`, and a projection that omitted it would
   * build an EMPTY map and leave every row unbound (#7537's shape, one seam
   * over).
   */
  private async resolvePredicateRelated(
    schema: any,
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
  ): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts` (see `MasterDetailRelatedHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolvePredicateRelated> = {
      buildReferentialFieldClear: (...a) => this.buildReferentialFieldClear(...a),
      get _registry() { return readRegistry(); },
      resolveOneHopRelated: (...a) => this.resolveOneHopRelated(...a),
    };
    return resolvePredicateRelated.call(host, schema, rows, context);
  }

  /**
   * [#24197] Resolve the related rows a page of `rows` reads ONE hop through a
   * reference field — the one loader behind both seams that serve a hop:
   * validation predicates ({@link resolvePredicateRelated}, `authority:
   * 'predicate'`) and formula fields ({@link resolveFormulaRelated},
   * `authority: 'caller'`).
   *
   * Everything but the AUTHORITY of the value read is shared, so the two seams
   * cannot disagree about it: which reference fields and related fields to
   * read ({@link collectReferenceTraversals}), the declared-field intersection
   * and its `undeclared-field` report, the id set (one batched read per
   * reference field per call, never one per row; a multi-value or already
   * expanded slot names no single row), the `null` materialisation of a
   * declared column the driver omitted, and the per-row
   * {@link RelatedFieldBinding} with its reason when there is no row.
   *
   * ## The authority, and why the two differ
   *
   *  - `predicate`: a rule's output is a pass/fail the SYSTEM enforces, so the
   *    values are read as SYSTEM behind the caller's read doors — see
   *    {@link resolvePredicateRelated} for the whole argument.
   *  - `caller`: a formula's output is DATA handed to the reader. Reading the
   *    hop as SYSTEM would hand any reader of the junction row a related
   *    column it could not read directly, so the hop is read under the
   *    caller's OWN context, through every enforcement layer `find` applies
   *    (row-level security, field-level security, the organization wall). A
   *    related row that read does not return is `unresolved` — whether it
   *    exists nowhere or the reader may not see it, the formula answers the
   *    same, so the answer discloses neither.
   */
  private async resolveOneHopRelated(
    schema: any,
    wanted: ReadonlyMap<string, ReadonlySet<string>>,
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
    authority: 'predicate' | 'caller',
  ): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts` (see `MasterDetailRelatedHost`).
    const readRegistry = () => this._registry;
    const readFormulaHopReads = () => this.formulaHopReads;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof resolveOneHopRelated> = {
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
      get _registry() { return readRegistry(); },
      find: (...a) => this.find(...a),
      masterDetailHeadersCallerReads: (...a) => this.masterDetailHeadersCallerReads(...a),
      get formulaHopReads() { return readFormulaHopReads(); },
      get logger() { return readLogger(); },
    };
    return resolveOneHopRelated.call(host, schema, wanted, rows, context, authority);
  }

  /**
   * [#6457] Make a resolved master-detail header TOTAL over the MASTER
   * object's declared fields, so a `parent.<field>` predicate is evaluable
   * whatever subset of columns the driver echoed back.
   *
   * ## The hole this closes
   *
   * #4953 made the `record` / `previous` roots total at every server seam
   * ({@link ./declared-fields.js#materializeDeclaredFields}); the 2026-08-06
   * ruling deliberately left `parent` out, because `parent` is a row of ANOTHER
   * object and its ABSENCE is #4889's fail-closed signal. What that left behind
   * is the same trap one root over — visible as a THREE-row table, of which
   * only the middle row moves here:
   *
   * | header state | `readonlyWhen: parent.status == null` | before | now |
   * |---|---|---|---|
   * | carries `status` | evaluates | locks per verdict | unchanged |
   * | resolved, no `status` key | `No such key: status` — `parent` IS bound, so `unknownVariableOf` does not match ⇒ ordinary fail-OPEN | **declared lock let through** | evaluates (`status` reads `null`) |
   * | unresolvable (`null`) | `Unknown variable: parent` | LOCKED (#4889) | LOCKED — unchanged |
   *
   * The middle row is the bug: whether a declared lock enforced depended on
   * which columns a driver happened to return, which is not something an author
   * can see or control. `requiredWhen` (#4977) shares the binding and had the
   * mirror of it — fail-open there means the requirement is simply not
   * enforced. One materialisation serves both consumers.
   *
   * ## Why HERE, and not in the strip / the evaluator
   *
   * `stripReadonlyWhenFields*` and `evaluateValidationRules` are pure functions
   * over what they are handed; they hold the DETAIL object's field table and
   * have no way to reach the MASTER's — threading a second field table through
   * their signatures would put the master's schema in four call sites' hands to
   * serve one binding. The engine already holds both the registry and the
   * just-read header at these two seams, so the header arrives at those
   * functions already total and their signatures do not move.
   *
   * ## The fail-CLOSED line is preserved EXACTLY (#4889)
   *
   * This function is only ever reached with a row IN HAND — the persisted-state
   * precondition `declared-fields.ts` states. An UNRESOLVABLE header still
   * returns `null` from the resolvers above, still leaves `parent` unbound,
   * still faults as `Unknown variable: parent`, and is still read as LOCKED. The
   * two cases stay distinguishable by construction: absence is decided before
   * this function is called, materialisation only ever applies to a row that
   * exists.
   *
   * A master the registry cannot resolve yields no field table, and the header
   * passes through unchanged — sparse, i.e. exactly the pre-#6457 behaviour.
   * That is the honest answer: without the declared shape we cannot know which
   * absent keys are fields and which would be fabrication.
   *
   * COPIED before materialising, like every other caller: the row is what
   * `findOne`/`find` returned and may be observed elsewhere; it must not gain
   * materialised nulls behind its reader's back.
   */
  private materializeParentHeader(master: string, row: Record<string, unknown>): Record<string, unknown> {
    return materializeDeclaredFields({ ...row }, this.masterDeclaredFields(master));
  }

  /** The MASTER object's declared-field table, or `undefined` when the registry
   *  does not know it (see {@link materializeParentHeader}). */
  private masterDeclaredFields(master: string): Record<string, unknown> | undefined {
    const schema = this._registry.getObject(master) as { fields?: Record<string, unknown> } | undefined;
    const fields = schema?.fields;
    return fields && typeof fields === 'object' ? fields : undefined;
  }

  /**
   * [#4551] Report stored references that resolve to nothing. **Read-only** —
   * this issues no writes at all.
   *
   * The follow-up to {@link assertReferencesResolve}'s deliberate `isSystem`
   * exemption. That exemption stays exactly as #4441 wrote it (seed replay and
   * boot provisioning must keep their ordering freedom); what it left behind is
   * a residual — the platform itself can still write a reference into the void
   * and nothing says so. This is the "something says so".
   *
   * The existence oracle passed to the audit is **this engine's own**
   * {@link referenceExists}, not a second copy: the audit and the write-path
   * guard therefore answer "does this id exist" — and "could I even tell?" —
   * with one predicate, so the report can never be more or less strict than the
   * rule it reports on.
   *
   * ## Each row is probed under its OWN organization (#19837)
   *
   * One predicate needs one scope, too. The write-path guard probes under the
   * WRITER's `tenantId` since #19808, and refuses a reference into another
   * organization; this audit has no writer, so it hands the probe the
   * organization the scanned row was stamped with — the same one, for every
   * non-system write — and a NULL-organization row (or an object with no tenant
   * column) probes unscoped. A stored cross-organization reference — written
   * before #19808, or by an `isSystem` write — is therefore reported, where the
   * unscoped probe found the row in the other organization and said nothing.
   *
   * ## …except under a UNION posture, where it stays unscoped
   *
   * Under `group` ({@link postureUsesUnionScope}) the write rule's reach is the
   * WRITER's whole membership set, and the stored row does not record it. A
   * probe scoped to the row's own organization would be STRICTER than that
   * rule: it would report every cross-organization reference a group member
   * legitimately wrote, on every sweep of healthy data. So the probe stays
   * unscoped there, as before #19837 — never stricter than the rule. ⚠️ The
   * blind spot this leaves, stated rather than implied: under `group` a stored
   * reference into an organization NO writer of that row could reach (a write
   * made before #19808's guard existed, an `isSystem` write, or a membership
   * since revoked) resolves and is NOT reported; only a reference that
   * resolves nowhere is.
   *
   * See {@link auditDanglingReferences} for the judgments (readonly SPLIT —
   * `readonly` references are read like any other and their findings filed
   * under `provenance` / `provenanceUndetermined` since #4743/#5719, not
   * skipped; empty values; unknown ≠ absent) and for the bounded-scan honesty
   * of the report, whose incompleteness now has a bucket at every level:
   * `truncatedObjects` inside a table, `unscannedObjects` for the tables the
   * budget never reached (#5718), `unreadableObjects` for what the datasource
   * refused, and `aborted` for a run called off (#4747).
   */
  inspectDanglingReferences(
    options?: DanglingReferenceAuditOptions,
  ): Promise<DanglingReferenceReport> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    const read_registry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof inspectDanglingReferences> = {
      get _registry() { return read_registry(); },
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
      referenceExists: (...a) => this.referenceExists(...a),
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return inspectDanglingReferences.call(host, options);
  }

  /**
   * [#24964] Read-only: every record a by-id {@link delete} of `object`/`id`
   * would remove, the root first — the cascade set that delete collects for
   * itself before it writes anything, read through the same walk.
   *
   * Exists for the operator's remover of the rows {@link inspectDanglingReferences}
   * reports (`os db orphans`). Its dry run must list the deeper details the
   * delete would reach, and it can only say that truthfully by asking the walk
   * the delete runs. A copy of "which relations cascade" in the command would
   * be free to disagree with the delete it previews.
   *
   * It reads, and does nothing else:
   *
   * - it issues no write and runs no hook;
   * - it files no #12166 elevation record: that record says the platform read
   *   an object as system for a delete, and none happens here;
   * - it reads as SYSTEM with no organization, the probes a system-context
   *   delete makes (`{ isSystem: true }`, no `tenantId`). A delete under any
   *   other context can reach a different set.
   *
   * What it lists is the `cascade` relations' reach, the delete's phase 1.
   * A `restrict` dependent outside the set refuses the delete when it runs,
   * and a `set_null` reference to a member is cleared when it runs. Neither
   * is listed here: neither removes a record.
   *
   * Like the delete's own walk, it propagates an unreadable registry or a
   * dependents probe that fails for any reason but a table that was never
   * provisioned. ⛔ Never treat a throw as "no deeper details".
   */
  inspectCascadeDelete(
    object: string,
    id: string | number,
  ): Promise<Array<{ object: string; id: string }>> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    const read_registry = () => this._registry;
    const host: ThisParameterType<typeof inspectCascadeDelete> = {
      get _registry() { return read_registry(); },
      collectCascadeDeleteSet: (...a) => this.collectCascadeDeleteSet(...a),
      resolveObjectName: (...a) => this.resolveObjectName(...a),
    };
    return inspectCascadeDelete.call(host, object, id);
  }

  /**
   * [#28001] `IObjectQLEngine.getCascadeDeleteObjects`: the objects a delete
   * of a record of `object` can cascade into, which the metadata read serves
   * beside the object as `cascadeDeleteObjects` so a delete confirmation can
   * name them (ruling B on #28001: the client gets the list from the server,
   * never from a second copy of the engine rule).
   *
   * Read from the rule the delete runs: breadth-first through the relations
   * whose resolved behaviour is `cascade` ({@link cascadeRelationBehavior},
   * through the same scan {@link collectCascadeDeleteSet} makes at each
   * depth), so a `master_detail` child is named by default and a lookup only
   * when it declares `deleteBehavior: 'cascade'`. A child's own cascading
   * children are named too, since the delete reaches them through it. Each
   * object once, in the order the walk first reaches it; `object` itself only
   * when a cascading relation leads back to it.
   *
   * It is object-level, and that is the whole of its disclosure: it reads the
   * registry and no row, so it says what a delete MAY remove, never which
   * records or how many. {@link inspectCascadeDelete} is the record-level
   * reading, as SYSTEM, for the operator's command, and is not served.
   *
   * What it leaves out is what removes nothing: a `restrict` relation (it
   * refuses the delete) and a `set_null` one (it clears the reference),
   * as {@link inspectCascadeDelete} leaves them out.
   *
   * `undefined` when the registry does not hold `object`: the read then
   * serves no key, rather than `[]`, which says nothing cascades.
   */
  getCascadeDeleteObjects(object: string): string[] | undefined {
    if (!this._registry.getObject(object)) return undefined;
    const host: ThisParameterType<typeof collectCascadeDeleteObjects> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
    };
    return collectCascadeDeleteObjects.call(
      host, this.resolveObjectName(object), this._registry.getAllObjects(),
    );
  }

  /**
   * Register the crypto provider that backs `secret`-typed fields.
   *
   * When set, the engine encrypts secret fields on write (storing ciphertext in
   * `sys_secret` and only an opaque ref on the business row) and masks them on
   * read. When NOT set, writing to an object that declares a secret field is
   * **fail-closed** — the write throws rather than persist cleartext.
   *
   * Mirrors the Settings subsystem's ICryptoProvider wiring; the host (e.g.
   * `serve`) injects `LocalCryptoProvider` in dev and a KMS/Vault-backed
   * provider in production.
   *
   * Notifies {@link onCryptoProviderChange} listeners AFTER the provider is in
   * place, so a listener that immediately re-reads a secret sees the new
   * capability rather than the state that made it fail (#8022).
   */
  setCryptoProvider(provider: ICryptoProvider): void {
    this.cryptoProvider = provider;
    this.logger.info('CryptoProvider configured for secret fields');
    // A listener is a re-arm, never part of this call's contract: one that
    // throws must not fail the host's composition root, and must not stop the
    // listeners behind it from re-arming.
    for (const listener of [...this.cryptoProviderListeners]) {
      try {
        listener();
      } catch (err) {
        this.logger.warn('CryptoProvider registration listener failed', {
          error: (err as Error)?.message ?? String(err),
        });
      }
    }
  }

  /**
   * [#21207] Read accessor for the registered provider's keyed digest
   * (`ICryptoProvider.keyedDigest`), or `undefined` while no provider is
   * registered.
   *
   * The ONE way a consumer outside this engine reaches the server-held key:
   * the doors that serve a stored metadata content hash serve
   * `keyedDigest(stored)` instead, and compare a caller's version token in that
   * same form. Deliberately narrower than the provider itself — a consumer
   * that needs a keyed digest gets that one primitive, never `decrypt`.
   *
   * Read at the moment of use, never cached by the caller: a host injects the
   * provider AFTER the kernel starts (see {@link setCryptoProvider}), so a
   * value captured at boot would still say "none" once one is registered.
   */
  getKeyedDigest(): ((plain: string) => Promise<string>) | undefined {
    const provider = this.cryptoProvider;
    return provider ? (plain: string) => provider.keyedDigest(plain) : undefined;
  }

  /**
   * [#8022] Observe crypto-provider registration.
   *
   * Exists for consumers that must dereference a `secret` field on a schedule
   * they do not control — the boot path. `secret` reads are fail-closed by
   * design (#7799), which is correct, but "no provider" at boot is a
   * *transient* state on every host: `kernel:ready` runs plugins, and only
   * after `runtime.start()` returns does the composition root call
   * {@link setCryptoProvider}. A consumer whose cache was built in that gap is
   * wrong until it rebuilds, and polling is the only alternative to being told.
   *
   * Fires on every registration, including a later replacement (a KMS provider
   * swapped in over the dev one) — a listener that re-reads is correct in both
   * cases, and a re-read is cheap next to signing with a key from the wrong
   * provider.
   *
   * @returns an unsubscribe function; call it when the listener's owner stops.
   */
  onCryptoProviderChange(listener: () => void): () => void {
    this.cryptoProviderListeners.add(listener);
    return () => {
      this.cryptoProviderListeners.delete(listener);
    };
  }

  /**
   * [ADR-0105 D2 / #3623] Inject the tenancy-posture accessor that decides
   * whether driver-level native tenant scoping widens to the caller's whole
   * membership set (`DriverOptions.tenantIds`, the `group` posture's union)
   * instead of the active-org equality (`DriverOptions.tenantId`).
   *
   * Wired by the enforcement layer (SecurityPlugin) — deliberately NOT
   * self-derived from env here: the posture in force is an entitlement
   * question (`tenancy` service), and widening the driver wall is only safe
   * when the Layer 0 union wall is actually enforcing above it. No provider
   * (an embedding without plugin-security) keeps today's equality scoping —
   * fail toward isolation, never toward exposure.
   */
  setTenancyPostureProvider(provider: () => string | undefined): void {
    this.tenancyPostureProvider = provider;
  }

  /**
   * Normalize credential fields on `row` in place before it reaches the driver.
   *
   * Two channels share the read mask ({@link SECRET_MASK}) but differ on write
   * (see ADR-0100):
   *
   *  - **`secret`** — encrypted: each plaintext is wrapped by the ICryptoProvider
   *    and replaced on `row` by an opaque ref. Cleartext never reaches the
   *    business table. [#27495] The `sys_secret` row is SEALED here and handed
   *    back, not written: the caller writes it with {@link persistSecretRows}
   *    immediately before the record's own driver write, so a write refused
   *    after this pass (validation, the post-image seam) leaves no row behind.
   *  - **`password`** (generic, non-`better-auth`) — plaintext at rest: stored
   *    verbatim, no encryption and no `sys_secret` row. Only the echoed-mask drop
   *    below applies to it.
   *
   * Rules:
   *  - Any masked field (secret or password) whose value equals the read mask ⇒
   *    the key is dropped, so a form round-trip that echoes the mask does not
   *    overwrite the stored value.
   *  - No secret fields on the object ⇒ no further work (fast path, no crypto).
   *  - `null`/`undefined` secret value ⇒ left as-is (clears the secret).
   *  - [#8559] `""` secret value ⇒ REFUSED with {@link EmptyCredentialWriteError}
   *    (ADR-0112 `VALIDATION_ERROR`/400, message names `null` as the clear
   *    spelling). Encrypting it would mint a `sys_secret` row that decrypts to
   *    nothing behind a perfectly valid ref, so every read reports "a secret is
   *    set" while the dereference returns nothing — the contradictory state
   *    #8542/#8558 defend consumers against. Refused, not folded into the
   *    `null` branch: silently reinterpreting the write was explicitly rejected
   *    (maintainer ruling 2026-08-13 on #8559). The `password` half of the same
   *    ruling lands at its own seam — {@link refuseEmptyPasswordFields} — since
   *    the two types share the read mask but not this encryption path.
   *  - Secret value already a ref ⇒ [#27582] a non-system write may only seal
   *    a new value or keep its own record's ref. From the system principal
   *    (`context.isSystem === true`) it is left as-is, as it always was. From
   *    any other caller it is kept only when every row the write lands on
   *    already holds exactly that ref in that column — read from `storedRows`,
   *    which each call site supplies (none for an insert, the pre-image for a
   *    by-id update, the matched rows for a predicate update) — and then the
   *    key is dropped, as the echoed mask is. Any other ref is REFUSED with
   *    {@link SecretRefWriteError} (ADR-0112 `VALIDATION_ERROR`/400), one
   *    answer whatever the ref names.
   *  - **Fail-closed:** any other secret value with no CryptoProvider registered,
   *    or no reachable `sys_secret` store, THROWS — never persists cleartext.
   *    (A `password` field needs no CryptoProvider — it is stored as-is.)
   */
  private async encryptSecretFields(
    object: string,
    row: Record<string, unknown>,
    context: ExecutionContext | undefined,
    driverOptions: unknown,
    storedRows: StoredRowsReader,
  ): Promise<PendingSecretRow[]> {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const readCryptoProvider = () => this.cryptoProvider;
    const host: ThisParameterType<typeof encryptSecretFields> = {
      get _registry() { return readRegistry(); },
      get cryptoProvider() { return readCryptoProvider(); },
      getDriver: (...a) => this.getDriver(...a),
    };
    return encryptSecretFields.call(host, object, row, context, driverOptions, storedRows);
  }

  /**
   * [#27495] Write the `sys_secret` rows {@link encryptSecretFields} sealed for
   * one record write. Called immediately before that record's driver write and
   * after every pass that can refuse it, so the credential row is written only
   * with the record that names it. Each row lands on `written` as it is
   * written, which is what the write's failure path hands to
   * {@link releaseSecretHandles} when the record write does not land.
   */
  private async persistSecretRows(pending: readonly PendingSecretRow[], written: PendingSecretRow[]): Promise<void> {
    // [#27495] The body lives in `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const host: ThisParameterType<typeof persistSecretRows> = {
      getDriver: (...a) => this.getDriver(...a),
    };
    return persistSecretRows.call(host, pending, written);
  }

  /**
   * [#27495] Remove each `sys_secret` row in `slots` that the column it was
   * minted for no longer names — best-effort, and never a throw.
   *
   * Two occasions reach it. `'refused'`: a write that sealed and wrote a row
   * did not complete, so the row may name nothing. `'retired'`: a committed
   * update cleared the field (`null`) or replaced its value, so the handle the
   * column named before may name nothing; [#27581] a committed delete reaches
   * it the same way, for every handle the removed rows held. The same three
   * checks decide both,
   * and every one that cannot pass KEEPS the row, the recoverable direction
   * (deleting a handle a row still names destroys that credential, and nothing
   * can name what was lost):
   *
   *  - **Verified, never inferred.** No row of `object` may still name the
   *    handle in that column: a predicate write seals ONE handle for every row
   *    it matches, so clearing one of them leaves the handle in force for the
   *    rest; a write that did land after all (a partially applied batch) still
   *    names its row.
   *  - **This column's own handle.** The `sys_secret` row's `namespace`/`key`
   *    must be this object and field; a ref a system writer copied onto another
   *    column is not released through that column.
   *  - **Inside the record's unit.** The count and the delete ride the open
   *    transaction where it covers their drivers, so they see the write's own
   *    state and roll back with it; a record write in a unit that does not
   *    cover the `sys_secret` store keeps the row, since the delete could
   *    outlive a rollback of the record.
   *
   * A row kept for a failure (not for being in use) is reported once at
   * `error`, naming the column and the remedy: the caller's answer does not
   * change, and the stored ciphertext is exactly what the operator believes
   * gone. Legacy orphans written before this existed are not swept here; the
   * orphan report lists them.
   */
  private async releaseSecretHandles(
    object: string,
    slots: readonly SecretHandleSlot[],
    context: ExecutionContext | undefined,
    occasion: 'refused' | 'retired',
  ): Promise<void> {
    // [#27495] The body lives in `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readTxStore = () => this.txStore;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof releaseSecretHandles> = {
      get txStore() { return readTxStore(); },
      get logger() { return readLogger(); },
      getDriver: (...a) => this.getDriver(...a),
      transactionCoversDriverFor: (...a) => this.transactionCoversDriverFor(...a),
      isClosedUnitHandle: (...a) => this.isClosedUnitHandle(...a),
    };
    return releaseSecretHandles.call(host, object, slots, context, occasion);
  }

  /**
   * [#8559] Refuse `""` on a `password`-typed field before it reaches the
   * driver — the `password` half of the same maintainer ruling (2026-08-13)
   * that makes {@link encryptSecretFields} refuse `""` on a `secret` field.
   *
   * Its own seam, deliberately NOT routed through the encryption path: the two
   * types share the read mask and the echoed-mask drop but a `password` field
   * is plaintext at rest (no CryptoProvider, no `sys_secret` row — ADR-0100),
   * so the refusal binds where its write actually flows. Storing `""` verbatim
   * would produce the same contradiction as the secret arm without the cipher
   * row: a non-null stored value that every read masks as "a password is set"
   * while the credential has no content. `null` (clear) and the echoed mask
   * (drop, handled in {@link encryptSecretFields}) keep their meanings.
   *
   * Scope is {@link collectMaskedPasswordFields}: `managedBy: 'better-auth'`
   * objects are exempt — their password column is not masked on read, so the
   * "reads as set, holds nothing" contradiction cannot arise there, and its
   * write path belongs to the auth subsystem.
   *
   * Called at every call site of {@link encryptSecretFields} (single/bulk
   * insert, single-id update, multi update) so the two halves of the ruling
   * guard the same doors.
   */
  private refuseEmptyPasswordFields(object: string, row: Record<string, unknown>): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof refuseEmptyPasswordFields> = {
      get _registry() { return readRegistry(); },
    };
    return refuseEmptyPasswordFields.call(host, object, row);
  }

  /**
   * Mask credential fields on read so plaintext never leaves the engine through
   * the normal query path. Covers `secret` fields (always) and `password` fields
   * on generic, non-`better-auth` objects (see {@link collectMaskedReadFields}
   * and ADR-0100). A set value becomes {@link SECRET_MASK}; an unset one stays
   * `null`. Privileged callers that genuinely need a secret's plaintext use
   * {@link resolveSecret} against the stored ref; a `password` field is stored
   * as plaintext at rest, so its cleartext is only ever reachable off this path.
   *
   * [#7728] Second collector branch, same choke point: a field declared
   * `internal: true` is OMITTED rather than masked — see
   * {@link omitInternalFields} for why the two dispositions differ.
   */
  private maskSecretFields(object: string, rows: any): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof maskSecretFields> = {
      get _registry() { return readRegistry(); },
      omitInternalFields: (...a) => this.omitInternalFields(...a),
    };
    return maskSecretFields.call(host, object, rows);
  }

  /**
   * [#7728] Drop every field declared `internal: true` from the rows the engine
   * hands back — "the declared value is never returned on the generic data
   * path". This is the read protection for ADR-0100's third credential channel:
   * auth-subsystem one-way hashes stored in `text` columns, which the two
   * type-keyed credential collectors structurally cannot reach.
   *
   * **OMIT, not mask** (maintainer ruling 2026-08-12 on #7728). The credential
   * mask exists to signal "a value is set" without leaking it. The column this
   * was minted for — `sys_api_key.key` — is `required: true`, so it is ALWAYS
   * set: the signal carries zero bits, while still shipping a value under a
   * field whose own description says it is "never exposed to clients". Omission
   * also leaves that description string untouched, so the four generated
   * translation bundles that mirror it do not churn.
   *
   * **`?select=` is covered by construction, and that is load-bearing.** The
   * strip acts on the RESULT ROWS, not on the projection, so a client that
   * spells the column out (`?select=id,key`) gets a 200 without it rather than
   * a bypass. `select` only gates on whether a field is KNOWN
   * (`assertProjectionFieldsExist`) and a flagged column is known, so a
   * projection-aware strip would have shipped looking complete and still leaked
   * to any caller who named the column — measured on the sibling column in
   * #7823, and reproduced here on `sys_api_key.key` before the fix.
   *
   * **No system carve-out**, and this is where the shape deliberately diverges
   * from its sibling {@link stripSearchCompanionFromRead}. That one keeps the
   * `__search` companion for a system caller who names it by projection,
   * because it has exactly one such reader whose backfill comparison would
   * otherwise rewrite every row on every run. This flag has no such reader: the
   * API-key verifier uses the column as a `where` FILTER and never reads it off
   * the result (`resolveApiKeyPrincipal` takes `expires_at` / `user_id` /
   * `organization_id` / `scopes`), and the mint path returns the plaintext it
   * generated, not the row it inserted. An escape hatch nobody needs is a hole
   * in a non-exposure guarantee, so there isn't one — if a legitimate system
   * reader ever appears, it reads the column through a purpose-built privileged
   * accessor, the way {@link resolveSecret} does for `secret`.
   *
   * Nothing below storage is touched. The strip runs on rows the driver has
   * already produced, so the predicate has been evaluated and the index used
   * before this method sees anything — which is precisely why authentication
   * keeps working.
   *
   * **READ path only** (#7823, maintainer ruling 2026-08-13 / A-prime). This
   * used to run at the two write-response sites as well (the 201 create body
   * and the by-id-update 200 body), which conflated "never returned on the
   * generic data path" with "never returned to the engine-level caller that
   * performed the write" — and broke authentication for `sys_session.token`,
   * whose minted value better-auth reads back off the insert result. The
   * write-response half of the guarantee now lives at the generic-data-path
   * ingress (`omitInternalFieldsFromWriteResponse` in
   * `@objectstack/metadata-protocol`, tripwire-enforced across every `*Data`
   * write face); engine write results keep the stored row whole. Lifecycle
   * consumers that need a flagged value back off a READ go through
   * {@link resolveInternalField} — never a carve-out here.
   */
  private omitInternalFields(object: string, rows: any): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof omitInternalFields> = {
      get _registry() { return readRegistry(); },
    };
    return omitInternalFields.call(host, object, rows);
  }

  /**
   * [#7642] Strip the hidden `__search` companion column from what a read
   * hands back, unless a SYSTEM caller named it in its projection.
   *
   * The column is declared client-invisible (`hidden` + `readonly` + `system`
   * + `searchable: false`) and the enforcement that exists is real: it is kept
   * out of auto-views, out of the `$search` auto-default, and a `$searchFields`
   * override naming it is refused with a 400 ("is hidden"). What was missing is
   * the PROJECTION half — a query that names no `fields` reaches the driver
   * with `ast.fields` undefined, every driver answers that with `SELECT *`, and
   * the companion rode back in every record body: list results, GET by id,
   * `/search` hits (which are `engine.find` rows verbatim) and the 201 create
   * body. The rule is applied HERE, at the engine, because the engine is the
   * PRODUCER those four surfaces share; fixing them one consumer at a time is
   * how three of the four would stay broken.
   *
   * Two carve-outs, both measured rather than defensive:
   *
   *  - **A system caller that asks for it by name keeps it.** The companion has
   *    exactly one such reader: `plugin-pinyin-search`'s backfill/reconcile
   *    walk, which projects `['id', ...sources, '__search']` under
   *    `{ isSystem: true }` and compares the stored blob against the recomputed
   *    one. Strip it unconditionally and that comparison reads `undefined`
   *    every pass — the backfill would rewrite every row of every object on
   *    every run, which is worse than the disclosure it was fixing.
   *  - **A non-system caller does NOT keep it, even by name.** `select` only
   *    gates on whether a field is KNOWN (`assertProjectionFieldsExist`), and
   *    the companion is known once provisioned — so `?select=__search` would
   *    otherwise be an open door straight through this strip, and a
   *    client-invisibility rule with a documented spelling that bypasses it is
   *    not one. `isSystem` is server-derived (never client input), the same
   *    trust the read-only strips on the write path already place in it.
   *
   * ## Why this door is SILENT where the `$searchFields` door returns a 400
   *
   * Asked on #7876 and ruled there on 2026-08-12 (direction C): the divergence
   * is intended, and it is not reopenable on symmetry alone. The two doors are
   * two KINDS of surface.
   *
   *  - `$searchFields` is AUTHORING input — it tells the server how to RUN the
   *    query. A value the server will not honour has to be said out loud, or
   *    the caller gets a WIDER answer than the one they narrowed to, in a
   *    response with nothing to distinguish it from a satisfied one. That is
   *    why `assertSearchFieldsAreSearchable` refuses the name with a 400
   *    (#4254) — the refusal is protecting the ROW SET.
   *  - `select` is a READ PROJECTION — it names what the caller would like
   *    back. Dropping a column the caller may not see leaves the answer
   *    correct: the rows are still the rows that were asked for, one key
   *    lighter. {@link omitInternalFields} directly above answers
   *    `?select=id,key` exactly this way, for exactly this reason (#7728), so
   *    silence here is the platform's existing read-path rule, not an
   *    exception to it.
   *
   * ⛔ Do not add a refusal here to make the two doors agree. That was option B
   * on #7876, weighed and declined: it turns a request that answers 200
   * today into a failure, for tidiness, on a spelling no non-system caller in
   * this tree uses — the companion's only deliberate reader is the backfill
   * carved out above. If a REAL caller is ever burned by the silent drop, that
   * measurement reopens it; the asymmetry by itself does not.
   *
   * ⚠️ `requestedFields` must be the CALLER's `fields`, captured before
   * `planFormulaProjection` — that pass rewrites the projection to every stored
   * column when a formula is in play, companion included.
   */
  private stripSearchCompanionFromRead(
    rows: unknown,
    requestedFields: readonly string[] | undefined,
    context: ExecutionContext | undefined,
  ): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`; it reads no member.
    stripSearchCompanionFromRead(rows, requestedFields, context);
  }

  /**
   * Driver options for a PRIVILEGED, driver-level read so it JOINS the open
   * ambient transaction instead of asking the pool for a second connection.
   *
   * The three privileged read verbs — {@link resolveSecret},
   * {@link resolveSecretField}, {@link resolveInternalField} — deliberately
   * read at DRIVER level, the only layer where the masked/omitted value still
   * exists. That bypasses hooks, field-level security and sharing by design;
   * what it must NOT bypass is the connection the surrounding transaction is
   * holding. {@link buildDriverOptions} threads the ambient handle onto every
   * ordinary read for that reason (ADR-0034); these three passed NO options at
   * all, so their read went to a FRESH pooled connection.
   *
   * On a roomy pool that is invisible — the pool simply hands out a second
   * connection. On a **single-connection pool it is a deadlock**: SQLite's knex
   * pool is `max: 1` (`driver-sqlite-wasm` and `driver-sql`/better-sqlite3
   * both), so the open transaction holds the one connection and the privileged
   * read waits for a connection that cannot be freed until the transaction
   * that is waiting on the read commits. Measured on the erasure path
   * (`runSubjectErasureAtomically` → better-auth `/admin/remove-user` →
   * `reattachInternalFieldsOnRead` → `resolveInternalField`): the read blocked
   * until knex's own acquire timeout fired ("Timeout acquiring a connection.
   * The pool is probably full", from `Transaction_Sqlite.acquireConnection`),
   * and the vendor route degraded that into an authentication refusal — a
   * signed-in caller answered `401` after ~120 s, on a route reachable without
   * credentials. Postgres/MySQL (`max >= 10`) never exhibited it.
   *
   * Reads only, and only the transaction: the same-origin gate (#5351) still
   * decides whether the handle is this object's driver's to use, so a
   * privileged read that resolves to a DIFFERENT datasource keeps its own
   * connection rather than executing on the wrong one. Returns `undefined`
   * when there is no ambient transaction, which is the pre-existing shape.
   */
  private privilegedReadDriverOptions(object: string): { transaction: unknown } | undefined {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readTxStore = () => this.txStore;
    const host: ThisParameterType<typeof privilegedReadDriverOptions> = {
      get txStore() { return readTxStore(); },
      transactionCoversDriverFor: (...a) => this.transactionCoversDriverFor(...a),
    };
    return privilegedReadDriverOptions.call(host, object);
  }

  /**
   * Dereference a stored secret ref back to its plaintext. Intended for
   * privileged, server-side consumers (e.g. a datasource connection-pool
   * binder) — NOT exposed through the generic read path, which only ever
   * returns the mask.
   *
   * Fail-closed: throws when no CryptoProvider is registered or the
   * `sys_secret` row is missing. Returns `null` when `ref` is not a secret ref.
   */
  async resolveSecret(ref: unknown, opts?: { tenantId?: string }): Promise<string | null> {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readCryptoProvider = () => this.cryptoProvider;
    const host: ThisParameterType<typeof resolveSecret> = {
      get cryptoProvider() { return readCryptoProvider(); },
      getDriver: (...a) => this.getDriver(...a),
      privilegedReadDriverOptions: (...a) => this.privilegedReadDriverOptions(...a),
    };
    return resolveSecret.call(host, ref, opts);
  }

  /**
   * Privileged: recover the plaintext of ONE row's `secret`-typed field.
   *
   * {@link resolveSecret} is documented for "privileged consumers … against the
   * stored ref", but until #7799 there was no supported way for such a consumer
   * to OBTAIN that ref: {@link maskSecretFields} replaces it with
   * {@link SECRET_MASK} on every `find`/`findOne`, unconditionally and after
   * hooks. A server-side reader that genuinely needs the value therefore had
   * two options, both bad — keep the credential in cleartext somewhere the read
   * path does not mask (which is the defect #7799 reports on
   * `sys_webhook.definition_json`), or reach around the engine into the driver
   * from a plugin. This method is the supported third option, and it is why the
   * webhook signing secret can now live in the encrypted channel at all.
   *
   * The row is read at DRIVER level on purpose — that is the only layer where
   * the ref still exists — which means it bypasses read hooks, field-level
   * security and sharing. That is the same trust `resolveSecret` already places
   * in its caller, and the reason both are spelled as explicit, separately-named
   * privileged verbs rather than an option on `find`: there is no query string
   * that reaches this, so it cannot be turned on from outside the process.
   *
   * Refuses any field that is not declared `type: 'secret'`. Without that guard
   * this would be a generic mask-bypass — in particular over a `password` field,
   * which is stored as PLAINTEXT at rest and is masked for exactly that reason
   * (ADR-0100). Only the encrypted channel is dereferenceable.
   *
   * Fail-closed like {@link resolveSecret}: throws when no CryptoProvider is
   * registered or the `sys_secret` row has gone missing. Returns `null` when the
   * row does not exist or the field holds no secret (never set, or cleared).
   */
  async resolveSecretField(
    object: string,
    recordId: string,
    field: string,
    opts?: { tenantId?: string },
  ): Promise<string | null> {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolveSecretField> = {
      get _registry() { return readRegistry(); },
      getDriver: (...a) => this.getDriver(...a),
      privilegedReadDriverOptions: (...a) => this.privilegedReadDriverOptions(...a),
      resolveSecret: (...a) => this.resolveSecret(...a),
    };
    return resolveSecretField.call(host, object, recordId, field, opts);
  }

  /**
   * Privileged: recover the stored values of ONE `internal: true` field for a
   * batch of rows, keyed by record id.
   *
   * [#8118] {@link omitInternalFields} deletes a flagged field from every row
   * the engine hands back — with NO system carve-out, by explicit design
   * (#7728): an escape hatch nobody needs is a hole in a non-exposure
   * guarantee. The same ruling names the shape a legitimate system reader uses
   * when one finally appears: it reads the column through a purpose-built
   * privileged accessor, the way {@link resolveSecret} does for `secret`. This
   * method is that accessor. Its first consumer is the outbound-HTTP
   * dispatcher's claim path (`SqlHttpOutbox.claim()` in
   * `@objectstack/service-messaging`): `sys_http_delivery.headers_json` — the
   * authored header map, the ordinary place an `Authorization: Bearer …` goes —
   * is flagged `internal` so the generic data API returns rows without it,
   * while the dispatcher must hand exactly that map to the wire VERBATIM (a
   * delivery that goes out missing a header is not self-announcing: against an
   * endpoint that does not require it, the delivery succeeds while silently
   * deviating from the authored configuration).
   *
   * Batch-shaped, deliberately, where {@link resolveSecretField} is
   * single-record: its consumer claims up to a full batch per dispatcher tick,
   * and #8118's triage rejected the `Field.secret()` route partly BECAUSE that
   * shape costs a driver read plus a decrypt per row per tick. One driver read
   * serves the whole claim batch; a single record is the batch of one. This is
   * the sibling of {@link resolveSecretField}'s pattern — guard first, then a
   * driver-level read — not a second divergent privileged-read path.
   *
   * The rows are read at DRIVER level on purpose — the only layer where the
   * value still exists — so this bypasses read hooks, field-level security and
   * sharing: the same trust {@link resolveSecret} and {@link resolveSecretField}
   * place in their callers, and the same reason all three are explicit,
   * separately-named privileged verbs rather than an option on `find`. No
   * query string reaches this, so it cannot be turned on from outside the
   * process.
   *
   * Refuses (ADR-0112 `code` + `status`) any field not declared
   * `internal: true` on the object. Without that guard this would be a generic
   * read-protection bypass — over `password` plaintext in particular, which is
   * masked deliberately (ADR-0100) — rather than the internal channel's
   * dereference. A `secret`-typed field is likewise refused unless it is also
   * flagged, and even then this returns the stored `secret:<id>` ref, never a
   * plaintext: decryption stays with {@link resolveSecretField}.
   *
   * Returns the stored value per id — `null` when the column is unset. An id
   * whose row does not exist is absent from the map; what a missing row means
   * belongs to the caller (for the dispatcher: a row deleted mid-claim). No
   * decrypt is involved: `internal` is a read-side omission flag, not an
   * encrypted channel — the at-rest story is the object's own (for
   * `sys_http_delivery`, 30d telemetry retention; encrypting the delivery row
   * was measured and rejected on #8118).
   */
  async resolveInternalField(
    object: string,
    recordIds: readonly string[],
    field: string,
  ): Promise<Map<string, unknown>> {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts` (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolveInternalField> = {
      get _registry() { return readRegistry(); },
      getDriver: (...a) => this.getDriver(...a),
      privilegedReadDriverOptions: (...a) => this.privilegedReadDriverOptions(...a),
    };
    return resolveInternalField.call(host, object, recordIds, field);
  }

  /**
   * Helper to get object definition
   */
  getSchema(objectName: string): ServiceObject | undefined {
    return this._registry.getObject(objectName);
  }

  /**
   * Resolve any object identifier to the physical storage name used by drivers.
   *
   * Accepts the canonical short name (e.g., 'account') or, for explicit
   * cross-package disambiguation, the canonical object name (e.g., 'account'). The result is
   * the physical table name derived via `StorageNameMapping.resolveTableName`.
   *
   * One name space with the data door: the target resolves ONLY through the
   * registry. A name the registry does not resolve is refused with the door's
   * own `OBJECT_NOT_FOUND` 404 (`objectNotFoundError`), never handed to the
   * driver as a raw table name. Before this, every in-process guard keyed by a
   * registered object name could be stepped around by naming the target some
   * other way, and an in-process caller (a sandboxed body, an action handler,
   * a hook) read what the door refused to serve.
   *
   * Platform code that must address storage without a registry entry has a
   * declared path a body cannot reach: the driver itself
   * (`datasource(name)`, `getDriverForObject(name)`), held by host code only.
   */
  private resolveObjectName(name: string): string {
    const schema = this._registry.getObject(name);
    if (schema) {
      return StorageNameMapping.resolveTableName(schema);
    }
    throw objectNotFoundError(name);
  }

  /**
   * [#20157] `IObjectQLEngine.judgeFilter`: judge whether `where` can run
   * against `objectName`, without running it (#19995 ruling C). The contract
   * docblock states the semantics; {@link judgeWhereAdmission} records the
   * pipeline and why it is the same one every verb runs.
   *
   * A registered name resolves exactly as the verbs resolve it, and the field
   * map is the one they read, so the verdict (and the object name inside its
   * message) is the one execution would give. It stops before `getDriver`:
   * nothing is resolved from or sent to a datasource.
   *
   * It judges the FILTER, not the object's existence. For a name the registry
   * does not resolve, the verbs refuse the object itself (`OBJECT_NOT_FOUND`,
   * before admission); this member still judges the filter there, with no
   * field map, as the contract states, because it reads nothing and hands the
   * name to no driver. That keeps the authoring-time judge (`os validate`,
   * whose engine holds only the stack's own objects) answering about the
   * filter for an object the platform or another package defines.
   */
  judgeFilter(
    objectName: string,
    where: EngineQueryOptions['where'],
    options?: EngineFilterJudgementOptions,
  ): EngineFilterJudgement {
    const object = this._registry.getObject(objectName) ? this.resolveObjectName(objectName) : objectName;
    return judgeWhereAdmission(
      object,
      options?.operation ?? 'find',
      where,
      this._registry.getObject(object),
      options?.context,
      this.relatedSchemaOf,
    );
  }

  /**
   * Name of the dedicated datasource lifecycle-classed system data prefers
   * when one is registered (ADR-0057 §3.6 / P3). Purely opt-in by the
   * datasource's existence — no `telemetry` driver registered ⇒ resolution
   * is exactly what it was before.
   */
  static readonly LIFECYCLE_DATASOURCE = 'telemetry';

  /**
   * The lifecycle classes that make an object an APPEND-ONLY SYSTEM LEDGER —
   * the audit trail, telemetry, and the event log (ADR-0057 §3.6).
   *
   * One constant, read by both places that must agree (#5351):
   *
   * 1. {@link getDriver} step 3 — which objects lifecycle-class separation
   *    routes to the dedicated datasource;
   * 2. {@link enforceTransactionOrigin} — which cross-datasource writes are
   *    CARVED OUT of an ambient transaction instead of refused.
   *
   * Two hand-written copies of this tuple would drift by one class and produce
   * the worst outcome available: an object routed away by rule 1 and refused by
   * rule 2 loses exactly the compliance row this whole change exists to save.
   *
   * `transient` is deliberately absent, matching step 3: those objects stay on
   * the primary, so they never reach the gate at all.
   */
  static readonly SYSTEM_LEDGER_LIFECYCLE_CLASSES: ReadonlySet<string> = new Set([
    'audit',
    'telemetry',
    'event',
  ]);

  /**
   * Is `objectName` an append-only system ledger? — the #5351 carve-out's
   * discriminator, and deliberately a property of the object's DECLARATION
   * (`lifecycle.class`) rather than of the deployment's routing.
   *
   * Why the declaration and not "was it routed by step 3": an audit ledger
   * pinned to its own datasource by an explicit `datasource:` binding, or by a
   * `datasourceMapping` rule, is the same append-only compliance ledger with
   * the same reason to be carved out — the routing mechanism is an operator's
   * choice, the class is the author's statement about what the data IS. Judging
   * by the mechanism would make the carve-out depend on which of three
   * equivalent configurations a deployment happened to use.
   */
  private isSystemLedgerObject(objectName: string): boolean {
    const lifecycleClass = (
      this._registry.getObject(objectName) as { lifecycle?: { class?: string } } | undefined
    )?.lifecycle?.class;
    return lifecycleClass !== undefined && ObjectQL.SYSTEM_LEDGER_LIFECYCLE_CLASSES.has(lifecycleClass);
  }

  /**
   * Helper to get the target driver
   *
   * Resolution priority (first match wins):
   * 1. Object's explicit `datasource` field (if not 'default')
   * 2. DatasourceMapping rules (namespace/package/pattern matching)
   * 3. Lifecycle-class separation (ADR-0057 §3.6): telemetry/event/audit
   *    objects route to the dedicated 'telemetry' datasource when registered
   * 4. Package's `defaultDatasource` from manifest
   * 5. Global default driver
   *
   * The order itself lives in {@link resolveDatasourceBinding} — this method
   * turns the name it decides on into a driver, and diagnoses the cases where
   * that driver is missing.
   */
  private getDriver(objectName: string): IDataDriver {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts` (see `DatasourceRoutingHost`).
    const readDrivers = () => this.drivers;
    const readLogger = () => this.logger;
    const readUnavailableDatasources = () => this.unavailableDatasources;
    const host: ThisParameterType<typeof getDriver> = {
      resolveDatasourceBinding: (...a) => this.resolveDatasourceBinding(...a),
      get drivers() { return readDrivers(); },
      get logger() { return readLogger(); },
      get unavailableDatasources() { return readUnavailableDatasources(); },
    };
    return getDriver.call(host, objectName);
  }

  /**
   * WHERE does `objectName`'s data live, and WHICH step decided — the single
   * implementation of the resolution order documented on {@link getDriver}.
   *
   * Split out for #5288 so the order exists exactly once. It had two readers
   * with two different answers: `getDriver` (all five steps) and every caller
   * that only needed the NAME, which read `object.datasource` — step 1 of five.
   * A second, shorter copy of a routing order is the failure
   * `resolveMappedDatasource` (#4462) was extracted to prevent, and it fails the
   * same way: silently, in whichever direction the copy is short.
   *
   * Steps 1-2 answer even when the named datasource has no registered driver:
   * they are BINDINGS, and `getDriver` stops there (it throws rather than
   * falling through — #4462). Steps 3-5 answer only when their driver is
   * registered, because that registration is what turns each of them on.
   *
   * `undefined` means nothing routes the object anywhere: no binding, and no
   * global default driver to fall back to.
   */
  private resolveDatasourceBinding(objectName: string): {
    datasource: string;
    via: 'explicit' | 'mapping' | 'lifecycle' | 'package' | 'default';
    /** Owning package, on `via: 'package'` only — for the debug line. */
    packageId?: string;
  } | undefined {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    const read_registry = () => this._registry;
    const readDefaultDriver = () => this.defaultDriver;
    const readDrivers = () => this.drivers;
    const readManifests = () => this.manifests;
    const host: ThisParameterType<typeof resolveDatasourceBinding> = {
      get _registry() { return read_registry(); },
      get defaultDriver() { return readDefaultDriver(); },
      get drivers() { return readDrivers(); },
      get manifests() { return readManifests(); },
      resolveDatasourceFromMapping: (...a) => this.resolveDatasourceFromMapping(...a),
    };
    return resolveDatasourceBinding.call(host, objectName);
  }

  /**
   * Which datasource is `objectName` BOUND to? — the effective one, resolved
   * through the same five steps {@link getDriver} routes by, computed as a NAME
   * and without taking a driver.
   *
   * The public face of {@link resolveDatasourceBinding}, added for #5288, and
   * the same argument as {@link resolveMappedDatasource} (#4462): a caller that
   * only needs to NAME the datasource used to read `object.datasource` and stop
   * there. That is step 1 of five, and `ObjectSchema.datasource` carries
   * `.default('default')` — so an object routed by a `datasourceMapping` rule,
   * by the ADR-0057 §3.6 lifecycle split, or by its package's
   * `defaultDatasource` answered `'default'`, which in this engine means "no
   * explicit binding, keep looking", never "the primary DB". A diagnostic built
   * on that answer names a database the rows are not in.
   *
   * Returns `undefined` when nothing binds the object anywhere and it simply
   * rides the deployment's default driver (step 5), which is deliberate on two
   * counts. The default driver keeps its NATURAL name (#3826 —
   * `drivers.has('default')` is false by construction), so that name identifies
   * a driver, not a datasource anyone bound this object to; and "rides the
   * default" is what the consumers of this answer already document as
   * `undefined`. Callers that need the default driver's name have
   * {@link getDefaultDriverName}.
   *
   * Never throws. A binding whose datasource has no registered driver is still
   * this object's datasource — the deployment is broken, `getDriver` says so
   * loudly, and a naming probe must be able to report the name that is broken.
   */
  resolveEffectiveDatasource(objectName: string): string | undefined {
    const binding = this.resolveDatasourceBinding(objectName);
    return binding && binding.via !== 'default' ? binding.datasource : undefined;
  }

  /**
   * Which datasource do the mapping rules route `objectName` to, if any?
   *
   * The PUBLIC face of {@link resolveDatasourceFromMapping}, added for the boot
   * path (#4462): the datasource-connection service must connect the
   * datasources a mapping actually routes objects to, and it must learn which
   * those are from the same resolver the query path uses. A second
   * implementation of "does this rule match?" living in the connection service
   * would drift by one clause and produce the worst of both postures — a
   * datasource connected that routing does not use, or routed to and never
   * connected, which is the defect itself.
   *
   * Returns `null` when no rule matches, and the datasource name (including
   * `'default'`) when one does. Rule matching only — an explicit
   * `object.datasource` binding outranks this and is not consulted here.
   */
  resolveMappedDatasource(objectName: string): string | null {
    return this.resolveDatasourceFromMapping(objectName, this._registry.getObject(objectName));
  }

  /**
   * Resolve datasource from mapping rules
   *
   * Rules are evaluated in order (or by priority if specified).
   * First matching rule wins.
   */
  private resolveDatasourceFromMapping(
    objectName: string,
    object?: any
  ): string | null {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts` (see `DatasourceRoutingHost`).
    const readDatasourceMapping = () => this.datasourceMapping;
    const host: ThisParameterType<typeof resolveDatasourceFromMapping> = {
      get datasourceMapping() { return readDatasourceMapping(); },
      matchPattern: (...a) => this.matchPattern(...a),
    };
    return resolveDatasourceFromMapping.call(host, objectName, object);
  }

  /**
   * Simple glob pattern matching
   * Supports * (any chars) and ? (single char)
   */
  private matchPattern(objectName: string, pattern: string): boolean {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts`; it reads no member.
    return matchPattern(objectName, pattern);
  }

  /**
   * Set datasource mapping rules
   * Called by ObjectQLPlugin during bootstrap
   */
  setDatasourceMapping(rules: Array<{
    namespace?: string;
    package?: string;
    objectPattern?: string;
    default?: boolean;
    datasource: string;
    priority?: number;
  }>) {
    this.datasourceMapping = rules;
    this.logger.info('Datasource mapping rules configured', {
      ruleCount: rules.length
    });
  }

  /**
   * Initialize the engine and all registered drivers.
   *
   * **Fail-fast by default** (framework#3741): if any boot-registered driver's
   * `connect()` rejects, this throws {@link DriverConnectError} and kernel
   * bootstrap aborts. Two reasons, both load-bearing:
   *
   *  1. Booting without a reachable datasource produces a server that reports
   *     itself started and then 500s every request with an error that reads
   *     nothing like "the database is unreachable". The caller immediately
   *     makes it worse: `ObjectQLPlugin.start()` runs `syncRegisteredSchemas()`
   *     right after this, issuing DDL against a driver that isn't there — so
   *     the boot leaves the schema half-applied even if the database appears
   *     a second later. Recovery is not the point: the underlying clients DO
   *     re-establish connections on their own (framework#3759 verified this),
   *     but nothing re-runs the boot sequence that was skipped.
   *  2. Swallowing the rejection removed a driver's ability to REFUSE STARTUP.
   *     Any fatal startup check — licence, server version, incompatible
   *     configuration, missing capability, not just an unreachable socket — is
   *     expressed by throwing from `connect()`, and every one of them used to
   *     be silently downgraded to a runtime error. (That is why
   *     driver-mongodb's multi-tenancy guard had to be hoisted into its
   *     constructor in #3734; `connect()` is a supported place for it now.)
   *
   * Operators who need the old lenient behaviour opt in explicitly with
   * `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`, which boots in a state that is warned
   * about loudly rather than assumed.
   */
  async init() {
    this.logger.info('Initializing ObjectQL engine', {
      driverCount: this.drivers.size,
      drivers: Array.from(this.drivers.keys())
    });

    const failures: DriverConnectFailure[] = [];
    for (const [name, driver] of this.drivers) {
      try {
        await driver.connect();
        this.logger.info('Driver connected successfully', { driverName: name });
      } catch (e) {
        failures.push({ driverName: name, error: e });
        this.logger.error('Failed to connect driver', e as Error, { driverName: name });
      }
    }

    if (failures.length > 0) {
      if (!resolveAllowDriverConnectFailure()) {
        throw new DriverConnectError(failures, this.drivers.size);
      }
      const failedDrivers = failures.map(f => f.driverName);
      const banner =
        `⚠️ DEGRADED BOOT: ${failures.length} of ${this.drivers.size} driver(s) failed to connect ` +
        `(${failedDrivers.join(', ')}), but OS_ALLOW_DRIVER_CONNECT_FAILURE is set — starting anyway. ` +
        `Every query routed to them fails until the datasource becomes reachable, and the boot-time ` +
        `schema sync is SKIPPED FOR GOOD — the client will reconnect on its own, but nothing re-runs ` +
        `the DDL, so those objects may have no tables even after the database comes back. Unset ` +
        `OS_ALLOW_DRIVER_CONNECT_FAILURE to restore fail-fast boot.`;
      this.logger.warn(banner, { failedDrivers });
      // …and again on a channel the operator's log level cannot filter away: the
      // line above is dropped outright at `error`/`fatal`/`silent`, which is a
      // normal production setting and precisely where this flag gets used. See
      // the helper's note — the duplication is deliberate, and it is NOT about
      // `os serve`'s boot-quiet window (that swallowed it too until #4012).
      emitDegradedBootBanner(banner);
    }

    this.logger.info('ObjectQL engine initialization complete');
  }

  /**
   * Ping every registered driver and report which ones are usable RIGHT NOW
   * (framework#3756).
   *
   * `init()` answers "could the drivers connect at boot"; this answers "can
   * they serve a query at this instant", which is a different question the
   * moment the database restarts, fails over, or drops the pool. Readiness
   * probes are the intended caller — a replica whose driver is down fails 100%
   * of its requests and must leave the load-balancer rotation.
   *
   * Every check is bounded by `timeoutMs` (default 2s) and settled
   * independently. The bound is not optional: `IDataDriver.checkHealth()`
   * swallows its own errors and returns `false`, but on a dead pool it does
   * not return at all — knex's `SELECT 1` waits out `acquireConnectionTimeout`
   * (60s by default). A probe that hangs is as useless as one that lies, so a
   * timed-out driver is reported unhealthy rather than awaited.
   *
   * A driver that implements no `checkHealth()` is reported healthy: absence of
   * a probe is not evidence of failure, and reporting "unhealthy" would take a
   * working deployment out of rotation over a driver that simply never had the
   * optional method.
   */
  async checkDriversHealth(opts?: { timeoutMs?: number }): Promise<DriverHealth[]> {
    // [#25522 cut 3] The body moved to `engine-lifecycle-health.ts` (see `LifecycleHealthHost`).
    const readDrivers = () => this.drivers;
    const host: ThisParameterType<typeof checkDriversHealth> = {
      get drivers() { return readDrivers(); },
    };
    return checkDriversHealth.call(host, opts);
  }

  /**
   * WHICH datasource is this deployment's PRIMARY one — the single
   * implementation of the criterion ruled on #13408 (2026-08-31, 第 6 场总监席
   * 决裁批 #12, maintainer verbatim 「同意」).
   *
   * The ruling's words, quoted rather than paraphrased because the constraint
   * is on the *kind* of answer, not only the answer:
   *
   * > 「主/默认」判据必须是一条读得出来的事实:定义为「承载平台系统对象(sys_*)的
   * > 那个数据源」或等价的可机读事实,⛔ 不得用「第一个注册的」之类启发式。
   *
   * So the fact read here is: **where do this deployment's platform system
   * objects actually live**, answered through {@link resolveDatasourceBinding}
   * — the same five-step order every query routes by. Not registration order,
   * not `getDefaultDriverName()` on its own. `getDefaultDriverName()` names the
   * driver flagged default at registration, which is a *configuration* input to
   * step 5, not evidence about where anything is stored; a deployment that
   * routes `sys_*` elsewhere by an explicit binding or a `datasourceMapping`
   * rule would make that answer confidently wrong, and wrong in the direction
   * that keeps a dead replica in rotation.
   *
   * ## Who votes
   *
   * The curated `PLATFORM_PROVIDED_OBJECT_NAMES` registry (`@objectstack/spec`)
   * intersected with what this registry actually holds — a name no package
   * registered here says nothing about this deployment, and asking
   * `resolveDatasourceBinding` about it would produce a step-5 answer read off
   * an object that does not exist.
   *
   * **Minus the ADR-0057 §3.6 system ledgers** ({@link isSystemLedgerObject} —
   * `audit` / `telemetry` / `event`), which are *deliberately* routed off the
   * primary when a `telemetry` datasource is registered. They are excluded
   * because including them would report `system-objects-split` for every
   * deployment that adopted lifecycle separation — a permanent drain-always
   * verdict for a configuration the platform recommends. `transient` is
   * deliberately NOT excluded, matching step 3: those objects stay on the
   * primary, so they are evidence about it.
   *
   * ## What it refuses to answer
   *
   * Disagreement, silence and a name with no driver behind it all return
   * `resolved: false`. That is the ruling's 「错向红」 requirement:
   *
   * > 判据解析失败或歧义时 ⇒ fail toward draining(宁可误摘不可静默保留)
   *
   * ⛔ The direction lives in the CALLER, because only the caller can drain —
   * this method's contract is that it never invents a name, and a caller that
   * treats `resolved: false` as "no primary is unhealthy" inverts the ruling.
   * The readiness caller's pins are in
   * `packages/runtime/src/http-dispatcher.ready.test.ts`.
   *
   * Never throws for a routing reason: every failure is a verdict. (A registry
   * that throws is not modelled here — that is a broken kernel, and the
   * readiness caller catches it into the same drain direction.)
   */
  resolvePrimaryDatasource(): PrimaryDatasourceVerdict {
    // [#25522 cut 3] The body moved to `engine-lifecycle-health.ts` (see `LifecycleHealthHost`).
    const readRegistry = () => this._registry;
    const readDrivers = () => this.drivers;
    const host: ThisParameterType<typeof resolvePrimaryDatasource> = {
      get _registry() { return readRegistry(); },
      isSystemLedgerObject: (...a) => this.isSystemLedgerObject(...a),
      resolveDatasourceBinding: (...a) => this.resolveDatasourceBinding(...a),
      get drivers() { return readDrivers(); },
    };
    return resolvePrimaryDatasource.call(host);
  }

  /**
   * Does this object declare a media field at all? Cached per schema object —
   * the registry hands back the same instance per object, so this scans a
   * field map once rather than on every write.
   */
  private objectHasMediaField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.mediaFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.values(objectSchema.fields).some(
      (def: any) => def && FILE_REFERENCE_TYPES.has(def.type),
    );
    ObjectQL.mediaFieldPresence.set(objectSchema, present);
    return present;
  }
  private static readonly mediaFieldPresence = new WeakMap<object, boolean>();

  /**
   * The media value-shape verdict for a write against `objectSchema`.
   *
   * Dormant by design, mirroring the storage module's own rule: an object with
   * no file-class field can hold no malformed media value, so it must not pay
   * even one query to learn that. Only objects that actually declare media
   * consult the deployment flag — and that read is itself memoized, so the
   * whole mechanism costs one query per process, and zero for an app that
   * stores no files.
   */
  private async mediaValueShapeStrictFor(objectSchema: any): Promise<boolean> {
    if (!this.objectHasMediaField(objectSchema)) return false;
    return this.isFileReferencesMigrationVerified();
  }

  /**
   * Does this object declare a reference or structured-JSON field that a write
   * would actually check? Same per-schema cache and same dormancy rule as
   * {@link objectHasMediaField}: an object holding none can hold no violation
   * of them, so it must not pay a query to learn that.
   *
   * The membership test is `isScannableValueShapeField` — the validator's own
   * — and not raw type membership, because the registry INJECTS covered-type
   * fields into every object it registers: `organization_id` and `owner_id`
   * (both `system`), plus `created_by` / `updated_by` (both in `SKIP_FIELDS`),
   * are all `lookup`s. A caller never writes any of them, so counting them made
   * this answer `true` for literally every object — the dormancy rule above
   * never fired, and this cache memoized a constant. Same predicate as the
   * scanner for the same reason the scanner imports it: three readings of "a
   * covered field" drifting by one clause is how a gate ends up governing
   * fields nothing enforces.
   *
   * [#21663] The three that are `readonly` (`organization_id`, `created_by`,
   * `updated_by`) DO reach the value-shape check now, on the value a system
   * writer, hook or stamp stores. They still do not count here, so an object
   * whose only covered fields are those stays warn-first for them: a malformed
   * value is admitted, logged and reported, never stored silently. See
   * `isScannableValueShapeField` for why widening this test is not the fix.
   */
  private objectHasCoveredValueField(objectSchema: any): boolean {
    if (!objectSchema?.fields) return false;
    const cached = ObjectQL.coveredValueFieldPresence.get(objectSchema);
    if (cached !== undefined) return cached;
    const present = Object.entries(objectSchema.fields).some(
      ([name, def]: [string, any]) => isScannableValueShapeField(name, def),
    );
    ObjectQL.coveredValueFieldPresence.set(objectSchema, present);
    return present;
  }
  private static readonly coveredValueFieldPresence = new WeakMap<object, boolean>();

  /** The reference / structured-JSON value-shape verdict for a write. */
  private async valueShapeStrictFor(objectSchema: any): Promise<boolean> {
    if (!this.objectHasCoveredValueField(objectSchema)) return false;
    return this.isValueShapesMigrationVerified();
  }

  /**
   * Has this deployment completed AND verified the ADR-0104 file-as-reference
   * migration (#3617)? Read once per process from the `sys_migration` flag.
   *
   * Every way of not knowing answers `false` — no storage service (so no
   * `sys_migration` object registered), no row, an unreadable table, a
   * malformed row. Enforcement derives from evidence, and absent evidence is
   * not permission. Here "no" means media value shapes keep warning instead
   * of rejecting, so a deployment that cannot be asked keeps writing.
   *
   * Public because the flag's other in-process consumer reads it through this
   * same memoized seam: the storage service's release path (#3459 PR-5b) asks
   * it whether a released field file may be tombstoned, duck-typed as an
   * optional method so a fake or an older engine reads as "not verified".
   * One read, one invalidation (`invalidateDataMigrationFlags`), no way for
   * the two consumers to see different answers.
   *
   * Costs nothing on a kernel without the storage objects: the registry lookup
   * short-circuits before any query.
   */
  async isFileReferencesMigrationVerified(): Promise<boolean> {
    return (await this.readFileReferencesFlagRow()).verified;
  }

  /**
   * [ADR-0131 D1] Hand a freshly-registered driver the question "is this
   * database certified", the same closure-not-value seam as
   * {@link supplyFileColumnsMovedResolver} and for the same reason: the answer
   * is a `sys_migration` row on a store this driver has not connected to yet.
   * A SQL driver asks it only when a table carries an index an earlier release
   * built with the NULL-safe `COALESCE(<tenant>, …)` key part, to decide
   * whether that index already is the plain key new DDL emits. A driver with
   * no such seam is left alone.
   */
  private supplyTenantKeyCertifiedResolver(driver: IDataDriver): void {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof supplyTenantKeyCertifiedResolver> = {
      isOrganizationOwnershipCertified: (...a) => this.isOrganizationOwnershipCertified(...a),
      get logger() { return readLogger(); },
    };
    return supplyTenantKeyCertifiedResolver.call(host, driver);
  }

  /**
   * [ADR-0131 D1] Is this database certified for the organization-ownership
   * shape — a verified `sys_migration` row for the ceremony's id (the birth
   * marker a store created from empty receives, or the ceremony's completion
   * marker) at this release's shape generation or above? The same reading the
   * runtime's boot guard boots on. No ledger object, no ledger table yet, no
   * row, or an unverified or older row answers `false`. Any other read failure
   * is thrown: "I could not check" is not "not certified", and the driver
   * asking reports it (`SqlDriver.isTenantKeyCertified`).
   */
  async isOrganizationOwnershipCertified(): Promise<boolean> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof isOrganizationOwnershipCertified> = {
      get _registry() { return readRegistry(); },
      findOne: (...a) => this.findOne(...a),
    };
    return isOrganizationOwnershipCertified.call(host);
  }

  /**
   * The one memoized read both file-flag questions come off (#15989).
   *
   * Written once so the two public readers cannot drift apart in the ARGUMENTS
   * they pass — the slot and the migration id decide which row is read, and a
   * second copy of them is a second way to read a different row.
   */
  private readFileReferencesFlagRow(): Promise<MigrationFlagRead> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const host: ThisParameterType<typeof readFileReferencesFlagRow> = {
      readMigrationFlagRowMemoized: (...a) => this.readMigrationFlagRowMemoized(...a),
    };
    return readFileReferencesFlagRow.call(host);
  }

  /**
   * Have this deployment's file-family COLUMNS moved to the bare-id encoding
   * (#15989 — sequencing step 2 of ADR-0104's 2026-09-05 addendum)?
   *
   * The kernel-side half of the arm a SQL driver writes on. The driver cannot
   * ask this itself: the fact lives in a `sys_migration` row, which is a row
   * in a table the driver is the one serving, and reading it needs the
   * registry and the read pipeline this engine owns. So the engine answers,
   * and {@link registerDriver} hands each driver a closure over this method —
   * that is the whole kernel→driver supply seam.
   *
   * ## Every way of not knowing answers "not moved"
   *
   * No `sys_migration` object registered, no row, an unreadable table, a row
   * whose `columns_moved_at` is null or empty, a row that is not verified —
   * all `false`, which is today's JSON encoding on every deployment that
   * exists. That direction is not a preference: a driver that guessed "moved"
   * would write bare ids into a JSON column, which is the one failure this
   * whole mechanism is shaped to prevent. ⛔ It is also why the answer is NOT
   * the `adr-0104-file-references` flag alone — every creation-attested store
   * since 17.0 carries that flag AND JSON-quoted ids.
   *
   * Shares one memo slot, and therefore one read, with
   * {@link isFileReferencesMigrationVerified}: they are two questions about
   * one row. `invalidateDataMigrationFlags()` drops both.
   */
  async haveFileColumnsMoved(): Promise<boolean> {
    return (await this.readFileReferencesFlagRow()).columnsMoved;
  }

  /**
   * Has this deployment completed AND verified the ADR-0104 non-media
   * value-shape scan (`os migrate value-shapes`, #3438)? Same memoized seam and
   * same fail-lenient posture as the file flag above — and a SEPARATE flag,
   * because it attests a different fact. The file migration says file values
   * were converted and reconciled; it says nothing about whether a `lookup` id
   * or a `location` payload is well formed, so it may not vouch for these
   * classes.
   */
  async isValueShapesMigrationVerified(): Promise<boolean> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const host: ThisParameterType<typeof isValueShapesMigrationVerified> = {
      readMigrationFlagMemoized: (...a) => this.readMigrationFlagMemoized(...a),
    };
    return isValueShapesMigrationVerified.call(host);
  }

  /**
   * The memoized seam both public flag readers share — and the place where
   * "read once per process" is kept from meaning "answer from a read that
   * never happened" (#4769).
   *
   * The two negatives this read can produce are NOT the same fact:
   *
   *  - **Conclusive.** The ledger was reachable and it does not authorise the
   *    gate (no row, `verified_at` null, blocking findings). Evidence was
   *    consulted; memoize it. A later in-process migration run announces
   *    itself through {@link invalidateDataMigrationFlags}.
   *  - **Inconclusive.** The ledger could not be ASKED — `sys_migration` is
   *    not registered yet, or the query threw. Both still answer `false` (an
   *    unaskable gate stays closed), but freezing that for the life of the
   *    process turns one unlucky early write into a whole boot's posture. It
   *    is exactly how one boot ends up lax over data the next boot rejects:
   *    the platform objects register during kernel init while the very first
   *    write can land before them, so the answer cached is about a moment
   *    when nothing could have answered at all.
   *
   * So an inconclusive read is answered but not kept. The retry costs one
   * registry lookup per write until the ledger exists (it short-circuits
   * before any query), and stops the moment a real read succeeds.
   */
  private async readMigrationFlagMemoized(
    slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified',
    migrationId: string,
    verifiedLog: string,
  ): Promise<boolean> {
    return (await this.readMigrationFlagRowMemoized(slot, migrationId, verifiedLog)).verified;
  }

  /**
   * The same memoized read, handed back WHOLE (#15989).
   *
   * The row carries two facts a consumer can want — is the migration verified,
   * and have the columns moved — and they must come from one read: two reads
   * can straddle a `--apply` and answer out of one another's date, which for
   * these two facts means "verified, columns not moved" (the JSON arm) and
   * "not verified, columns moved" (an unreachable state) both become
   * observable. {@link readMigrationFlagMemoized} is this function projected
   * onto its first field, so the two can never disagree.
   */
  private async readMigrationFlagRowMemoized(
    slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified',
    migrationId: string,
    verifiedLog: string,
  ): Promise<MigrationFlagRead> {
    const cached = this[slot];
    if (cached) return await cached;
    const pending = this.readMigrationFlagVerified(migrationId, verifiedLog);
    this[slot] = pending;
    const result = await pending;
    // Only a read that actually consulted the ledger may be remembered. Clear
    // by identity so a concurrent `invalidateDataMigrationFlags()` (or a
    // re-read that already replaced this slot) is not undone here.
    if (!result.conclusive && this[slot] === pending) this[slot] = null;
    return result;
  }

  /**
   * Read one deployment migration flag and answer whether it authorises its
   * consumers. Shared by both flags so the "every way of not knowing answers
   * false" rule is written once: no `sys_migration` object registered, no row,
   * an unreadable table, a malformed row — all `false`. Enforcement derives
   * from evidence, and absent evidence is not permission.
   *
   * `conclusive` says whether the ledger was actually consulted, so the caller
   * can tell "asked, and the answer is no" from "could not ask" — see
   * {@link readMigrationFlagMemoized}. It never changes the verdict, only
   * whether that verdict is worth remembering.
   *
   * Costs nothing on a kernel without the platform objects: the registry
   * lookup short-circuits before any query.
   */
  private async readMigrationFlagVerified(
    migrationId: string,
    verifiedLog?: string,
  ): Promise<MigrationFlagRead> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof readMigrationFlagVerified> = {
      get _registry() { return readRegistry(); },
      findOne: (...a) => this.findOne(...a),
      get logger() { return readLogger(); },
    };
    return readMigrationFlagVerified.call(host, migrationId, verifiedLog);
  }

  // ────────────────────────────────────────────────────────────────────
  // The counterexamples this boot has written (ADR-0104 / #4769)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every ADR-0104 value-shape violation this process has ADMITTED, tallied
   * per migration id — the evidence that stops a boot certifying a contract it
   * has itself broken.
   *
   * ## The invariant this exists to keep
   *
   * A boot may not prove a contract it violates in that same boot. The
   * fresh-datastore attestation used to do exactly that: a store created from
   * empty was recorded as `verified` because emptiness settles both ADR-0104
   * facts — and then the very same boot seeded rows whose values contradict
   * them. The certificate was true at the instant it was written and false a
   * second later, so the FIRST boot ran warn-first over data it stored and
   * every LATER boot read the certificate, enforced, and rejected the data its
   * own predecessor had written. Nothing changed but a restart.
   *
   * ## Why the write path is the right witness
   *
   * Certifying a deployment clean needs a complete scan; showing it is NOT
   * clean needs one counterexample. The write path already computes that
   * counterexample with the exact predicate strict mode would use, so this
   * tally is free, exact, and impossible to drift from enforcement — the three
   * properties a second scan implementation would have had to earn.
   *
   * Keyed by migration id (not by field class) so the one place that maps a
   * value class to the flag that gates it stays here, beside the gates
   * themselves. A consumer asks about `adr-0104-file-references` and gets an
   * answer about `adr-0104-file-references`.
   */
  valueShapeViolationsAdmitted(): Record<string, AdmittedValueShapeViolationTally> {
    const out: Record<string, AdmittedValueShapeViolationTally> = {};
    for (const [migrationId, tally] of this.admittedValueShapeViolations) {
      out[migrationId] = { count: tally.count, first: { ...tally.first } };
    }
    return out;
  }

  /** Per-migration tally of admitted violations; see the accessor above. */
  private readonly admittedValueShapeViolations = new Map<string, AdmittedValueShapeViolationTally>();
  /** Ids whose creation attestation this process has already torn up. */
  private readonly retractedCreationAttestations = new Set<string>();
  /** Serializes retraction writes so concurrent violations issue one update. */
  private creationAttestationRetraction: Promise<void> = Promise.resolve();
  /**
   * Ids whose deviation marker this process has already written (#4797).
   * Reset by {@link invalidateDataMigrationFlags}, which is what a host calls
   * after running a migration in-process — a re-earned certificate opens a
   * fresh witness window, and without the reset the next admitted value in the
   * same process would be silently unrecorded.
   */
  private readonly recordedDeviations = new Set<string>();
  /** Serializes deviation writes so concurrent violations issue one update. */
  private deviationRecording: Promise<void> = Promise.resolve();

  /**
   * The sink `validateRecord` reports admitted violations to. Built per write
   * (one closure per call, not per row) so the tally can name the object.
   */
  private admittedViolationSink(object: string): AdmittedValueShapeViolationSink {
    return (violation) => this.noteAdmittedValueShapeViolation(object, violation);
  }

  private noteAdmittedValueShapeViolation(object: string, violation: AdmittedValueShapeViolation): void {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readAdmittedValueShapeViolations = () => this.admittedValueShapeViolations;
    const host: ThisParameterType<typeof noteAdmittedValueShapeViolation> = {
      get admittedValueShapeViolations() { return readAdmittedValueShapeViolations(); },
      recordObservedDeviation: (...a) => this.recordObservedDeviation(...a),
      retractCreationAttestation: (...a) => this.retractCreationAttestation(...a),
    };
    return noteAdmittedValueShapeViolation.call(host, object, violation);
  }

  /**
   * Record that this deployment has ADMITTED a value its own verified contract
   * rejects (#4797) — without touching `verified_at`.
   *
   * ## The window
   *
   * Once a certificate holds, the write path is strict and a non-conforming
   * value cannot land, so the certificate cannot go stale on its own. The
   * operator escape hatches are the exception, and they exist *precisely* to
   * relax a deployment that has already verified: with
   * `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES` on, the value is
   * admitted and persisted while `sys_migration` still reads `verified_at`
   * non-null, `blocking: 0`. Turn the switch off — or let any other process or
   * machine run without it — and strict returns to reject the very data this
   * deployment stored. Meanwhile the `adr-0104-file-references` gate, which
   * also governs reclamation of released field files, keeps deleting bytes on
   * the strength of a certificate that is now false.
   *
   * ## Why a marker rather than a revocation
   *
   * {@link retractCreationAttestation} clears `verified_at`, and is right to:
   * its target is a certificate issued on the inference "created empty, so
   * clean", which a single counterexample fully disproves. A certificate
   * earned by `os migrate … --apply` is a walk of the whole store, and one
   * admitted write is not evidence of that order — overturning it would make a
   * deliberately temporary switch into a one-way door, forcing a full
   * re-migration on anyone who used the escape hatch once.
   *
   * So the authority is withdrawn in proportion to reversibility. The marker
   * leaves every recoverable behaviour running (strict enforcement once the
   * switch is off, tombstoning, throttling — a rejected write is retried, a
   * tombstone is lifted on re-attach) and stops only what cannot be undone:
   * `authorisesIrreversibleAction` is false while it stands, so the reap
   * guard's byte delete refuses. A real apply-mode run clears it.
   *
   * ## Cost
   *
   * At most one ledger read+update per migration id per process, never awaited
   * by the write that triggered it, and skipped entirely once the marker is
   * standing. A lax write is therefore not a ledger round-trip; the FIRST lax
   * write of each class is, and only while the row is still verified.
   *
   * Deliberately never inserts. No row means nothing was certified, so there
   * is no authority to withdraw — and inserting one would fabricate a run that
   * never happened.
   */
  private recordObservedDeviation(migrationId: string): void {
    if (this.recordedDeviations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    this.recordedDeviations.add(migrationId);
    this.deviationRecording = this.deviationRecording
      .then(async () => {
        // [#20648] Same single-row route as `readMigrationFlagVerified`.
        const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          context: { isSystem: true } as ExecutionContext,
        });
        if (!row || row.id !== migrationId) return; // nothing certified — no authority to withdraw
        if (row.deviation_observed_at != null && String(row.deviation_observed_at) !== '') return; // already standing
        // Only a row that currently authorises something can have authority
        // withdrawn. An unverified row already denies both halves, so marking
        // it would add a diagnostic nobody gates on — and the next apply run
        // would clear it before anything read it.
        const verified = isDataMigrationFlagVerified({
          id: migrationId,
          last_run_at: String(row.last_run_at ?? ''),
          verified_at: row.verified_at == null ? null : String(row.verified_at),
          blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
        });
        if (!verified) return;
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            deviation_observed_at: now,
            deviation_detail: JSON.stringify({
              observed: 'lax-admitted-violating-value',
              ...(tally?.first ?? {}),
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.logger.warn(
          `[value-shape] '${migrationId}': this deployment is recorded as verified, but an ` +
            'escape hatch (OS_ALLOW_LAX_MEDIA_VALUES / OS_ALLOW_LAX_VALUE_SHAPES) just admitted a ' +
            `value that contract rejects (${tally?.first.object}.${tally?.first.field}: ` +
            `${tally?.first.detail}). The certificate stands for everything recoverable, but ` +
            'irreversible actions are withheld — released field files are no longer collected, so ' +
            'no byte is deleted on evidence this deployment has contradicted. Fix the data and run ' +
            '`os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to clear it (ADR-0104).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Failing to record
        // is the dangerous direction — it leaves the reclamation gate open on
        // a certificate we now know is stale — so say so loudly.
        this.logger.warn(
          `[value-shape] could not record the observed deviation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still authorises irreversible collection while ` +
            'this deployment holds a value its own contract rejects; run the migration to ' +
            're-derive the gate',
        );
      });
  }

  /**
   * Tear up a creation attestation this boot has just contradicted (#4769).
   *
   * The attestation normally never gets written in the first place: it asks
   * {@link valueShapeViolationsAdmitted} before recording anything, so a boot
   * that seeded a violating value declines to certify. This closes the other
   * order — the certificate is already in the ledger and the contradicting
   * value lands afterwards, which is reachable whenever the deployment is
   * still lenient at that moment (`OS_ALLOW_LAX_MEDIA_VALUES` /
   * `OS_ALLOW_LAX_VALUE_SHAPES`) or whenever a writer runs after the
   * attestation point at all — the `os dev` hot-reload seeder and a runtime
   * marketplace install both seed on a store this boot created. Without this
   * the ledger would keep asserting a fact the store contradicts, and the NEXT
   * boot would enforce it against exactly the data this one wrote.
   *
   * The boot's own inline seed used to head that list, via the background
   * continuation of a run that overran `OS_INLINE_SEED_BUDGET_MS` — the
   * attestation's `kernel:ready` backstop fired mid-seed and the tail landed
   * against the certificate it had just issued. #4795 closed that ordering at
   * the source: the attestation now defers while the `seed-settlement` contract
   * reports a source outstanding, so the inline seed can no longer contradict
   * a certificate this boot issued. This stays the safety net rather than the
   * first line of defence for it.
   *
   * Deliberately narrow:
   *
   *  - only on a store THIS boot created from empty, so the only verified row
   *    that can exist is the attestation this boot issued. Evidence produced by
   *    a real `os migrate … --apply` run is never rewritten from here — a scan
   *    that walked the whole store outranks a single write's observation, and
   *    an operator who opted into leniency did not ask us to revoke their
   *    migration;
   *  - never inserts. No row means nothing was certified, and the attestation
   *    declining on the tally is what keeps it that way;
   *  - once per migration id per process, and never awaited by the write. The
   *    recorded `blocking` count is therefore a LOWER bound — which is all the
   *    gate reads, since any non-zero count closes it.
   */
  private retractCreationAttestation(migrationId: string): void {
    if (this.retractedCreationAttestations.has(migrationId)) return;
    if (!this._registry.getObject(DATA_MIGRATION_FLAG_OBJECT)) return;
    if (!this.wasDatastoreCreatedFromEmpty()) return;
    this.retractedCreationAttestations.add(migrationId);
    this.creationAttestationRetraction = this.creationAttestationRetraction
      .then(async () => {
        // [#20648] Same single-row route as `readMigrationFlagVerified`.
        const row: any = await this.findOne(DATA_MIGRATION_FLAG_OBJECT, {
          where: { id: migrationId },
          context: { isSystem: true } as ExecutionContext,
        });
        if (!row || row.id !== migrationId) return; // nothing certified — nothing to revoke
        if (row.verified_at == null) return; // gate already closed
        const tally = this.admittedValueShapeViolations.get(migrationId);
        const now = new Date().toISOString();
        let details: Record<string, unknown> = {};
        if (typeof row.details === 'string' && row.details.length > 0) {
          try {
            const parsed = JSON.parse(row.details);
            if (parsed && typeof parsed === 'object') details = parsed as Record<string, unknown>;
          } catch {
            details = { previous_details: row.details };
          }
        }
        await this.update(
          DATA_MIGRATION_FLAG_OBJECT,
          {
            id: migrationId,
            verified_at: null,
            blocking: tally?.count ?? 1,
            details: JSON.stringify({
              ...details,
              revoked: 'boot-admitted-violating-value',
              revoked_at: now,
              revoked_by: tally?.first,
            }),
            updated_at: now,
          },
          { context: { isSystem: true } as ExecutionContext },
        );
        this.invalidateDataMigrationFlags();
        this.logger.warn(
          `[value-shape] revoked '${migrationId}': this deployment was recorded as verified at ` +
            'creation, then this boot wrote a value that contradicts it ' +
            `(${tally?.first.object}.${tally?.first.field}: ${tally?.first.detail}). ` +
            'The gate is closed again — fix the data, then run `os migrate ' +
            (migrationId === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to re-earn it (ADR-0104).',
        );
      })
      .catch((err: any) => {
        // Bookkeeping must never surface as a write failure. Staying verified
        // is the bad direction, so say so loudly rather than silently.
        this.logger.warn(
          `[value-shape] could not revoke the creation attestation for '${migrationId}' ` +
            `(${err?.message ?? err}) — the ledger still claims this deployment is verified ` +
            'while its data contradicts that; run the migration to re-derive it',
        );
      });
  }

  /**
   * Drop the memoized deployment migration flags so the next write re-reads
   * them. For a host that runs a data migration in-process and wants its
   * effect without a restart.
   *
   * Also reopens the deviation witness window (#4797). The run that prompted
   * this call cleared any standing marker, so the "already recorded, don't
   * write again" guard would otherwise silence the next admitted value for the
   * life of the process — a deployment could re-earn its certificate and then
   * deviate again with nothing noticing. Costs at most one further ledger
   * write per migration id per re-run.
   */
  invalidateDataMigrationFlags(): void {
    this.fileReferencesMigrationVerified = null;
    this.valueShapesMigrationVerified = null;
    this.migrationGatesAnnounced = false;
    this.recordedDeviations.clear();
  }

  /**
   * Say, once at boot, which value-shape gates are still open here and what
   * closes them (ADR-0104's 2026-07-30 addendum, #3438).
   *
   * Both gates fail toward leniency: a deployment that never runs its
   * migration keeps warning instead of rejecting, and keeps every released
   * file forever. That default is deliberate — but silent, and a gate nobody
   * is told about is served by nobody. The LAX posture is the one worth
   * announcing, so this logs only when a gate is open *and* this deployment's
   * own metadata says the gate is about something it stores; the verified case
   * already logs from the flag read.
   *
   * A gate whose posture an environment switch has already settled says
   * nothing either, because the flag this line reports on is not what decides
   * that deployment's posture: under `OS_DATA_VALUE_SHAPE_STRICT_ENABLED`
   * enforcement is already on, so "checked but NOT enforced here" is simply
   * false, and under either opt-out the operator chose leniency deliberately,
   * so naming a migration that would not change what they get is noise. Each
   * gate consults its own pair, since the opt-outs are per-class. Cheapest
   * test first: a kernel with nothing to say never reaches the flag query.
   *
   * Costs one flag read per applicable gate (both memoized, and both already
   * paid by the first write to such an object), and nothing at all for an app
   * that declares neither class of field.
   */
  async announceOpenMigrationGates(): Promise<void> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readMigrationGatesAnnounced = () => this.migrationGatesAnnounced;
    const writeMigrationGatesAnnounced = (v: ObjectQL['migrationGatesAnnounced']) => { this.migrationGatesAnnounced = v; };
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof announceOpenMigrationGates> = {
      get migrationGatesAnnounced() { return readMigrationGatesAnnounced(); }, set migrationGatesAnnounced(v) { writeMigrationGatesAnnounced(v); },
      get _registry() { return readRegistry(); },
      objectHasMediaField: (...a) => this.objectHasMediaField(...a),
      objectHasCoveredValueField: (...a) => this.objectHasCoveredValueField(...a),
      readMigrationFlagVerified: (...a) => this.readMigrationFlagVerified(...a),
      get logger() { return readLogger(); },
    };
    return announceOpenMigrationGates.call(host);
  }
  private migrationGatesAnnounced = false;

  /**
   * Did this process CREATE the datastore it is talking to, from empty?
   *
   * True only when every driver that can account for its schema sync created
   * tables and found none already there. That conjunction is the whole point:
   * one pre-existing table anywhere means something ran here before us, so
   * this store's history is not ours to vouch for. A driver that cannot
   * report (`getSchemaSyncStats` absent, deferred DDL, sync skipped) makes the
   * answer no rather than maybe — the consumers of this fact grant
   * permissions, so "cannot say" must read as "no".
   *
   * The one caller is the fresh-datastore attestation (#3438, ADR-0104's
   * 2026-07-30 addendum), which records that a store born empty needs no data
   * migration. Ask it only during boot: once the process starts serving, the
   * counts describe a moment that has passed.
   */
  wasDatastoreCreatedFromEmpty(): boolean {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts` (see `MigrationFlagsHost`).
    const readDrivers = () => this.drivers;
    const host: ThisParameterType<typeof wasDatastoreCreatedFromEmpty> = {
      get drivers() { return readDrivers(); },
    };
    return wasDatastoreCreatedFromEmpty.call(host);
  }

  async destroy() {
    this.logger.info('Destroying ObjectQL engine', { driverCount: this.drivers.size });
    
    for (const [name, driver] of this.drivers.entries()) {
      try {
        await driver.disconnect();
      } catch (e) {
        this.logger.error('Error disconnecting driver', e as Error, { driverName: name });
      }
    }

    // #13578 — teardown is an eviction path too, and it used to disconnect
    // every driver while leaving all of them REGISTERED. A destroyed engine
    // therefore still answered `checkDriversHealth()` by pinging pools it had
    // just closed, so a readiness probe racing shutdown read a list of drivers
    // that were deliberately dead. Disconnect-then-evict, through the one
    // primitive, so `defaultDriver` and the datasource defs go with them.
    // Names are snapshotted first: `unregisterDriver` mutates the Map.
    for (const name of [...this.drivers.keys()]) this.unregisterDriver(name);
    
    this.logger.info('ObjectQL engine destroyed');
  }

  // ============================================
  // Helper: Expand Related Records
  // ============================================

  /** Maximum depth for recursive expand to prevent infinite loops */
  private static readonly MAX_EXPAND_DEPTH = 3;
  private static readonly MAX_CASCADE_DEPTH = 10;
  /**
   * [#5038] Most rows one predicate write may fire per-row hooks over — in
   * BOTH phases since #5574 (ADR-0058 Addendum II, D6).
   *
   * Public so a test — and an operator reading a rejection — can name the same
   * number the engine enforces. It is now a RE-EXPORT of the spec contract's
   * `MAX_BULK_PER_ROW_HOOK_ROWS`, not a second literal: until #5574's engine
   * half the same number was written down twice and only a pin in
   * `bulk-write-hook-conformance.test.ts` kept the two agreeing. See
   * `assertBulkPerRowHookBudget`.
   */
  public static readonly MAX_BULK_PER_ROW_HOOK_ROWS = MAX_BULK_PER_ROW_HOOK_ROWS;
  /** In-memory next-value cache per `object.field` for autonumber generation,
   *  lazily seeded from the current max in the store. */
  private readonly autonumberCounters = new Map<string, number>();

  /**
   * Memoized answer to "has THIS deployment completed and verified the
   * ADR-0104 file-as-reference migration?" (#3617) — the fact that decides
   * whether a malformed media value rejects or merely warns.
   *
   * Memoized as a PROMISE so concurrent first writes share one read rather
   * than racing several. Deliberately not refreshed on a timer: the flag is
   * written by `os migrate files-to-references --apply`, a deliberate
   * operator action, and a process that has not seen it yet simply stays
   * lenient — the safe direction. A host that migrates in-process can call
   * {@link invalidateDataMigrationFlags} instead of waiting for a restart.
   */
  private fileReferencesMigrationVerified: Promise<MigrationFlagRead> | null = null;
  private valueShapesMigrationVerified: Promise<MigrationFlagRead> | null = null;

  /** Lazily-built index: child object name → roll-up summary descriptors on
   *  parent objects that aggregate it. Invalidated when packages register. */
  private summaryIndex: Map<string, SummaryDescriptor[]> | null = null;

  /** The SAME descriptors, indexed the other way: parent object name → the
   *  roll-up summary fields that object OWNS. Built in the same pass as
   *  {@link summaryIndex} and invalidated with it. The child index answers
   *  "whose summaries must I recompute after writing this row"; this one answers
   *  "which of my own summary fields must be seeded when I create this row"
   *  (#5749) — the question the child index structurally cannot answer, because
   *  a parent that has never had a child appears in no child write. */
  private summaryIndexByParent: Map<string, SummaryDescriptor[]> | null = null;

  /**
   * Retry options for roll-up summary recompute (framework#3147). Public so a
   * test can inject a no-op sleep for deterministic backoff; production uses
   * the transient-retry defaults.
   */
  summaryRetryOptions: RetryOptions = {};

  /** Invalidate the cached roll-up summary index (call when metadata changes). */
  private invalidateSummaryIndex(): void {
    this.summaryIndex = null;
    this.summaryIndexByParent = null;
  }

  /** Scan all registered objects for `summary` fields and index them BOTH ways
   *  — by the child object they aggregate and by the parent object that owns
   *  them — resolving the child→parent FK field. One scan, two views of the
   *  identical descriptor objects, so the two indexes can never disagree about
   *  which roll-ups exist.
   *
   *  [#9154] The registry read PROPAGATES. It used to be
   *  `try { (registry as any).getAllObjects?.() ?? [] } catch { [] }`, which
   *  answered a read that could not run with an invented *"no object declares a
   *  roll-up"* — the same shape #8895 ruled on (*discriminate or propagate*)
   *  and #9002 removed from the two delete-cascade seams, and there is no
   *  benign failure class to discriminate here either: an unreadable registry
   *  is never truthfully "no roll-ups". An empty index means
   *  {@link recomputeSummaries} recomputes nothing after every insert / update
   *  / delete, so every parent summary field keeps a stale value while every
   *  write reports success and nothing is logged.
   *
   *  Both halves of the swallow are gone, not just the `catch`: the optional
   *  call `?.()` absorbed a registry that does not implement `getAllObjects` at
   *  all — the same structural omission a test double really did ship, and one
   *  that is invisible precisely because it never throws. A plain call fails
   *  loudly on it.
   *
   *  ⚠️ This is a STRUCTURAL close, not a live defect: `SchemaRegistry`'s
   *  `getAllObjects()` is a walk over in-memory `Map`s calling `resolveObject()`
   *  — which returns `undefined` on every failure branch it models — over a
   *  fold that is spreads and comparisons. No I/O, no driver, no `throw` on the
   *  measured path. The pin lives in
   *  `engine-summary-index-registry-read-failure.test.ts`.
   *
   *  [#19082] The SECOND way this one function invented *"nothing to
   *  recompute"* — a different input, the same outcome. The child→parent FK
   *  was resolved by comparing the child field's `reference` carrier to the
   *  parent's name, so a carrier no reader can read (a non-string where
   *  `FieldSchema.reference` declares an optional string) compared false
   *  against every name, `fkField` stayed unset, and the `continue` below
   *  dropped a DECLARED roll-up out of both indexes with nothing logged.
   *
   *  ⛔ The fix is NOT a looser comparison — that would trade a silent
   *  stall for a MIS-MATCHED foreign key, which is more expensive. The
   *  carrier is read through the one arbiter and the skip now SAYS SO, at
   *  `error` (a persisted summary silently stops tracking its children while
   *  every write keeps reporting success — the durability class). Absence and
   *  every readable carrier behave exactly as before; the resolution rule
   *  itself is deliberately left where PR #18503's C2 boundary put it. Pinned
   *  in `engine-summary-index-unreadable-carrier.test.ts`, both directions. */
  private buildSummaryIndex(): {
    byChild: Map<string, SummaryDescriptor[]>;
    byParent: Map<string, SummaryDescriptor[]>;
  } {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts` (see `SummariesAndExpansionHost`).
    const read_registry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof buildSummaryIndex> = {
      get _registry() { return read_registry(); },
      get logger() { return readLogger(); },
    };
    return buildSummaryIndex.call(host);
  }

  /** `registry.objectRevision` the cached {@link summaryIndex} was built at. */
  private summaryIndexRevision = -1;

  /**
   * Ensure both roll-up indexes are present and current. Split out of
   * {@link getSummaryDescriptors} so the parent-side view (#5749) shares the
   * exact same staleness rule instead of re-deriving one.
   *
   * ## [#9154] A failed build leaves NO cache entry — *a poisoned cache entry
   * must not survive the read that poisoned it*
   *
   * This is the limb that made the swallow removed from
   * {@link buildSummaryIndex} worse than its two #9002 siblings. Those invented
   * an answer ONCE, per delete. Here the answer is MEMOIZED and stamped with the
   * registry's current `objectRevision` — so one failed read did not degrade one
   * write, it installed an empty index that every subsequent write then read as
   * a measured answer. And `objectRevision` moves only on a metadata MUTATION
   * (`registerObject`, `unregisterObject`, `unregisterObjectsByPackage`,
   * `removeObjectOverlay`, `invalidate`, `invalidateAll`, `reset`) — never on a
   * data write. A steady-state deployment performs none of those, so the
   * invented emptiness outlived its cause for the whole process lifetime,
   * ending only at a restart or at an unrelated publish. The failure was not
   * "briefly wrong"; it was wrong until an unrelated event.
   *
   * Two things hold the invariant, and both are load-bearing — do not reorder:
   *
   *  1. the build runs to completion into a LOCAL before anything is published
   *     to `this`, so a throw cannot leave a half-written pair of indexes, and
   *     the revision stamp is written LAST — an unstamped failure is retried on
   *     the very next call rather than being remembered as an answer;
   *  2. the `catch` below clears whatever was cached and resets the stamp before
   *     rethrowing. Behaviourally that is a no-op today (nothing reads the
   *     fields without coming through here first, and the stale entry would be
   *     rebuilt anyway) — it is here so the guarantee is stated in code instead
   *     of resting on the survey in (1). ⛔ It swallows nothing: the error is
   *     rethrown unchanged, and `engine-summary-index-registry-read-failure.test.ts`
   *     pins both the propagation and the retry.
   */
  private ensureSummaryIndexes(): void {
    // Rebuild whenever the REGISTRY's object set has moved since the index was
    // built — not only when someone remembered to call
    // `invalidateSummaryIndex`. That single site (`registerApp`) is bypassed by
    // the runtime publish path, which registers straight into the registry
    // (`protocol.saveMetaItem` → `registry.registerObject`). A kernel that had
    // already done one write — publishing itself writes `sys_metadata` — held an
    // index built before the new object existed, so every child write of a
    // freshly published roll-up skipped the recompute and the parent read null
    // until the process restarted. That is exactly how an AI-built app's
    // "已完成任务数" shipped empty over correct metadata (cloud#970).
    const revision = (this._registry as unknown as { objectRevision?: number })?.objectRevision;
    const stale = typeof revision === 'number' && revision !== this.summaryIndexRevision;
    if (!this.summaryIndex || !this.summaryIndexByParent || stale) {
      let built: { byChild: Map<string, SummaryDescriptor[]>; byParent: Map<string, SummaryDescriptor[]> };
      try {
        built = this.buildSummaryIndex();
      } catch (err) {
        // [#9154] Nothing measured came back, so nothing is remembered — not
        // even the entry that was already here, which the staleness test above
        // has just judged out of date. The next call rebuilds from scratch.
        this.invalidateSummaryIndex();
        this.summaryIndexRevision = -1;
        throw err;
      }
      this.summaryIndex = built.byChild;
      this.summaryIndexByParent = built.byParent;
      if (typeof revision === 'number') this.summaryIndexRevision = revision;
    }
  }

  /** Roll-up descriptors for summaries that aggregate `childObject` — i.e. the
   *  ones a write to `childObject` must recompute. Semantics unchanged. */
  private getSummaryDescriptors(childObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndex!.get(childObject) ?? [];
  }

  /** [#26950] The child-side foreign-key columns the roll-ups over
   *  `childObject` read: what a predicate write must read off its matched rows,
   *  before it writes, to hand {@link recomputeSummaries} the parents to
   *  recompute. Empty when no roll-up aggregates `childObject`. */
  private summaryForeignKeyColumns(childObject: string): string[] {
    return [...new Set(this.getSummaryDescriptors(childObject).map((desc) => desc.fkField))];
  }

  /** Roll-up descriptors for the summary fields `parentObject` OWNS (#5749) —
   *  i.e. the ones a NEW row of `parentObject` must have seeded.
   *
   *  Public since #6063: the one-off backfill of pre-#6013 `NULL` rows
   *  (`os migrate summary-nulls`) iterates parents, and reading the engine's
   *  OWN index is what makes it see exactly the roll-ups the engine maintains —
   *  same FK resolution, same filter, same staleness rule. Re-deriving them
   *  would be a second index that disagrees the first time either moves. */
  getOwnedSummaryDescriptors(parentObject: string): SummaryDescriptor[] {
    this.ensureSummaryIndexes();
    return this.summaryIndexByParent!.get(parentObject) ?? [];
  }

  /**
   * Seed the roll-up `summary` fields a freshly-created row owns (#5749).
   *
   * `recomputeSummaries` only ever visits parents named by a child write, so a
   * parent that has NEVER had a child is never visited and its summary column
   * keeps whatever insert put there — `null`. Delete the last child and the
   * parent DOES get visited (via `previous`) and lands on 0. Same logical state,
   * two different values: `filter ["task_count","=",0]` silently skipped every
   * parent that never had a child, and so did sorting, GROUP BY and any formula
   * reading the field (null propagation).
   *
   * The fix is at the producer: write the empty-collection value at create time,
   * so `count`/`sum` start at 0 and only ever move to another number.
   * `min`/`max`/`avg` have no empty-set value and deliberately stay `null` —
   * {@link summaryEmptySetValue} is the single list both this and the recompute
   * fallback read.
   *
   * Author-supplied values are never overwritten. The `!= null` test matches
   * {@link applyFieldDefaults} exactly (#2706): on INSERT an explicit `null` is
   * "no value supplied", any real value — including a deliberate 0 or a seeded
   * count — is respected. Runs before the `beforeInsert` hooks for the same
   * reason defaults do, so a hook still has the final say.
   *
   * Existing rows are untouched: this is create-time only, so parents already
   * stored with `null` stay `null` until a child write recomputes them.
   */
  private initializeSummaryFields(object: string, record: any): any {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts` (see `SummariesAndExpansionHost`).
    const host: ThisParameterType<typeof initializeSummaryFields> = {
      getOwnedSummaryDescriptors: (...a) => this.getOwnedSummaryDescriptors(...a),
    };
    return initializeSummaryFields.call(host, object, record);
  }

  /**
   * Recompute roll-up `summary` fields on parent records after a child write.
   * For each affected parent (the FK value on the changed/old child record), it
   * aggregates the child collection and writes the result onto the parent's
   * summary field. Runs in the caller's execution context — SYSTEM-ELEVATED,
   * see below — so it joins the same transaction (e.g. the cross-object batch)
   * when one is open.
   *
   * # Why the recompute is system-elevated (#7673)
   *
   * A roll-up is ENGINE-DERIVED state on the parent, not a caller write to it.
   * The permission decision that matters — may this caller write the CHILD —
   * has already been made by the time we get here; whether
   * `showcase_project.task_count` may be refreshed is not a question about the
   * caller's grant on `showcase_project`.
   *
   * Passing the caller's own context straight through made it one, and the
   * ordinary parent/child shape — a child more widely writable than its parent
   * (tasks, line items, comments, time entries) — broke on it in three
   * separate ways, all of them fail-open:
   *
   *   1. **A granted child write returned 500 after the row was written.** The
   *      parent update raised `PermissionDeniedError`, which this method
   *      recorded as a failure and the three call sites then threw as
   *      `SummaryRecomputeError` — mapped to a 500 by REST, on a write that had
   *      already COMMITTED. A client that retried created a duplicate row
   *      (#7673 / #7719, measured on `examples/app-showcase`: a plain member
   *      holding `showcase_task: create + read` 500'd on every POST and PATCH).
   *   2. **The aggregate was computed from the caller's VISIBLE subset.** Where
   *      the caller COULD write the parent, the recompute succeeded and stored
   *      an RLS-scoped count — a parent column silently rewritten to one
   *      reader's view of the child collection. A roll-up is a property of the
   *      parent, never of whoever happened to touch a child.
   *   3. **An author-declared `readonly: true` roll-up column was stripped.**
   *      The write-path read-only strip runs on `!context.isSystem`, and the
   *      recompute's payload is "caller supplied" from its point of view, so
   *      the summary silently never landed.
   *
   * Elevation is a `sudo()`-shaped derivative of the caller's context
   * (`{ ...execCtx, isSystem: true }`), NOT a bare `{ isSystem: true }`: the
   * open transaction handle, `tenantId` and `timezone` must survive, or the
   * recompute leaves the caller's transaction and stops being tenant-scoped.
   * That makes this the same posture the roll-up's two OTHER writers already
   * hold — `initializeSummaryFields` runs inside the engine's own insert, and
   * `backfillSummaryNulls` (#6063) elevates explicitly — so all three writers
   * of a summary column now agree about who owns it.
   *
   * What this does NOT do: it never widens what the caller may read or write.
   * The parent's own row stays governed by the caller's grants (a direct
   * `update` of the parent is refused exactly as before), the summary field
   * stays subject to the parent's FLS on read, and the only value this path can
   * move is the one the author DECLARED as a function of the child collection.
   */
  private async recomputeSummaries(
    childObject: string,
    records: any,
    previous: any,
    execCtx?: ExecutionContext,
  ): Promise<SummaryRecomputeFailure[]> {
    const descriptors = this.getSummaryDescriptors(childObject);
    if (descriptors.length === 0) return [];
    // The elevation described above. Built once per call, spread from the
    // caller's context so transaction / tenant / timezone ride along.
    const systemCtx = { ...(execCtx ?? {}), isSystem: true } as ExecutionContext;
    const recs = Array.isArray(records) ? records : records ? [records] : [];
    const prevs = Array.isArray(previous) ? previous : previous ? [previous] : [];
    const failures: SummaryRecomputeFailure[] = [];
    for (const desc of descriptors) {
      const ids = new Set<string>();
      for (const r of recs) { const v = r?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const p of prevs) { const v = p?.[desc.fkField]; if (v != null && v !== '') ids.add(String(v)); }
      for (const parentId of ids) {
        try {
          // Retry a transient failure (a turso `fetch failed` on the parent
          // aggregate/update) with backoff — a network blip here used to leave
          // the parent summary silently stale (framework#3147).
          await withTransientRetry(async () => {
            // The aggregate — parent-FK match ANDed with the optional
            // per-summary filter, empty-set fallback included — is
            // `aggregateSummaryValue` (#6063). Behaviour unchanged; it simply
            // lives where the insert-time seed and the one-off NULL backfill
            // can read the identical computation instead of copying it.
            const value = await aggregateSummaryValue(this, desc, parentId, systemCtx);
            await this.update(desc.parentObject, { id: parentId, [desc.summaryField]: value }, { context: systemCtx } as any);
          }, this.summaryRetryOptions);
        } catch (err) {
          // Retries exhausted (or a non-transient failure). Record it so the
          // caller can surface it — one parent's failure must not abort the
          // remaining parents' recompute.
          this.logger.warn('Roll-up summary recompute failed', {
            childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField,
            error: (err as any)?.message,
          });
          failures.push({ childObject, parentObject: desc.parentObject, parentId, field: desc.summaryField, error: err });
        }
      }
    }
    return failures;
  }

  /**
   * Post-process expand: resolve lookup/master_detail fields by batch-loading related records.
   * 
   * This is a driver-agnostic implementation that uses secondary queries ($in batches)
   * to load related records, then injects them into the result set.
   * 
   * @param objectName - The source object name
   * @param records - The records returned by the driver
   * @param expand - The expand map from QueryAST (field name → nested QueryAST)
   * @param depth - Current recursion depth (0-based)
   * @returns Records with expanded lookup fields (IDs replaced by full objects)
   */
  private async expandRelatedRecords(
    objectName: string,
    records: any[],
    expand: Record<string, QueryAST>,
    depth: number = 0,
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    if (!records || records.length === 0) return records;
    if (depth >= ObjectQL.MAX_EXPAND_DEPTH) return records;

    const objectSchema = this._registry.getObject(objectName);
    // If no schema registered, skip expand — return raw data
    if (!objectSchema || !objectSchema.fields) return records;

    for (const [fieldName, nestedAST] of Object.entries(expand)) {
      // [#4371] The nested AST is caller-authored too: a wire spelling inside
      // `expand: { rel: { sort } }` used to be silently dropped exactly like
      // the top-level bag (this loop reads only canonical keys). Same
      // rejection, scoped to the four wire-only pairs — the nested shape is a
      // QueryAST, not an option bag, so the option-key gate does not apply.
      if (nestedAST && typeof nestedAST === 'object') {
        for (const slot of ENGINE_WIRE_ONLY_SLOTS) {
          for (const alias of slot.aliases) {
            if ((nestedAST as Record<string, unknown>)[alias] != null) {
              throw new Error(
                `expand['${fieldName}'] on '${objectName}' does not accept '${alias}': it is a wire ` +
                `spelling of '${slot.canonical}', folded by the RPC/protocol layer — a direct engine ` +
                `call bypasses that fold, so the value would be silently dropped, not applied. Pass ` +
                `'${slot.canonical}' (${WIRE_ONLY_CANONICAL_SHAPES[slot.canonical] ?? 'the canonical QueryAST shape'}) instead.`,
              );
            }
          }
        }
      }
      const fieldDef = objectSchema.fields[fieldName];

      // Skip if field not found or not a relationship type.
      //
      // `user` is a lookup specialized to sys_user and `tree` is a hierarchical
      // self-reference — both carry the same `reference` + id storage, so both
      // expand through this exact path (single or multiple).
      //
      // [#4226] The membership test is `REFERENCE_VALUE_TYPES` — the spec's own
      // list of types whose value "points at another record … the related record
      // object in expanded form" — rather than a hand-copied `!==` chain. The
      // chain had drifted: it omitted `tree`, so a `$expand` of a hierarchy
      // field returned the raw parent id and rendered as a bare placeholder,
      // while `field-value.zod.ts` and objectui's `EXPANDABLE_FIELD_TYPES` both
      // declared it expandable. Reading the shared set is what stops the
      // protocol's expand gate (which validates against the same set) from ever
      // admitting a field this loop then silently skips.
      //
      // [cloud#983] The TARGET comes from `referenceTargetOf` for that same
      // anti-drift reason. A raw `fieldDef.reference` read made `{ type:
      // 'user' }` (no `reference`) targetless here AND at the gate — but
      // `user`'s target is fixed BY THE TYPE (`sys_user`; `Field.user()` takes
      // no target argument), so the field was fully specified and the request
      // was refused `400 … declares no target object`. Both sides now ask the
      // one function what a reference field points at.
      if (!fieldDef) continue;
      if (!REFERENCE_VALUE_TYPES.has(fieldDef.type)) continue;
      const referenceObject = referenceTargetOf(fieldDef);
      if (!referenceObject) continue;
      // [#24358] ⛔ A reference into the stored-metadata-body family is never
      // expanded, at any depth and for any caller. The family's projection runs
      // at its doors and only for the object a request names, so this sub-read
      // would nest the stored body and its content hash unprojected under the
      // requested rows — material the family's own door withholds from the same
      // reader. The field keeps the stored id, the answer a reference the
      // caller may not expand gets (an unexposed target, #22661, or a refused
      // sub-read, below), so it says nothing about the row.
      if (isStoredMetadataBodyObject(referenceObject)) continue;

      // Collect all foreign key IDs from records (handle both single and multiple values)
      const allIds: any[] = [];
      for (const record of records) {
        const val = record[fieldName];
        if (val == null) continue;
        if (Array.isArray(val)) {
          allIds.push(...val.filter((id: any) => id != null));
        } else if (typeof val === 'object') {
          // Already expanded — skip
          continue;
        } else {
          allIds.push(val);
        }
      }

      // De-duplicate IDs
      const uniqueIds = [...new Set(allIds)];
      if (uniqueIds.length === 0) continue;

      // Batch-load related records using $in query
      try {
        // Constrain the batch to the collected FK ids. When the nested expand
        // AST carries its own `where`, AND-merge it via an explicit `$and`
        // group rather than spreading keys onto the id filter: a shallow spread
        // would clobber the `id` constraint (if the nested filter also keys
        // `id`) and is ambiguous when the nested filter is a top-level `$or` /
        // `$and`. The `$and` wrapper is correct for every FilterCondition shape.
        const idFilter = { id: { $in: uniqueIds } };
        const where = nestedAST.where
          ? { $and: [idFilter, nestedAST.where] }
          : idFilter;

        // [#2850] Resolve the referenced object through the engine's own read
        // path (`this.find`) rather than the raw driver, so the security
        // middleware applies the REFERENCED object's RLS + FLS to the expanded
        // batch — not merely tenant isolation. A single `find` over the
        // collected `id $in [...]` batch re-enters the middleware exactly once
        // (no N+1), preserving the batched load. `nestedAST.limit/offset` are
        // still intentionally NOT forwarded: this path batch-loads every
        // parent's related records in one query, so a *per-parent* limit/offset
        // can't be expressed — a global cap would silently drop records other
        // parents need. Paginate by querying the related object directly.
        //
        // The `__expandRead` marker (set here, never from client input —
        // `executionContext` is server-built) tells the security layer this is
        // an expansion sub-read. It does NOT relax that layer: since #7626 the
        // referenced object takes the FULL treatment — CRUD gate,
        // requiredPermissions, RLS and FLS — so you may expand only rows you
        // could have read directly. (#2850 shipped a waiver for "public"
        // referenced objects; it keyed on an axis almost no object declares and
        // never checked the caller's grants, so it disclosed private records to
        // callers the gate had already refused.) A refusal is caught below and
        // the bare FK id is retained, which is why the parent read still
        // succeeds. `expand` is intentionally omitted from this query so `find`
        // does not re-expand — nested relations recurse below under the depth
        // guard.
        //
        // [#7537] The join key is MACHINERY, not a caller-chosen column. This
        // sub-read's projection is forwarded from `nestedAST.fields`, and the
        // map built below is keyed on `rec.id` — so a nested projection that did
        // not name `id` returned rows carrying no `id`, built an EMPTY map, and
        // fell through the `recordMap.get(...) ?? val` injection, writing the
        // original foreign key back. The expansion was then indistinguishable
        // from never having been requested: `200`, and the field still holds a
        // valid-looking id.
        //
        // The failing spelling is the one the platform itself PRESCRIBES: both
        // `FIELD_NODE_OBJECT_FORM_REMOVED` and `QUERY_JOINS_REMOVED`
        // (`query.zod.ts`) tell authors migrating off the retired nested-select
        // object form and off `query.joins` to write
        // `expand: { owner: { object: 'user', fields: ['name'] } }`. Refusing the
        // mismatch would turn two retirement messages' own migration target into
        // an error, so the prescribed form is made to WORK instead: `id` is added
        // to the sub-read unconditionally and stripped back out of the emitted
        // nested record when the caller did not ask for it.
        //
        // `id` is the only join key there is, literally: `referenceTargetOf`
        // yields the target OBJECT and a reference field carries no
        // target-column metadata, so the batch filter above is `{ id: { $in } }`
        // by construction. There is no configurable key to add instead.
        //
        // Only a driver that honours a projection exactly could ever show this —
        // `SqlDriver` emits `builder.select(query.fields)` verbatim, while
        // `InMemoryDriver.projectFields` force-adds `id` to every projection,
        // which is why mock/in-memory suites could not reach the defect and a
        // better-sqlite3 QA run (#7463) could.
        const nestedFields = Array.isArray(nestedAST.fields) && nestedAST.fields.length > 0
          ? nestedAST.fields
          : undefined;
        const joinKeyRequested = !nestedFields || nestedFields.includes('id');
        const relatedRecords = await this.find(
          referenceObject,
          {
            where,
            // [commit 74155c735] The `as any` these two carried is gone: `find` takes the
            // author state now, and the parsed nodes a `QueryAST` holds are
            // valid author input (a present `order` is legal to write).
            ...(nestedAST.fields
              ? { fields: joinKeyRequested ? nestedAST.fields : [...nestedFields!, 'id'] }
              : {}),
            ...(nestedAST.orderBy ? { orderBy: nestedAST.orderBy } : {}),
            context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext,
          },
        ) ?? [];

        // Build a lookup map: id → record
        const recordMap = new Map<string, any>();
        for (const rec of relatedRecords) {
          const id = rec.id;
          if (id != null) recordMap.set(String(id), rec);
        }

        // Recursively expand nested relations if present
        if (nestedAST.expand && Object.keys(nestedAST.expand).length > 0) {
          const expandedRelated = await this.expandRelatedRecords(
            referenceObject,
            relatedRecords,
            nestedAST.expand,
            depth + 1,
            execCtx,
          );
          // Rebuild map with expanded records
          recordMap.clear();
          for (const rec of expandedRelated) {
            const id = rec.id;
            if (id != null) recordMap.set(String(id), rec);
          }
        }

        // [#7537] Strip the join key back out when the caller did not name it.
        // It was added above for THIS function's own lookup, so the emitted
        // nested record carries exactly the columns the projection asked for —
        // the same contract a top-level `fields` gets. Deliberately AFTER the
        // recursive expand: that block rebuilds `recordMap` keyed on `rec.id`
        // and still needs the key present. Each related record is stripped once
        // here rather than per-parent, because one record object is injected
        // into every parent that points at it.
        if (!joinKeyRequested) {
          for (const rec of recordMap.values()) {
            if (rec && typeof rec === 'object') delete rec.id;
          }
        }

        // Inject expanded records back into the original result set
        for (const record of records) {
          const val = record[fieldName];
          if (val == null) continue;

          if (Array.isArray(val)) {
            record[fieldName] = val.map((id: any) => recordMap.get(String(id)) ?? id);
          } else if (typeof val !== 'object') {
            record[fieldName] = recordMap.get(String(val)) ?? val;
          }
          // If val is already an object, leave it as-is
        }
      } catch (e) {
        // Graceful degradation: if expand fails, keep original IDs
        this.logger.warn('Failed to expand relationship field; retaining foreign key IDs', {
          object: objectName,
          field: fieldName,
          reference: referenceObject,
          error: (e as Error).message,
        });
      }

      // [#29460] `referenceNameVisible` (ruling 6574398310, letter B): the ids
      // the caller's own expansion above left bare are asked whether the
      // caller was REFUSED them, and a refused target is served by its name
      // and id only. Every other value keeps the answer the loop gave it. See
      // {@link serveReferenceNames}.
      if ((fieldDef as { referenceNameVisible?: unknown }).referenceNameVisible === true) {
        await this.serveReferenceNames(objectName, records, fieldName, referenceObject, execCtx);
      }
    }

    return records;
  }

  /**
   * [#29460] Serve `FieldSchema.referenceNameVisible` on an expanded read
   * (director ruling 6574398310, letter B). Runs from
   * {@link expandRelatedRecords} for a field declaring the key, after the
   * caller's own expansion of it, and rewrites only the ids that expansion
   * left bare.
   *
   * For each such id it asks, as the caller and with none of the caller's
   * `$expand` nesting, whether the caller may read it (the security service's
   * object-level admission, then an id-only read for the row scope). A refused
   * id whose record exists in the caller's tenant becomes
   * `{ id, name, readRefused: true }`: `name` is ADR-0079's display name,
   * read by the engine under the tenant-kept elevation from exactly `id` and
   * the resolved name field, with the floor `Record #<id>` when field-level
   * security keeps that field from the caller. A readable target keeps its
   * expansion, an id the caller's own nested filter left bare stays bare, an
   * id no record has stays bare. `multiple: true` is judged per element.
   *
   * ⛔ Never served on an unexpanded read: ADR-0104 D1's stored form is the
   * bare id for every caller. ⛔ The caller's projection, filter, order and
   * nested expand never reach the elevated read, and the field's
   * `displayField` does not choose its column.
   */
  private async serveReferenceNames(
    objectName: string,
    records: any[],
    fieldName: string,
    referenceObject: string,
    execCtx?: ExecutionContext,
  ): Promise<void> {
    // The body lives in `engine-reference-name-visible.ts` (see `ReferenceNameVisibleHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof serveReferenceNames> = {
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
      find: (...a) => this.find(...a),
      resolveReadableIdsSecurity: (...a) => this.resolveReadableIdsSecurity(...a),
      formulaReadsReference: (name, def, fields) => {
        try {
          const entry = formulaPlanEntry(name, def, fields);
          return entry.hops !== undefined || entry.hopConflict !== undefined;
        } catch {
          // An expression the planner cannot compile is not served by name.
          return true;
        }
      },
    };
    return serveReferenceNames.call(host, objectName, records, fieldName, referenceObject, execCtx);
  }

  /**
   * Resolve file-field id references to their expanded read form (ADR-0104 D3
   * wave 2). A `file`/`image`/`avatar`/`video`/`audio` value stored as an
   * opaque `sys_file` id string whose servable row this read finds (committed,
   * or a tombstone still held) is enriched, in place, to the `FileValueSchema`
   * object `{ id, name, size, mimeType, url }` — `url` derived from the stable
   * `/files/:fileId` resolver, never stored. That is one of three expanded
   * forms: an id nothing resolves stays the bare id (DUAL-MODE SAFE, and the
   * fail-open `catch` below), and an id whose `sys_file` read is refused to the
   * caller becomes `FileRefusedValueSchema` (REFUSED IS NOT ABSENT).
   *
   * DUAL-MODE SAFE: an inline-blob value (an object) and a string that does
   * NOT match a committed `sys_file` row (e.g. an external url) pass through
   * unchanged, so a field may hold either form during the pre-v17 window.
   *
   * REFUSED IS NOT ABSENT: when the caller's own `sys_file` read is refused,
   * each id becomes `{ id, metadataRefused: true }` (`FileRefusedValueSchema`)
   * rather than staying a bare id — see the `catch` below.
   *
   * PARENT-DERIVED (#22637, maintainer ruling B on #22624): that refusal is
   * about `sys_file` as an object, not about the files a record owns. A file
   * whose `ref_object` / `ref_id` name the record being read is judged by the
   * download door's own field-owned verdict (ADR-0104 D3) — the declared
   * `fileAccessDelegate` where the object names one, else the caller's read of
   * that record — and hydrates when it allows. Every other id keeps the
   * refused marker. See {@link readParentDerivedFiles}.
   *
   * ASKED BEFORE READ (#24335): the caller's `sys_file` read is issued only
   * when the security service admits it — {@link callerMayReadSysFile}, the
   * middleware's own object-level read gate. A caller it refuses goes
   * straight to the refused arm, the answer that read's refusal produced, so
   * the served value is the same and no access attempt is made: the security
   * layer logs no denial for a read the reader never asked for. A direct
   * `sys_file` read by that reader is refused, and logged, exactly as before.
   *
   * Batched: one admission ask and at most one `sys_file` `id $in […]` read
   * per call (no N+1) — and, on the refused arm only, one more system read
   * plus one verdict call; zero of each when no field holds a string value
   * (the blob-only case), so the step is free for objects that have not
   * adopted references.
   */
  private async resolveFileReferences(
    objectName: string,
    records: any[],
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts` (see `FileReferenceHydrationHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof resolveFileReferences> = {
      get _registry() { return readRegistry(); },
      callerMayReadSysFile: (...a) => this.callerMayReadSysFile(...a),
      serveRefusedFileHydration: (...a) => this.serveRefusedFileHydration(...a),
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
      servableFileRows: (...a) => this.servableFileRows(...a),
    };
    return resolveFileReferences.call(host, objectName, records, execCtx);
  }

  /**
   * [#24335] May this caller read `sys_file` at all? Asked of the registered
   * security service's `canReadObject` BEFORE {@link resolveFileReferences}
   * issues the caller's own `sys_file` read, as the parent-record read gate
   * asks before it reads a parent object ("A skipped object is not an access
   * attempt", plugin-audit). `canReadObject` is the security middleware's own
   * object-level read gate, arm for arm, and answers without logging or
   * throwing; the read it spares is one that gate would refuse, and
   * plugin-security logs every refusal at WARN — a line on every ordinary
   * record read by a reader without `sys_file` read, burying the real denials.
   *
   * Asked with the caller's envelope minus its operation-private `__` keys
   * (`withoutOperationPrivateKeys`, as {@link readParentDerivedFiles} asks its
   * verdict): no second derivation of authority, and no muting of the
   * middleware's log — the reader's own `sys_file` read still logs its denial.
   *
   * It only ever NARROWS what is read: `true` still reads as the caller, and
   * that read still decides. Unasked ⇒ `true`, the read goes to the middleware
   * as it did before: no usable security service, one whose contract omits the
   * optional `canReadObject`, or an ask that throws. Any other answer than
   * `true` ⇒ the refused arm, which is what that read's refusal served.
   */
  private async callerMayReadSysFile(execCtx?: ExecutionContext): Promise<boolean> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts` (see `FileReferenceHydrationHost`).
    const host: ThisParameterType<typeof callerMayReadSysFile> = {
      resolveReadableIdsSecurity: (...a) => this.resolveReadableIdsSecurity(...a),
    };
    return callerMayReadSysFile.call(host, execCtx);
  }

  /**
   * The refused arm of {@link resolveFileReferences}: this caller may not read
   * `sys_file`, whether its admission said so up front (#24335) or its read was
   * refused. Each id a record of this result owns is put to the field-owned
   * verdict ({@link readParentDerivedFiles}, #22637) and hydrates when it
   * allows; every other id becomes `{ id, metadataRefused: true }`
   * (`FileRefusedValueSchema`). Logged at `debug`: the answer is handed to
   * the caller in the value.
   */
  private async serveRefusedFileHydration(
    objectName: string,
    records: any[],
    fileFields: string[],
    uniqueIds: string[],
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts` (see `FileReferenceHydrationHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof serveRefusedFileHydration> = {
      readParentDerivedFiles: (...a) => this.readParentDerivedFiles(...a),
      get logger() { return readLogger(); },
    };
    return serveRefusedFileHydration.call(host, objectName, records, fileFields, uniqueIds, execCtx);
  }

  /**
   * The servable subset of some `sys_file` rows, keyed by id — the rule both
   * arms of {@link resolveFileReferences} serve by, so a row hydrates under
   * the same condition whichever read found it.
   */
  private async servableFileRows(objectName: string, rows: any[]): Promise<Map<string, any>> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts` (see `FileReferenceHydrationHost`).
    const readHeldFileResolver = () => this._heldFileResolver;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof servableFileRows> = {
      get _heldFileResolver() { return readHeldFileResolver(); },
      get logger() { return readLogger(); },
    };
    return servableFileRows.call(host, objectName, rows);
  }

  /**
   * [#22637] The parent-derived half of a REFUSED `sys_file` hydration: which
   * of the ids this result holds are field-owned by a record in it, and does
   * the download door's verdict let this caller read them?
   *
   * Maintainer ruling B on #22624, verbatim as the card records it: "A file
   * field's metadata follows the parent-derived verdict the download door
   * already applies (ADR-0104 D3, `buildFileReadAuthorizer`): when the
   * caller's `sys_file` read is refused, `resolveFileReferences` still
   * hydrates a file whose `ref_object` / `ref_id` name the record being read
   * (the delegate consulted where the owner object declares a
   * `fileAccessDelegate`); a referenced id that does not point at that record
   * keeps PR #22620's refused marker; direct `sys_file` queries and
   * `public_read` are unchanged."
   *
   * Two reads, both narrow:
   *
   *  1. **Which ids does a record in this result own?** One `sys_file` read
   *     under a `sudo()`-shaped context (`{ ...caller, isSystem: true }`: the
   *     caller's tenant wall and transaction ride along). The `where` itself
   *     asks for the ownership pair — `ref_object` this object, `ref_id` one
   *     of these records — so a file that is not field-owned here is never
   *     read at all, and only {@link PARENT_DERIVED_FILE_COLUMNS} leave the
   *     driver. It is the same posture the download door reads a file in (by
   *     id, under the system context, never the caller's `sys_file` grant).
   *     `sys_file`'s own read rule is untouched: this read serves only the ids
   *     a record the caller just read holds, and the caller's own `sys_file`
   *     queries are refused exactly as before.
   *  2. **May this caller read those owners' files?** The registered
   *     {@link FieldOwnedFileReadAuthorizer} — the door's own field-owned arm,
   *     handed over by the storage plugin, never re-derived here — asked ONCE
   *     with every owner id, under the caller's envelope minus its
   *     operation-private `__` keys (`withoutOperationPrivateKeys`: the
   *     verdict judges the caller, not this sub-read). It consults the
   *     owner object's `fileAccessDelegate` where one is declared, so a
   *     delegate-governed object gets the delegate's answer and not the raw
   *     record read.
   *
   * Narrower than the door, by the ruling: the door also serves a file's
   * uploader and a file reachable through any `sys_attachment` parent; this
   * serves only a file owned by the record it is read in.
   *
   * Returns, per allowed file id, the owning record's id and its servable row
   * — `null` when the row is owned and allowed but not servable, which the
   * caller reads as the bare id a `sys_file` reader would see. An id absent
   * from the map keeps the refused marker. Unwired, no record ids, or a
   * failure: an empty map — every id stays refused, the answer before this
   * existed. [#26672] `find` / `findOne` read `id` for any projection that
   * names a file field ({@link withFileOwnerKey}), so a caller's projection
   * that leaves `id` out does not land here.
   */
  private async readParentDerivedFiles(
    objectName: string,
    records: any[],
    uniqueIds: string[],
    execCtx?: ExecutionContext,
  ): Promise<Map<string, { ownerId: string; row: any | null }>> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts` (see `FileReferenceHydrationHost`).
    const readFieldOwnedFileReadAuthorizer = () => this._fieldOwnedFileReadAuthorizer;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof readParentDerivedFiles> = {
      get _fieldOwnedFileReadAuthorizer() { return readFieldOwnedFileReadAuthorizer(); },
      find: (...a) => this.find(...a),
      servableFileRows: (...a) => this.servableFileRows(...a),
      get logger() { return readLogger(); },
    };
    return readParentDerivedFiles.call(host, objectName, records, uniqueIds, execCtx);
  }

  // ============================================
  // Data Access Methods (IDataEngine Interface)
  // ============================================

  /**
   * Expand `{filter-placeholder}` values in a read AST's `where` against the
   * request (framework#3582).
   *
   * Filters travel as JSON, so a time- or user-scoped slice authored in a view,
   * dashboard, related list or REST query writes `'{current_year_start}'` /
   * `'{current_user_id}'` rather than a literal. Until now nothing on the server
   * substituted them: the placeholder reached the driver as a string, compared
   * as text, and matched nothing — an empty grid with no error anywhere.
   *
   * The engine is the right seam because it is the ONE gate every server-side
   * read passes through (REST, SDK, related lists, flow `find_records`, sharing
   * graph reads), so a surface that follows the filter contract works the day it
   * ships instead of waiting for its own resolver. It runs BEFORE the middleware
   * chain so only author-supplied filters are inspected; the RLS/sharing filters
   * injected downstream are built from concrete context values and carry no
   * placeholders.
   *
   * Cheap by construction: {@link resolveFilterTokens} returns the input by
   * reference when the tree holds no placeholder, which is every internal query.
   * An unresolvable placeholder throws (see the resolver's module doc) — the one
   * outcome an author can act on.
   *
   * [#20334] `position` names the AST's filter slot: `where` (every read verb)
   * or `having` (`aggregate`). One resolver for both, so a placeholder reads the
   * same in either position: `{current_year_start}` resolves, and an unknown one
   * is `FILTER_TOKEN_UNKNOWN` / 400. The resolver needs no field type — it walks
   * values, never keys — so a `having` keyed by aggregate aliases resolves as a
   * `where` keyed by fields does.
   *
   * [ADR-0053 D-D1, amended — #5930] …and then LOWERS the position, through
   * {@link resolveThenLowerWhere}: resolution and lowering are one stage, so a
   * verb cannot run one without the other. `lowering` is required for that
   * reason — the position's declared-type reader (`where`: the object's
   * fields; `having`: the aggregated row's columns).
   */
  private async resolveWhereTokens(
    ast: QueryAST | undefined,
    execCtx: ExecutionContext | undefined,
    lowering: FilterLoweringOptions,
    position: 'where' | 'having' = 'where',
    operation = 'find',
  ): Promise<void> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts` (see `QueryLoweringHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolveWhereTokens> = {
      get _registry() { return readRegistry(); },
      resolveRelateThenLowerWhere: (...a) => this.resolveRelateThenLowerWhere(...a),
    };
    return resolveWhereTokens.call(host, ast, execCtx, lowering, position, operation);
  }

  /**
   * [#20802] Stage 2 of `where` admission on every verb, whole: resolve the
   * placeholders, then LOWER EACH NESTED-RELATION CONDITION
   * ({@link lowerRelationConditions}), then run the shared lowering
   * ({@link resolveThenLowerWhere}'s second half, `lowerFilterCondition`).
   *
   * The order is ADR-0053 D-D1 item 3's, extended by one step: tokens first,
   * so a condition on the related object carries the resolved values (one
   * instant for the whole filter) into the related read; the relation step
   * before the shared lowering, so that lowering reads the `$in` / `$contains`
   * the relation step produced — including the NULL-safe `$not` over it — and
   * never a nested object whose columns belong to another object.
   */
  private async resolveRelateThenLowerWhere<W>(
    object: string,
    operation: string,
    where: W,
    execCtx: ExecutionContext | undefined,
    lowering: FilterLoweringOptions,
  ): Promise<W> {
    const resolved = resolveWhereFilterTokens(
      where, execCtx, whereResolvedTokenJudge(object, operation, this._registry.getObject(object)),
    );
    const related = await this.lowerRelationConditions(object, operation, resolved, execCtx);
    return lowerFilterCondition(related, lowering);
  }

  /**
   * [#20802] The registry's declared schema of a related object, by name —
   * what the `where` door admits a nested-relation condition's keys against.
   */
  private readonly relatedSchemaOf = (name: string): unknown => this._registry.getObject(name);

  /**
   * [#20802] Lower every nested-relation condition in one `where` —
   * `{ owner: { region: 'NA' } }` beneath a relation field — into a filter
   * every driver answers, by READING the related object: the ids of the
   * records the condition matches become `$in` on a single-valued relation, or
   * an `$or` of `$contains` per id on a multi-valued one
   * (`relation-filter-lowering.ts` holds the forms, the cap and the words).
   *
   * **As the caller.** The read is this engine's own `find` on the related
   * object with the caller's execution context — not a driver call and not a
   * system read — so the related object's CRUD gate, row scope and field
   * permissions apply exactly as they do to a direct read of it, and its own
   * doors judge the condition's comparands against its own declarations. A
   * refusal from any of them is the answer, loudly; nothing is swallowed.
   *
   * **Bounded.** The read asks for one id more than
   * {@link RELATION_FILTER_ID_CAP}; receiving it, the filter is refused
   * (`INVALID_FILTER` / 400, the two-step route in the words), never run over
   * a cut-off list.
   *
   * Returns `where` by reference when it holds no condition — the common path
   * reads nothing and allocates nothing beyond one walk.
   */
  private async lowerRelationConditions<W>(
    object: string,
    operation: string,
    where: W,
    execCtx: ExecutionContext | undefined,
  ): Promise<W> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts` (see `QueryLoweringHost`).
    const readRegistry = () => this._registry;
    const readRelatedSchemaOf = () => this.relatedSchemaOf;
    const host: ThisParameterType<typeof lowerRelationConditions> = {
      get _registry() { return readRegistry(); },
      get relatedSchemaOf() { return readRelatedSchemaOf(); },
      find: (...a) => this.find(...a),
    };
    return (lowerRelationConditions<W>).call(host, object, operation, where, execCtx);
  }

  /**
   * The write-path counterpart of {@link resolveWhereTokens}: return `options`
   * with `where` placeholders expanded (#3810).
   *
   * Returns the SAME object when nothing resolved — `resolveFilterTokens`
   * returns its input by reference on a placeholder-free tree, so the common
   * path allocates nothing. When something does resolve, a shallow copy is
   * made rather than assigning through: `options` belongs to the caller, and
   * writing back would bake one request's user id into a filter object the
   * caller may reuse (view metadata and flow node config both get reused).
   *
   * [ADR-0053 D-D1, amended — #5930] …and lowered, in the same stage
   * ({@link resolveThenLowerWhere}), with the object's declared-type reader.
   * The lowering is copy-on-write too, so a `where` it rewrites lands on the
   * copy, never on the caller's object.
   */
  private async withResolvedWhere<T extends { where?: unknown; context?: ExecutionContext } | undefined>(
    object: string,
    operation: string,
    options: T,
    lowering: FilterLoweringOptions,
  ): Promise<T> {
    if (!options || options.where == null) return options;
    // [#20157] Through the stage function the judge also calls. [#20802] …with
    // the nested-relation step between resolution and the shared lowering.
    const resolved = await this.resolveRelateThenLowerWhere(object, operation, options.where, options.context, lowering);
    return resolved === options.where ? options : ({ ...options, where: resolved } as T);
  }

  /**
   * ADR-0061: expand `search` into a server-resolved cross-field `$or` of
   * `$icontains`, AND it with any caller `where`, then strip the search keys off
   * the AST.
   *
   * Shared by `find` and `findOne` (#4419). It lived inline in `find` and
   * nowhere else, while `ENGINE_FIND_OPTION_KEYS` — the one legal-key set BOTH
   * methods are checked against (see {@link ENGINE_OPTION_KEY_SETS}) — declares
   * `search`/`searchFields` for both. So `findOne({ search })` passed the gate,
   * rode onto the AST verbatim, and reached a driver: no driver reads
   * `ast.search` (the expansion is the engine's job by ADR-0061), so the
   * predicate vanished and the forced `limit: 1` turned it into the first row of
   * the WHOLE object — a real, plausible-looking record unrelated to the search.
   * That is #4419's reported failure exactly, under a different key than the
   * `filter` #4346 closed; one expander, called from both, is what stops the
   * pair drifting again.
   *
   * Field resolution is server-side (declared `searchableFields` →
   * auto-default); the optional `searchFields` override is intersected with the
   * allowed set, never widened. All drivers already execute `$or`/`$icontains`,
   * so this needs no driver changes.
   *
   * [#29394] A resolved field whose declared type can never hold a string (the
   * #15661 door's verdict) gets no clause — `expandSearchToFilter` skips it —
   * because that door judges only the caller's `where`, above, and never this
   * expansion. The set itself is not narrowed, so the refusals below judge it
   * as before, and a set of only such fields answers no rows.
   *
   * The keys are deleted whether or not anything expanded — leaving them on
   * would hand the driver a key it does not read, which is the same silent drop
   * one layer down.
   */
  private expandSearchOnAst(
    ast: QueryAST,
    schema: ServiceObject | undefined,
    context: ExecutionContext | undefined,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-find.ts` (see `FindHost`).
    const host: ThisParameterType<typeof expandSearchOnAst> = {
      resolveSearchQueryableFields: (...a) => this.resolveSearchQueryableFields(...a),
    };
    return expandSearchOnAst.call(host, ast, schema, context);
  }

  /**
   * [#25672] The fields `context` may query on `object`, asked of the
   * registered `security` service's `getQueryableFields` — the answer the
   * field-read predicate guard is the complement of. `undefined` narrows
   * nothing, and is the answer when no context is carried (a context-less
   * read is never asked about, as `searchAll` does), when no security service
   * is registered or it has no such method, or when it gives no answer: the
   * guard still judges the search, so an absent answer can only leave the
   * request as strict as it was. A throw from the method propagates.
   */
  private async resolveSearchQueryableFields(
    object: string,
    context: ExecutionContext | undefined,
  ): Promise<ReadonlySet<string> | undefined> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts` (see `QueryLoweringHost`).
    const readSecurityServiceSourceSlot = () => (this as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT];
    const host: ThisParameterType<typeof resolveSearchQueryableFields> = {
      get [SECURITY_SERVICE_SOURCE_SLOT]() { return readSecurityServiceSourceSlot(); },
    };
    return resolveSearchQueryableFields.call(host, object, context);
  }

  /**
   * The aggregate and count verbs' door into {@link expandSearchOnAst} — ⛔ not
   * a second expander. `QuerySchema.search` (ADR-0061 D1) is declared beside
   * `groupBy` / `aggregations` with no carve-out, so a grouped read under a
   * search groups the SEARCHED rows, and a count under one counts them (#22790:
   * `findData`'s paged `total`): the same cross-field `$or`, resolved from the
   * same server-side searchable set, `internal: true` exclusion and
   * `searchFields` narrowing, ANDed with `where` exactly as on `find` — before
   * the security middlewares run, so an injected RLS predicate composes with it
   * the same way on every verb.
   *
   * The expansion runs on a carrier AST holding only the three keys it reads,
   * and the result is a COPY of `query` with `where` replaced and the two
   * search keys gone: the bag belongs to the caller (view metadata and flow
   * node config are reused), and a search key left on it would ride to
   * `opCtx.options` unexpanded. The common path — no search key — returns the
   * same reference and allocates nothing.
   */
  private async expandSearchOnOptions<T extends EngineAggregateOptions | EngineCountOptions>(
    object: string,
    query: T,
    options: EngineReadOptions | undefined,
  ): Promise<T> {
    if (query.search === undefined && query.searchFields === undefined) return query;
    const { search, searchFields, ...rest } = query;
    const carrier = { object, where: rest.where, search, searchFields } as QueryAST;
    await this.expandSearchOnAst(carrier, this._registry.getObject(object), mergeReadContext(query.context, options?.context));
    if (carrier.where === undefined) return rest as T;
    return { ...rest, where: carrier.where } as T;
  }

  /**
   * [commit 74155c735] Fill the author-state defaults the query schemas declare, so the
   * AST handed to middlewares, hooks and drivers is the PARSED state
   * `QueryAST` (a `z.infer` type) promises.
   *
   * ADR-0122 made `EngineQueryOptions` the author state (`z.input`): a key
   * with a declared `.default()` is optional to write. `find`/`findOne` kept
   * demanding the parsed state anyway (commit 53068c130 pinned them back) because the
   * engine built its AST by bare spread and filled no default — `order:
   * undefined` would have ridden straight to the driver. This is the filling.
   * Each defaulting node is run through ITS OWN schema rather than
   * hand-assigning values, so a default declared in `packages/spec` stays the
   * single source of truth:
   *
   * - `orderBy[]` nodes through `SortNodeSchema` — fills `order: 'asc'`, the
   *   query path's one declared default. Measured before the flip: every
   *   driver already coalesces a missing `order` to `'asc'` (`sql-driver.ts`
   *   `s.order || 'asc'`, `memory-driver.ts`, `mongodb-driver.ts`,
   *   `remote-transport.ts` likewise), so the filled value changes no query's
   *   answer — it makes the AST say what the drivers were already assuming.
   *   Parsing also applies the node's declared strictness to type-BYPASSING
   *   callers: an unknown sort key, or the retired `direction` spelling, is
   *   now refused with the schema's own prescription instead of silently
   *   dropped-or-honored per driver (#4721's defect class) — the same refusal
   *   `normalizeSortNodes` already makes on the wire path.
   * - `expand` values recurse: a nested query is the same authoring surface.
   *   No driver reads `ast.expand` (the engine expands post-fetch), and the
   *   nested read that executes re-enters `find()` — which fills again — so
   *   the recursion keeps the AST's type honest without a cast.
   *
   * `search` is deliberately NOT parsed, though `FullTextSearchSchema` carries
   * three flag defaults (`fuzzy`/`operator`/`highlight`). Two measurements
   * decide it. First, nothing can ever read them off the AST: no executor
   * reads the flags at all (#4286 — the ADR-0061 expansion reads only `query`
   * + `fields`), and {@link expandSearchOnAst} deletes `search` from the AST
   * before middlewares, hooks or the driver see it, so a filled value would be
   * constructed and then discarded unread. Second, parsing would REFUSE input
   * the engine deliberately accepts: the wire path hands this method
   * `search.fields` in the comma-STRING shape (and the `q` spelling) that
   * `resolveSearchFields`/`normalizeSearch` tolerate by design — pinned in
   * `query-expression-conformance.test.ts` — while the schema declares
   * `fields: string[]`. The type-level gap this leaves (author-state `search`
   * inside a `QueryAST`-typed value, until the key is deleted a few lines
   * later) is covered by the same single cast as `expand`, below.
   *
   * `where`/`fields`/`limit`/`offset`/`top` carry no `.default()` or
   * `.transform()` (pinned in `filter.zod.ts`'s own docs) and are not parsed —
   * the cost is one small-object parse per authored sort node / search
   * config, only when the key is present.
   */
  private fillQueryAstDefaults<T extends Pick<QueryInput, 'orderBy' | 'search' | 'expand'>>(
    query: T,
  ): T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> } {
    const out: Record<string, unknown> = { ...query };
    if (Array.isArray(out.orderBy)) {
      out.orderBy = out.orderBy.map((node) => SortNodeSchema.parse(node));
    }
    if (out.expand != null && typeof out.expand === 'object') {
      const expand: Record<string, unknown> = {};
      for (const [field, nested] of Object.entries(out.expand)) {
        expand[field] = this.fillQueryAstDefaults(nested as QueryInput);
      }
      out.expand = expand;
    }
    // The one cast in the flip: `orderBy`/`expand` are rebuilt above; `search`
    // is claimed-but-not-parsed, per the doc — deleted from the AST unread.
    return out as T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> };
  }

  /**
   * Refuse a `findOne` that selects nothing in particular (#4419).
   *
   * The AST reaching here is the CALLER's own intent: aliases folded, unknown
   * keys refused, `search` expanded — but the security/sharing middlewares have
   * not run yet, and that ordering is the point. An injected RLS predicate
   * narrows *which* rows are visible; it does not make "whichever of them comes
   * first" a thing the caller asked for. Judging the post-middleware AST would
   * pass every query on a scoped object and leave the hole open where it is
   * most expensive.
   *
   * "Selects nothing" is read the same way #3896 read an empty sharing
   * criteria: absent, `null`, or `{}` — the three shapes that mean "match every
   * row". This guard closes the one case that is unambiguously
   * match-everything, not everything it cannot prove.
   *
   * [#5158] This comment used to add: "a `where` that is not a plain object (an
   * expression tree) is the DRIVER'S to interpret, and counts as a predicate."
   * That sentence was the engine's blessing of a second filter dialect, and it
   * cost exactly what a blessing costs — `findOne({ where: [] })` counted as a
   * predicate, walked past this guard, and returned an ARBITRARY row: the #4419
   * defect surviving inside #4419's own guard. `FilterArray` is now lowered by
   * {@link lowerWhereFilterArray} at every entry point, so by the time this
   * runs `where` is a `FilterCondition` or nothing. The `Array.isArray` arm
   * below is kept as defence in depth for a subclass or a future caller that
   * reaches this method without lowering — it is no longer a contract.
   *
   * `orderBy` is the other way to be specific, and a legitimate one — "the
   * newest", "the highest priority". It is honored on this path by every
   * driver, so it is a real answer and not a second silent drop.
   */
  private requireFindOnePredicate(object: string, ast: QueryAST): void {
    // [#29986 codemod] The body moved to `engine-find.ts`.
    return requireFindOnePredicate(object, ast);
  }

  async find(object: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<any[]> {
    object = this.resolveObjectName(object);
    // Normalize the alias spellings (`filter`→`where`, `top`→`limit`) by the
    // spec's slot table — the driver AST only understands the canonical keys,
    // so an unfolded `{ filter }` would match ALL rows (silent over-grant —
    // surfaced by ADR-0057's sharing/graph read path). Same fold, same
    // conflict rule on every engine entry point (#4346). The wire-only
    // spellings (`sort`/`select`/`skip`/`populate`) are REJECTED instead of
    // folded — a direct call carrying one used to have it silently dropped
    // (#4371, three shipped instances in #4370).
    query = foldEngineOptionAliases(object, 'find', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(object, 'find', query, ENGINE_FIND_OPTION_KEYS);
    // [#27008] An empty projection is refused, never read as every column.
    assertProjectionNamesAField(object, 'find', query);
    query = lowerWhereFilterArray(object, 'find', query, this._registry.getObject(object), this.relatedSchemaOf);
    this.logger.debug('Find operation starting', { object, query });
    const driver = this.getDriver(object);
    // `object` LAST: the resolved name must win. Spread-first used to let a
    // stray `query.object` overwrite it, splitting the AST's object from the
    // table actually queried (#4371 option-2 survey) — every middleware and
    // hook reading `ast.object` would have been lied to.
    // `context` is dropped HERE rather than `delete`d from the built AST: since
    // ADR-0122 the caller-supplied `context` is the AUTHOR state (every key
    // optional) while `QueryAST` carries the parsed one, so spreading it in and
    // removing it a line later would type the AST with a context it never holds.
    // [commit 74155c735] The rest of the bag is author state too now — the defaults its
    // schemas declare are filled here, before anything downstream reads the AST.
    const { context: _findContext, ...findQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findQuery), object };
    // [ADR-0100] A `secret` / `password` column is never a filter or sort key
    // for a non-system caller — judged on the caller's own `where` / `orderBy`
    // / `expand`, before the search term is expanded into `where` and before
    // the middlewares inject their server-authored filters.
    // [internal: true] …and a flagged column is never evaluated for one either,
    // judged first so the refusal is the data door's own (the door asks the
    // same definition before the engine runs).
    rejectInternalFieldEvaluation(object, ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
    rejectCredentialEvaluation(object, 'find', ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);

    // Plan formula projection: rewrite ast.fields to drop virtual formula
    // names and inject their dependencies, so the driver returns the raw
    // fields needed to compute the formulas after fetch.
    const _findSchema = this._registry.getObject(object);

    await this.expandSearchOnAst(ast, _findSchema, mergeReadContext(query?.context, options?.context));
    // [#7642] The caller's OWN projection, captured before any planning pass
    // rewrites it — the only thing that can answer "did this caller ask for
    // `__search`?". See `stripSearchCompanionFromRead`.
    const _findRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    // [#7095] Before the projection is planned and before anything is handed to
    // a driver: an ORDER BY this engine cannot materialise is refused, not
    // dropped. `fillQueryAstDefaults` has already normalised `orderBy` into
    // `SortNode[]`, so the names read here are the ones the driver would get.
    assertOrderByIsMaterializable(object, 'find', _findSchema, ast.orderBy);
    // [#7589] The projection's DOTTED leg, judged on the caller's own
    // spellings BEFORE the formula planner rewrites the projection: a dotted
    // entry is structurally unresolvable (no populate step exists — #7601)
    // and is refused loudly instead of riding its head segment into the
    // driver, where the #3821 ladder answered it with EVERY field.
    assertProjectionHasNoDottedPaths(object, 'find', _findSchema, ast.fields);
    const _findFormula = planFormulaProjection(_findSchema, ast.fields);
    // [#26672] …and a file field's owner key — see `withFileOwnerKey`.
    const _findProjection = withFileOwnerKey(_findSchema, ast.fields, _findFormula);
    if (_findProjection.projected) ast.fields = _findProjection.projected;
    // [#22300] The columns that widening added, cut back off the answer at the
    // `return` — see `withoutFormulaWidening`.
    const _findWidened = _findProjection.widened ? new Set(_findProjection.widened) : undefined;

    // Drop any requested PLAIN field that doesn't exist on the schema.
    // Without this, drivers (notably SqlDriver) emit `SELECT unknown_col
    // FROM ...` which the DB rejects ("no such column") — and SqlDriver
    // swallows that error and returns `[]`, making a frontend bug (e.g. a
    // generic view requesting `name`/`due_date` on every object) look like
    // "no records exist". Silently filtering matches the existing OData
    // tolerance and Salesforce/Postgres behavior of `SELECT *` semantics.
    //
    // [#7589] This tolerance is for unknown PLAIN columns ONLY, and it is
    // KEPT deliberately (ruled 2026-08-12): the "no records exist" failure it
    // prevents is real, and the driver-side half of the same tolerance
    // backstops registry-less hosts. A structurally unresolvable (dotted)
    // projection is a different fact and no longer reaches this filter via
    // the engine — `assertProjectionHasNoDottedPaths` above refused it.
    if (_findSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      // Always allow the primary key + audit columns even if not present in
      // schema.fields. Without this, callers requesting `select=id,name`
      // silently get the `id` projected away, breaking record navigation.
      // [#21571] The same three the default projection and the write door
      // admit — `PLATFORM_PROVISIONED_COLUMNS`, one list.
      const known = new Set<string>([...Object.keys(_findSchema.fields), ...PLATFORM_PROVISIONED_COLUMNS]);
      // Whole names, no head-splitting: only plain entries reach here (the
      // dotted refusal above fired on anything carrying a '.').
      const filtered = ast.fields.filter(f => known.has(f));
      // [#27165] Nothing left is an empty projection, refused as `fields: []`
      // is — never read as every column.
      if (filtered.length === 0) refuseProjectionOfUnknownColumns(object, 'find', ast.fields);
      ast.fields = filtered;
    }

    const opCtx: OperationContext = {
      object,
      operation: 'find',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    // [ADR-0053 D-D1, amended — #5930] Resolve, then lower (the shared
    // lowering), against the object's declared field types.
    await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, declaredDatetimeLowering(_findSchema), 'where', 'find');

    await this.executeWithMiddleware(opCtx, async () => {
      const hookContext: HookContext = {
          object,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeFind', hookContext);
      hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      // [ADR-0139 D2] The executor boundary: the AST is final here — after the
      // doors, the middleware chain and `beforeFind` — so every `ReadableIds`
      // leaf is composed (or refused) on it, immediately before the driver.
      const driverAst = await this.composeReadableIdsAtBoundary(object, 'find', hookContext.input.ast as QueryAST, opCtx.context);

      try {
          let result = await driver.find(object, driverAst, hookContext.input.options as any);

          // [#21571] The read's default projection is the DECLARED field set:
          // a column no metadata declares (a field retired in an upgrade,
          // whose column additive sync leaves behind) never leaves the engine.
          // Shaped here, on the rows as the driver returned them, so it holds
          // whichever driver answered and whichever rung of a driver's
          // recovery ladder answered (driver-sql retries `select('*')` when a
          // projected statement names a missing column) — and before formulas,
          // `expand`, file references and the hooks, so all of them see the
          // declared record. See `declared-read-columns.ts`.
          if (Array.isArray(result)) {
            result = rowsWithDeclaredColumnsOnly(result, declaredColumnSet(_findSchema));
            // [#29408] …and answered on every stored declared column the read
            // SELECTED: one the driver returned no key for (a driver that
            // stores only written columns) is `null`, as driver-sql's column
            // answers — the row's persisted state is in hand. Unselected,
            // formula and FLS-refused columns stay absent; see
            // `selectedStoredColumns`.
            result = rowsWithSelectedColumnsAnswered(result, selectedStoredColumns(_findSchema, driverAst?.fields));
          }

          // Post-process: evaluate formula virtual fields against the raw rows.
          // [#20082] With the caller's permission map when a formula calls
          // `can` — one resolution for the whole result set, never per row.
          if (Array.isArray(result)) {
            applyFormulaPlan(_findFormula.plan, result, opCtx.context, await this.resolveFormulaPermissions(
              object, _findFormula.plan, result, opCtx.context, this.permissionResolution(opCtx.context),
            ), this.formulaFaultSink(object), await this.resolveFormulaRelated(
              // [#24197] One batched read per reference field for this PAGE —
              // the rows the driver returned, after limit/offset.
              _findSchema, _findFormula.plan, result, opCtx.context, query,
            ), this.formulaOptionLabels(_findSchema, _findFormula.plan, opCtx.context));
          }

          // Post-process: expand related records if expand is requested
          if (ast.expand && Object.keys(ast.expand).length > 0 && Array.isArray(result)) {
            result = await this.expandRelatedRecords(object, result, ast.expand, 0, opCtx.context);
          }

          // Post-process: resolve file-field id references to their expanded
          // read form (ADR-0104 D3), one of three: the FileValueSchema file
          // object, the bare id when nothing resolves it, or
          // FileRefusedValueSchema's `{ id, metadataRefused: true }` when this
          // caller is refused the `sys_file` read. Always-on but free unless a
          // file field holds an id string; dual-mode-safe (blobs pass through).
          if (Array.isArray(result)) {
            result = await this.resolveFileReferences(object, result, opCtx.context);
          }

          hookContext.event = 'afterFind';
          hookContext.result = result;
          await this.triggerHooks('afterFind', hookContext);

          // [#15823] `find()` GUARANTEES the array, so the one seam that can
          // break the declaration is closed here. An `afterFind` handler may
          // SHAPE a read — mutate rows, drop keys, filter rows out, assign a
          // different ARRAY — but replacing the container is a hook-contract
          // violation, refused loudly rather than returned as an envelope a
          // caller's `Promise<any[]>` says cannot occur (ruled 2026-09-06).
          //
          // ⛔ Placement is load-bearing and not the `return`: `maskSecretFields`
          // and `stripSearchCompanionFromRead` below BOTH assume the array and
          // both run on `hookContext.result`, so the check has to precede them —
          // otherwise the first consumer to walk a replaced container is the
          // one that reports the problem, from the wrong place.
          if (!Array.isArray(hookContext.result)) {
            throw new FindHookResultNotArrayError({
              object,
              event: 'afterFind',
              result: hookContext.result,
            });
          }

          // Never let secret-field plaintext (or its ref) leave through the
          // generic read path — mask after hooks run. Privileged consumers use
          // resolveSecret() against the stored ref instead.
          this.maskSecretFields(object, hookContext.result);

          // [#7642] …and never let the hidden `__search` companion column out
          // through the default projection either. After the hooks, for the
          // same reason the mask is: a server-side `afterFind` handler is not
          // the client this column is hidden from.
          this.stripSearchCompanionFromRead(hookContext.result, _findRequestedFields, opCtx.context);

          return hookContext.result;
      } catch (e) {
          this.reportFindFailure(object, e);
          throw e;
      }
    });

    // [#22300] The formula widening is cut back off the answer here, after the
    // middleware chain — every internal consumer above read the full row.
    return rowsWithoutFormulaWidening(opCtx.result as any[], _findWidened);
  }

  /**
   * Report a failed {@link find} at the level its CAUSE earns — then leave the
   * throw exactly where it was.
   *
   * ## The two facts this frame used to merge
   *
   * "The table has not been created yet" and "the read failed" are different
   * facts, and until commit 3a86a65e7 this line reported both at `error`, with a stack.
   * The first one is the ordinary state of a database nobody has migrated yet,
   * and every caller on that path already treats it as a normal answer and says
   * so in its own code: {@link readMigrationFlagVerified} ("an unreadable table
   * … → false"), `ObjectQLPlugin.readAuthoredHookRows` /
   * `readAuthoredActionRows` (report `authoredRows: 0` and carry on),
   * `readAuthoredTranslationLayer`, and `ObjectStoreActionActivationStore.probe`
   * (whose caller already follows this frame with a `warn` stating the
   * consequence in operator terms).
   *
   * Measured, on `os migrate plan --database-url file:<an unmigrated db>`: five
   * ERROR records with full stack traces, out of a command that EXITS 0 and
   * prints a correct plan. Four stack traces are the first thing an operator
   * sees when planning a database whose whole point is that it is not migrated
   * yet — and an `error` channel that fires on a routine state is the
   * over-application `sql-driver.ts` already names on a nearby line: it trains
   * everyone to skim `error`.
   *
   * ## ⛔ What this is NOT is a broadened catch
   *
   *   * The throw is UNCHANGED on both branches. No caller's control flow, no
   *     caller's `catch`, and no error envelope moves — this method decides a
   *     log level and nothing else.
   *   * Only the class that positively identifies as "relation does not exist"
   *     is demoted, asked through the shared {@link isMissingTableError}
   *     predicate (`@objectstack/metadata/errors`, #4825) — the same call
   *     {@link probeInstallOrganizations} and {@link resolveFileReferences}
   *     make, never a hand-rolled `code === '42P01'` copy. That predicate earns
   *     a benign verdict rather than defaulting to one: a connection drop, a
   *     timeout, a permission denial, a query fault — and, through its
   *     `excludes`, Postgres' `column "x" of relation "y" does not exist`,
   *     which contains a legal missing-table phrase but is a column fault on a
   *     table that EXISTS — all stay on the loud branch, with the stack (at
   *     `warn`; the last section says why not `error`).
   *   * The fault stays visible without this frame: the driver's own refusal
   *     envelope (`SqlDriver.backendStatementFault` → `logger.warn`) carries
   *     the table, the dialect reason and the compiled statement, and is
   *     untouched here. That is deliberately the surviving loud half, and it is
   *     the half `runtime/src/expected-read-refusal-noise.ts` already documents
   *     as "where this class of fault can still be picked up".
   *
   * `debug` rather than `warn` for exactly that reason: the driver already puts
   * one warn-level line per refusal in front of a reader, so a second would
   * move this noise rather than remove it. What the demotion drops is the
   * duplicate and its stack; the classification survives in the meta.
   *
   * The `debug` demotion is READS only: a write to a table that does not exist
   * is not a normal answer for any caller, and takes the write doors' `warn`
   * like every other write fault does (#17052).
   *
   * ## The loud branch is `warn`, not `error` — the caller is told
   *
   * [#17212] Every cause the predicate does NOT earn a benign verdict for is
   * reported at `warn`, with its message and stack, and `find`'s `catch` then
   * rethrows it — `throw e` is that catch's only exit. That is AGENTS.md's
   * third legal answer (*Degradation log levels*): "a failure handed to the
   * CALLER is not a degradation at all … Do not bolt a `logger.error` onto
   * such a site". The requester IS told — the throw is the answer — so an
   * `error` line is a second, louder report of a fact the caller already has.
   * The write doors moved for the same reason (#17052): their catches rethrow
   * too.
   *
   * ⛔ Demoted, not deleted — only the level moved. The message and the stack
   * survive through {@link writeFailureLogMeta}: `warn(message, meta?)` has no
   * `Error` slot, and an Error handed over AS meta serializes to `{}` (its
   * `message`/`stack` are non-enumerable). On the SQL read path the fault is
   * also reported one frame down on the driver's own `warn` —
   * `SqlDriver.backendStatementFault` for every backend fault it measured
   * (connection, timeout and ACL included), `unresolvableFilterColumnRefusal`
   * for an unresolvable WHERE column. The filter COMPILER's refusals
   * (`uncompilableFieldReferenceError` and its siblings) have no driver line:
   * they are raised before the statement runs, as refusals carrying a declared
   * `400` — a rejected request, answered to its caller.
   */
  private reportFindFailure(object: string, error: unknown): void {
    // [#29986 codemod] The body moved to `engine-find.ts` (see `FindHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof reportFindFailure> = {
      get logger() { return readLogger(); },
    };
    return reportFindFailure.call(host, object, error);
  }

  /**
   * Read the ONE record the query selects, or `null`.
   *
   * `findOne` applies `limit: 1` by contract — so unlike `find`, the query's
   * predicate is the only thing standing between the caller and *an arbitrary
   * row*. A query that selects nothing in particular does not return nothing;
   * it returns the object's first row, which is a real, plausible-looking
   * record that no caller's `if (!row)` check can catch, and that propagates
   * into whatever is computed next (#4419). So this method REQUIRES the caller
   * to say which record it wants:
   *
   * - `where` (or the `filter` alias, folded here), or a `search` that expands
   *   to one — the record is selected by predicate.
   * - `orderBy` — "the FIRST record in this order" (the newest, the highest
   *   priority). Deterministic without a predicate, and honored by every
   *   driver on this path.
   *
   * Neither → throws. If any row genuinely will do, that is
   * `find(object, { limit: 1 })`, which says so at the call site.
   *
   * No ordering is IMPOSED when the caller supplies none: `ORDER BY <pk> LIMIT
   * 1` makes a planner abandon the predicate's own index (objectstack#4363, and
   * see `SqlDriver.findRows`' `singleRowLookup`). `findOne` promises *a*
   * matching record, never a position in a sequence.
   *
   * Fires the same `beforeFind`/`afterFind` hooks as `find` (#3195).
   */
  async findOne(objectName: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<Record<string, any> | null> {
    objectName = this.resolveObjectName(objectName);
    // Same alias fold as find() (#4346). Without it, `findOne({ filter })`
    // matched the first row of the WHOLE table rather than the predicate.
    // `top` folds into `limit` here too, but findOne is single-row by
    // contract, so the literal `limit: 1` below wins over both spellings.
    // Wire-only spellings are rejected, same as find() (#4371) — `sort`
    // matters here too: findOne({ sort }) means "first row of THIS order".
    query = foldEngineOptionAliases(objectName, 'findOne', query, ENGINE_QUERY_SLOTS, ENGINE_WIRE_ONLY_SLOTS);
    rejectUnknownEngineOptions(objectName, 'findOne', query, ENGINE_FIND_OPTION_KEYS);
    // [#27008] Same refusal as find().
    assertProjectionNamesAField(objectName, 'findOne', query);
    query = lowerWhereFilterArray(objectName, 'findOne', query, this._registry.getObject(objectName), this.relatedSchemaOf);
    this.logger.debug('FindOne operation', { objectName });
    const driver = this.getDriver(objectName);
    // `object` after the spread for the same reason as find(); `limit: 1`
    // last — findOne is single-row by contract.
    // Same reason as find(): the caller's `context` is the author state and the
    // AST carries the parsed one, so it leaves before the AST is typed.
    // [commit 74155c735] And the same default-filling as find(), for the same reason.
    const { context: _findOneContext, ...findOneQuery } = query ?? {};
    const ast: QueryAST = { ...this.fillQueryAstDefaults(findOneQuery), object: objectName, limit: 1 };
    // [ADR-0100] Same internal-field and credential-column refusals as `find`, same position.
    rejectInternalFieldEvaluation(objectName, ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);
    rejectCredentialEvaluation(objectName, 'findOne', ast, mergeReadContext(query?.context, options?.context), this.relatedSchemaOf);

    // Plan formula projection (same as find): rewrite ast.fields so the driver
    // returns the raw dependency fields, then evaluate formulas after fetch.
    const _findOneSchema = this._registry.getObject(objectName);
    // Before the guard below, so a `search` that resolves to a real filter
    // counts as the predicate it is (#4419).
    await this.expandSearchOnAst(ast, _findOneSchema, mergeReadContext(query?.context, options?.context));
    this.requireFindOnePredicate(objectName, ast);
    // [#7095] Same refusal as `find`, and it matters MORE here: `findOne`
    // applies `limit: 1`, so `orderBy` is the whole of "which record" — a
    // dropped sort does not merely reorder the answer, it returns a DIFFERENT
    // record, and the one it returns looks exactly as legitimate.
    assertOrderByIsMaterializable(objectName, 'findOne', _findOneSchema, ast.orderBy);
    // [#7589] Same dotted-projection refusal as `find`, same position: on the
    // caller's own spellings, before the formula planner rewrites them. The
    // measured flow chain (`get_record` → `data.findOne`) reaches THIS verb
    // whenever `limit` is absent or 1, so a hole here would be the same hole.
    assertProjectionHasNoDottedPaths(objectName, 'findOne', _findOneSchema, ast.fields);
    // [#7642] Caller's own projection, before planning rewrites it — see `find`.
    const _findOneRequestedFields = Array.isArray(ast.fields) ? [...ast.fields] : undefined;
    const _findOneFormula = planFormulaProjection(_findOneSchema, ast.fields);
    // [#26672] Same as `find`: a file field's owner key is read too.
    const _findOneProjection = withFileOwnerKey(_findOneSchema, ast.fields, _findOneFormula);
    if (_findOneProjection.projected) ast.fields = _findOneProjection.projected;
    // [#22300] Same as `find`: what the widening added is cut at the `return`.
    const _findOneWidened = _findOneProjection.widened ? new Set(_findOneProjection.widened) : undefined;

    // Drop unknown PLAIN fields — see the equivalent block in `find()` for
    // the rationale, and for why this tolerance is plain-columns-only ([#7589]
    // refused any dotted entry above, so none reaches this filter).
    if (_findOneSchema?.fields && Array.isArray(ast.fields) && ast.fields.length > 0) {
      // Always allow the primary key + audit columns even if not present
      // in schema.fields (matches `find()` behavior, one list).
      const known = new Set<string>([...Object.keys(_findOneSchema.fields), ...PLATFORM_PROVISIONED_COLUMNS]);
      const filtered = ast.fields.filter(f => known.has(f));
      // [#27165] Same refusal as `find`.
      if (filtered.length === 0) refuseProjectionOfUnknownColumns(objectName, 'findOne', ast.fields);
      ast.fields = filtered;
    }

    const opCtx: OperationContext = {
      object: objectName,
      operation: 'findOne',
      ast,
      options: query,
      context: mergeReadContext(query?.context, options?.context),
    };
    // [ADR-0053 D-D1, amended — #5930] Resolve, then lower.
    await this.resolveWhereTokens(opCtx.ast as QueryAST, opCtx.context, declaredDatetimeLowering(_findOneSchema), 'where', 'findOne');

    await this.executeWithMiddleware(opCtx, async () => {
      // [#3195] `findOne` fires the SAME `beforeFind`/`afterFind` hooks as
      // `find` — the read event attaches to record materialization, not to the
      // engine method, so one subscription covers every read shape (there is no
      // separate `beforeFindOne`/`afterFindOne`). Mirrors `find()` above.
      const hookContext: HookContext = {
          object: objectName,
          event: 'beforeFind',
          input: { ast: opCtx.ast, options: opCtx.options },
          session: this.buildSession(opCtx.context),
          provenance: this.buildProvenance(opCtx.context),
          user: this.buildUser(opCtx.context),
          api: this.buildHookApi(opCtx.context),
          transaction: opCtx.context?.transaction,
          ql: this
      };
      await this.triggerHooks('beforeFind', hookContext);
      hookContext.input.options = this.buildDriverOptions(objectName, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      // [ADR-0139 D2] The executor boundary, as in `find`.
      const driverAst = await this.composeReadableIdsAtBoundary(objectName, 'findOne', hookContext.input.ast as QueryAST, opCtx.context);

      let result = await driver.findOne(objectName, driverAst, hookContext.input.options as any);

      // [#21571] Same default projection as `find`, same position: the
      // declared field set, applied to the row as the driver returned it.
      result = withDeclaredColumnsOnly(result, declaredColumnSet(_findOneSchema));
      // [#29408] Same answer on the selected stored columns as `find`.
      result = withSelectedColumnsAnswered(result, selectedStoredColumns(_findOneSchema, driverAst?.fields));

      // Post-process: evaluate formula virtual fields against the raw row
      // ([#20082] with the caller's permission map when a formula calls `can`).
      if (result != null) {
        applyFormulaPlan(_findOneFormula.plan, [result], opCtx.context, await this.resolveFormulaPermissions(
          objectName, _findOneFormula.plan, [result], opCtx.context, this.permissionResolution(opCtx.context),
        ), this.formulaFaultSink(objectName), await this.resolveFormulaRelated(
          _findOneSchema, _findOneFormula.plan, [result], opCtx.context, query,
        ), this.formulaOptionLabels(_findOneSchema, _findOneFormula.plan, opCtx.context));
      }

      // Post-process: expand related records if expand is requested
      if (ast.expand && Object.keys(ast.expand).length > 0 && result != null) {
        const expanded = await this.expandRelatedRecords(objectName, [result], ast.expand, 0, opCtx.context);
        result = expanded[0];
      }

      // Post-process: resolve file-field id references (ADR-0104 D3).
      if (result != null) {
        const resolved = await this.resolveFileReferences(objectName, [result], opCtx.context);
        result = resolved[0];
      }

      hookContext.event = 'afterFind';
      hookContext.result = result;
      await this.triggerHooks('afterFind', hookContext);

      // [#16231] `findOne()` now DECLARES what it answers — the one record the
      // query selects, or `null` — so the seam that can break the declaration
      // is closed here, on the terms #15823 set for `find()`. An `afterFind`
      // handler may SHAPE the record (mutate it, drop keys, assign a different
      // RECORD built from it); replacing it with something that is neither a
      // record nor `null` is a hook-contract violation, refused loudly rather
      // than returned as a value the caller's type says cannot occur.
      //
      // ⛔ Placement is load-bearing and not the `return`, exactly as on
      // `find()`: `maskSecretFields` and `stripSearchCompanionFromRead` below
      // both run on `hookContext.result`, so the check has to precede them —
      // otherwise the first consumer to walk a replaced value is the one that
      // reports the problem, from the wrong place.
      if (!isFindOneResultShape(hookContext.result)) {
        throw new FindOneHookResultNotRecordError({
          object: objectName,
          event: 'afterFind',
          result: hookContext.result,
        });
      }

      // Mask secret fields — plaintext never leaves through the read path.
      this.maskSecretFields(objectName, hookContext.result);
      // [#7642] Hidden `__search` companion — same door, same rule as `find`.
      // This is the `GET /data/:object/:id` surface (`getData` reads through
      // findOne), one of the four the issue measured.
      this.stripSearchCompanionFromRead(hookContext.result, _findOneRequestedFields, opCtx.context);

      return hookContext.result;
    });

    // [#22300] Same cut as `find`, same position: after the middleware chain.
    return withoutFormulaWidening(opCtx.result, _findOneWidened);
  }

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
  private staticReadonlyCreateStrip(
    object: string,
    readonlySubject: NonNullable<ReturnType<typeof staticReadonlyInsertSubject>>,
    row: Record<string, unknown>,
    supplied: Readonly<Record<string, unknown>>,
    context: ExecutionContext | undefined,
    pass: {
      logger: Parameters<typeof stripReadonlyFields>[3];
      strictReadonlyWrites: boolean;
      hookWrittenKeys: ReadonlySet<string> | undefined;
      nowSnap: Date;
      permissionResolution: PermissionResolution | undefined;
    },
  ): Promise<{ row: Record<string, unknown>; taken: string[]; error?: unknown }> {
    // [#29986 codemod] The body moved to `engine-insert.ts` (see `InsertHost`).
    const host: ThisParameterType<typeof staticReadonlyCreateStrip> = {
      applyFieldDefaults: (...a) => this.applyFieldDefaults(...a),
      resolveDefaultPermissions: (...a) => this.resolveDefaultPermissions(...a),
    };
    return staticReadonlyCreateStrip.call(host, object, readonlySubject, row, supplied, context, pass);
  }

  /**
   * Insert one record or an array of records.
   *
   * At-least-once hook semantics (framework#3152): when this call is driven by
   * `bulkWrite` (seed / import), a transient batch retry or a per-row
   * degradation re-runs the whole insert, so a `beforeInsert` hook may fire
   * MORE THAN ONCE for the same input row (a first attempt that failed in
   * validation, then the degraded retry). Side-effecting `beforeInsert` hooks
   * (notifications, external calls, counters) must therefore be idempotent.
   * `afterInsert` hooks fire only on a successful write, so they are not
   * re-run by a validation failure. Autonumbers are assigned only after
   * validation passes, so a doomed attempt no longer consumes a sequence value
   * (no number-range gaps from a rejected batch).
   */
  // [#3407 / #5126] BOTH members of `WriteObservabilityOptions` are live here,
  // for TWO strips that share one report site (`insertDropped`, below): the
  // runtime-owned (`autonumber`) strip added by #5503, and — since the
  // maintainer ruling of 2026-09-03 (option C, #14147) — the AUTHOR-declared
  // static-`readonly` strip, the same `stripReadonlyFields` the update path
  // runs, under the same `isSystem` gate. Each member arrived carrying the same
  // standing condition — #3407's "if insert ever gains a silent strip, wire the
  // listener at that strip site", #5126's "it is inert here only because insert
  // strips nothing; if insert ever gains a strip, both members wire up together
  // at that site". #5503 was the first such strip and #14147 the second; both
  // discharge through the one site: quiet-and-observable by default
  // (`onFieldsDropped`), refused outright under `strictReadonlyWrites` — the
  // same one-per-call choice update offers.
  //
  // What INSERT still does NOT strip: `readonlyWhen` (a conditional lock has no
  // prior record to evaluate on a create — the update-path note below says
  // "INSERT stays exempt" for exactly that strip), and the FLS write gate throws
  // rather than stripping. So neither member reports on those here — only on
  // what this path actually strips. The 2026-07-24 row "INSERT (all callers)
  // exempt" this note used to rest on is SUPERSEDED, and the metadata-protocol
  // ingress copy it pointed external callers at is deleted: there is one
  // create-side enforcement point, and it is this one. Any FURTHER strip added
  // here must feed `insertDropped` (or wire both members at its own site) too.
  // [#20805] The computed-field door is the third, and reports at the same
  // site under its own `computed` reason (`insertDrops`) — in every context,
  // `isSystem` included, since a `formula` value has no column to land in.
  /**
   * Validate-only (commit 18189983d, #4633 ruling D) — run the write path's own verdict
   * over candidate rows and report it, WITHOUT persisting anything.
   *
   * ## Why this exists
   *
   * `import`'s dry run used to predict the write's verdict with a hand-copied
   * mirror of the engine's rules (`rest/src/import-coerce.ts`). A copy cannot
   * structurally keep up with the family it mirrors — value shapes and their
   * ADR-0104 posture, `format` checks, object-level `validations`, the state
   * machine — so the ruling replaced prediction with the verdict itself. The
   * point is that agreement is guaranteed **by construction**: this method
   * calls the same `validateRecord` and `evaluateValidationRules`, with the
   * same options, that `insert()` calls a few hundred lines below.
   *
   * ## The write's doors run here too (#20805)
   *
   * A verdict on a payload the write never stores is not the write's verdict.
   * So before judging, this runs the write's own doors, by the same functions
   * (one function per door, ⛔ no copy here): the declared-field door (an
   * undeclared key is THROWN as `INVALID_FIELD` / 400 naming the field, exactly
   * as `insert()` throws it — it used to be answered `valid: true`), the
   * computed-field door (a `formula` value is stripped, every context), and the
   * caller-write strips (`isSystem`-gated). What the write would drop is
   * reported through `options.onFieldsDropped`, the listener the write reports
   * through.
   *
   * [#20922] And per row: an accepted row's `droppedFields` names what the
   * write would take from THAT row, recorded at the strips themselves — the
   * same report `insertMany` hangs on that row's `ok` outcome. The listener's
   * events stay the batch-level union, one per reason, naming no row.
   *
   * ## ADR-0104 posture — the whole reason B was rejected
   *
   * The verdict is resolved against the TARGET DEPLOYMENT'S REAL POSTURE via
   * the same `valueShapeStrictFor` / `mediaValueShapeStrictFor` the write path
   * uses. On a self-certified (strict) deployment a bad value shape is an
   * error here exactly as it would be on write; on a warn-first deployment it
   * is admitted here exactly as it would be on write, and reported as a
   * WARNING rather than an error. An unconditionally-strict dry run (option B)
   * was rejected precisely because it would fail rows on every un-migrated
   * deployment that the write would have accepted — a false alarm that teaches
   * authors to distrust the one gate in front of a bulk import.
   *
   * The warn-first admissions are deliberately NOT routed to
   * `admittedViolationSink`: that sink records "this boot has written data
   * against the old contract" so the deployment cannot then certify itself
   * (#4769). A dry run writes nothing, so recording an admission would make a
   * *preview* block a later migration — a side effect on a call whose whole
   * contract is to have none.
   *
   * ## What it deliberately does NOT simulate
   *
   * No hooks run. `beforeInsert` fires BEFORE validation on the real path, so
   * a hook that derives a business field could in principle change a verdict
   * this method reports. Running arbitrary user-authored hooks to close that
   * gap is the worse trade by a wide margin — a "validate without persisting"
   * call that fires side-effecting hooks (mail, outbound calls, writes to
   * other objects) is the #4052 defect in a new spelling, where a preview
   * quietly executes. So the gap is documented rather than closed: audit and
   * ownership stamps are `system`/`readonly`, so validation never requires
   * them, and (#21663) the only thing it asks of a readonly value is its
   * shape, which a platform stamp always has — so what remains is the narrow
   * case of a hook deriving a *business* field that its object also
   * validates.
   *
   * ## An `update`-mode preview judges the stored row (#22445)
   *
   * A by-id update reads its prior row and judges the stored row merged with
   * the patch, so a rule that reads a column the patch omits sees the stored
   * value. A preview that judged the patch alone refused rows the write
   * admits: the omitted column was missing from the judged record, and the
   * rule faulted. So a row that carries its address — the `id` every update
   * door folds into the payload (`updateData`), classified by the write's
   * own `resolveEngineUpdateDispatch` — is judged against the row that id
   * names, as the by-id update judges it: the stored row is the rules'
   * `previous`, and their record is that row merged with the patch.
   *
   * ⛔ The READ DOOR decides whether there is a row to judge: it is asked
   * first, under the caller's own context (`findOne`). A row the caller
   * cannot read is a row that does not exist (the by-id write answers 404 for
   * it before it reads anything), so the preview judges no row for it and
   * gives no verdict about its columns. The image itself is the write's own
   * prior-row read ({@link readUpdatePriorRow}), the row as STORED, kept to
   * the columns the read door served this caller UNCHANGED: a column it hid,
   * and one it served transformed (a partial mask keeps the key and replaces
   * the value), is judged as empty, so the verdict never depends on a value
   * the caller could not have read in full. A refused read propagates as the
   * refusal it is. A row with no address, or whose id names no row this
   * caller can read, is judged on the patch alone, as before.
   *
   * ## The master-detail header is bound as the write binds it (#22474)
   *
   * Every write binds the detail row's master-detail header for a field
   * `requiredWhen` that reads `parent`, and an update that repoints the row
   * binds the header it leaves as `previousParent` for the ADR-0113
   * pre-check. A preview that bound neither refused, as unevaluable, rows the
   * write admits. So the preview binds both, from the same view and under the
   * same gate as the write (an object with no parent-scoped `requiredWhen`
   * reads no header). It reads the header under the caller's own access, as
   * the write does since #22519 ({@link resolvePreviewParents}): a header the
   * caller cannot read binds as a missing one. ⛔ Unlike the write, a header
   * column the read door served transformed or not at all is judged as empty.
   *
   * ## The Layer 0 tenant wall answers for its own rows (#25062)
   *
   * A row's `organization_id` is judged on the write by the tenant wall, which
   * lives in the enforcement layer's middleware and so never runs here. The
   * preview asks that wall for its verdict on each row
   * ({@link registerWriteWallVerdict}) and answers from it, and it asks where
   * the write does: on the row before the strips, and again on a row the
   * strips changed, which is the row the write's stored-image half judges. A
   * row whose organization the wall judges keeps the column through the
   * static `readonly` strip (no `droppedFields` entry), as the write stores
   * it; a row the wall refuses is `valid: false` with the write's own code
   * (`PERMISSION_DENIED`) and message, under `organization_id` when the wall
   * refused the value and `_record` when it refused the caller's state, and it
   * drops nothing. Unregistered, the strip runs as before.
   *
   * Named limit: the wall judges the row as the preview holds it, after the
   * defaults and before any hook. An organization a `beforeInsert` /
   * `beforeUpdate` hook writes is judged by the write's stored-image half
   * alone, so a row a hook places outside the caller's scope previews valid
   * and is refused by the write.
   *
   * Nothing is written and no sequence is consumed. Reads do happen: the
   * stored row above, the master-detail headers, the related rows a
   * traversing rule names (see the `previewRelatedForRow` block below), and
   * [#26684] on an insert, the write's reference check on each id the caller
   * supplied, behind the same write-gate probe as the related rows.
   * Validation itself is in-process, which is what makes row-by-row dry run
   * of a large import affordable.
   */
  async validate(
    object: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options?: {
      mode?: 'insert' | 'update';
      context?: ExecutionContext;
      /**
       * [#20805] The write's own strip listener: called once per `reason` for
       * the fields the write WOULD drop from these rows — the same events, in
       * the same shape, that `insert` / `update` report through
       * `WriteObservabilityOptions.onFieldsDropped`. A listener that throws is
       * logged and ignored, as on the write.
       */
      onFieldsDropped?: WriteObservabilityOptions['onFieldsDropped'];
    },
  ): Promise<ValidateDataResponse> {
    // [#25522 cut 16] The body moved to `engine-validate.ts` (see `ValidateHost`).
    const readRegistry = () => this._registry;
    const readWriteWallVerdict = () => this._writeWallVerdict;
    const readLogger = () => this.logger;
    const readWriteGateProbe = () => this._writeGateProbe;
    const host: ThisParameterType<typeof validate> = {
      resolveObjectName: (...a) => this.resolveObjectName(...a),
      get _registry() { return readRegistry(); },
      permissionResolution: (...a) => this.permissionResolution(...a),
      resolveDefaultPermissions: (...a) => this.resolveDefaultPermissions(...a),
      initializeSummaryFields: (...a) => this.initializeSummaryFields(...a),
      applyFieldDefaults: (...a) => this.applyFieldDefaults(...a),
      get _writeWallVerdict() { return readWriteWallVerdict(); },
      staticReadonlyCreateStrip: (...a) => this.staticReadonlyCreateStrip(...a),
      get logger() { return readLogger(); },
      mediaValueShapeStrictFor: (...a) => this.mediaValueShapeStrictFor(...a),
      valueShapeStrictFor: (...a) => this.valueShapeStrictFor(...a),
      validationMessageContext: (...a) => this.validationMessageContext(...a),
      buildEvalUser: (...a) => this.buildEvalUser(...a),
      findOne: (...a) => this.findOne(...a),
      readUpdatePriorRow: (...a) => this.readUpdatePriorRow(...a),
      resolvePreviewParents: (...a) => this.resolvePreviewParents(...a),
      get _writeGateProbe() { return readWriteGateProbe(); },
      resolvePredicateRelated: (...a) => this.resolvePredicateRelated(...a),
      resolveOptionPermissions: (...a) => this.resolveOptionPermissions(...a),
      getSummaryDescriptors: (...a) => this.getSummaryDescriptors(...a),
      assertReferencesResolve: (...a) => this.assertReferencesResolve(...a),
      previewHomeAmounts: (...a) => this.previewHomeAmounts(...a),
    };
    return validate.call(host, object, data, options);
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
  private async updateByIdExpecting(
    driver: IDataDriver,
    object: string,
    id: unknown,
    data: Record<string, unknown>,
    expect: Readonly<Record<string, unknown>>,
    options: Parameters<IDataDriver['findOne']>[2],
  ): Promise<unknown> {
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

  /** [ADR-0142 D4] Set once the precondition's no-`updateMany` degradation has been logged. */
  private preconditionDegradedWarned = false;

  /** [ADR-0142 D5] The assignment seam, built on first use. */
  private assignmentEvaluator?: AssignmentRuleEvaluator;

  /** The registered ownership-queue service, through the plugin's slot — `null` on every other state. */
  private ownershipQueueService(): AssignmentQueueService | null {
    const source = (this as unknown as Record<symbol, unknown>)[OWNERSHIP_QUEUE_SOURCE_SLOT];
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

  private assignment(): AssignmentRuleEvaluator {
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

  private async readUpdatePriorRow(
    object: string,
    id: unknown,
    context: ExecutionContext | undefined,
    base?: unknown,
  ): Promise<Record<string, unknown> | null> {
    const priorAst: QueryAST = { object, where: { id }, limit: 1 } as QueryAST;
    const preOpts = this.buildDriverOptions(object, context, base as any);
    return withDeclaredColumnsOnly(
      await this.getDriver(object).findOne(object, priorAst, preOpts) as Record<string, unknown> | null,
      declaredColumnSet(this._registry.getObject(object)),
    );
  }

  /**
   * Create one record, or a batch of them.
   *
   * # The error contract on a unique violation (#14095)
   *
   * A driver's unique-constraint refusal leaves this door as the ADR-0112
   * envelope `DuplicateRecordError` — `code: 'DUPLICATE_RECORD'`, `status: 409`,
   * the driver's own error whole on `cause`, and `field` when the dialect
   * determinably named the conflicting COLUMN. Identically on every driver, in
   * the single-row and batch paths alike, so the platform's own recommended
   * idiom ("declare a unique index, attempt the insert, swallow the violation")
   * is expressible by an application that knows nothing about SQLite's
   * `SQLITE_CONSTRAINT_UNIQUE`, Postgres' `23505` or MySQL's `ER_DUP_ENTRY`.
   *
   * ⛔ Every other driver failure is rethrown UNCHANGED — a NOT NULL violation,
   * a deadlock, a missing table, an unreachable store. The verdict is
   * `isUniqueViolationError` (`@objectstack/types`), the one predicate the repo
   * has for the question; this door adds no dialect knowledge of its own.
   *
   * One conflict keeps a narrower identity: an autonumber the engine ITSELF
   * issued and re-issued to exhaustion is `ERR_AUTONUMBER_COLLISION`, which
   * says something `DUPLICATE_RECORD` cannot ("re-seeded, re-issued, still
   * refused"). It carries the driver error as `cause` exactly as before.
   */
  async insert(object: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any> {
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
            ql: this,
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
      for (let i = 0; i < rowHookContexts.length; i++) {
        const withheld = insertWithheld[i];
        if (!withheld) continue;
        const target = rowHookContexts[i]!.input.data as Record<string, unknown> | null | undefined;
        if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
        rowHookWrittenKeys[i] = handBackWithheldInsertReadonly(
          target, withheld, insertShown[i] ?? new Map(), rowHookWrittenKeys[i],
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
      // steering. Free for every object no rule names (`rulesFor` is a registry
      // read).
      {
        const evaluator = this.assignment();
        if (evaluator.rulesFor(object).length > 0) {
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
      for (const rowCtx of rowHookContexts) {
        rowCtx.input.options = driverOptions;
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
            const stripDrops = droppedFieldEvents(object, computedDropped, insertDropped);
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
        const insertDrops = droppedFieldEvents(object, computedDropped, insertDropped, storedExpressionReplaced);
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
        if (homeAmountPlan.length > 0) {
          const homeServing = this.homeAmountServing(opCtx.context);
          for (let i = 0; i < rows.length; i++) {
            if (rowErrors[i] !== undefined) continue;
            const row = rows[i] as Record<string, unknown> | null | undefined;
            if (!row || typeof row !== 'object') continue;
            try {
              Object.assign(row, await projectHomeAmounts(homeAmountPlan, row, homeServing, {
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
            assertRecordCurrencyCodes(object, (schemaForValidation as { fields?: unknown } | undefined)?.fields, rows[i], 'insert');
            emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(schemaForValidation as any, rows[i], 'insert', { logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: msgCtx, parent: insertParentForRow?.(rows[i]), related: batchSummaries ? batchSummaries.overlay(insertRelatedForRow(rows[i])) : insertRelatedForRow(rows[i]), permissions: insertPermissionsFor(rows[i]) }), this.logger, object);
            await this.assertReferencesResolve(
              schemaForValidation, rows[i], suppliedPerRow[i], opCtx.context, msgCtx,
            );
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
                  const droppedFields = droppedFieldEvents(
                    object, computedStrip.droppedPerRow[i] ?? [], insertDroppedPerRow[i] ?? [],
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

  /**
   * Batch insert with PARTIAL SUCCESS (framework#3172): unlike
   * `insert(object, rows[])` — which aborts the whole batch when any row
   * fails validation — this culls the bad rows after beforeInsert, writes the
   * survivors in one driver batch, and returns one outcome per input row in
   * input order. beforeInsert hooks therefore run exactly ONCE per row even
   * when the batch contains bad rows (no whole-batch degradation re-run), and
   * dead rows never consume an autonumber sequence value. afterInsert hooks,
   * summary recompute, and realtime events fire only for the written rows.
   *
   * A summary-recompute failure after retries still throws
   * {@link SummaryRecomputeError} (framework#3147) with `written` set to the
   * outcome array — the records ARE written.
   *
   * `onFieldsDropped` (#3407) is forwarded to `insert`, so the runtime-owned
   * strip (#5503) reports here too. ⚠️ The event carries no row index — it is
   * the UNION over the batch — and a caller holding the input rows CANNOT
   * resolve it back to rows. "Which rows supplied N" is a different set from
   * "which rows dropped N": since ruling C (#14147) the static-`readonly` strip
   * runs after `beforeInsert` and exempts keys a hook assigned, per row
   * (`hookWrittenKeys: rowHookWrittenKeys[i]`, above), so two rows that both
   * supplied N can differ on whether N survived — and a row this method culled
   * before the strip dropped nothing at all. Nor does the returned row answer
   * it: a stripped `readonly` field is re-defaulted and a stripped `autonumber`
   * is refilled, so the key is present on the row that did drop it. Read a
   * reported name as "at least one row dropped this field"; `insertManyData`
   * surfaces it at batch level for exactly this reason.
   */
  async insertMany(object: string, rows: any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<InsertManyRowOutcome[]> {
    if (!Array.isArray(rows)) throw new Error('insertMany expects an array of rows');
    return this.insert(object, rows, { ...(options ?? {}), __partialRowErrors: true } as any);
  }

  /**
   * Update one record by id, or every record a predicate selects.
   *
   * # The error contract on a unique violation (commit 9d7f7259f)
   *
   * A driver's unique-constraint refusal leaves this door as the ADR-0112
   * envelope `DuplicateRecordError` — `code: 'DUPLICATE_RECORD'`, `status: 409`,
   * the driver's own error whole on `cause`, and `field` when the dialect
   * determinably named the conflicting COLUMN — identically on every driver
   * and on both driver exits (the by-id `driver.update` and the predicate
   * `driver.updateMany`). It is the insert door's contract (#14095), one verb
   * over: before this, the same user action answered `409 DUPLICATE_RECORD` on
   * create and `500 INTERNAL_ERROR` on edit, because the raw driver error
   * carried neither `code` nor `status` and the REST boundary sanitised it.
   *
   * A predicate write names no row. `field` is what `uniqueViolationColumn`
   * reads off the driver's error; WHICH of the N matched rows conflicted is a
   * question that error does not answer, and this door invents no answer to it
   * (triage ruling, 2026-09-02: a fabricated row attribution is worse than an
   * absent one).
   *
   * ⛔ Every other driver failure is rethrown UNCHANGED — a NOT NULL violation,
   * a deadlock, a missing table, an unreachable store. The verdict is
   * `isUniqueViolationError` (`@objectstack/types`), the one predicate the repo
   * has for the question; this door adds no dialect knowledge of its own. The
   * operator log line (`Update operation failed`) keeps carrying the driver's
   * own diagnosis, read through the envelope's `cause`.
   *
   * The envelope sits on the two driver exits, not on the outer `catch`: that
   * `catch` also sees the `afterUpdate` dispatch and the roll-up recompute, and
   * a violation raised by a nested driver call in there is not this object's.
   */
  async update(object: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<Record<string, any> | number | null> {
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
          ql: this
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

       hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
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
               sealedSecrets = await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options, async () => [priorRecord]);
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
               const mdRel = schemaHasParentRequiredWhen ? resolveMasterDetailRelation(updateSchema as any) : null;
               const priorMasterId = mdRel ? masterIdOf(mdRel.fk, null, priorRecord) : undefined;
               const repointsMaster =
                   mdRel != null &&
                   priorMasterId != null &&
                   masterIdOf(mdRel.fk, landing?.view ?? preRoWhen, priorRecord) !== priorMasterId;
               const roWhenPreviousParent = repointsMaster
                   ? await this.resolveMasterDetailParent(updateSchema, null, priorRecord, opCtx.context)
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
               emitValidationAdvisories(options?.onValidationAdvisory, evaluateValidationRules(updateSchema as any, hookContext.input.data as Record<string, unknown>, 'update', { previous: priorRecord, logger: this.logger, currentUser: this.buildEvalUser(opCtx.context), skipStateMachine: shouldSkipStateMachine(opCtx.context), messages: updateMsgCtx, parent: roWhenParent, previousParent: roWhenPreviousParent, related: relatedForUpdate, permissions: permissionsForUpdate }), this.logger, object);
               // [#4441] A repoint is as capable of dangling as an initial link.
               // [#29062] …but a value the row already stores is not a repoint:
               // the prior row is what the check forgives a refused value against.
               await this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
                 async () => [priorRecord],
               );
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
                     ? await this.updateByIdExpecting(driver, object, hookContext.input.id, hookContext.input.data as Record<string, unknown>, precondition, hookContext.input.options as Parameters<IDataDriver['findOne']>[2])
                     : await driver.update(object, hookContext.input.id as string, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
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
               sealedSecrets = await this.encryptSecretFields(object, hookContext.input.data as Record<string, unknown>, opCtx.context, hookContext.input.options, readPriorRows);
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
               const mdRelMulti = schemaHasParentRequiredWhenMulti ? resolveMasterDetailRelation(updateSchema as any) : null;
               const previousParentForRow =
                   mdRelMulti != null && masterIdOf(mdRelMulti.fk, landingMulti?.view ?? preRoWhenMulti, undefined) != null
                       ? await this.resolveMasterDetailParents(updateSchema, null, priorRows, opCtx.context)
                       : undefined;
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
               // [#4441] The bulk call site too — a guard wired into single-id
               // writes only is still a hole one call site over (AGENTS.md
               // PD #10's own worked example, #3106).
               // [#29062] A refused value is forgiven only when EVERY matched row
               // already stores it (the `readPriorRows` memo, read only then);
               // a row it is new to makes it this write's reference.
               await this.assertReferencesResolve(
                 updateSchema, hookContext.input.data as Record<string, unknown>,
                 opCtx.data as Record<string, unknown>, opCtx.context, updateMsgCtx,
                 readPriorRows,
               );
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
                     : (((await driver.find(object, { ...ast, fields: summaryKeyColumns }, hookContext.input.options as Parameters<IDataDriver['find']>[2])) ?? []) as Record<string, unknown>[]);
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
                   : (((await driver.find(object, { ...ast, fields: ['id', ...movedSecretColumns] }, hookContext.input.options as Parameters<IDataDriver['find']>[2])) ?? []) as Record<string, unknown>[]);
               await this.persistSecretRows(sealedSecrets, writtenSecrets);
               try {
                   result = await driver.updateMany!(object, ast, hookContext.input.data as Record<string, unknown>, hookContext.input.options as any);
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

  /**
   * Can the by-id delete of `object` and its whole cascade run as ONE unit of
   * work? [#7413]
   *
   * `delete()`'s by-id branch ran `cascadeDeleteRelations` and then
   * `driver.delete` with no transaction around either, and the cascade
   * RE-ENTERS `this.delete()` / `this.update()` per dependent row — so every
   * child committed on its own. A refusal partway (the `restrict` branch below,
   * a child's permission check, a later child's `beforeDelete` hook) left an
   * arbitrary PREFIX of the children deleted while the caller received 409/403
   * and reasonably read it as "nothing happened". #4620 already ruled the
   * principle for the batch path — *atomic honoured for real, or refused; a
   * partial delete has no natural undo* — and this path never got it.
   *
   * Three verdicts, because "wrap it in a transaction" is only unconditionally
   * right in one of them:
   *
   * - **`'none'`** — no registered object declares a relation of the delete
   *   family ({@link statesDeleteSemantics}: `master_detail` / `lookup` /
   *   `tree`) pointing at `object`, so `cascadeDeleteRelations` cannot write anything
   *   and there is no multi-write unit to make atomic. The delete runs exactly
   *   as it did before this card: one `driver.delete`, no transaction opened,
   *   no degrade warning. A plain non-cascade delete is the CONTROL for this
   *   change and must stay byte-identical.
   * - **`'split'`** — dependents exist, but at least one participant (the
   *   parent or a transitively-referencing child) resolves to a driver other
   *   than the engine's DEFAULT one. `transaction()` opens on the default
   *   driver and covers that connection alone (ADR-0119 D1 — no two-phase
   *   commit on `IDataDriver`), so opening one here would not buy atomicity; it
   *   would REFUSE the cascade outright, because `enforceTransactionOrigin`
   *   throws {@link CrossDatasourceTransactionWriteError} for a business write
   *   inside a transaction that does not cover it (#5351 / #5696 point 2, the
   *   2026-08-06 ruling). A cross-datasource cascade delete works today, and
   *   turning it into a hard refusal is a strictly worse answer than the
   *   non-atomic one it has always had. So it keeps that answer and says so
   *   once — see {@link warnCascadeNotAtomic}.
   * - **`'atomic'`** — dependents exist and every participant sits on the
   *   default driver. This is the shape the card measured and the shape
   *   virtually every deployment has; the caller gets one unit of work.
   *
   * A pure registry walk — no I/O, no driver call. It answers from the SCHEMA
   * (which objects *could* be reached), never from row counts, so the verdict
   * is stable for a given schema and costs nothing on the common path. The walk
   * is the transitive closure of "objects referencing X" because a cascade
   * recurses into each child's own cascade; it is bounded by
   * {@link ObjectQL.MAX_CASCADE_DEPTH}, the ceiling the recursion itself carries.
   *
   * Fails toward `'split'` on anything it cannot resolve WITHIN the walk (an
   * unregistered reference, a `getDriver` throw): the degrade is today's
   * behaviour, while a wrong `'atomic'` would manufacture the refusal this
   * verdict exists to avoid.
   *
   * [#9002] That fail-toward rule is about resolving individual PARTICIPANTS.
   * It never covered the registry read that produces the participant list in
   * the first place, and the `catch → 'none'` that used to sit there was not an
   * instance of it: `'none'` is the one verdict that asserts something positive
   * about the schema — *nothing references this object* — and an unreadable
   * registry cannot support that claim. The swallow's own comment argued the
   * direction from `cascadeDeleteRelations` returning on the same failure, so
   * that nothing was left un-cascaded to make atomic; once that seam propagates
   * the premise is gone, and this one propagates with it. Note the ORDER makes
   * this seam the first to speak: `delete()` calls this before it runs the
   * cascade, so an unreadable registry now fails the delete before any row is
   * touched.
   */
  private planCascadeAtomicity(object: string): 'none' | 'split' | 'atomic' {
    const objects: ServiceObject[] = this._registry.getAllObjects();

    // Which objects reference `name` via a relation the cascade would follow.
    // The family test ({@link statesDeleteSemantics}) + `reference` test is
    // `cascadeDeleteRelations`'s own, so the two cannot disagree about who
    // participates. `restrict` fields are INCLUDED deliberately: a restrict
    // refusal is the card's core repro, and it must roll back the siblings
    // already cascaded before it.
    //
    // [#22957] A `tree` takes part since it joined the family. Its reference
    // names the object that declares it, so an object whose only relation is
    // its own hierarchy now plans `'atomic'` rather than `'none'`: a subtree
    // cascade is several deletes, and a refusal from a node deep in it must
    // roll back the nodes deleted before it.
    const referencing = (name: string): string[] => {
      const out: string[] = [];
      for (const child of objects) {
        const childName = (child as any)?.name as string | undefined;
        const fields = (child as any)?.fields as Record<string, any> | undefined;
        if (!childName || !fields) continue;
        for (const [fieldName, fdef] of Object.entries(fields)) {
          if (!statesDeleteSemantics(fdef)) continue;
          // [#18550] The carrier is read through the ONE arbiter, so a
          // `reference` no reader can read REFUSES here instead of reading as
          // "this child does not reference `name`". The two answers stay
          // different on purpose:
          //
          //  - ABSENCE (`undefined` / `null` / `''`) is unchanged and still
          //    silent. `referenceCarrierOf` answers `undefined` for all three
          //    and this `continue` skips the field, which is what a field that
          //    names no target legitimately means (`FieldSchema.reference` is
          //    `.optional()`, `StrictField` declares it nullable).
          //  - UNREADABILITY is the loud one. An object- or array-valued
          //    carrier was TRUTHY here and then failed both name comparisons
          //    below, so the relation was dropped from the set silently — and
          //    this function's `'none'` is, by its own docblock above, the one
          //    verdict that asserts something POSITIVE about the schema
          //    ("nothing references this object"). An unreadable carrier can
          //    no more support that claim than an unreadable registry can.
          const ref = deleteWalkTargetOf(fdef, 'ObjectQL.planCascadeAtomicity');
          if (!ref) continue;
          let resolvedRef: string | undefined;
          try { resolvedRef = this.resolveObjectName(ref); } catch { resolvedRef = undefined; }
          if (ref !== name && resolvedRef !== name) continue;
          // [#21910, #21918] The scan skips every column the registry injected
          // into a federated object and the object does not provision, so this
          // walk does too: the participant test stays the scan's own, as the
          // comment above requires. A federated object this walk still reaches
          // through a relation its author declared keeps the verdict
          // `'split'`, because the scan probes that relation.
          if (isFederatedUnprovisionedInjectedColumn(child, fieldName)) continue;
          out.push(childName);
          break;
        }
      }
      return out;
    };

    const firstLevel = referencing(object);
    if (firstLevel.length === 0) return 'none';

    const defaultDriver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    if (!defaultDriver) return 'split';
    const onDefaultDriver = (name: string): boolean => {
      try { return this.getDriver(name) === defaultDriver; } catch { return false; }
    };

    if (!onDefaultDriver(object)) return 'split';
    const seen = new Set<string>([object]);
    let frontier = firstLevel;
    for (let depth = 0; depth < ObjectQL.MAX_CASCADE_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const name of frontier) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!onDefaultDriver(name)) return 'split';
        next.push(...referencing(name));
      }
      frontier = next;
    }
    return 'atomic';
  }

  /**
   * The `'split'` verdict of {@link planCascadeAtomicity}, said out loud — once
   * per object per engine instance (#7413).
   *
   * Same reasoning as {@link warnTransactionUnsupported}, which this mirrors
   * deliberately: a capability is not available, so the delete keeps the
   * non-atomic behaviour it has always had. `warn`, not `error` — at this
   * moment nothing claimed-persisted has failed to land; what is missing is the
   * ability to undo the cascade if a later child refuses. Escalating it would
   * train readers to skim `error`, which AGENTS.md names as the mirror-image
   * mistake.
   */
  private warnCascadeNotAtomic(object: string): void {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts` (see `CascadePlanningHost`).
    const readCascadeNotAtomicReported = () => this.cascadeNotAtomicReported;
    const readDefaultDriver = () => this.defaultDriver;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof warnCascadeNotAtomic> = {
      get cascadeNotAtomicReported() { return readCascadeNotAtomicReported(); },
      get defaultDriver() { return readDefaultDriver(); },
      get logger() { return readLogger(); },
    };
    return warnCascadeNotAtomic.call(host, object);
  }

  /**
   * [#9362] The dependents probe's `where`, spelled for the KIND of reference
   * field it is aimed at.
   *
   * A single-valued `lookup` / `master_detail` stores a scalar foreign key, and
   * bare equality is the right question about it. A MULTI-VALUED reference
   * field stores an ARRAY, and every SQL backend in this repo puts that array
   * in a JSON TEXT column. [#18408] Which of the two a field is, is
   * {@link declaredMultiValued} — the one predicate the storage side asks
   * (#17469) — ⛔ never a raw `field.multiple`: `master_detail` and `tree` are
   * outside `MULTI_CAPABLE_TYPES`, so the flag on one of those buys a JSON
   * column from nobody, and aiming `$contains` at the scalar column the driver
   * really built is the mirror image of the defect below.
   *
   * Aiming bare equality at a multi-valued column compares
   * the whole serialization (`["a","b"]`) against one id, which can never hold;
   * `driver-sql` refuses the spelling outright (`INVALID_FILTER` / 400, #7398),
   * and that refusal is correct and stays. Until this method existed the probe
   * built bare equality for both kinds, so every object pointed at by any
   * registered `multiple: true` lookup had its delete refused with a 400 — on
   * the stock showcase, `showcase_account`, with an EMPTY dependent table:
   * the fault is schema-driven, not data-driven, because the probe runs per
   * DECLARED relation.
   *
   * The multi-value spelling is `$contains`, which is what the refusal itself
   * prescribes and the one membership spelling every driver here answers. On a
   * column the driver holds declared multi-valued it asks MEMBERSHIP, as
   * `FILTER_OPERATORS`' `$contains` docblock (`@objectstack/spec`) declares for
   * a JSON-stored column: `driver-sql` (and `driver-sqlite-wasm` and the local
   * `driver-turso`, which extend it) compiles a per-dialect membership
   * construct, `driver-memory` a mingo `$elemMatch`, and `driver-mongodb` the
   * same `$elemMatch`. No public filter surface is widened: `$contains` is
   * already declared, and this is the only construction site that changes.
   *
   * Membership answers EXACTLY on a well-formed slot, but a backend that does
   * not hold the declaration (a table it was never told about) answers the
   * SUBSTRING reading instead, which is a SUPERSET: with ids `acc_1` and
   * `acc_10`, a row holding `acc_10` also matches a probe for `acc_1`. That is
   * why the caller still narrows the rows exactly through
   * {@link ObjectQL.storedReferenceIncludes} — over-matching here would make
   * `cascade` DELETE and `set_null` clear rows that never referenced this
   * record, which is worse than the 400 being fixed. The pushdown's only job is
   * to keep the probe from reading the whole table.
   *
   * ⚠️ Membership is array-only on every backend that answers it, so a slot
   * holding an off-shape bare scalar (the write door never stores one, it wraps
   * a scalar; out-of-band data can) is not matched by the pushdown, and the
   * scalar arm of {@link ObjectQL.storedReferenceIncludes} never sees that row.
   *
   * The `$or` limb covers the other direction — a FALSE NEGATIVE, which on an
   * integrity guard is the fail-OPEN that #8895 ruled out. An id needing JSON
   * escaping (a quote, a backslash) appears in the serialized text in its
   * ESCAPED form, so a backend answering the substring reading over that text
   * would miss the row for the raw id; a membership test, and a document or
   * in-memory backend, compares the element itself and needs the RAW form. Both
   * are asked whenever they differ, and the exact narrowing discards whatever
   * the extra limb over-matched. Identical for an ordinary id, which is every
   * id this engine generates.
   */
  private referenceProbeFilter(
    fieldName: string,
    fdef: { type?: unknown; multiple?: unknown },
    id: string | number,
  ): Record<string, unknown> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`.
    return referenceProbeFilter(fieldName, fdef, id);
  }

  /**
   * [#9362] Does this STORED reference value point at `id`? The exact answer
   * the `$contains` pushdown in {@link ObjectQL.referenceProbeFilter} can only
   * approximate.
   *
   * Element-wise over the array, comparing `String(v)` — the same reading
   * `dangling-reference-audit.ts` already applies to a stored reference
   * (`Array.isArray(raw) ? raw : [raw]`), so the two integrity surfaces cannot
   * disagree about what "this row references that record" means. An EXPANDED
   * record in the slot is a read shape rather than an id write, and is skipped
   * there for that reason; it is skipped here too.
   *
   * A non-array value is still compared rather than dismissed. A
   * `multiple: true` slot holding a bare scalar is off-shape, and the two
   * dispositions available are not symmetric: reading it as "references
   * nothing" would drop a `restrict` refusal and let a referenced record be
   * deleted — the fail-OPEN direction #8895 ruled out for this same guard —
   * while reading it as a reference at most refuses a delete loudly.
   */
  private static storedReferenceIncludes(stored: unknown, id: string | number): boolean {
    const wanted = String(id);
    const values = Array.isArray(stored) ? stored : [stored];
    for (const v of values) {
      if (v == null || typeof v === 'object') continue;
      if (String(v) === wanted) return true;
    }
    return false;
  }

  /**
   * [#9688] What a `multiple: true` reference slot holds once the deleted
   * record's membership is removed — the ONE computation behind both the
   * per-row `required` judgement in {@link ObjectQL.cascadeDeleteRelations}
   * and the `set_null` write that judgement gates.
   *
   * One function rather than two readings that happen to match, because the
   * judgement decides whether the write may run at all: a predicate computing
   * the remainder differently could clear a delete and then have the write
   * land the empty required set the judgement exists to refuse — or refuse a
   * delete whose write would have produced a perfectly legal non-empty set.
   *
   * `String(v) !== String(id)` is the same reading
   * {@link ObjectQL.storedReferenceIncludes} applies when narrowing
   * `dependents`, so the member removed is exactly the member that made the
   * row a dependent. A non-array value is normalized to the array spelling
   * rather than dismissed, for the same reason the narrowing compares it: an
   * off-shape bare scalar in a `multiple: true` slot is still a reference.
   *
   * [#27004] `cleared` are the members this cascade has already removed from
   * the relation ({@link CascadeDeleteSet.cleared}): a row read once for a
   * whole root set may still list them, and they are not written back.
   */
  private static remainderAfterMemberRemoval(
    stored: unknown,
    id: string | number,
    cleared?: ReadonlySet<string>,
  ): unknown[] {
    const current: unknown[] = Array.isArray(stored) ? stored : [stored];
    return current.filter((v) => String(v) !== String(id) && !cleared?.has(String(v)));
  }

  /**
   * [#12166] The identity the pre-delete reference CHECK runs under — system,
   * unconditionally (maintainer ruling 2026-08-26, option A).
   *
   * `sudo()`-shaped, never a bare `{ isSystem: true }`. The full reasoning sits
   * at the one call site (`cascadeDeleteRelations`'s dependents probe); the
   * short form is that the spread carries three things the bare spelling would
   * drop — the caller's transaction handle, the TENANT scope, and `userId`,
   * which is the audit ledger's triggered-by half beside `isSystem`'s
   * executed-as half.
   *
   * A helper rather than an inline spread because the disclosure re-probe below
   * has to be able to say "the caller's OWN context" by contrast, and because a
   * second inline spelling is how one of the two would later gain a key the
   * other lacks.
   */
  private static referenceCheckContext(context?: ExecutionContext): ExecutionContext {
    return { ...(context ?? {}), isSystem: true } as ExecutionContext;
  }

  /**
   * [#12166, ruling constraint 3] File the reference-check elevation, BOTH
   * halves: `triggeredBy` = the operator who asked for the delete,
   * `executedAs: 'system'` = the identity the check actually ran under.
   *
   * ## Why a record exists at all
   *
   * The elevation is the whole of what this card changed, and an elevation
   * nobody can see afterwards is the thing a security reviewer has no way to
   * audit. The ruling names the Salesforce/Dataverse ledger shape for exactly
   * this reason: a platform-executed integrity action is attributable to the
   * human who triggered it, not laundered into "system did something".
   *
   * ## Why the LOGGER and not a `sys_audit_log` row
   *
   * Stated plainly, because a narrow audit edge has to be visible to be honest
   * (`read-audit.ts` takes the same posture about its own narrowing):
   *
   * The elevated operation is a READ, and `plugin-audit`'s read writer declares
   * — and pins — that a system-elevated read produces NO row, deliberately:
   * those are the platform reading for its own bookkeeping, and recording them
   * would bury the human views that ledger exists to make findable. Minting a
   * row here would either contradict that declared boundary or require the
   * engine to reach into a plugin it does not depend on. The engine's logger is
   * the channel it owns, and it is where the reporting deployment read the
   * defect in the first place — the issue's evidence is a server log line.
   *
   * So: this is a LOG record, at `info`, and the honest limit of it is that a
   * deployment which does not retain engine logs retains no trace. A durable
   * `sys_audit_log` row for the elevation is a follow-up that belongs to
   * plugin-audit, which owns that row shape.
   *
   * `debug` was not an option: a record that is off by default in production is
   * not an audit record.
   *
   * ⛔ The record names the referenced OBJECT and the relation FIELD — declared
   * metadata — and never a row id, a field value, or a count. Constraint 2
   * governs what the CALLER is told; this is the server-side ledger and could
   * defensibly say more, but saying more here is how a count reaches a support
   * transcript, and the two surfaces are kept on one rule so neither has to be
   * re-audited alone.
   */
  private recordReferenceCheckElevation(
    object: string,
    id: string | number,
    childName: string,
    fieldName: string,
    context?: ExecutionContext,
  ): void {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts` (see `DeleteCascadeHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof recordReferenceCheckElevation> = {
      get logger() { return readLogger(); },
    };
    return recordReferenceCheckElevation.call(host, object, id, childName, fieldName, context);
  }

  /**
   * [#12166, ruling constraint 2] May the refusal disclose HOW MANY rows
   * reference this record?
   *
   * The elevation above is what makes this question exist. Before it, the
   * dependents probe ran as the caller, so every number the `DELETE_RESTRICTED`
   * envelope reported (`dependentCount`, the localized message's `count`, the
   * developerMessage) was derived from rows the caller could read by
   * definition. After it, the probe sees rows the caller may have no grant on
   * at all — and shipping that count back would hand a caller with NO read
   * permission on `childName` an exact, repeatable cardinality oracle over it:
   * delete-probe each record of `object`, read the count off the 409, and
   * reconstruct the hidden table's reference histogram without ever being
   * allowed to read a row.
   *
   * The ruling closes that: the error names the referenced OBJECT and nothing
   * about rows — "one notch more conservative than Salesforce". It does NOT ask
   * for the count to be dropped for everyone, and dropping it would be its own
   * regression (the count is what makes the refusal actionable, and it predates
   * this card for callers who could always compute it). So the count is
   * disclosed on exactly one condition: **the caller's own identity would have
   * produced the same rows.**
   *
   * The comparison is on ROW IDENTITY, not on length. Two different sets can
   * have the same size, and RLS narrowing is precisely the case that produces
   * one — a caller who may read `childName` at the object level but whose
   * row-level filter hides two of three referencing rows must not be told
   * "three" either. Comparing id sets makes the object-level denial and the
   * row-level narrowing the same answer, which is what they are.
   *
   * Costs one extra query, and only on the refusal path — the delete is being
   * aborted anyway, so this is not on any successful delete's critical path.
   *
   * Fails CLOSED, on the DISCLOSURE axis: any throw at all (a genuine
   * permission denial, an outage, a driver error) answers "not disclosable".
   * That direction is deliberate and is the opposite of #8895's stance for the
   * integrity probe itself — an integrity guard that cannot run must not
   * silently pass, but a DISCLOSURE that cannot be justified must not silently
   * happen. The two guards face opposite ways because a wrong answer costs
   * opposite things: there, a permitted delete that should have been refused;
   * here, a leak. Nothing about the refusal itself depends on this — an
   * unanswerable probe still refuses the delete, just without the number.
   */
  private async dependentCountIsDisclosable(
    childName: string,
    probeWhere: Record<string, unknown>,
    probedIds: readonly string[],
    fieldName: string,
    multiValued: boolean,
    id: string | number,
    context?: ExecutionContext,
  ): Promise<boolean> {
    // The caller IS the system (seed replay, migration, an internal cascade
    // recursion). Nothing was elevated PAST them, so there is nothing to
    // withhold — and withholding here would strip the count from the engine's
    // own internal paths for no gain.
    if (context?.isSystem === true) return true;
    try {
      // Typed through the DECLARED options type rather than cast: `where` is
      // `Record<string, unknown>` on `EngineQueryOptionsSchema` and `context`
      // rides `BaseEngineOptions`, so nothing here needs erasing
      // (`check:query-options-erasure` — the grandfathered `as any` on the
      // elevated probe above is a pre-existing site this card does not sweep,
      // tracked in #4918).
      let own: any[] = await this.find(childName, { where: probeWhere, context });
      // The SAME narrowing the elevated probe applied (#9362), or the two sets
      // would be compared through different definitions of "references this
      // record" and a multi-value relation would read as non-disclosable
      // always.
      if (multiValued && own) {
        own = own.filter((row: any) => ObjectQL.storedReferenceIncludes(row?.[fieldName], id));
      }
      const ownIds = new Set((own ?? []).map((r: any) => String(r?.id)));
      return ownIds.size === probedIds.length && probedIds.every((rid) => ownIds.has(rid));
    } catch (error) {
      // Says something rather than rethrowing, and the asymmetry is the point
      // (`check:durability-read-invention` accepts either — "say something, or
      // ask the error's type").
      //
      // Rethrowing is WRONG here specifically. The integrity answer is already
      // in hand: the elevated probe succeeded, the dependents are known, and
      // this delete is being refused either way. Propagating a failure of the
      // DISCLOSURE probe would convert a correct `409 DELETE_RESTRICTED` into a
      // `500` — a worse answer for the caller, produced by a query that exists
      // only to decide how much detail the refusal carries.
      //
      // Nor is the invented value a durability hazard of the class that rule
      // guards: no declared set is being read, and `false` withholds. The
      // failure mode of getting this wrong is a slightly less informative
      // refusal, never a permitted delete and never an over-disclosure.
      //
      // The one thing that WOULD be wrong is doing it silently — an operator
      // seeing count-free refusals has no way to tell "withheld on purpose"
      // from "the disclosure probe has been failing for a week".
      this.logger.warn(
        `[reference-cleanup] could not determine whether the caller may be told how many '${childName}' ` +
        `record(s) reference this one; withholding the count from the refusal (the refusal itself stands)`,
        { object: childName, error: (error as Error)?.message ?? String(error) },
      );
      return false;
    }
  }

  /**
   * Apply referential delete behavior for relations pointing AT this record,
   * before it is removed. For every registered object with a `master_detail`,
   * `lookup` or `tree` field, or a `user` field that declares a
   * `deleteBehavior` ({@link statesDeleteSemantics}), referencing
   * `object`, honor the field's `deleteBehavior`:
   *   - `cascade`  → delete the dependent rows (recursively, so grandchildren
   *                  are handled by each child's own delete),
   *   - `set_null` → clear the foreign key. On a MULTI-VALUED field
   *                  ([#18408] {@link declaredMultiValued}, ⛔ not the raw
   *                  flag) the FK is a SET, so "clear" means remove the
   *                  deleted MEMBER and keep the rest; an emptied set on
   *                  an optional field is stored as `null`, the same as one
   *                  never set — the representation `FieldSchema` pins
   *                  (`packages/spec/src/data/field.zod.ts`, the `multiple`
   *                  doc block, ruling A on #29343, record 6591577985,
   *                  amending #9447),
   *   - `restrict` → refuse the delete when dependents exist.
   * `master_detail` defaults to `cascade` (the parent owns the child
   * lifecycle); `lookup` and `tree` default to `set_null` — except a `set_null` default
   * on a REQUIRED lookup escalates to `restrict` (you can't null a NOT NULL
   * FK; restricting with a clear dependent-count message beats a misleading
   * "<field> is required" 400 from the child) — and on a `multiple: true`
   * required lookup that escalation is decided per ROW after the dependents
   * probe (#9688): a row that keeps another member takes the member removal,
   * a row the removal would EMPTY keeps the refusal, and the refusal counts
   * only those rows. A by-id delete runs it for its one record; a predicate
   * delete (`multi: true`) runs it for every row it matched ([#26871], see
   * `delete()`'s predicate arm).
   *
   * [#27004] It takes a ROOT SET: the by-id delete passes a set of one, the
   * predicate arm the ids it matched. Every phase below reads a relation once
   * per {@link REFERENCE_PROBE_BATCH} records of the set
   * ({@link probeReferencingRowsOfSet}), not once per record, and judges and
   * writes per record as before. One walk of one set: a matched row another
   * matched row's cascade reaches is in the set like any other member, so it
   * refuses nothing and is cleared of nothing (#22305), and the predicate
   * arm's own `deleteMany` removes it.
   *
   * [#22305] Two phases, so the walk knows its own set before it judges
   * anything:
   *   1. {@link collectCascadeDeleteSet} — read-only. Every record the cascade
   *      deletes, transitively, across every CASCADING relation, the root
   *      included.
   *   2. {@link walkReferencingRelations} — the walk above, unchanged in
   *      order, except that a `restrict` (authored, or the escalated
   *      required `set_null`) and a `set_null` write consider only rows
   *      OUTSIDE the set. A row in the set is about to be deleted by this same
   *      cascade: it cannot be left dangling, so it refuses nothing, and
   *      clearing its reference would be a write against a row about to go.
   * [#26718] Between the two, {@link refuseRestrictsInsideOwnCascade}, also
   * read-only: an AUTHORED `restrict` held by a member the cascade reaches
   * only THROUGH the record that restrict protects (a child holding a
   * master_detail and a restrict lookup to one parent; a grandchild under it)
   * refuses the delete before the first write. The row is in the set, so phase
   * 2 alone would let the cascade delete it.
   *
   * Before this, the outcome depended on registration order: with the
   * contacts registered ahead of the contracts, deleting an account refused
   * on a contract's required lookup to a contact, a contract the same delete
   * was about to remove; the other order deleted. A refusal from a row outside
   * the set is unchanged, and so is the unit of work: the set is collected
   * inside the transaction that `delete()` opens for the cascade.
   *
   * A nested `delete()` the walk makes for a member joins the ambient set
   * ({@link cascadeDeleteSets}); any other delete reaching here — a hook's,
   * say — is the root of its own cascade, as before.
   */
  private async cascadeDeleteRelations(
    object: string,
    ids: ReadonlyArray<string | number>,
    context?: ExecutionContext,
    depth = 0,
  ): Promise<void> {
    const roots: Array<string | number> = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (id == null || seen.has(String(id))) continue;
      seen.add(String(id));
      roots.push(id);
    }
    if (roots.length === 0 || depth >= ObjectQL.MAX_CASCADE_DEPTH) return;
    // [#9002] The registry read is UNGUARDED, deliberately — and this is the
    // statement that decides whether the cascade runs AT ALL.
    //
    // It used to sit behind a bare `catch { return; }`, which is the #8895
    // shape one layer up: #8895's `catch` invented "no dependents" for ONE
    // relation whose probe could not run; this one invented "no relations" for
    // EVERY relation at once, before the per-relation probe was ever reached —
    // no `restrict` refusal, no `set_null`, no `cascade`, nothing logged, and
    // the caller told the delete succeeded.
    //
    // #8895 ruled the family *discriminate or propagate*. Discrimination needs
    // a benign failure class — there it was the unprovisioned child TABLE,
    // which genuinely cannot hold a referencing row. Here there is none: an
    // unreadable registry is never truthfully "no relations", so `propagate`
    // is the whole answer and the `catch` has nothing left to do.
    //
    // No new error code and no new response field: whatever the registry read
    // raised reaches the caller with its envelope intact, exactly as #8895's
    // probe failure does.
    const objects: ServiceObject[] = this._registry.getAllObjects();
    // [#22305] A member of a cascade already in progress joins that cascade's
    // set. Any other delete is the root of its own cascade, and collects the
    // set first: before one refusal is judged and before one row is written.
    const inherited = this.cascadeDeleteSets.getStore();
    const joining = inherited ? roots.filter((id) => cascadeSetHas(inherited.members, object, id)) : [];
    if (inherited && joining.length > 0) {
      await this.walkReferencingRelations(object, joining, context, objects, inherited);
    }
    const fresh = joining.length > 0 ? roots.filter((id) => !cascadeSetHas(inherited!.members, object, id)) : roots;
    if (fresh.length === 0) return;
    const cascadeSet = await this.collectCascadeDeleteSet(object, fresh, context, objects);
    // [#26718] Every restrict a member's own cascade would override is judged
    // here, before the first write.
    await this.refuseRestrictsInsideOwnCascade(cascadeSet, fresh.map((id) => ({ object, id })), context, objects);
    await this.cascadeDeleteSets.run(cascadeSet, () =>
      this.walkReferencingRelations(object, fresh, context, objects, cascadeSet),
    );
  }

  /**
   * [#27004] How many records of one object a single dependents probe asks
   * about: the predicate arm's `$in` delete batch, so neither statement
   * outgrows a driver's bind-parameter limit.
   */
  private static readonly REFERENCE_PROBE_BATCH = 500;

  /**
   * [#22305] Phase 1 of {@link cascadeDeleteRelations}: every record a by-id
   * delete of `object`/`id` removes, the root included, collected READ-ONLY.
   *
   * Breadth-first across every relation whose resolved behaviour is
   * `cascade`, read through the walk's own two readings — which relations
   * point at an object ({@link cascadeRelationBehavior}) and which rows
   * reference a record ({@link probeReferencingRows}: system identity, the
   * same filter, the same missing-table and multi-value handling) — so the
   * two phases cannot disagree about which rows a cascade reaches. A record
   * already in the set is not expanded again, so a cycle in the data (a
   * self-reference, two objects cascading into each other) terminates.
   *
   * The cost is one extra probe per CASCADING relation per member, since the
   * walk probes those relations again as it deletes. `restrict` and
   * `set_null` relations are not read here. Every probe here is an elevated
   * read, so it files its #12166 record before it runs, through the
   * once-per-record ledger the walk shares ({@link fileReferenceCheckElevation}).
   *
   * [#24964] …except for {@link inspectCascadeDelete}, which passes
   * `fileElevations: false`: that record says "read as system FOR THE DELETE
   * of" the record, and an inspection deletes nothing, so filing it there would
   * put a delete that never happened in the log. The reads are the same.
   *
   * [#27004] From a root SET, level by level: the records found at one depth
   * are probed together, per object and per relation, through
   * {@link probeReferencingRowsOfSet}. The set and its edges are the ones the
   * record-by-record walk collected.
   */
  private async collectCascadeDeleteSet(
    object: string,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    opts: { fileElevations: boolean } = { fileElevations: true },
  ): Promise<CascadeDeleteSet> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts` (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof collectCascadeDeleteSet> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
      fileReferenceCheckElevation: (...a) => this.fileReferenceCheckElevation(...a),
      probeReferencingRowsOfSet: (...a) => this.probeReferencingRowsOfSet(...a),
    };
    return collectCascadeDeleteSet.call(host, object, ids, context, objects, opts);
  }

  /**
   * Does `fieldName` on `child` point at `object` as a relation the cascade
   * walk follows, and with which behaviour? `undefined` when it does not. The
   * behaviour is the RESOLVED one, before the required-`set_null` escalation,
   * which also reads the field's `multiple` and, on a multi-value field, the
   * rows themselves.
   *
   * [#22305] Lifted out of the walk so both phases of
   * {@link cascadeDeleteRelations} read relations one way: the set the first
   * collects is the set the second deletes.
   */
  private cascadeRelationBehavior(
    object: string,
    child: ServiceObject,
    fieldName: string,
    fdef: any,
  ): string | undefined {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts` (see `CascadePlanningHost`).
    const host: ThisParameterType<typeof cascadeRelationBehavior> = {
      resolveObjectName: (...a) => this.resolveObjectName(...a),
    };
    return cascadeRelationBehavior.call(host, object, child, fieldName, fdef);
  }

  /**
   * [#12166, ruling constraint 3] File the elevation record for a probe of
   * `childName` made while deleting `object`/`id` — once. One record per
   * referenced OBJECT, not per relation: two lookup fields on the same child
   * pointing at the same parent are one "the platform read object X as
   * system" fact, and filing it twice would make the ledger's row count a
   * function of the child's field layout.
   *
   * [#22305] The dedupe is the cascade's, not one call's: the collection walk
   * and the deleting walk probe the same cascading relations, and between
   * them file one record per deleted record per referenced object, as the
   * single walk did.
   */
  private fileReferenceCheckElevation(
    set: CascadeDeleteSet,
    object: string,
    id: string | number,
    childName: string,
    fieldName: string,
    context: ExecutionContext | undefined,
  ): void {
    const key = JSON.stringify([object, String(id), childName]);
    if (set.elevationsFiled.has(key)) return;
    set.elevationsFiled.add(key);
    this.recordReferenceCheckElevation(object, id, childName, fieldName, context);
  }

  /**
   * The dependents probe of {@link cascadeDeleteRelations}: the rows of
   * `childName` whose `fieldName` references `id`, read under SYSTEM identity
   * and exactly narrowed. [#22305] Both phases read through it, so the set the
   * collection walk gathers and the rows the deleting walk acts on are one
   * reading of the same relation.
   */
  private async probeReferencingRows(
    childName: string,
    fieldName: string,
    fdef: any,
    id: string | number | ReadonlyArray<string | number>,
    probeWhere: Record<string, unknown>,
    context: ExecutionContext | undefined,
  ): Promise<any[]> {
    let dependents: any[];
    try {
      dependents = await this.find(
        childName,
        // [#12166] (maintainer ruling 2026-08-26, option A) SYSTEM identity,
        // unconditionally. This probe is the platform's own referential-
        // integrity read, not a query the caller asked for, and running it
        // as the caller made "delete permission" silently mean "delete +
        // read on EVERY referencing table": a caller with full delete rights
        // on `object` but no read grant on `childName` got a blanket 403
        // from the security middleware — whether or not a reference existed,
        // and with `childName` EMPTY. Measured on a real deployment across
        // 17 role×object pairs, with the A/B control that granting read-only
        // on the referencing object (touching NOTHING about delete rights)
        // turned the identical delete into a 200.
        //
        // Referential-integrity actions are engine responsibility executed
        // under system identity on every mainstream platform — the RDBMS FK
        // baseline, Salesforce (lookup clearing / cascade delete documented
        // as bypassing sharing), Dataverse, ServiceNow, Odoo. Caller
        // identity here was the outlier.
        //
        // The elevation is `sudo()`-SHAPED (`{ ...context, isSystem: true }`),
        // never a bare `{ isSystem: true }` — the same posture
        // `recomputeSummaries` holds one axis over. Three reasons, and each
        // one is a defect if dropped:
        //   - the open transaction handle, `tenantId` and `timezone` must
        //     survive, or this probe leaves the caller's transaction and
        //     stops being TENANT-scoped — a bare system context would widen
        //     the probe across the tenant wall, which is the opposite of
        //     what this card relaxes;
        //   - `userId` survives, and that IS the audit ledger's
        //     "triggered-by" half (ruling constraint 3): the record carries
        //     triggered-by = the deleting operator and executed-as = system.
        //     `read-audit.ts` states the same property of `sudo()`;
        //   - it is a NARROW elevation: nothing else about the delete path
        //     changes identity (ruling constraint 1). The `set_null` UPDATE
        //     and the `cascade` DELETE below still run as the caller, byte
        //     for byte, so this relaxes the reference CHECK and not the
        //     caller's own authority over the dependent rows.
        //
        // [Constraint 4] If the spec later declares per-relationship
        // on-delete behaviour, BEHAVIOUR follows the declaration; the
        // identity of this probe stays system, unconditionally. Do not make
        // this line conditional on `behavior`.
        { where: probeWhere, context: ObjectQL.referenceCheckContext(context) } as any,
      );
    } catch (error) {
      // [#8895] Discriminate by error TYPE — this probe IS the referential
      // guard, so an empty answer is only truthful for the one failure that
      // really means "no dependents".
      //
      // The bare `catch { continue }` this replaces reached `continue` on
      // ANY probe failure, and every consequence of that is silent: the
      // walk's `restrict` branch never fires, so a delete the integrity
      // rules say must be REFUSED is allowed through; `set_null`/`cascade`
      // never run, so child rows that should have been nulled or removed
      // are left orphaned; nothing is logged and the caller is told the
      // delete succeeded. Fail-OPEN on an integrity guard — the read did
      // not happen and the answer "there are none" was invented for it
      // (ADR-0110 D3: "the probe found nothing" and "the probe could not
      // run" are different facts with opposite meanings here).
      //
      // Benign: the child object is registered but its TABLE was never
      // provisioned (schema sync not run yet). It cannot hold a row that
      // references anything, so zero dependents IS the truth and skipping
      // the relation is correct. Asked through the shared
      // `isMissingTableError` predicate (`@objectstack/metadata/errors`,
      // #4825) — the same call `seedAutonumber` and `resolveFileReferences`
      // make — never a hand-rolled code test.
      //
      // Everything else (connection drop, timeout, permission denial, a
      // query error, a missing COLUMN on a provisioned table) means the
      // dependents may well exist and simply were not seen. It propagates:
      // the delete fails loudly and nothing is written, which is the same
      // disposition the maintainer's 2026-08-15 ruling gives this family —
      // unprovisioned is truthful emptiness, everything else must surface.
      // A guard that could not be EVALUATED must not silently pass.
      //
      // No new response field and no new error code: the caller receives
      // the probe's own failure, envelope intact.
      if (isMissingTableError(error, childName)) return [];
      throw error;
    }
    // [#9362] The multi-value pushdown in the probe filter can be a SUPERSET
    // (the substring reading, on a backend without the declaration), so the
    // exact answer is taken here, on the rows themselves. Everything the walk
    // does with them — the `restrict` count in the 409 envelope, the `cascade`
    // recursion, the `set_null` write — and the set the collection walk
    // gathers read this answer, so narrowing anywhere later would leave one of
    // them acting on a row that never referenced this record.
    // [#27004] Over a set of ids (`probeReferencingRowsOfSet`), a row is kept
    // when it holds any of them.
    if (declaredMultiValued(fdef) && dependents) {
      const wanted: ReadonlyArray<string | number> = Array.isArray(id) ? id : [id as string | number];
      dependents = dependents.filter((row) =>
        wanted.some((w) => ObjectQL.storedReferenceIncludes(row?.[fieldName], w)),
      );
    }
    return dependents ?? [];
  }

  /**
   * [#27004] {@link referenceProbeFilter} for a SET of records: the rows that
   * reference any of `ids`. A single-valued reference asks `$in`; a
   * multi-valued one ORs each id's own limbs, the spelling the nested-relation
   * lowering already sends for a multiple lookup. One id is that id's own
   * filter, byte for byte.
   */
  private referenceProbeFilterOfSet(
    fieldName: string,
    fdef: { type?: unknown; multiple?: unknown },
    ids: ReadonlyArray<string | number>,
  ): Record<string, unknown> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts` (see `CascadePlanningHost`).
    const host: ThisParameterType<typeof referenceProbeFilterOfSet> = {
      referenceProbeFilter: (...a) => this.referenceProbeFilter(...a),
    };
    return referenceProbeFilterOfSet.call(host, fieldName, fdef, ids);
  }

  /**
   * [#27004] The dependents probe ({@link probeReferencingRows}) for a SET of
   * records of one object: the rows of `childName` referencing each of `ids`,
   * keyed by `String(id)`. One read per {@link REFERENCE_PROBE_BATCH} ids, so a
   * walk over a predicate delete's matched rows costs one probe per relation
   * per batch rather than one per row; a batch of one is the by-id probe,
   * filter and all.
   *
   * Each row is then given to the ids it references: its stored value on a
   * single-valued field, its members on a multi-valued one (the #9362 exact
   * reading, {@link storedReferenceIncludes}). A row of a single-valued field
   * whose value names none of the batch (a driver comparing ids in a way
   * `String()` does not) is never dropped: that batch is asked again id by
   * id, which is the by-id answer.
   */
  private async probeReferencingRowsOfSet(
    childName: string,
    fieldName: string,
    fdef: any,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
  ): Promise<Map<string, any[]>> {
    const byId = new Map<string, any[]>();
    const multiValued = declaredMultiValued(fdef);
    const batchSize = ObjectQL.REFERENCE_PROBE_BATCH;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const rows = await this.probeReferencingRows(
        childName, fieldName, fdef, batch.length === 1 ? batch[0] : batch,
        this.referenceProbeFilterOfSet(fieldName, fdef, batch), context,
      );
      if (batch.length === 1) {
        byId.set(String(batch[0]), rows);
        continue;
      }
      const found = new Map<string, any[]>(batch.map((id) => [String(id), []]));
      let unattributed = false;
      for (const row of rows) {
        // The members' reading is `storedReferenceIncludes`'s, element by
        // element; a single value is compared as one.
        const stored = row?.[fieldName];
        const values: unknown[] = multiValued && Array.isArray(stored) ? stored : [stored];
        const held = new Set<string>();
        for (const v of values) {
          if (v == null || typeof v === 'object') continue;
          if (found.has(String(v))) held.add(String(v));
        }
        if (held.size === 0) { unattributed = true; break; }
        for (const key of held) found.get(key)!.push(row);
      }
      if (unattributed) {
        for (const id of batch) {
          found.set(String(id), await this.probeReferencingRows(
            childName, fieldName, fdef, id, this.referenceProbeFilter(fieldName, fdef, id), context,
          ));
        }
      }
      for (const [key, held] of found) byId.set(key, held);
    }
    return byId;
  }

  /**
   * [#22305] Phase 2 of {@link cascadeDeleteRelations}, for one record of
   * `cascadeSet`: refuse, clear or cascade each relation that points at it.
   * Unchanged from the single walk it was, but for three readings of the set:
   * a `restrict` and a `set_null` consider only rows OUTSIDE it, and a row the
   * walk has already entered is not cascaded into again.
   */
  private async walkReferencingRelations(
    object: string,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    cascadeSet: CascadeDeleteSet,
  ): Promise<void> {
    // Entered before the first nested `delete()` can come back here: every
    // record of the set, so one member's cascade never deletes another.
    for (const id of ids) cascadeSetAdd(cascadeSet.entered, object, id);
    // [#24948] An organization that still owns rows is refused here, whole,
    // before the first relation below is cascaded or cleared.
    if (object === ORGANIZATION_OBJECT) {
      for (const id of ids) await this.refuseOrganizationDeleteWhileOwned(id, context, objects, cascadeSet);
    }
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        const resolvedBehavior = this.cascadeRelationBehavior(object, child, fieldName, fdef);
        if (resolvedBehavior === undefined) continue;
        // [#24948] Judged by `refuseOrganizationDeleteWhileOwned` above, which
        // found no row outside the cascade set: there is nothing to clear, and
        // clearing is not on offer for this column anyway.
        if (this.isTenantColumnSetNull(object, child, fieldName, resolvedBehavior)) continue;
        // [#24948] A reference the organization's delete keeps as it is,
        // naming the deleted organization: never cleared, never counted.
        if (object === ORGANIZATION_OBJECT && resolvedBehavior === 'set_null' &&
            ObjectQL.keepsOrganizationReference(child, fieldName)) continue;
        let relationBehavior: string = resolvedBehavior;

        // [#9689] (maintainer ruling 2026-08-19, Q3 = B): the judgement the
        // #9625 comment in `cascadeRelationBehavior` deferred is now taken — `FieldSchema` REJECTS an
        // authored `deleteBehavior: 'set_null'` on a `master_detail` at parse
        // time, so the value is meaningful again: one that still reaches this
        // site came in around the parse seam (a raw `registerObject`, or a
        // stored/artifact row written before the tightening — the two
        // populations parse-time rejection measurably cannot catch, since the
        // engine registers raw objects and never re-parses). The coercion
        // itself stays: this delete is about to CASCADE children whose
        // declaration asked for them to be kept, and that divergence must be
        // loud and attributable, not silent. Sanctioned logger shape per
        // PR #9750: reach for `error`, fall back to `warn` — NEVER an optional
        // call like `logger.error?.()`, which emits nothing against a sink
        // with no `error`. Caveat, measured (#4447): a built app artifact
        // materializes FieldSchema defaults, so an artifact-loaded BARE
        // master_detail also carries `set_null` and logs here — that residual
        // imprecision is the materialized-default defect tracked as #9784, not
        // a reason to soften this log.
        if (fdef.type === 'master_detail' && fdef.deleteBehavior === 'set_null') {
          for (const id of ids) {
            const msg =
              `[cascade-delete] ${childName}.${fieldName} declares deleteBehavior: 'set_null' on a ` +
              `master_detail referencing '${object}' — that value is NOT honored on master_detail: the ` +
              `delete of ${object}/${String(id)} CASCADES its referencing child rows, the opposite of what ` +
              `the declaration asks (children kept). FieldSchema now rejects this combination at parse time; ` +
              `this row reached the engine around the parse seam (raw registration, or metadata stored ` +
              `before the tightening). Re-declare the field: 'restrict' refuses the parent delete while ` +
              `children exist (no data loss), 'cascade' (or omitting the key) accepts the cascade ` +
              `deliberately, or make it a lookup if children must survive the parent.`;
            if (typeof this.logger.error === 'function') this.logger.error(msg);
            else this.logger.warn(msg);
          }
        }

        // A REQUIRED foreign key cannot be nulled — set_null would issue an
        // UPDATE clearing the FK, which the child's required-field validator
        // rejects with a misleading "<field> is required" 400 (the field isn't
        // even on the object being deleted). That's a contradiction, not the
        // author's intent: a required FK means the child can't exist detached,
        // so deleting the parent must be RESTRICTed (SQL's default for a
        // NOT NULL FK). Authors who want the children gone set
        // deleteBehavior:'cascade' explicitly.
        //
        // [#9625] The test reads the RESOLVED `behavior` (`cascadeRelationBehavior`),
        // which no longer records how the value got there. So it escalates
        // BOTH the defaulted set_null and one the author wrote out as
        // `deleteBehavior: 'set_null'` — the two are indistinguishable here by
        // construction, and both are measured escalating
        // (`engine-cascade-delete.test.ts`). Only `cascade` and `restrict` are
        // untouched. The predecessor of this comment claimed the escalation
        // applied to the *defaulted* set_null alone; that was true of
        // `cascade`/`restrict` and false of an explicit `set_null`, which is
        // the half-truth #9625 measured. Say it the way the code behaves: the
        // escalation is a property of the RESOLVED behavior plus `required`,
        // not of what the author typed.
        //
        // [#9688] The rationale above is also what BOUNDS the escalation, and
        // on a `multiple: true` field it does not reach every row. The
        // set_null limb there does not clear the slot: since #9438 it removes
        // the deleted MEMBER and writes the remainder. So "a cleared required
        // FK trips the child's validator" is true of exactly one case — the
        // row whose set the removal would EMPTY, since `[]` is what the #9447
        // ruling (maintainer, 2026-08-18) says violates `required` on a
        // multi-value field, and what the record validator has rejected since
        // #9476. A row that still holds another live member is written a
        // NON-EMPTY set, which `required` accepts and no validator objects
        // to; refusing its parent's delete was broader than the contract, and
        // refused it citing a failure that could not have happened.
        //
        // Emptiness is a property of a ROW, not of the field — and no row has
        // been read at this point. So the multi-value half of the escalation
        // is DEFERRED to just after the dependents probe (search
        // `requiredSetNull` below), where the rows are known and exactly
        // narrowed. The single-valued half stays here and is unchanged:
        // clearing a scalar FK always writes `null`, so its premise needs no
        // row to hold.
        //
        // The deferral changes WHEN the decision is made, never who it is
        // reported to: a row that does keep the refusal still refuses THIS
        // relation before its own set_null write runs, so the caller is told
        // `DELETE_RESTRICTED` about the record it asked to delete, instead of
        // the child's own `required` 400 naming a field that is not on that
        // record's object at all.
        //
        // [#9362] `multiValued` is declared here rather than at the probe
        // because the probe's filter spelling, the set_null write below and
        // — since #9688 — this escalation all turn on it.
        // [#18408] Was `fdef.multiple === true`. See {@link declaredMultiValued}.
        const multiValued = declaredMultiValued(fdef);
        const requiredSetNull = relationBehavior === 'set_null' && fdef.required === true;
        if (requiredSetNull && !multiValued) {
          relationBehavior = 'restrict';
        }

        // [#12166, ruling constraint 3] File the elevation BEFORE it happens,
        // and file BOTH halves — triggered-by = the deleting operator,
        // executed-as = system (the Salesforce/Dataverse ledger shape).
        //
        // Before the probe rather than after, because the fact being recorded
        // is that the platform read this object under an identity the caller
        // does not hold. That is true whether the probe then finds rows, finds
        // none, refuses the delete, or fails — and a record written only on the
        // success path would be missing exactly the runs an auditor goes
        // looking for.
        for (const id of ids) this.fileReferenceCheckElevation(cascadeSet, object, id, childName, fieldName, context);

        // [#27004] One probe per batch of the set; each record then takes its
        // own rows, in the set's order.
        const referencing = await this.probeReferencingRowsOfSet(childName, fieldName, fdef, ids, context);
        const clearedKey = cascadeMemberKey(childName, fieldName);
        let cleared = cascadeSet.cleared.get(clearedKey);
        if (!cleared) { cleared = new Set(); cascadeSet.cleared.set(clearedKey, cleared); }
        for (const id of ids) {
          let behavior: string = relationBehavior;
          let dependents = referencing.get(String(id)) ?? [];
          if (dependents.length === 0) continue;

          // [#12166] The one record's probe filter: the DISCLOSURE re-probe in
          // `deleteRestrictedError` asks the identical question under the
          // caller's own identity. [#27004] The batched probe above is built from
          // this same filter, id by id ({@link referenceProbeFilterOfSet}), and
          // narrowed by the same reading, so the two cannot disagree about which
          // rows reference this record.
          const probeWhere = this.referenceProbeFilter(fieldName, fdef, id);

          // [#12166] The elevated probe's row IDENTITY, captured here — after the
          // multi-value narrowing and BEFORE the `requiredSetNull && multiValued`
          // narrowing below reduces `dependents` to the emptied subset. This is
          // the set the disclosure decision compares against, and the stage
          // matters: the emptied subset is computed from these rows' own stored
          // values, so a caller who can see exactly these rows can derive the
          // emptied count too, while a caller who cannot see them can derive
          // neither. Comparing at the later stage would leak the difference.
          const probedIds: readonly string[] = dependents.map((r: any) => String(r?.id));

          // [#22305] A row the cascade itself deletes refuses nothing and is
          // cleared of nothing: the triage ruling on #22305 is that a child in the
          // cascade set never restricts a sibling in the same set. Such a row is
          // not left dangling, because this same unit of work removes it, and
          // clearing its reference would be a write against a row about to go.
          // (The one cascade that is not one unit of work is
          // `planCascadeAtomicity`'s `'split'`: there a later refusal can strand
          // such a row, the partial outcome `warnCascadeNotAtomic` already
          // declares for every row that path deletes.) So `restrict` (authored,
          // or either half of the required escalation) and `set_null` judge only
          // the rows OUTSIDE the set, and a relation whose rows are all inside it
          // is done. `cascade` keeps every row: its rows ARE the set, and the
          // walk deletes them below.
          //
          // [#26718] …except an AUTHORED restrict held by a row the cascade reaches
          // only through the record that restrict protects: that one was judged
          // before the cascade wrote anything ({@link refuseRestrictsInsideOwnCascade}),
          // so a row in the set reaching here refuses nothing.
          //
          // After `probedIds`, on purpose: the disclosure check still compares
          // the caller's own view against every row the elevated probe read, so a
          // count is disclosed only to a caller who can see the whole relation,
          // as before; what it counts is the rows that actually refuse.
          if (behavior !== 'cascade') {
            dependents = dependents.filter((row) => !cascadeSetHas(cascadeSet.members, childName, row?.id));
            if (dependents.length === 0) continue;
          }

          // [#9688] The deferred half of the required escalation, decided per
          // ROW now that the rows are read and exactly narrowed — every row
          // here genuinely holds `id`, so its remainder is its set minus that
          // one member.
          //
          // The emptiness question is asked through
          // `remainderAfterMemberRemoval`, which is the SAME computation the
          // set_null write below performs. One function, two call sites, so the
          // judgement cannot predict a shape the write would not produce: a
          // predicate that computed the remainder even slightly differently
          // could clear the delete and then let the write land the very `[]`
          // this judgement exists to prevent.
          //
          // ANY row that would be emptied refuses the WHOLE delete — a delete
          // either happens or it does not, and a partial cascade is not on
          // offer. `dependents` is reduced to those rows first, because every
          // number the refusal reports reads it: `dependentCount`, the
          // localized message's `count`, and the developerMessage. Counting the
          // rows this delete no longer refuses over is the second defect the
          // card names, and it is fixed by the same statement.
          if (requiredSetNull && multiValued) {
            const emptied = dependents.filter(
              (row) => ObjectQL.remainderAfterMemberRemoval(row?.[fieldName], id, cleared).length === 0,
            );
            if (emptied.length > 0) {
              behavior = 'restrict';
              dependents = emptied;
            }
          }

          if (behavior === 'restrict') {
            throw await this.deleteRestrictedError({
              object, id, child, childName, fieldName, fdef, dependents, probeWhere, probedIds, multiValued,
              objects, context,
            });
          }

          for (const dep of dependents) {
            const depId = dep?.id;
            if (depId == null) continue;
            if (behavior === 'cascade') {
              // [#22305] Entered already: an ancestor of this delete, still in
              // progress up the stack (a cycle in the data), or a row an earlier
              // branch of this cascade has deleted (a row reached by two paths).
              // Either way this cascade removes it once, and re-entering would
              // loop forever on the first and answer 404 on the second.
              if (cascadeSetHas(cascadeSet.entered, childName, depId)) continue;
              // Recurse via the public delete so the child's own cascade,
              // hooks and events fire.
              //
              // [#23221] Inside a token naming exactly this child, which that
              // delete claims and projects onto the DECLARED
              // `HookContext.referentialCascadeDelete` (see
              // claimReferentialCascadeDelete): on the real request path the
              // caller's context reaches the child unchanged, so without it a
              // freeze guard cannot tell this delete from a hand delete of the
              // same row. The context is passed as before, by reference and
              // unmarked — see `cascadeIssuedDeletes` for why the marker is not
              // a context key. A grandchild is issued by the child's own walk,
              // inside a token of its own.
              await this.cascadeIssuedDeletes.run(
                { object: childName, id: String(depId), claimed: false },
                () => this.delete(childName, { where: { id: depId }, context } as any),
              );
            } else {
              // [#3023] Clear the FK as an engine-internal referential-integrity
              // write, tagged so plugin-security's ownership-anchor guard (#3004)
              // treats an `owner_id = null` cascade as integrity maintenance, not
              // a user-initiated disown — otherwise deleting the referenced record
              // trips the transfer guard and aborts the cascade mid-way. Marker
              // rides a server-DERIVED context (set here, never from client input
              // — same trust model as `__expandRead`), so it cannot be forged from
              // a request to bypass the guard on an ordinary write.
              //
              // [commit 34ce8e7db] This same marker is what `update()`'s hook-context
              // assembly projects onto the DECLARED `HookContext.
              // referentialFieldClear` (see buildReferentialFieldClear), so an
              // app guard can recognise the cleanup without reading an
              // operation-private key — on the real request path the inherited
              // caller envelope makes the cleanup otherwise indistinguishable
              // from a hand-clear of the same lookup.
              //
              // [#20006] `__referentialFieldClearCause` rides beside it: the
              // delete this cleanup serves and the reference it clears, which a
              // traversing rule's refusal of the cleanup names (see
              // `resolvePredicateRelated`). It authorizes nothing — it is read
              // only where the marker already holds, and only to word a refusal —
              // and the referencing row's id in it never reaches that text.
              const referentialCtx = {
                ...(context ?? {}),
                __referentialFieldClear: true,
                __referentialFieldClearCause: {
                  object, id: String(id), referencingObject: childName, referencingId: String(depId), field: fieldName,
                },
              } as ExecutionContext;
              if (multiValued) {
                // The FK is a SET, so `set_null` clears the deleted MEMBER, not
                // the slot: filter the stored array and write what remains.
                // Nulling the slot instead discarded every other live reference
                // (measured: `["acc_a","acc_b"]` re-read as `null` after
                // `acc_a` was deleted).
                //
                // The residual shape when the last member goes is not this
                // engine's call to make: `FieldSchema` pins it —
                // `packages/spec/src/data/field.zod.ts`, the `multiple` and
                // `required` doc blocks (ruling A on #29343, record
                // 6591577985, amending #9447) — and this write consumes that
                // contract: it hands the write door the `[]` that
                // `Array.prototype.filter` yields, and the door stores an
                // emptied optional set as `null` (`blankAsNullColumns`, reach
                // `'emptyList'`), the same as one never set.
                //
                // [#9688] The remainder is computed by
                // `remainderAfterMemberRemoval`, which the per-row required
                // judgement above calls on the same row: this write is only
                // reached for a row that judgement measured as keeping at least
                // one other member, and the two must agree by construction.
                // The reading it applies — `String(v) !== String(id)`, and an
                // off-shape bare scalar normalized to the array spelling — is
                // documented there.
                const next = ObjectQL.remainderAfterMemberRemoval(dep?.[fieldName], id, cleared);
                await this.update(childName, { id: depId, [fieldName]: next }, { context: referentialCtx } as any);
              } else {
                await this.update(childName, { id: depId, [fieldName]: null }, { context: referentialCtx } as any);
              }
            }
          }
          // [#27004] Every row outside the set has had `id` cleared from it.
          cleared.add(String(id));
        }
      }
    }
  }

  /**
   * [#26718] Before the cascade writes anything: refuse the delete when an
   * AUTHORED `restrict` is held by a row the cascade would remove only because
   * the record that restrict protects is removed.
   *
   * The deleting walk judges a `restrict` against rows OUTSIDE the cascade set
   * alone (#22305), and a row inside it was exempt whatever put it there. That
   * exemption is right for a row the cascade reaches through ANOTHER record (a
   * contract and the contact it restricts, both details of the account being
   * deleted: the account's delete removes both, and neither is left dangling).
   * It was wrong for a row reached THROUGH the very record it protects: a child
   * holding a `master_detail` and a `restrict` lookup to the same parent is in
   * that parent's set by its own master_detail, so the restrict was never
   * asked and the cascade deleted the child — the record the author declared
   * undeletable. A grandchild under that parent holding the restrict is the
   * same case one level down.
   *
   * So for every member, every relation whose RESOLVED behaviour is `restrict`
   * ({@link cascadeRelationBehavior}, an authored `restrict` on a lookup,
   * tree or master_detail) is probed here when its object has a member in the
   * reach of that member ({@link cascadeReachOf}); a referencing row in the
   * reach refuses with the walk's own `DELETE_RESTRICTED`
   * ({@link deleteRestrictedError}). Every restrict is judged before the
   * first cascade, so the outcome no longer depends on the order the fields or
   * objects are declared in, and nothing has been written when it refuses.
   *
   * ⛔ The required-lookup escalation (`set_null` on a required field read as
   * `restrict`) is not judged here: it restricts because a required reference
   * cannot be CLEARED, and a row the cascade deletes is never cleared. It keeps
   * the #22305 rule. Neither does this replace the walk's judgement of rows
   * outside the set, which is unchanged.
   */
  private async refuseRestrictsInsideOwnCascade(
    cascadeSet: CascadeDeleteSet,
    roots: ReadonlyArray<{ object: string; id: string | number }>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
  ): Promise<void> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts` (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof refuseRestrictsInsideOwnCascade> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
      fileReferenceCheckElevation: (...a) => this.fileReferenceCheckElevation(...a),
      probeReferencingRowsOfSet: (...a) => this.probeReferencingRowsOfSet(...a),
      deleteRestrictedError: (...a) => this.deleteRestrictedError(...a),
      referenceProbeFilter: (...a) => this.referenceProbeFilter(...a),
    };
    return refuseRestrictsInsideOwnCascade.call(host, cascadeSet, roots, context, objects);
  }

  /**
   * The `DELETE_RESTRICTED` refusal of deleting `object`/`id` because
   * `dependents` of `childName` reference it via `fieldName`. One builder for
   * the deleting walk ({@link walkReferencingRelations}) and the judgement
   * before it ({@link refuseRestrictsInsideOwnCascade}), so the two answer one
   * envelope.
   */
  private async deleteRestrictedError(args: {
    object: string;
    id: string | number;
    child: ServiceObject;
    childName: string;
    fieldName: string;
    fdef: any;
    dependents: readonly any[];
    probeWhere: Record<string, unknown>;
    probedIds: readonly string[];
    multiValued: boolean;
    objects: ServiceObject[];
    context: ExecutionContext | undefined;
  }): Promise<Error> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts` (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof deleteRestrictedError> = {
      validationMessageContext: (...a) => this.validationMessageContext(...a),
      dependentCountIsDisclosable: (...a) => this.dependentCountIsDisclosable(...a),
      objectDisplayLabel: (...a) => this.objectDisplayLabel(...a),
    };
    return deleteRestrictedError.call(host, args);
  }

  /**
   * [#24948] Is `fieldName` on `child` the TENANT column of `child`, pointing at
   * the organization being deleted with the `set_null` behaviour?
   *
   * The tenant column is the one `resolveTenantFieldName` names: the column
   * the engine stamps and scopes by, whether the registry injected it
   * (`TENANT_SCOPE_FIELD_DEF`) or the object declared its own, as the identity
   * tables do. Every such lookup resolves to `set_null` unless its author wrote
   * something else, and ADR-0131 D1 leaves NULL nothing to mean: a cleared
   * tenant column is an orphan, and on a store whose column is already NOT
   * NULL the clear is a constraint failure halfway through a delete. So the
   * engine never clears one. {@link refuseOrganizationDeleteWhileOwned} refuses
   * the delete instead. An authored `cascade` or `restrict` keeps its own
   * meaning.
   */
  private isTenantColumnSetNull(
    object: string,
    child: ServiceObject,
    fieldName: string,
    behavior: string | undefined,
  ): boolean {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`.
    return isTenantColumnSetNull(object, child, fieldName, behavior);
  }

  /**
   * [#24948] Do `child`'s rows outlive the organization they name? Read from
   * the declaration the object already carries, never from a list of names:
   *
   *   - `managedBy: 'append-only'`, a ledger (the audit bucket: `sys_activity`,
   *     `sys_audit_log`, `sys_email` and their siblings). Such a row is history:
   *     it ages out on its own retention, or is the delivery log of something
   *     that already happened. The organization delete itself writes
   *     `sys_activity` rows, so a ledger that counted would refuse every
   *     organization delete, the empty ones included (seat decision 6305179819).
   *   - `managedBy: 'engine-owned'`, a row the platform writes as a consequence
   *     of records or activity (approval state, automation runs, notification
   *     and HTTP deliveries, mirrored mail, record shares, import jobs,
   *     settings values), which an administrator cannot delete over the data
   *     API. Counting it would make any organization that has been used
   *     undeletable through every door (seat decision 6307135388).
   *
   * Neither refusal counts such a row. It is kept, and so is every reference it
   * holds to the organization: it goes on naming the deleted organization,
   * never NULL (ADR-0131 D1) and never deleted (ADR-0131 §8), and under tenant
   * scoping the row reads as no organization's.
   */
  private static outlivesOrganization(child: ServiceObject): boolean {
    const managedBy = (child as { managedBy?: unknown })?.managedBy;
    return managedBy === 'append-only' || managedBy === 'engine-owned';
  }

  /**
   * [#24948] Does an organization delete keep `child.fieldName`, a `set_null`
   * lookup into `sys_organization` that is not `child`'s tenant column, as it
   * is? Two kinds of reference, and only these (seat decisions 6305179819,
   * 6305996369 and 6307135388):
   *
   *   - every such lookup on an object whose rows outlive the organization
   *     ({@link outlivesOrganization}): `sys_audit_log.tenant_id` is the audit
   *     log's attribution, not its tenant column, and history outlives what it
   *     audits;
   *   - an attribution column named `organization_id` on an object whose
   *     tenancy is disabled (`resolveTenantFieldName` answers null): neither
   *     counted nor cleared. No object in this tree declares one today.
   *
   * Everything else keeps its `set_null`: a pointer such as a session's or an
   * API key's `active_organization_id`, or a parent-organization lookup, is
   * cleared exactly as before.
   */
  private static keepsOrganizationReference(child: ServiceObject, fieldName: string): boolean {
    if (ObjectQL.outlivesOrganization(child)) return true;
    return fieldName === SystemFieldName.ORGANIZATION_ID && resolveTenantFieldName(child) === null;
  }

  /**
   * [#24948] How many rows of `childName` name the organization `id` through
   * `fieldName`, leaving out the rows the cascade itself deletes. A system
   * `count`, never a row read, for every table the cascade deletes no row of,
   * which is every table but the cascading children of the organization (none
   * on the platform). Only for such a table are the rows probed
   * ({@link probeReferencingRows}), so the cascade's own members can be left
   * out exactly. A table never provisioned holds none.
   */
  private async countReferencingRowsOutside(
    childName: string,
    fieldName: string,
    fdef: any,
    id: string | number,
    cascadeSet: CascadeDeleteSet,
    context: ExecutionContext | undefined,
  ): Promise<{ where: Record<string, unknown>; count: number }> {
    const where = this.referenceProbeFilter(fieldName, fdef, id);
    if ((cascadeSet.members.get(childName)?.size ?? 0) > 0) {
      const probed = await this.probeReferencingRows(childName, fieldName, fdef, id, where, context);
      return { where, count: probed.filter((row) => !cascadeSetHas(cascadeSet.members, childName, row?.id)).length };
    }
    try {
      return { where, count: await this.count(childName, { where, context: ObjectQL.organizationCountContext(context) }) };
    } catch (error) {
      if (isMissingTableError(error, childName)) return { where, count: 0 };
      throw error;
    }
  }

  /**
   * [#24948] The context an organization's row counts run under: system
   * identity, and nothing of the caller's scope. A `tenantId` carried in from
   * a caller acting in another organization would scope the count to THAT
   * organization and read 0 rows naming this one, so the refusal would pass on
   * an undercount. Only the request's transaction and trace are kept: the
   * count must see the request's own uncommitted writes. The ordinary
   * reference probes keep the caller's scope ({@link referenceCheckContext}).
   */
  private static organizationCountContext(context?: ExecutionContext): ExecutionContext {
    return {
      isSystem: true,
      ...(context?.transaction !== undefined ? { transaction: context.transaction } : {}),
      ...(context?.traceId !== undefined ? { traceId: context.traceId } : {}),
    } as ExecutionContext;
  }

  /**
   * [#24948] May the refusal disclose `count` to the caller? Only when the
   * caller's own identity counts the same rows: the elevated count read rows
   * the caller may not see. (A system caller's own count is the elevated one.)
   */
  private organizationCountIsDisclosable(
    childName: string,
    where: Record<string, unknown>,
    count: number,
    context: ExecutionContext | undefined,
  ): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts` (see `CascadePlanningHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof organizationCountIsDisclosable> = {
      count: (...a) => this.count(...a),
      get logger() { return readLogger(); },
    };
    return organizationCountIsDisclosable.call(host, childName, where, count, context);
  }

  /**
   * [#24948] The engine half of organization delete: refuse while any row
   * outside the cascade set still names the organization in its tenant column,
   * a row that outlives the organization excepted ({@link outlivesOrganization}).
   *
   * Runs before the walk touches the first relation, and reads every tenant
   * relation before it throws, so the one refusal names every table that holds
   * rows, each with its count. It is the safety net under plugin-auth's own
   * refusal, which answers the same question before better-auth deletes the
   * organization's members: whatever path reaches a `sys_organization` delete,
   * no row is orphaned to NULL, on a store born with a nullable tenant column
   * or anywhere else.
   *
   * Each relation is COUNTED ({@link countReferencingRowsOutside}: system
   * identity, its elevation filed first, a missing table read as no rows),
   * never read row by row, so a large organization costs one `count` per
   * table. A count reaches the refusal only when the caller's own identity
   * counts the same ({@link organizationCountIsDisclosable}); otherwise the
   * table is named without one. The wire code is the standard catalog's `DELETE_RESTRICTED`,
   * because that is the condition: a delete refused while dependents exist.
   */
  private async refuseOrganizationDeleteWhileOwned(
    id: string | number,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    cascadeSet: CascadeDeleteSet,
  ): Promise<void> {
    const owned: Array<{ object: string; count?: number }> = [];
    for (const child of objects) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      // An append-only or engine-owned object's rows outlive the organization: not counted, kept as they are.
      if (!childName || !fields || ObjectQL.outlivesOrganization(child)) continue;
      for (const [fieldName, fdef] of Object.entries(fields)) {
        const behavior = this.cascadeRelationBehavior(ORGANIZATION_OBJECT, child, fieldName, fdef);
        if (!this.isTenantColumnSetNull(ORGANIZATION_OBJECT, child, fieldName, behavior)) continue;
        this.fileReferenceCheckElevation(cascadeSet, ORGANIZATION_OBJECT, id, childName, fieldName, context);
        const { where, count } = await this.countReferencingRowsOutside(childName, fieldName, fdef, id, cascadeSet, context);
        if (count === 0) continue;
        const disclose = await this.organizationCountIsDisclosable(childName, where, count, context);
        owned.push(disclose ? { object: childName, count } : { object: childName });
      }
    }
    if (owned.length === 0) return;
    const named = owned
      .map((o) => (o.count === undefined ? o.object : `${o.object} (${o.count})`))
      .join(', ');
    const err: any = new Error(
      `Cannot delete this organization: it still owns records in ${named}. ` +
        'Delete or move those records first, then delete the organization.',
    );
    err.developerMessage =
      `Cannot delete ${ORGANIZATION_OBJECT} (${id}): rows still reference it through their tenant column ` +
      `in ${named}. The engine never clears a tenant column (ADR-0131 D1), so the delete is refused ` +
      'until those rows are deleted or moved to another organization.';
    err.code = 'DELETE_RESTRICTED';
    err.status = 409;
    err.httpStatus = 409;
    err.object = ORGANIZATION_OBJECT;
    // The first table in the `DELETE_RESTRICTED` envelope's own two keys, and
    // every table in `dependents`.
    err.dependentObject = owned[0].object;
    if (owned[0].count !== undefined) err.dependentCount = owned[0].count;
    err.dependents = owned;
    throw err;
  }

  /**
   * [#24948] How many rows each object holds for `organizationId` in its tenant
   * column: the question plugin-auth's organization delete asks before
   * anything is deleted. Only objects holding at least one row are listed.
   *
   * The relations read are the ones {@link refuseOrganizationDeleteWhileOwned}
   * judges, through the same reader ({@link cascadeRelationBehavior}: a
   * federated object's unprovisioned injected column is no relation), widened
   * to every behaviour: a tenant column its author declared `restrict` blocks
   * the delete too, and one declared `cascade` would delete records, which is
   * not the organization's own structure either. A count, never a row: the
   * read is a system-identity `count`, and a table never provisioned holds no
   * row.
   *
   * `exclude` names the objects the caller removes as part of the delete
   * itself. An append-only or engine-owned object is never counted ({@link
   * outlivesOrganization}), the same set the engine's own refusal leaves out.
   */
  async organizationOwnedRowCounts(
    organizationId: string,
    options?: { exclude?: Iterable<string>; context?: ExecutionContext },
  ): Promise<Array<{ object: string; count: number }>> {
    const exclude = new Set(options?.exclude ?? []);
    const counts: Array<{ object: string; count: number }> = [];
    for (const child of this._registry.getAllObjects()) {
      const childName = (child as any)?.name as string | undefined;
      const fields = (child as any)?.fields as Record<string, any> | undefined;
      if (!childName || !fields || exclude.has(childName) || ObjectQL.outlivesOrganization(child)) continue;
      const tenantField = resolveTenantFieldName(child);
      if (!tenantField || !fields[tenantField]) continue;
      const fdef = fields[tenantField];
      if (this.cascadeRelationBehavior(ORGANIZATION_OBJECT, child, tenantField, fdef) === undefined) continue;
      let count: number;
      try {
        count = await this.count(childName, {
          where: this.referenceProbeFilter(tenantField, fdef, organizationId),
          context: ObjectQL.organizationCountContext(options?.context),
        });
      } catch (error) {
        if (isMissingTableError(error, childName)) continue;
        throw error;
      }
      if (count > 0) counts.push({ object: childName, count });
    }
    return counts;
  }

  async delete(object: string, options?: EngineDeleteOptions): Promise<boolean | number> {
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
    // [#23221] Is this the child delete a cascade issued? Decided here, once,
    // before any middleware or hook runs, so the claim is this call's alone.
    const referentialCascadeDelete = this.claimReferentialCascadeDelete(object, id);

    const opCtx: OperationContext = {
      object,
      operation: 'delete',
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
          ql: this
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

      hookContext.input.options = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });

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
              const runByIdDelete = async (writeContext?: ExecutionContext) => {
                await this.cascadeDeleteRelations(object, [hookContext.input.id as string | number], writeContext)
                  .catch((e: unknown) => { throw cascadeStoppedRefusal(e, object); });
                return await driver.delete(
                  object,
                  hookContext.input.id as string,
                  this.buildDriverOptions(object, writeContext, hookContext.input.options as any),
                );
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
                     ?? (((await driver.find(object, { ...opCtx.ast!, fields: summaryKeyColumns }, hookContext.input.options as Parameters<IDataDriver['find']>[2])) ?? []) as Record<string, unknown>[]);
                 }
                 // [#27581] The handles the matched rows hold, read BEFORE the
                 // statement removes them: the per-row hook read when it was
                 // made, otherwise only `id` and the secret columns, through
                 // this write's AST and options. No secret column, no read.
                 if (secretColumns.length > 0) {
                   deletedSecrets = deletedSecretSlots(deleteSchema, predicateMatchedRows
                     ?? (((await driver.find(object, { ...opCtx.ast!, fields: ['id', ...secretColumns] }, hookContext.input.options as Parameters<IDataDriver['find']>[2])) ?? []) as Record<string, unknown>[]));
                 }
                 result = await driver.deleteMany!(object, opCtx.ast!, hookContext.input.options as any);
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

  async count(object: string, query?: EngineCountOptions, options?: EngineReadOptions): Promise<number> {
    // [#25522 cut 18] The body moved to `engine-count-aggregate.ts` (see `CountAggregateHost`).
    const readRegistry = () => this._registry;
    const readRelatedSchemaOf = () => this.relatedSchemaOf;
    const host: ThisParameterType<typeof count> = {
      resolveObjectName: (...a) => this.resolveObjectName(...a),
      get _registry() { return readRegistry(); },
      get relatedSchemaOf() { return readRelatedSchemaOf(); },
      expandSearchOnOptions: (...a) => this.expandSearchOnOptions(...a),
      getDriver: (...a) => this.getDriver(...a),
      resolveWhereTokens: (...a) => this.resolveWhereTokens(...a),
      executeWithMiddleware: (...a) => this.executeWithMiddleware(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      composeReadableIdsAtBoundary: (...a) => this.composeReadableIdsAtBoundary(...a),
      find: (...a) => this.find(...a),
    };
    return count.call(host, object, query, options);
  }

  /**
   * The `internal: true` evaluate refusal for EVERY caller — the
   * `QueryEvaluationGate` member of the `objectql` slot contract. The body is
   * `internal-field-evaluation-guard.ts`, the one definition, which this
   * engine's own read path also applies to every non-system caller; a door
   * asks this method and never restates it.
   */
  assertNoInternalFieldEvaluated(
    object: string,
    query: InternalFieldEvaluationQuery,
    options?: InternalFieldEvaluationOptions,
  ): void {
    assertNoInternalFieldEvaluated(object, query, this.relatedSchemaOf, options);
  }

  /**
   * Fail-closed guard (ADR-0100 / #3171 / #7922): refuse to aggregate over a
   * field whose value is withheld on the generic read path. Such fields reach
   * this guard through **two independent collectors**, and it needs both:
   *
   *  - {@link collectCredentialFields} — keyed by field TYPE (`secret` /
   *    `password`). A GROUP BY / MIN / MAX / array_agg over such a column would
   *    surface the stored `secret:<id>` ref or the password value.
   *  - {@link collectInternalReadFields} — keyed by the `internal: true` FLAG
   *    (#7728). ADR-0100's third credential channel is a one-way hash living in
   *    an ordinary `text` column, which no type-keyed collector can ever reach;
   *    the flag is that channel's opt-in declaration. Without this half the
   *    guard had the same type-vs-flag blind spot #7728 fixed on the read path:
   *    a flagged column was omitted from `find`/`findOne` yet freely groupable
   *    here, so the flag's promise ("never returned on the generic data path")
   *    stopped at the edge of `aggregate()`.
   *
   * Post-hoc masking is not available on this path — the value is already a
   * group key by the time there is a row, and masking group keys corrupts the
   * result. So we reject instead.
   *
   * Neither collector carries a `managedBy` exemption, so the union does not
   * acquire one, deliberately. Read-masking exempts `password` on better-auth
   * objects so login reads still see the stored value; *aggregating* a
   * credential is never legitimate, least of all on an identity table, where it
   * is an inference oracle over hashes.
   *
   * Only the two output-bearing positions on `EngineAggregateOptions` carry
   * field names: `aggregations[].field` (skip COUNT(*) — undefined or '*') and
   * `groupBy[]` (a string, or a `{ field }` bucket object).
   *
   * The refusal carries the ADR-0112 envelope — `INVALID_FIELD` / 400, located
   * at the object and the field(s) named. It used to be a bare `Error` with no
   * `code` or `status`, so a 400-class author refusal reached the data door
   * 500-shaped (`INTERNAL_ERROR`, an undeclared fault). The code matches the
   * analytics door's own refusal of an `internal: true` member and the engine's
   * structured-JSON group-by refusal: the verdict is about the NAME being a
   * field that is never returned on a generic data exit, which `INVALID_FIELD`
   * is the catalog member for. The envelope now binds the `secret` / `password`
   * case too, which shared the bare `Error`.
   */
  private rejectCredentialAggregation(object: string, query: EngineAggregateOptions): void {
    // [#25522 cut 18] The body moved to `engine-count-aggregate.ts` (see `CountAggregateHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof rejectCredentialAggregation> = {
      get _registry() { return readRegistry(); },
    };
    return rejectCredentialAggregation.call(host, object, query);
  }

  aggregate(object: string, query: EngineAggregateOptions, options?: EngineReadOptions): Promise<any[]> {
    // [#29986 codemod] The body moved to `engine-delete-and-aggregate.ts` (see `DeleteAndAggregateHost`).
    const read_registry = () => this._registry;
    const readLogger = () => this.logger;
    const readRelatedSchemaOf = () => this.relatedSchemaOf;
    const host: ThisParameterType<typeof aggregate> = {
      get _registry() { return read_registry(); },
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      composeReadableIdsAtBoundary: (...a) => this.composeReadableIdsAtBoundary(...a),
      executeWithMiddleware: (...a) => this.executeWithMiddleware(...a),
      expandSearchOnOptions: (...a) => this.expandSearchOnOptions(...a),
      getDriver: (...a) => this.getDriver(...a),
      get logger() { return readLogger(); },
      rejectCredentialAggregation: (...a) => this.rejectCredentialAggregation(...a),
      get relatedSchemaOf() { return readRelatedSchemaOf(); },
      resolveObjectName: (...a) => this.resolveObjectName(...a),
      resolveWhereTokens: (...a) => this.resolveWhereTokens(...a),
    };
    return aggregate.call(host, object, query, options);
  }
  
  /**
   * Run raw driver-specific commands (SQL for SqlDriver, REST for RestDriver, …).
   *
   * ⚠️ **Tenant isolation bypass.** Raw `execute()` does NOT thread the
   * caller's `ExecutionContext.tenantId` into a `WHERE organization_id`
   * predicate — drivers see the command verbatim. Callers MUST inline the
   * tenant filter themselves, or restrict raw execution to genuinely global
   * statements (schema migrations, sys_* / control-plane tables).
   *
   * Prefer the typed entry points (`find`, `update`, `delete`, `count`, …)
   * whenever feasible — they auto-apply tenancy + soft-delete + audit warnings.
   */
  async execute(command: any, options?: Record<string, any>): Promise<any> {
      // [#25522 cut 7] The body moved to `engine-execute-transactions.ts` (see `ExecuteTransactionsHost`).
      const readDrivers = () => this.drivers;
      const readDefaultDriver = () => this.defaultDriver;
      const host: ThisParameterType<typeof execute> = {
        getDriver: (...a) => this.getDriver(...a),
        get drivers() { return readDrivers(); },
        get defaultDriver() { return readDefaultDriver(); },
      };
      return execute.call(host, command, options);
  }

  /**
   * Execute a callback inside a database transaction.
   *
   * The callback receives a context object that should be passed to all
   * downstream `engine.insert/update/delete/find/findOne` calls (as
   * `{ context: trxCtx }`). The transaction handle threads through
   * `OperationContext.context.transaction` and the SQL driver's per-builder
   * `.transacting(trx)` call.
   *
   * - If the default driver does not support transactions — no
   *   `beginTransaction` method, or `supports.transactionsUnsupported: true`
   *   from a transport that inherited one it cannot honour (#18063) — the
   *   callback
   *   runs directly with the supplied base context (no rollback). This keeps
   *   the API safe to call on drivers without ACID support (e.g. the
   *   in-memory driver in tests). It is DECLARED behaviour (ADR-0119 D1), not
   *   a bug to be discovered — but since v17 it is no longer *silent*: the
   *   degrade warns once per driver (#4619, {@link warnTransactionUnsupported}),
   *   and a caller who cannot live with it says so with `opts.require: true`,
   *   which THROWS {@link TransactionUnsupportedError} instead (#5696 point 1).
   * - On callback success the transaction is committed; on any thrown error
   *   it is rolled back and the original error is re-thrown.
   * - The transaction covers ONE driver's connection — the default one — as
   *   ADR-0119 D1 declared and this engine still provides (no two-phase
   *   commit). What a write routed elsewhere gets is decided by
   *   {@link enforceTransactionOrigin} (#5351 / #5696, 2026-08-06 ruling): a
   *   BUSINESS write is refused with
   *   {@link CrossDatasourceTransactionWriteError}; an append-only SYSTEM
   *   LEDGER (`lifecycle.class` audit / telemetry / event) is carved out and
   *   executed OUTSIDE the transaction, so it survives a rollback — the orphan
   *   row is the deliberate direction of error for a compliance ledger. Either
   *   way the other driver never receives this transaction's handle, which is
   *   what the pre-v17 engine did and what put statements on the wrong
   *   connection entirely.
   * - The callback's SECOND argument says whether this call owns the
   *   transaction (#5696 point 3): `owned: true` when this call opened it,
   *   `false` when it JOINED an outer one (ADR-0067 D2) — and `false` on the
   *   degrade path too, where there is no transaction to own. A callback whose
   *   own guarantees are phrased as "this all rolls back together" only holds
   *   that promise when it owns the transaction; before this signal it had no
   *   way to tell. One-argument callbacks are unaffected.
   *
   * Use case: multi-step operations that must be atomic (e.g. CRM
   * `convertLead`, which creates an account + contact + opportunity + flips
   * the lead in a single unit of work).
   */
  async transaction<T>(
    callback: (trxCtx: any, info: EngineTransactionInfo) => Promise<T>,
    baseContext?: any,
    opts?: EngineTransactionOptions,
  ): Promise<T> {
    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of
    // opening a nested driver transaction. A nested begin would acquire a
    // second connection (a deadlock on single-connection pools like the
    // SQLite knex pool) and would NOT be covered by the outer rollback —
    // exactly the half-landing this join prevents: an outer batch
    // transaction (e.g. `publishPackageDrafts`) must own the one-and-only
    // commit/rollback for every write made through nested helpers (the
    // sys-metadata repository's `withTxn`, hook-driven writes, …).
    const ambient = this.txStore.getStore();
    if (ambient?.transaction) {
      // JOINED, not owned: some outer caller decides commit vs rollback (#5696).
      return callback(
        { ...(baseContext ?? {}), transaction: ambient.transaction },
        { owned: false },
      );
    }
    const driver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    const drv = driver as any;
    // [#18063] The gate is the DECLARATION, not bare method presence. A
    // subclass inherits `beginTransaction` from a base whose transport has
    // transactions while its own has none — it cannot opt out of a door it did
    // not open, so presence alone routed it down the transactional path and the
    // handle it produced covered nothing. `driverSupportsTransactions` is the
    // one definition (`@objectstack/spec`), shared with the ScopedContext trio
    // below so the engine's transaction entrances cannot drift apart.
    if (!driverSupportsTransactions(drv)) {
      const datasource = this.defaultDriver ?? drv?.name;
      if (opts?.require === true) {
        // Fail CLOSED (#5696 point 1): the caller declared it cannot tolerate
        // running without a rollback, so refuse BEFORE the callback writes
        // anything rather than degrade behind a warning it may never read.
        // Generalizes `batchData`'s atomic gate (ADR-0119 D4).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // Declared degrade (ADR-0119 D1) — behaviour unchanged, but no longer
      // mute: the caller asked for atomicity and is not getting it (#4619).
      this.warnTransactionUnsupported(datasource, drv?.supports?.transactionsUnsupported === true);
      // `owned: false` — honest: there is no transaction here to own, and no
      // rollback the callback may promise on the strength of it.
      return callback(baseContext, { owned: false });
    }
    const trx = await drv.beginTransaction();
    const trxCtx = { ...(baseContext ?? {}), transaction: trx };
    try {
      // Run the callback inside the ambient transaction store so internal
      // queries during writes reuse this transaction's connection (ADR-0034),
      // CLOSED once the callback settles, before the commit (#22782, #22855).
      const result = await this.runOpenedUnit(trx, driver!, () => callback(trxCtx, { owned: true }));
      if (drv.commit) await drv.commit(trx);
      else if (drv.commitTransaction) await drv.commitTransaction(trx);
      return result;
    } catch (err) {
      let rollbackFailed = false;
      try {
        if (drv.rollback) await drv.rollback(trx);
        else if (drv.rollbackTransaction) await drv.rollbackTransaction(trx);
      } catch {
        // swallow rollback failures so the original error surfaces
        rollbackFailed = true;
      }
      // [#21274] A boundary outside the middleware seam: a commit failure, or
      // a callback that reached the driver through the transaction handle.
      // An error that already crossed an engine boundary inside the callback
      // comes back as the same reference. A stale-roll-up refusal ("stored")
      // is no longer true once this rollback has run: `rolledBackRefusal`.
      // [#29421] Nor is "rolled back" once the rollback threw:
      // `rollbackFailedRefusal`.
      throw redactPropagatedDriverFault(rollbackFailed ? rollbackFailedRefusal(err) : rolledBackRefusal(err));
    }
  }

  /**
   * [#22782, #22855] Run `body`, the callback of a unit just opened on `owner`
   * with handle `trx`. This is the ONE place both transaction surfaces
   * ({@link transaction} and `ScopedContext.transaction`) publish a unit and
   * close it again.
   *
   * Published: the entry goes into {@link txStore} (ADR-0034) for the body's
   * lifetime, carrying its owner (#4619). Internal queries during writes reuse
   * this connection, and a nested `transaction()` on either surface joins it.
   *
   * Closed once `body` settles, BEFORE the caller commits or rolls back. Work
   * the body started and did not await (an `async: true` hook) holds the
   * handle two ways: ambiently, through this entry, and explicitly, threaded
   * into the callback's context and from there into the hook's `ctx.api`. That
   * work used to run on the finished handle and lose its write ("Transaction
   * query already complete"). Emptying the entry ends the ambient way;
   * {@link openedUnits} ends the explicit one, because
   * {@link buildDriverOptions} treats a closed unit's handle as absent. The
   * work then runs unenrolled, on its own connection, as outside any unit:
   * `opensAfterAbortUnit` reads the handle the same way, so such a write opens
   * the door's own unit when its hooks call for one.
   *
   * A primitive handle cannot key {@link openedUnits}, so it keeps only the
   * ambient half.
   */
  private runOpenedUnit<T>(trx: unknown, owner: IDataDriver, body: () => Promise<T>): Promise<T> {
    const entry: { transaction: unknown; scope?: TransactionScope } =
      { transaction: trx, scope: this.newTransactionScope(owner) };
    if (trx !== null && (typeof trx === 'object' || typeof trx === 'function')) this.openedUnits.set(trx, entry);
    return this.txStore.run(entry, body).finally(() => { entry.transaction = undefined; entry.scope = undefined; });
  }

  /** [#22855] Is `handle` a unit {@link runOpenedUnit} published whose callback has since settled? */
  private isClosedUnitHandle(handle: unknown): boolean {
    if (handle === null || (typeof handle !== 'object' && typeof handle !== 'function')) return false;
    const entry = this.openedUnits.get(handle);
    return entry !== undefined && entry.transaction === undefined;
  }

  /**
   * Build the observability record for a transaction this engine just opened
   * (#4619). See {@link TransactionScope} — records only, routes nothing.
   */
  private newTransactionScope(owner: IDataDriver): TransactionScope {
    return {
      driver: owner,
      datasource: this.datasourceNameOf(owner),
      reportedOutOfScope: new Set<string>(),
    };
  }

  /**
   * Which datasource name is `driver` registered under?
   *
   * `registerDriver` keys {@link drivers} by `driver.name`, so the two normally
   * agree — but the map is the routing authority (`getDriver` resolves through
   * it), so the map is what is searched, and `driver.name` is only the fallback
   * for a driver that was never registered. Runs at most once per transaction
   * (and once per out-of-scope report), never on the hot path.
   */
  private datasourceNameOf(driver: IDataDriver): string {
    for (const [name, registered] of this.drivers) {
      if (registered === driver) return name;
    }
    return driver?.name ?? 'unknown';
  }

  /**
   * A caller asked for a transaction and the driver cannot give it one (#4619).
   *
   * The behaviour is unchanged and DECLARED (ADR-0119 D1: "when that driver has
   * no `beginTransaction` the callback runs with NO transaction and NO
   * rollback"). What was missing is that a caller had no way to find out —
   *
   * [#18063] TWO reasons now reach this degrade and the message says which.
   * The second is a transport that DECLARED it cannot honour a handle while
   * inheriting `beginTransaction` from a base class that can. Before the
   * declaration existed such a driver was indistinguishable from a working one
   * here, so the engine opened a transaction against it and the degrade — the
   * honest answer — was unreachable.
   *
   * the same shape as `batchData`'s `atomic` flag being a lie for as long as it
   * was (ADR-0119 D4). Tightening this into a throw would change the declared
   * contract and is deliberately NOT done here.
   *
   * `warn`, not `error`, on purpose. AGENTS.md's judgment question asks whether
   * the system looks normal *while something it claims is persisted has not
   * landed*; at this moment nothing has been lost — a capability simply is not
   * there, and every write in the callback still lands. This is the
   * `if (!capability)` composition branch the same section names as the
   * usual `warn`; escalating it would train readers to skim `error`, which is
   * exactly what made the #4420 `warn` unreadable.
   *
   * Once per engine instance per driver: the drivers that reach this path (test
   * doubles, foreign engines) reach it on EVERY call.
   */
  private warnTransactionUnsupported(datasource: string | undefined, declaredUnsupported = false): void {
    // [#25522 cut 7] The body moved to `engine-execute-transactions.ts` (see `ExecuteTransactionsHost`).
    const readTransactionUnsupportedReported = () => this.transactionUnsupportedReported;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof warnTransactionUnsupported> = {
      get transactionUnsupportedReported() { return readTransactionUnsupportedReported(); },
      get logger() { return readLogger(); },
    };
    return warnTransactionUnsupported.call(host, datasource, declaredUnsupported);
  }

  /**
   * A write inside an open `transaction()` resolved to a driver that
   * transaction does not cover — decide what happens to it (#5351, #5696).
   *
   * Called at the TOP of `insert`/`update`/`delete`, before hooks, validation
   * or defaults run: a refusal here has cost the caller nothing.
   *
   * This seam replaced `reportWriteOutsideTransaction` (#4619 / PR #5724),
   * which reported the split at `error` and let the write proceed with the
   * owner's handle. Reporting was the right first move — it made the defect
   * audible without pre-empting a decision that changes ADR-0119 D1's declared
   * contract for every multi-datasource deployment. The 2026-08-06 maintainer
   * ruling made that decision, and it is TWO answers, not one, because the two
   * kinds of write fail in opposite directions:
   *
   * - **Business writes are REFUSED** ({@link CrossDatasourceTransactionWriteError},
   *   #5696 point 2). The caller opened a transaction and asked for one unit of
   *   work; there is no way to give them one across two drivers (no two-phase
   *   commit on `IDataDriver`, deliberately out of scope). Silently committing
   *   part of it — which is what the pre-v17 engine did, on the wrong
   *   connection at that — is the outcome a caller can neither detect nor undo.
   *   Refusing hands them the choice: one datasource per transaction, or
   *   per-datasource units they reconcile themselves.
   * - **Append-only system ledgers are CARVED OUT** (#5351): audit / telemetry
   *   / event rows execute OUTSIDE the transaction, on their own connection,
   *   with no foreign handle. They therefore survive a rollback of the business
   *   transaction — an "orphan row" describing a write that was undone. For an
   *   append-only compliance ledger that is the correct direction of error:
   *   a spurious row is reconcilable, a MISSING row for a write that did
   *   commit is an unrecoverable compliance hole, and the missing row is what
   *   shipped before this change. It is also what lets a plugin author write an
   *   ordinary `afterInsert` audit hook with no knowledge that datasource
   *   routing exists — refusing here would be swallowed by that hook's
   *   try/catch and lose the row exactly as before.
   *
   * No `error` log survives on either path. The refusal IS the report, louder
   * than any line; and the carve-out is now DECLARED behaviour that fires on
   * every audited write of every transaction in a lifecycle-split deployment —
   * logging it at `error`, or even `warn`, would train readers to skim the
   * levels that carry real durability failures, which AGENTS.md names as the
   * mirror-image mistake. It is recorded at `debug`, once per transaction per
   * datasource, for the operator who is asking why an audit row outlived a
   * rolled-back write; the durable answer lives in ADR-0067/ADR-0119.
   */
  private enforceTransactionOrigin(
    objectName: string,
    driver: IDataDriver,
    operation: 'insert' | 'update' | 'delete',
  ): void {
    // [#25522 cut 7] The body moved to `engine-execute-transactions.ts` (see `ExecuteTransactionsHost`).
    const readTxStore = () => this.txStore;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof enforceTransactionOrigin> = {
      get txStore() { return readTxStore(); },
      datasourceNameOf: (...a) => this.datasourceNameOf(...a),
      isSystemLedgerObject: (...a) => this.isSystemLedgerObject(...a),
      get logger() { return readLogger(); },
    };
    return enforceTransactionOrigin.call(host, objectName, driver, operation);
  }

  // ============================================
  // Compatibility / Convenience API
  // ============================================
  // These methods provide a higher-level API matching the @objectql/core
  // ObjectQL interface, enabling painless migration from the legacy layer.

  /**
   * Register a single object definition.
   * 
   * Proxies to SchemaRegistry.registerObject() with sensible defaults.
   * Fields without a `name` property are auto-assigned from their key.
   */
  registerObject(
    schema: ServiceObject,
    packageId: string = '__runtime__',
    namespace?: string
  ): string {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof registerObject> = {
      get _registry() { return readRegistry(); },
    };
    return registerObject.call(host, schema, packageId, namespace);
  }

  /**
   * Unregister a single object by name.
   */
  unregisterObject(name: string, packageId?: string): void {
    if (packageId) {
      this._registry.unregisterObjectsByPackage(packageId);
    } else {
      // Remove from generic metadata as fallback
      this._registry.unregisterItem('object', name);
    }
  }

  /**
   * Get an object definition by name.
   * Alias for getSchema() — matches @objectql/core API.
   */
  getObject(name: string): ServiceObject | undefined {
    return this.getSchema(name);
  }

  /**
   * Get all registered object configs as a name→config map.
   * Matches @objectql/core getConfigs() API.
   */
  getConfigs(): Record<string, ServiceObject> {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof getConfigs> = {
      get _registry() { return readRegistry(); },
    };
    return getConfigs.call(host);
  }

  /**
   * Get a registered driver by datasource name.
   * 
   * Unlike the private getDriver() (which resolves by object name),
   * this method directly looks up a driver by its registered name.
   */
  getDriverByName(name: string): IDataDriver | undefined {
    return this.drivers.get(name);
  }

  /**
   * Introspect a datasource's live remote schema (ADR-0015).
   *
   * Resolves the driver registered under `datasource` and delegates to its
   * `introspectSchema()` capability. Used by the external-datasource service
   * (and CLI/REST) to list remote tables and validate federated objects.
   *
   * @throws if the datasource has no registered driver, or the driver does
   *   not support introspection.
   *
   * [#11493] The return is the spec's ONE introspection shape — the
   * `IDataEngine.introspectDatasource?` contract member this method
   * implements — not the untyped `Promise<unknown>` it declared while
   * `IDataDriver` was silent about `introspectSchema`. The `as any` on the
   * driver lookup went in the same stroke: the member is on the driver
   * contract now, so the duck-typed probe below is a typed read. Runtime is
   * deliberately byte-identical — both throws and the delegation are
   * unchanged.
   */
  async introspectDatasource(datasource: string): Promise<SpecIntrospectedSchema> {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readDrivers = () => this.drivers;
    const host: ThisParameterType<typeof introspectDatasource> = {
      get drivers() { return readDrivers(); },
    };
    return introspectDatasource.call(host, datasource);
  }

  /**
   * Get the driver responsible for the given object.
   *
   * Resolves datasource binding from the object's schema definition,
   * falling back to the default driver. This is a public version of
   * the internal getDriver() used by CRUD operations.
   *
   * @param objectName - FQN or short name of the registered object.
   * @returns The resolved IDataDriver, or undefined if no driver is available.
   */
  getDriverForObject(objectName: string): IDataDriver | undefined {
    try {
      return this.getDriver(objectName);
    } catch {
      return undefined;
    }
  }

  /**
   * Sync all registered object schemas to their respective drivers.
   * Call this after dynamically registering new objects at runtime
   * (e.g. after template seeding) to ensure tables/collections exist
   * before inserting seed data.
   *
   * A federated object (ADR-0015 `external`) is not a DDL target. It is bound
   * to its remote table without DDL, the way the boot sync
   * (`ObjectQLPlugin.syncRegisteredSchemas`) binds it.
   */
  async syncSchemas(): Promise<void> {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof syncSchemas> = {
      getDriverForObject: (...a) => this.getDriverForObject(...a),
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
    };
    return syncSchemas.call(host);
  }

  /**
   * Sync a SINGLE object's physical storage (create/alter its table) on
   * demand. Boot-time {@link syncSchemas} runs once at startup, so an object
   * that becomes live at runtime (e.g. publishing a drafted object) has a
   * registry entry but no table — data CRUD then fails with "no such table"
   * until the next restart. Calling this right after the object is registered
   * makes it immediately usable. Idempotent: the SQL driver only creates the
   * table when absent (and alters to add new columns).
   */
  async syncObjectSchema(objectName: string): Promise<void> {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof syncObjectSchema> = {
      getDriverForObject: (...a) => this.getDriverForObject(...a),
      get _registry() { return readRegistry(); },
    };
    return syncObjectSchema.call(host, objectName);
  }

  /**
   * Drop the physical storage (table/collection) backing an object — the
   * inverse of {@link syncObjectSchema}. DESTRUCTIVE: deletes all rows in the
   * table. Used by the protocol delete path when the caller explicitly opts
   * into storage teardown (e.g. discarding an object that was published only
   * to preview it). No-op when the object's driver does not expose `dropTable`.
   * Resolves the physical table name from the registered definition, falling
   * back to the bare name if the def was already removed.
   */
  async dropObjectSchema(objectName: string): Promise<void> {
    const obj = this._registry.getObject(objectName) as any;
    const driver = this.getDriverForObject(objectName);
    if (!driver || typeof (driver as any).dropTable !== 'function') return;
    const tableName = StorageNameMapping.resolveTableName(obj ?? ({ name: objectName } as any));
    await (driver as any).dropTable(tableName);
  }

  /**
   * Get a registered driver by datasource name.
   * Alias matching @objectql/core datasource() API.
   *
   * @throws Error if the datasource is not found
   */
  datasource(name: string): IDataDriver {
    const driver = this.drivers.get(name);
    if (!driver) {
      throw new Error(`[ObjectQL] Datasource '${name}' not found`);
    }
    return driver;
  }

  /**
   * Register a hook handler.
   * Convenience alias for registerHook() matching @objectql/core on() API.
   * 
   * Usage:
   *   ql.on('beforeInsert', 'user', async (ctx) => { ... });
   */
  on(
    event: string,
    objectName: string,
    handler: (ctx: HookContext) => Promise<void> | void,
    packageId?: string
  ): void {
    this.registerHook(event, handler, { object: objectName, packageId });
  }

  /**
   * Remove all hooks, actions, and objects contributed by a package.
   */
  removePackage(packageId: string): void {
    // [#25522 cut 8] The body moved to `engine-compatibility-api.ts` (see `CompatibilityApiHost`).
    const readHooks = () => this.hooks;
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof removePackage> = {
      removeActionsByPackage: (...a) => this.removeActionsByPackage(...a),
      get hooks() { return readHooks(); },
      get _registry() { return readRegistry(); },
    };
    return removePackage.call(host, packageId);
  }

  /**
   * Gracefully shut down the engine, disconnecting all drivers.
   * Alias for destroy() — matches @objectql/core close() API.
   */
  async close(): Promise<void> {
    return this.destroy();
  }

  /**
   * Create a scoped execution context bound to this engine.
   * 
   * Usage:
   *   const ctx = engine.createContext({ userId: '...', tenantId: '...' });
   *   const users = ctx.object('user');
   *   await users.find({ where: { status: 'active' } });
   */
  createContext(ctx: Partial<ExecutionContext>): ScopedContext {
    // [#25653] The parse keeps declared keys only, so the app-automation
    // elevation mark an action body's envelope carries is carried across it:
    // dropped here, the body's `ctx.api` writes would reach the
    // identity-assignment refusal unmarked.
    return new ScopedContext(
      carryAppAutomationElevation(ctx, ExecutionContextSchema.parse(ctx)),
      this
    );
  }

  /**
   * Static factory: create a fully configured ObjectQL instance.
   * 
   * Matches @objectql/core's `new ObjectQL(config)` pattern but also
   * registers drivers and objects, then calls init().
   * 
   * Usage:
   *   const ql = await ObjectQL.create({
   *     datasources: { default: myDriver },
   *     objects: { user: { name: 'user', fields: { ... } } }
   *   });
   */
  static async create(config: {
    datasources?: Record<string, IDataDriver>;
    objects?: Record<string, ServiceObject>;
    hooks?: Array<{ event: string; object: string; handler: (ctx: HookContext) => Promise<void> | void }>;
  }): Promise<ObjectQL> {
    const ql = new ObjectQL();

    // Register drivers
    if (config.datasources) {
      for (const [name, driver] of Object.entries(config.datasources)) {
        // Set driver name if not already set
        if (!driver.name) {
          (driver as any).name = name;
        }
        ql.registerDriver(driver, name === 'default');
      }
    }

    // Register objects
    if (config.objects) {
      for (const [_key, schema] of Object.entries(config.objects)) {
        ql.registerObject(schema);
      }
    }

    // Register hooks
    if (config.hooks) {
      for (const hook of config.hooks) {
        ql.on(hook.event, hook.object, hook.handler);
      }
    }

    // Initialize (connect drivers)
    await ql.init();

    return ql;
  }
}

/**
 * Repository scoped to a single object, bound to an execution context.
 *
 * Provides both IDataEngine-style methods (find, insert, update, delete)
 * and convenience aliases (create, updateById, deleteById) matching
 * the @objectql/core ObjectRepository API.
 */
/**
 * A repository bound to one object and one execution context — what
 * `ScopedContext.object(name)` returns, and what a hook reaches as
 * `ctx.api.object(name)`.
 *
 * `implements IScopedObjectRepository` (#5945): the six members that contract
 * declares are the ones the documentation corpus is measured to CALL, and the
 * `implements` clause is what keeps the two from drifting — before it, the
 * only descriptions of this face were the private slices each consumer
 * hand-rolled (`type CrossObjectApi = …`), which nothing checked. The class
 * stays WIDER than the contract on purpose (`create`, `delete`, `deleteById`,
 * `aggregate`, `execute`); `implements` allows that, and those members join the
 * contract when a call site turns up to justify them.
 */
export class ObjectRepository implements IScopedObjectRepository {
  constructor(
    private objectName: string,
    private context: ExecutionContext,
    private engine: IDataEngine & { executeAction?: (o: string, a: string, c: any) => Promise<any> }
  ) {}

  async find(query: any = {}): Promise<any[]> {
    return this.engine.find(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /**
   * [commit 5c8f5af50] Declared `Promise<Record<string, any> | null>`, not `Promise<any>`.
   *
   * `IScopedObjectRepository.findOne` has declared that shape since #16231's
   * ruling A landed (commit 854639b31), and `IDataEngine.findOne` — the call this
   * method forwards to, one line down — declares it too. This method sat
   * between two narrow declarations and re-widened the value back to `any` on
   * the way out, so `implements IScopedObjectRepository` stayed satisfied (a
   * wider return always satisfies a narrower one) while every call site that
   * reaches a repository through the CLASS rather than the interface kept
   * reading `any` — `ObjectQL.createContext(…).object(n).findOne(…)` among
   * them, which is exported.
   *
   * ⛔ Not a narrowing of the contract: the contract already said this. This
   * is the implementation coming back to the declaration it published.
   */
  async findOne(query: any = {}): Promise<Record<string, any> | null> {
    return this.engine.findOne(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  async insert(data: any): Promise<any> {
    return this.engine.insert(this.objectName, data, {
      context: this.context,
    });
  }

  /** Alias for insert() — matches @objectql/core convention */
  async create(data: any): Promise<any> {
    return this.insert(data);
  }

  /**
   * [commit 5c8f5af50] Declared `Promise<Record<string, any> | number | null>`, the same
   * re-widening as {@link findOne} and repaired the same way: the record for
   * the single-record form, the affected-row count for the predicate form
   * (`{ where, multi: true }`), `null` when the write matched nothing.
   *
   * ⛔ `updateById` is deliberately NOT touched here. Its `Promise<any>` is
   * what `IScopedObjectRepository.updateById` itself declares, so the class
   * matches its contract and there is no drift to repair on this side; that
   * member is `packages/spec`'s to narrow (its spec half: commit 6059b29c0).
   */
  async update(data: any, options: any = {}): Promise<Record<string, any> | number | null> {
    return this.engine.update(this.objectName, data, {
      ...options,
      context: this.context,
    });
  }

  /** Update a single record by ID */
  async updateById(id: string | number, data: any): Promise<any> {
    return this.engine.update(this.objectName, { ...data, id: id }, {
      where: { id: id },
      context: this.context,
    });
  }

  async delete(options: any = {}): Promise<any> {
    return this.engine.delete(this.objectName, {
      ...options,
      context: this.context,
    });
  }

  /** Delete a single record by ID */
  async deleteById(id: string | number): Promise<any> {
    return this.engine.delete(this.objectName, {
      where: { id: id },
      context: this.context,
    });
  }

  async count(query: any = {}): Promise<number> {
    return this.engine.count(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /** Aggregate query */
  async aggregate(query: any = {}): Promise<any[]> {
    return this.engine.aggregate(this.objectName, {
      ...query,
      context: this.context,
    });
  }

  /**
   * Execute a named action registered on this object.
   *
   * [#13866, Director ruling 决裁批 #24 2026-09-01] Elevated to the SAME
   * trusted posture REST `/actions` (`domains/actions.ts`) and MCP
   * `run_action` (`action-execution.ts`) already give an action body (#13832,
   * #2849). This is the third `executeAction` caller those two files' own
   * comments name `ScopedRepo.execute()` — until now it handed the body
   * neither `api` nor `executionContext`, the context-less facade #3914
   * argues an action body must never get. A caller reaching another action
   * via `ctx.api.object(x).execute(y)` (an in-process handler composing a
   * sibling handler, `action-execution.ts`'s own description of this path)
   * now dispatches under the same identity its own body runs under.
   *
   * `{ ...this.context, isSystem: true }` is the `sudo()`-shaped elevation
   * `buildActionExecutionContext` and `recomputeSummaries`'s `systemCtx` both
   * use, not a bare `{ isSystem: true }`: spreading the caller's envelope
   * FIRST keeps the resulting write attributable and correctly scoped —
   * `userId` stamps `created_by`/`updated_by`, `tenantId` stamps the org
   * column and drives driver-level tenant isolation, an open `transaction`
   * joins rather than escapes — instead of the unattributable, org-less rows
   * a bare `{ isSystem: true }` would produce.
   *
   * The census behind this change (repo + `examples/` + `apps/`, production
   * and test) found ZERO existing callers of this method anywhere — every
   * `ObjectRepository.execute()` / `ScopedRepo.execute()` hit in the tree was
   * prose describing the shape, never an invocation — so this widens what a
   * FUTURE caller's write is accepted to do, without changing any write
   * anyone ships today.
   *
   * [Disclosure completeness] What widens is larger than the static
   * `readonly` strip named above. `isSystem: true` on `this.context` is read
   * by ObjectQL's registered security middleware as a TOTAL, unconditional
   * bypass — `plugin-security/src/security-plugin.ts:1614-1616`, "System
   * operations bypass security" / `return next()` ahead of every other gate
   * in that middleware — so every `find`/`insert`/`update`/`delete` this
   * `ctx.api` drives also skips RLS read scoping (`:4344`) and field-level
   * security (`:4495`); the CRUD/export permission checks in the same
   * middleware (`:1616`, `canExport` at `:4573`); the ADR-0103 engine-owned/
   * append-only write guard (`system-write-guard.ts:96,120`, called at
   * `security-plugin.ts:1736`); the package-managed / system-row /
   * curated-capability-name write gates (and, until C3 stage 8, the
   * audience-anchor gate)
   * (`security-plugin.ts:1690-1724`); the referential-integrity check
   * (`:5892` in this file) and the tenant-audit mute (`:3773`) — in addition
   * to the static `readonly`/runtime-owned strip on BOTH update paths
   * (`:11290`, `:11473`) and the insert path (`:10025`), not the single site
   * an earlier draft of this note implied. Exactly what REST `/actions` and
   * MCP `run_action` already give an action body — see
   * `content/docs/permissions/system-context.mdx` ("Elevation is total, and
   * it is not granular") for the full catalog this bypass belongs to.
   *
   * Bounded on two sides: metadata-plane schema masking
   * (`metadata-core/object-schema-fls.ts:228`) is a separate REST/GraphQL
   * dispatch path this `ctx.api` surface never calls into; and
   * `plugin-sharing/rule-hooks.ts`'s insert/update materialisation skip was
   * already retired by the maintainer's 2026-08-31 ruling on #13533 (system
   * and user writes materialise sharing grants identically today).
   */
  async execute(actionName: string, params?: any): Promise<any> {
    if (this.engine.executeAction) {
      // [#25653] With the `'action'` mark, as `buildActionExecutionContext`
      // (runtime) gives the REST and MCP doors' action bodies: the action this
      // reaches is app-authored automation running elevated, so its writes to
      // the four identity-assignment objects are refused (plugin-security).
      const executionContext: ExecutionContext = markAppAutomationElevation(
        { ...this.context, isSystem: true },
        'action',
      );
      return this.engine.executeAction(this.objectName, actionName, {
        ...params,
        userId: this.context.userId,
        tenantId: this.context.tenantId,
        roles: this.context.positions,
        executionContext,
        api: new ScopedContext(executionContext, this.engine),
      });
    }
    throw new Error(`Actions not supported by engine`);
  }
}

/**
 * Scoped execution context with object() accessor.
 *
 * Provides identity (userId, tenantId/spaceId, roles),
 * repository access via object(), privilege escalation via sudo(),
 * and transactional execution via transaction().
 *
 * `implements IScopedContext` (#5945) — this class IS `HookContext.api`, built
 * per dispatch by {@link ObjectQL.buildHookApi}. The contract declares the two
 * members hooks reach (`object`, `transaction`); `sudo()`, the discrete
 * begin/commit/rollback trio and the identity getters stay off it, so this
 * class is deliberately wider than what it implements.
 */
export class ScopedContext implements IScopedContext, RunAsDerivableApi {
  constructor(
    private executionContext: ExecutionContext,
    private engine: IDataEngine
  ) {}

  /**
   * [#25653] Set on the api an app-authored hook is handed
   * ({@link APP_AUTHORED_HOOK_API}) and kept by every api derived from it
   * ({@link derive}); read by {@link sudo}.
   */
  private appAuthored = false;

  /** A child over `executionContext` that keeps this api's provenance. */
  private derive(executionContext: ExecutionContext): ScopedContext {
    const child = new ScopedContext(executionContext, this.engine);
    child.appAuthored = this.appAuthored;
    return child;
  }

  /** Get a repository scoped to this context */
  object(name: string): ObjectRepository {
    return new ObjectRepository(name, this.executionContext, this.engine as any);
  }

  /**
   * Create an elevated (system) context.
   *
   * [#25653] Platform code's `sudo()` carries no app-automation mark, so its
   * writes to the four identity-assignment objects land. An app-authored
   * hook's in-process `ctx.api.sudo()` is the hook's elevation: it carries
   * the `'hook'` mark (unless the context already carries one).
   */
  sudo(): ScopedContext {
    const elevated = { ...this.executionContext, isSystem: true };
    return this.derive(
      this.appAuthored && !appAutomationElevationOf(elevated)
        ? markAppAutomationElevation(elevated, 'hook')
        : elevated,
    );
  }

  /**
   * [#25653] The api an app-authored hook runs with — see
   * {@link APP_AUTHORED_HOOK_API} (`hook-run-as.ts`), where the line between
   * app-authored and platform hooks is drawn. Derived by `wrapDeclarativeHook`
   * for a hook the binder bound, before its `runAs` is applied.
   *
   * An inherited system context with no `flowRunId` and no mark gets the
   * `'hook'` mark: the hook runs with that elevation, so its writes to the four
   * identity-assignment objects are refused as a `runAs: 'system'` hook's are.
   * A run's context (`flowRunId`) is already judged as the run's; a marked one
   * keeps its mark; a user's context is not elevated and needs none.
   */
  [APP_AUTHORED_HOOK_API](): ScopedContext {
    const ctx = this.executionContext;
    const inheritsElevation = ctx.isSystem && !ctx.flowRunId && !appAutomationElevationOf(ctx);
    const api = new ScopedContext(inheritsElevation ? markAppAutomationElevation(ctx, 'hook') : ctx, this.engine);
    api.appAuthored = true;
    return api;
  }

  /**
   * [#14010] The api a hook that declared `runAs` is handed — derived from the
   * engine-built one (`buildHookApi(opCtx.context)`) at dispatch, by
   * `wrapDeclarativeHook`, for the duration of the handler call. `'inherit'`
   * never reaches here (the wrapper hands the original through by reference).
   *
   *  - `'system'` → {@link sudo}-shaped: `{ ...triggering context, isSystem: true }`.
   *    The same envelope the in-process `ctx.api.sudo()` idiom produced, so a
   *    hook that used to elevate by hand elevates identically by declaration
   *    — and now on the sandboxed surface too. `userId` / `tenantId` /
   *    `transaction` ride along: elevation is authorization, not anonymity
   *    (#5494), and the hook's writes stay inside the triggering transaction.
   *    [#25653] It also carries the app-automation elevation mark
   *    (`'hook'`, `@objectstack/core`), so the identity-assignment refusal
   *    (plugin-security) judges the hook's writes to the four identity
   *    objects as it judges a system flow's. Derived here, ⛔ never in
   *    {@link sudo}: platform code elevates through `sudo()` and keeps writing
   *    those objects.
   *  - `'user'` → `{ ...triggering context, isSystem: false }` when the
   *    trigger resolved a user — the pin de-elevates a hook fired by a
   *    `runAs:'system'` flow node or an `isSystem` service write that still
   *    named its operator. With NO `userId` there is nothing to scope to, so
   *    the api is an {@link UnscopedHookApi}: every data door refuses
   *    (`HOOK_UNSCOPED_DATA_ACCESS`, the #3760 posture — never a silent
   *    fall-open, never a silent re-badge as system).
   */
  withRunAs(runAs: Exclude<HookRunAs, 'inherit'>, ref: HookRunAsRef): IScopedContext {
    if (runAs === 'system') {
      return this.derive(
        markAppAutomationElevation({ ...this.executionContext, isSystem: true }, 'hook'),
      );
    }
    if (!this.executionContext.userId) return new UnscopedHookApi(ref);
    return this.derive({ ...this.executionContext, isSystem: false });
  }

  /**
   * [#24497] The second half of a hook's `runAs: 'user'` derivation: the
   * user's grants, peer list and email (#24639), seeded through the one
   * resolver the request path seeds them through (`resolveUserAuthzGrants`,
   * `@objectstack/core`).
   * The hook wrapper awaits it on the api {@link withRunAs} derived; it stays
   * a separate, async step so `withRunAs` keeps its synchronous contract.
   *
   * A hook fired from a hand-built `{ isSystem: true, userId }` context (the
   * approvals writes) was pinned with no `org_user_ids`, so every row policy
   * reading `current_user.org_user_ids` compiled `unresolved-variable` and
   * dropped out: the hook saw its own `sys_user` row only, while the same
   * user's request saw their organisation's members too. Ruling A′ puts the
   * contract on the producer: every user context carries `org_user_ids`.
   *
   * [#24639] The same contract holds for `email`: the RLS compiler binds
   * `current_user.email` from the context's `email` and nothing else, so a
   * hand-built context that named a user and carried no email made every
   * email-keyed row policy (`assignee == current_user.email`) drop out, and
   * the hook read nothing where the user's own request reads their rows. The
   * email is the one the same resolution returns (the user's stored
   * `sys_user.email`, from the user-row read that resolution already makes,
   * as the request path falls back to it), so a context that resolves for its
   * grants or peers pays nothing more for it. A context that lacks only the
   * email pays the one resolution; a user with no stored email (a phone-only
   * sign-up) pays it on every such dispatch and still carries none, which
   * fails closed exactly as before.
   *
   * The same rule as a `runAs: 'user'` flow's run setup (service-automation
   * `resolveRunContext`):
   *  - positions and permission sets the context already carries stay
   *    verbatim, so a narrowed ceiling is never re-broadened; only a context
   *    with no `permissions` takes the resolved ones;
   *  - a context that already carries a peer list keeps it;
   *  - a context that already carries an email keeps it verbatim (the
   *    session's, on a request-resolved context); only a context with none
   *    takes the resolved one;
   *  - a context that needs none of the three resolves nothing and is
   *    returned as is. One that lacks only the email is NOT that context: it
   *    resolves, and takes the email alone.
   *
   * The peer list is the members of the context's `tenantId`, the user
   * included; a context with no `tenantId` gets the user alone, as an
   * organisation-less request does. A resolver failure (an unreadable
   * permission store) is thrown to the caller, which keeps the unseeded api.
   *
   * Called on the api {@link withRunAs}`('user')` derived, which is never
   * elevated, so it does not re-judge the elevation flag.
   *
   * Keyed on {@link SEED_USER_GRANTS}, a symbol the package entry does not
   * export, so it is no nameable member of this class's published face (see
   * the symbol's docblock in `hook-run-as.ts`).
   */
  async [SEED_USER_GRANTS](): Promise<ScopedContext> {
    const ctx = this.executionContext;
    if (!ctx.userId) return this;
    const needsGrants = !Array.isArray(ctx.permissions);
    const needsPeers = !Array.isArray(ctx.org_user_ids);
    const needsEmail = !ctx.email;
    if (!needsGrants && !needsPeers && !needsEmail) return this;
    const grants = await resolveUserAuthzGrants(
      this.engine,
      ctx.userId,
      ctx.tenantId ? { tenantId: ctx.tenantId } : {},
    );
    return this.derive({
      ...ctx,
      ...(needsGrants ? { positions: grants.positions, permissions: grants.permissions } : {}),
      ...(needsPeers ? { org_user_ids: grants.org_user_ids } : {}),
      ...(needsEmail && grants.email ? { email: grants.email } : {}),
    });
  }

  /**
   * Execute a callback within a database transaction.
   *
   * The callback receives a new ScopedContext whose operations
   * share the same transaction handle. If the callback throws,
   * the transaction is rolled back; otherwise it is committed.
   *
   * Falls back to non-transactional execution if the driver
   * does not support transactions.
   *
   * Carries BOTH of `ObjectQL.transaction`'s declared caveats (ADR-0119 D1) —
   * default-datasource-only, and a silent degrade when that driver has no
   * `beginTransaction` — because it is a second implementation of the same
   * thing, reached from `ctx.api.transaction(fn)` in hook and action bodies.
   * Behaviour is unchanged, and so is the split: since #4619 both caveats
   * report through the SAME engine-side helpers the engine's own
   * `transaction()` uses, so this surface is no quieter than the direct one and
   * "say it once" holds across both.
   *
   * `opts.require` and the callback's `owned` argument (#5696) are honoured
   * here for the same reason: a second implementation of one primitive must not
   * become a second DIALECT of it. A hook body that fails closed through
   * `ctx.api.transaction` gets the same refusal the engine's own surface gives.
   *
   * And so, since #6168, is the **ADR-0067 D2 join** — the first thing this
   * method does, exactly as on the engine surface. It was the one point where
   * the second implementation still diverged, and it diverged in the direction
   * that costs the most: a hook triggered from inside an `engine.transaction()`
   * that called `ctx.api.transaction(fn)` opened a SECOND driver transaction,
   * which (a) takes a second connection — the deadlock D2 exists to avoid on a
   * single-connection pool like SQLite's — and (b) committed itself, so its
   * writes SURVIVED the outer rollback. D2's whole point is that the outermost
   * caller owns the one-and-only commit/rollback for every write made through
   * nested helpers. The `owned` signal was already honest about this
   * (`true` every time, because this surface really did always open); what was
   * wrong is the behaviour it was honestly describing.
   *
   * DECLARED LIMIT, so the next reader does not mistake it for the same
   * oversight: the join reads the engine's ambient `txStore` only. The discrete
   * `beginTransaction`/`commit`/`rollback` trio below deliberately does not
   * populate that store (its handle is threaded explicitly across
   * `setImmediate` boundaries where AsyncLocalStorage does not survive), so a
   * trio-held handle is invisible here and is NOT joined — which is what keeps
   * this branch from mistaking an explicitly-threaded handle for an ambient
   * one. The QuickJS sandbox drives `ctx.api.transaction(fn)` through that trio
   * rather than through this method, so a VM-side body is outside THIS join —
   * it gets its own, on the trio's `beginTransaction` since #6406, with the
   * same semantics: same handle, `owned: false`, and commit/rollback abstaining
   * in favour of the outer owner. Unattributable handles are the same surface
   * #6167 tracks, and closing that needs handle ownership to become
   * discoverable on `IDataDriver`.
   */
  async transaction(
    callback: (trxCtx: ScopedContext, info: EngineTransactionInfo) => Promise<any>,
    opts?: EngineTransactionOptions,
  ): Promise<any> {
    const engine = this.engine as any;
    // The engine's ambient transaction store (ADR-0034), reached the `as any`
    // way this whole class reaches engine internals, for the D2 join below. A
    // transaction this call opens is published by the engine's own helper.
    const txStore = engine?.txStore as
      | { getStore(): { transaction: unknown } | undefined }
      | undefined;

    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of opening
    // a nested driver one (#6168). Same first move, same reasons and the same
    // shape as `ObjectQL.transaction`: a nested begin would take a second
    // connection AND would not be covered by the outer rollback, so the outer
    // caller would stop owning the one-and-only commit/rollback.
    //
    // BEFORE the driver/`require` handling on purpose, mirroring the engine:
    // when there is an ambient transaction there IS a transaction, so
    // `require: true` is satisfied by joining it and the degrade is not
    // reachable.
    const ambient = txStore?.getStore();
    if (ambient?.transaction) {
      // The handle is threaded EXPLICITLY into the child context, not left to
      // the ambient store, for the same reason the engine surface threads it:
      // `buildDriverOptions` prefers the explicit handle, and it survives async
      // boundaries the store does not. It is identity-equal to the store's
      // handle, so `transactionCoversDriverFor` still attributes it to the
      // OUTER owner and the #5351 same-origin gate judges it unchanged.
      const joinedCtx = this.derive({ ...this.executionContext, transaction: ambient.transaction });
      // JOINED, not owned: the outer caller decides commit vs rollback (#5696).
      return callback(joinedCtx, { owned: false });
    }

    // Find the default driver for transaction support
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;

    // [#18063] Declaration, not bare method presence — see the engine surface's
    // gate; one predicate serves both so they cannot answer differently.
    if (!driverSupportsTransactions(driver)) {
      const datasource = engine.defaultDriver ?? driver?.name;
      if (opts?.require === true) {
        // Same fail-closed refusal as the engine surface (#5696 point 1).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // No transaction support — execute directly. Declared (ADR-0119 D1), but
      // said out loud since #4619: the caller asked for atomicity and the
      // callback is about to run without any.
      engine.warnTransactionUnsupported?.(datasource, driver?.supports?.transactionsUnsupported === true);
      return callback(this, { owned: false });
    }

    const trx = await driver.beginTransaction();
    const trxCtx = this.derive({ ...this.executionContext, transaction: trx });
    // Publish this transaction into the engine's ambient store so internal
    // queries during writes reuse its connection (ADR-0034) — and so a nested
    // `transaction()` on either surface can JOIN it. The store entry also
    // carries WHICH driver owns the transaction (#4619) so the write path can
    // report a write routed off it. [#22855] Through the engine's ONE unit
    // helper, `runOpenedUnit`, the one `ObjectQL.transaction` runs its callback
    // in, reached the same `as any` way as `txStore` itself. It closes the unit
    // when the callback settles, so work the callback started and did not await
    // (an `async: true` hook) no longer keeps the finished handle, neither the
    // ambient one nor the `trxCtx` one threaded above.
    const runIn = <R>(fn: () => Promise<R>): Promise<R> =>
      typeof engine.runOpenedUnit === 'function' ? engine.runOpenedUnit(trx, driver, fn) : fn();

    try {
      // Reached only with no ambient transaction to join, so this call really
      // did open one and the callback owns the outcome (#5696 / #6168).
      const result = await runIn(() => callback(trxCtx, { owned: true }));
      if (driver.commit) await driver.commit(trx);
      else if (driver.commitTransaction) await driver.commitTransaction(trx);
      return result;
    } catch (error) {
      if (driver.rollback) await driver.rollback(trx);
      else if (driver.rollbackTransaction) await driver.rollbackTransaction(trx);
      // [#21274] The engine surface's twin (`ObjectQL.transaction`), the
      // stale-roll-up conversion included.
      throw redactPropagatedDriverFault(rolledBackRefusal(error));
    }
  }

  /**
   * Handles this context JOINED (ADR-0067 D2) rather than opened, recorded by
   * {@link beginTransaction} and consumed by {@link releaseJoinedHandle}.
   *
   * A joined handle belongs to an OUTER owner, so this context must not commit
   * or roll it back. Keying by the handle object is what makes the abstention
   * exact — a context that later opens one of its own gets a different handle
   * and closes it normally. Entries are removed by the first commit/rollback
   * that names them, so the set holds at most the transactions currently open
   * through this (per-dispatch, short-lived) context.
   */
  private readonly joinedHandles = new Set<unknown>();

  /**
   * Was `handle` JOINED by this context rather than opened by it? Consumes the
   * record, so the trio's terminal call is also what forgets the handle.
   *
   * Two independent signals, because the trio's callers are exactly the ones
   * that cannot keep a closure on the stack and may not close on the same
   * object they opened on:
   *
   *   1. this context's own {@link joinedHandles} record, and
   *   2. identity with the CURRENT ambient handle — a handle the engine is
   *      holding open right now is, by construction, not one the trio opened
   *      (the trio never publishes into `txStore`, so a trio-owned handle is
   *      never the ambient one).
   *
   * Both point the same way and both fail SAFE: the ambiguous answer is
   * "abstain", never "commit a transaction we do not own".
   */
  private releaseJoinedHandle(handle: unknown): boolean {
    if (this.joinedHandles.delete(handle)) return true;
    if (handle == null) return false;
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    return ambient?.transaction === handle;
  }

  /**
   * Resolve the default driver, if it exposes transaction primitives.
   * Shared by {@link transaction} and the discrete begin/commit/rollback trio.
   */
  private txDriver(): any | undefined {
    const engine = this.engine as any;
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;
    // [#18063] Declaration, not bare method presence — the trio's `begin`
    // returns `null` and `commit`/`rollback` abstain for a transport that
    // declared it cannot honour a handle, which is the same graceful degrade a
    // driver with no `beginTransaction` already gets.
    return driverSupportsTransactions(driver) ? driver : undefined;
  }

  /**
   * Discrete transaction primitives — `begin` / `commit` / `rollback` as three
   * separate calls, in contrast to {@link transaction}'s single-callback form.
   *
   * This trio exists for callers that cannot keep a JS closure on the stack for
   * the lifetime of the transaction — chiefly the sandbox runner, where the
   * hook/action body's `ctx.api.transaction(fn)` is driven across many host
   * event-loop turns via deferred promises. With no closure spanning
   * begin→commit there is nothing to hand `txStore.run`, so a transaction this
   * trio opens can never be PUBLISHED into the engine's ambient store; the
   * handle is threaded **explicitly** instead: `begin` returns a child
   * ScopedContext carrying `transaction: trx` in its execution context, and
   * `resolveTx` honors that explicit handle ahead of the ambient store. Every
   * `object(...)` op on the returned context therefore reuses the one
   * connection without relying on ALS — which is also what keeps it working
   * across `setImmediate` boundaries an outside caller may schedule the
   * commit from.
   *
   * Returns `null` when the driver has no transaction support — the caller then
   * runs non-transactionally against `this` (same graceful degrade as
   * {@link transaction}).
   *
   * ## ADR-0067 D2 join (#6406) — the third face of one primitive
   *
   * `begin` JOINS an already-open ambient transaction instead of opening a
   * nested driver one, exactly as `ObjectQL.transaction` always did and as
   * {@link transaction} does since #6168. Without it, a QuickJS body's
   * `ctx.api.transaction(fn)` — which reaches this trio, not {@link transaction}
   * — opened a SECOND driver transaction inside a host `engine.transaction()`:
   * a second connection (the deadlock D2 exists to avoid on a single-connection
   * pool) whose `__txCommit` made its writes SURVIVE the outer rollback, with
   * no error and no log.
   *
   * `owned` in the result is #5696's signal, in the shape this face can carry
   * it: `false` says this call joined and the OUTER caller owns the one and
   * only commit/rollback. Commit and rollback abstain for such a handle
   * ({@link releaseJoinedHandle}) — the guarantee lives HERE rather than in
   * each caller, so a caller that ignores the bit still cannot close a
   * transaction it does not own. An explicit rollback of a joined handle
   * therefore performs NO driver rollback here; it is the same answer the
   * callback faces give, where the joined branch has no rollback of its own and
   * a throw propagates to the outer owner, which rolls the whole unit back.
   *
   * DECLARED LIMIT, measured rather than assumed (#6406): the join reads the
   * engine's ambient `txStore` at BEGIN time. On the sandbox path that store IS
   * readable there — the leaf runs on a chain awaited down from the host's
   * `txStore.run`, so the AsyncLocalStorage context is still current — which is
   * why no separate capture mechanism is needed. What the trio still cannot do
   * is PUBLISH: it has no closure spanning begin→commit to wrap in
   * `txStore.run`, which is why its own handle is threaded explicitly and stays
   * invisible to the ambient readers. A caller whose `begin` is scheduled from
   * OUTSIDE the transaction's async context sees no ambient and opens its own,
   * exactly as before — join is best-effort on visibility, on this face and on
   * both callback faces alike.
   */
  async beginTransaction(): Promise<{ ctx: ScopedContext; handle: unknown; owned: boolean } | null> {
    // ADR-0067 D2 — JOIN before the driver lookup, the same first move and the
    // same position as both callback faces (#6168 / #6406). An ambient
    // transaction IS a transaction, so there is nothing to look a driver up for.
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    if (ambient?.transaction) {
      // Threaded explicitly into the child context, identity-equal to the
      // store's handle — so `buildDriverOptions` binds every op on it to the
      // outer connection and `transactionCoversDriverFor` still attributes the
      // handle to the OUTER owner (#5351 unchanged).
      const ctx = this.derive({ ...this.executionContext, transaction: ambient.transaction });
      this.joinedHandles.add(ambient.transaction);
      return { ctx, handle: ambient.transaction, owned: false };
    }
    const driver = this.txDriver();
    if (!driver) return null;
    const trx = await driver.beginTransaction();
    const ctx = this.derive({ ...this.executionContext, transaction: trx });
    return { ctx, handle: trx, owned: true };
  }

  /**
   * Commit a handle obtained from {@link beginTransaction}.
   *
   * ABSTAINS for a JOINED handle (#6406): committing a transaction this context
   * did not open would land the inner writes early and take the outcome away
   * from the outer owner — the durability half of the D2 defect.
   */
  async commitTransaction(handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.commit) await driver.commit(handle);
    else if (driver.commitTransaction) await driver.commitTransaction(handle);
  }

  /**
   * Roll back a handle obtained from {@link beginTransaction}.
   *
   * ABSTAINS for a JOINED handle (#6406), mirroring the callback faces: their
   * joined branch issues no rollback either, and a throw inside it propagates
   * to the outer owner, which rolls back the whole unit of work. Rolling the
   * outer transaction back from here would be the mirror-image error — an inner
   * failure silently discarding writes the outer caller has not finished with.
   */
  async rollbackTransaction(handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.rollback) await driver.rollback(handle);
    else if (driver.rollbackTransaction) await driver.rollbackTransaction(handle);
  }

  get userId() { return this.executionContext.userId; }
  get tenantId() { return this.executionContext.tenantId; }
  /** Alias for tenantId — matches ObjectQLContext.spaceId convention */
  get spaceId() { return this.executionContext.tenantId; }
  get roles() { return this.executionContext.positions; }
  get isSystem() { return this.executionContext.isSystem; }

  /** Internal: expose the transaction handle for driver-level access */
  get transactionHandle() { return this.executionContext.transaction; }

  /**
   * [#24197] One declared `formula` field of `objectName`, evaluated over
   * `record` as a read under THIS context serves it — {@link
   * ObjectQL.serveFormulaField} with this context's own execution context, so
   * the one hop the formula reads through a reference is read with this
   * context's identity and permissions and, inside a transaction this context
   * carries, on that transaction's connection. `undefined` when `field` is not
   * a declared formula field.
   */
  async serveFormulaField(objectName: string, record: Record<string, unknown>, field: string): Promise<unknown> {
    return (this.engine as unknown as ObjectQL).serveFormulaField(objectName, record, field, this.executionContext);
  }
}
