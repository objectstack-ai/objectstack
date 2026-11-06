// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryAST, QueryInput, HookContext, ServiceObject } from '@objectstack/spec/data';
// [commit 74155c735] The defaulting node schema `fillQueryAstDefaults` runs author input
// through — the declared `.default()` stays in `packages/spec`, the engine
// only invokes it.
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
import { parseAutonumberFormat, driverSupportsTransactions } from '@objectstack/spec/data';
// [#5158] Door 2's lowering sink — the SAME pair the protocol face (Door 1)
// runs, so `FilterArray` has exactly one lowering in the product.
// [ADR-0053 D-D1, amended 2026-09-30 — #5930] The shared `FilterCondition →
// FilterCondition` lowering, run once per filter position after the doors and
// after token resolution (`resolveThenLowerWhere`), so every driver and the
// in-process `having` / per-aggregation evaluator receive the lowered filter.
import { type FilterCondition, type FilterLoweringOptions } from '@objectstack/spec/data';
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
// Seek pagination for the walks that must read EVERY row — the autonumber seed
// scan is one (#6249). Shared with `summary-backfill` rather than re-rolled:
// the cursor merge is the part that is easy to get subtly wrong.
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
// [#30237, ADR-0148] The recycle bin's write side: the capture body, and the
// retention seam the host hands over (`RecycleBinCaptureHost`).
import { openRecycleBinCapture, type RecycleBinCapture } from './recycle-bin/capture.js';
import type { RecycleBinRetentionSettings } from './recycle-bin/retention.js';
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
import { assertReferencesResolve, masterDetailHeadersCallerReads, referencesCheckedBeforeRules, type StoredReferenceRows } from './engine-referential-integrity.js';
// [#25522 cut 11] File-field hydration on read; the methods of the same names
// below hand each body the members it reads (`FileReferenceHydrationHost`).
import { callerMayReadSysFile, readParentDerivedFiles, resolveFileReferences, servableFileRows, serveRefusedFileHydration } from './engine-file-reference-hydration.js';
// [#29460] A `referenceNameVisible` reference's refused targets served by name
// and id on the expanded read; the method of the same name below hands the body
// the members it reads (`ReferenceNameVisibleHost`).
import { formulaReadsReference, serveReferenceNames } from './engine-reference-name-visible.js';
// [#25522 cut 12] The driver options every driver call receives, and the tenancy
// posture and Layer 0 verdict they are scoped by; the methods of the same names
// below hand each body the members it reads (`DriverOptionsHost`).
import { buildDriverOptions, driverReadScope, driverWriteTarget, engineLayer0Verdict, mergeDriverOptionsIntoHookView, resolveEnginePosture, wallExemptedOperation } from './engine-driver-options.js';
// [#25522 cut 13] The `sys_migration` flag reads, the certification question a
// driver is handed, and the admitted-violation tally and boot advisory; the
// methods of the same names below hand each body the members it reads (`MigrationFlagsHost`).
import { announceOpenMigrationGates, isOrganizationOwnershipCertified, isValueShapesMigrationVerified, noteAdmittedValueShapeViolation, readFileReferencesFlagRow, readMigrationFlagVerified, supplyTenantKeyCertifiedResolver, wasDatastoreCreatedFromEmpty } from './engine-migration-flags.js';
import { ExecutionContext, type InstalledPackageSource } from '@objectstack/spec/kernel';
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
  type RetryOptions,
  recordNotFoundError,
  resolveUserAuthzGrants,
  markAppAutomationElevation,
  appAutomationElevationOf,
} from '@objectstack/core';
import { WriteEpoch } from './write-epoch.js';
import { SummaryRecomputeError, cascadeStoppedRefusal, rolledBackRefusal, type SummaryRecomputeFailure } from './summary-errors.js';
import { TransactionUnsupportedError } from './transaction-errors.js';
import {
  withoutDeletedSelfParents,
  type SummaryDescriptor,
} from './summary-aggregate.js';
import { refreshSummariesExtendedBy, startSummaryRefreshOnEnable, summaryRefreshesSettled, type SummaryEnableRefreshReport } from './summary-enable-refresh.js';
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
  type DriverHealth,
  type DatasourceUnavailableInfo,
  type DatasourceUnavailableKind,
  type PrimaryDatasourceVerdict,
} from './driver-connect-errors.js';
// [#5979] The ONE shared "which read failure is benign?" predicate (#4825
// family). Imported from the leaf `/errors` subpath — which exists precisely
// so a cross-package consumer gets the 40-line predicate without the manager,
// the loaders or the YAML/filesystem machinery behind `@objectstack/metadata`'s
// root entry. Asking the shared predicate rather than hand-rolling a
// `code === '42P01'` test here is load-bearing, not stylistic: a second
// vocabulary of "benign driver error" is the exact debt that module exists to
// retire, and `check:durability-log-level` exempts only this declared name.
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
import { AssignmentRuleEvaluator, type AssignmentQueueService } from './assignment-rules.js';
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
import { IRealtimeService } from '@objectstack/spec/contracts';
import type { ICryptoProvider } from '@objectstack/spec/contracts';
// [#25522 cut 18] `count` and `aggregate()`'s credential guard
// (`rejectCredentialAggregation`); the methods of the same names below hand
// each body the members it reads (`CountAggregateHost`).
import { count, rejectCredentialAggregation } from './engine-count-aggregate.js';
// ADR-0100: the credential-column guard's filter / sort half, beside the
// aggregate half above — one collector, one envelope.
import { rejectCredentialEvaluation } from './credential-evaluation-guard.js';
import { rejectInternalFieldEvaluation } from './internal-field-evaluation-guard.js';
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
  type HomeAmountReads,
  type HomeAmountServing,
  type HomeLocalization,
  type HomeLocalizationResolver,
} from './home-amount-projection.js';
import { SchemaRegistry, type ArtifactInstallScope } from './registry.js';
import { stripSearchCompanion } from './search-companion.js';
import { type EvalError, type EvalOptionLabels, type EvalPermissions } from '@objectstack/formula';
import { declaredOptionLabels } from './formula-option-labels.js';
// [commit 3c1bbd2a8] The ONE spelling of "which object does an aggregated `defineView`
// container bind to", imported rather than re-spelled — from the LEAF subpath,
// for the reason the `/errors` import above states (commit 3bd9b3498). See
// `resolveMetadataItemName` below for why this registrar lost its fourth copy.
// [#20331] The divergent view-container `name` refusal — the ONE judge this
// registrar and `os validate` both call.
import { type BindHooksOptions } from './hook-binder.js';
import { validateRecord, validateRecordInScope, normalizeMultiValueFields, normalizeBlankTypedValues, normalizeNumericStringValues, coerceBooleanFields, ValidationError } from './validation/record-validator.js';
import type { AdmittedValueShapeViolation, AdmittedValueShapeViolationSink, ValidationMessageContext } from './validation/record-validator.js';
import type { RelatedRecordBinding } from './validation/rule-validator.js';
import { createBatchSummaryAccumulator } from './summary-batch-accumulation.js';
import { evaluateValidationRules, emitValidationAdvisories, needsPriorRecord, stripReadonlyWhenFields, stripReadonlyWhenFieldsMulti, hasReadonlyWhenInPayload, hasParentScopedReadonlyWhenInPayload, hasParentScopedRequiredWhen, stripReadonlyFields, stripRuntimeOwnedFields, staticReadonlyInsertSubject, preserveAuditIgnoredOnInsertWarning } from './validation/rule-validator.js';
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
// [#27277] The correctness floor over a plugin driver on an external datasource.
import {
  externalPredicateWriteRefusal,
  isExternalDriverFloor,
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
// [#25522 cut 19] The delete cascade's collection walk, the in-cascade
// `restrict` judge, the `DELETE_RESTRICTED` refusal, the reference-probe
// filter and the reference-check elevation record; the methods of the same
// names below hand each body the members it reads (`DeleteCascadeHost`).
// Imported after every module those bodies import, so the engine's module
// evaluation order is what it was.
// [#28001] …and the object-level closure of that walk the metadata read serves.
import { collectCascadeDeleteSet, deleteRestrictedError, recordReferenceCheckElevation, referenceProbeFilter, refuseRestrictsInsideOwnCascade } from './engine-delete-cascade.js';
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
  DISPATCHABLE_HOOK_EVENTS, ENGINE_DELETE_OPTION_KEYS, ENGINE_FIND_OPTION_KEYS, ENGINE_QUERY_SLOTS,
  ENGINE_UPDATE_OPTION_KEYS, ENGINE_WHERE_SLOTS, ENGINE_WIRE_ONLY_SLOTS, SECURITY_SERVICE_SOURCE_SLOT,
  WRITE_PRECONDITION_OPTION, applyFormulaPlan, applyStoredExpressionsToPatch, assertDispatchableHookEvent,
  assertOrderByIsMaterializable, assertProjectionHasNoDottedPaths, assertValidHookExcludeObjects,
  autonumberFieldNames, callerKeySets, callerSuppliedRow, computeStoredExpressions, declaredDatetimeLowering,
  droppedFieldEvents, foldEngineOptionAliases, handBackWithheldInsertReadonly, hydrateWriteFormulas,
  insertStaticReadonlySubject, lowerWhereFilterArray, masterIdOf, mergeReadContext,
  organizationPredicateDeleteRefusal, planFormulaProjection, planStoredExpressions, recomputeAutonumberReaders,
  rejectUnknownEngineOptions, replacedStoredExpressionFields, rowsWithoutFormulaWidening, settleBulkStoredExpressions,
  shouldSkipStateMachine, staticReadonlyStoredView, storedExpressionsReading, stripComputedWriteFields,
  undeclaredWriteFieldErrors, updateStaticReadonlySubject, withFileOwnerKey, withholdInsertReadonlyFromHooks,
  withoutFormulaWidening, writeFailureLogMeta,
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
import { HooksAndFunctionsFacet } from './engine-hooks-and-functions.js';
// [#29986 codemod] Action system and packaged-action activation: the methods of the same names below hand the bodies what they read (`ActionsHost`).
import { ActionsFacet, type ActionHandlerEntry } from './engine-actions.js';
// [#29986 codemod] Registration seams, readable-ids security, formula and default permissions: the methods of the same names below hand the bodies what they read (`SecurityResolversHost`).
import { SecurityResolversFacet } from './engine-security-resolvers.js';
// [#29986 codemod] Authz invalidation, middleware, session, driver options, posture, organization probe: the methods of the same names below hand the bodies what they read (`MiddlewareAndContextHost`).
import { MiddlewareAndContextFacet } from './engine-middleware-and-context.js';
// [#29986 codemod] Field defaults and autonumbers: the methods of the same names below hand the bodies what they read (`DefaultsAndAutonumbersHost`).
import { DefaultsAndAutonumbersFacet } from './engine-defaults-and-autonumbers.js';
// [#29986 codemod] Package, app, plugin, driver and datasource registration: the methods of the same names below hand the bodies what they read (`RegistrationHost`).
import { RegistrationFacet } from './engine-registration.js';
// [#29986 codemod] Realtime, i18n, home amounts, validation messages, references, master-detail: the methods of the same names below hand the bodies what they read (`ReferencesAndMasterDetailHost`).
import { ReferencesAndMasterDetailFacet } from './engine-references-and-master-detail.js';
// [#29986 codemod] Crypto, secrets, internal fields, schema and datasource routing, init: the methods of the same names below hand the bodies what they read (`SecretsAndRoutingHost`).
import { SecretsAndRoutingFacet } from './engine-secrets-and-routing.js';
// [#29986 codemod] Migration flags, value-shape deviations, creation attestations, destroy: the methods of the same names below hand the bodies what they read (`MigrationStateHost`).
import { MigrationStateFacet } from './engine-migration-state.js';
// [#29986 codemod] Summary indexes, related-record expansion, file and reference hydration: the methods of the same names below hand the bodies what they read (`SummariesAndExpansionHost`).
import { SummariesAndExpansionFacet } from './engine-summaries-and-expansion.js';
// [#29986 codemod] Query lowering, search, find and findOne: the methods of the same names below hand the bodies what they read (`FindHost`).
import { FindFacet } from './engine-find.js';
// [#29986 codemod] Write preparation and insert: the methods of the same names below hand the bodies what they read (`InsertHost`).
import { InsertFacet } from './engine-insert.js';
// [#29986 codemod] Cascade and referential delete planning: the methods of the same names below hand the bodies what they read (`CascadePlanningHost`).
import { CascadePlanningFacet } from './engine-cascade-planning.js';
// [#29986 codemod] Delete, count, aggregate and execute: the methods of the same names below hand the bodies what they read (`DeleteAndAggregateHost`).
import { DeleteAndAggregateFacet } from './engine-delete-and-aggregate.js';
// [#29986 codemod] Transactions: the methods of the same names below hand the bodies what they read (`TransactionsSectionHost`).
import { TransactionsSectionFacet } from './engine-transactions-section.js';
// [#29986 codemod] Compatibility / convenience API: the methods of the same names below hand the bodies what they read (`CompatibilitySectionHost`).
import { CompatibilitySectionFacet } from './engine-compatibility-section.js';
// [#29986 codemod] The facets' hosts, one per engine, which the static block at the end of the class builds.
import {
  actionsHost, cascadePlanningHost, compatibilitySectionHost, defaultsAndAutonumbersHost, deleteAndAggregateHost,
  findHost, hooksAndFunctionsHost, insertHost, middlewareAndContextHost, migrationStateHost,
  referencesAndMasterDetailHost, registrationHost, secretsAndRoutingHost, securityResolversHost,
  summariesAndExpansionHost, transactionsSectionHost,
} from './engine-facet-hosts.js';
// [#30052 codemod] Repository bound to one object and one execution context: the methods of the same names on `ObjectRepository` hand the bodies what they read (`ObjectRepositoryHost`).
import { ObjectRepositoryFacet } from './engine-object-repository.js';
// [#30052 codemod] Scoped execution context: repositories, elevation, transactions: the methods of the same names on `ScopedContext` hand the bodies what they read (`ScopedContextHost`).
import { ScopedContextFacet } from './engine-scoped-context.js';
// [#30052 codemod] The scoped facets' hosts, one per instance, which each class's static block builds.
import { objectRepositoryHost, scopedContextHost } from './engine-scoped-hosts.js';

// [#29986 codemod] The statics of `ObjectQL` its facet modules read, private ones included, as
// the class declares them (an indexed access on the class). The static block at the end of
// the class fills `ObjectQLStatics` with forwarders: a method is called on the class at
// call time, a field or accessor is read when the body reads it. A facet module imports
// `ObjectQLStatics` AS `ObjectQL`, so each moved body reads `ObjectQL.x` unedited;
// `index.ts` re-exports neither, so neither reaches the package.
export interface ObjectQLStaticsHost {
  readonly MAX_CASCADE_DEPTH: (typeof ObjectQL)['MAX_CASCADE_DEPTH'];
  readonly MAX_EXPAND_DEPTH: (typeof ObjectQL)['MAX_EXPAND_DEPTH'];
  readonly REFERENCE_PROBE_BATCH: (typeof ObjectQL)['REFERENCE_PROBE_BATCH'];
  readonly coveredValueFieldPresence: (typeof ObjectQL)['coveredValueFieldPresence'];
  readonly homeAmountOrganizationOf: (typeof ObjectQL)['homeAmountOrganizationOf'];
  readonly keepsOrganizationReference: (typeof ObjectQL)['keepsOrganizationReference'];
  readonly mediaFieldPresence: (typeof ObjectQL)['mediaFieldPresence'];
  readonly organizationCountContext: (typeof ObjectQL)['organizationCountContext'];
  readonly outlivesOrganization: (typeof ObjectQL)['outlivesOrganization'];
  readonly referenceCheckContext: (typeof ObjectQL)['referenceCheckContext'];
  readonly remainderAfterMemberRemoval: (typeof ObjectQL)['remainderAfterMemberRemoval'];
  readonly storedReferenceIncludes: (typeof ObjectQL)['storedReferenceIncludes'];
}
export const ObjectQLStatics = {} as ObjectQLStaticsHost;

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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.recordResidualOwner.call(hooksAndFunctionsHost.of(this), ownerId, source);
  }

  /**
   * [#28534] The origin {@link recordResidualOwner} recorded for a residual
   * owner id, or `undefined` when no artifact this engine registered named it
   * as its residual's owner.
   */
  residualOwnerSource(ownerId: string): 'code' | 'marketplace' | undefined {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.residualOwnerSource.call(hooksAndFunctionsHost.of(this), ownerId);
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
  private actions = new Map<string, ActionHandlerEntry>();

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
    // [#30215] `registerApp` writes `manifests`; an uninstall withdraws the
    // package through the registry's own verb, on every door, so the entry goes
    // with the registry's record. Left behind, ADR-0070's `isWritablePackage`
    // (which reads this map first) kept an uninstalled package read-only until
    // a restart.
    this._registry.onPackageUninstalled((packageId) => { this.manifests.delete(packageId); });
    // [#30377] A roll-up a package adds by extension is withheld with it, so
    // the child writes made during a disable recompute nothing: an enable
    // recomputes it (`summary-enable-refresh.ts`), on every enable door.
    this._registry.onPackageEnabled((packageId) => startSummaryRefreshOnEnable(this, this.logger, packageId));
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
  getStatus(): {
    name: "data";
    status: string;
    version: string;
    features: string[];
  } {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts`.
    return HooksAndFunctionsFacet.getStatus();
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
  }): void {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.registerHook.call(hooksAndFunctionsHost.of(this), event, handler, options);
  }

  /**
   * Remove all hooks registered under a given `packageId`. Used by
   * `bindHooksToEngine` to make re-binding (hot reload, app reinstall)
   * idempotent, and by app uninstall flows.
   */
  unregisterHooksByPackage(packageId: string): number {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.unregisterHooksByPackage.call(hooksAndFunctionsHost.of(this), packageId);
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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.registerFunction.call(hooksAndFunctionsHost.of(this), name, handler, packageIdOrOptions);
  }

  /** Look up a registered function by name. */
  resolveFunction(name: string): HookHandler | undefined {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.resolveFunction.call(hooksAndFunctionsHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.resolveFunctionEntry.call(hooksAndFunctionsHost.of(this), name);
  }

  /** Remove all functions registered under a given `packageId`. */
  unregisterFunctionsByPackage(packageId: string): number {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.unregisterFunctionsByPackage.call(hooksAndFunctionsHost.of(this), packageId);
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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.bindHooks.call(hooksAndFunctionsHost.of(this), hooks, opts);
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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.setDefaultBodyRunner.call(hooksAndFunctionsHost.of(this), runner);
  }

  /** The installed default body-runner, if any — the public read the first-wins guard implies. */
  getDefaultBodyRunner(): any {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.getDefaultBodyRunner.call(hooksAndFunctionsHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.setDefaultActionRunner.call(hooksAndFunctionsHost.of(this), runner);
  }

  /** The installed default action-runner factory, if any. */
  getDefaultActionRunner(): ((actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined) | undefined {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.getDefaultActionRunner.call(hooksAndFunctionsHost.of(this));
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
  public triggerHooks(event: string, context: HookContext): Promise<void> {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.triggerHooks.call(hooksAndFunctionsHost.of(this), event, context);
  }

  private hasHooksFor(event: string, object: string): boolean {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts`, its docblock with it (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.hasHooksFor.call(hooksAndFunctionsHost.of(this), event, object);
  }

  private opensAfterAbortUnit(event: 'afterInsert' | 'afterUpdate' | 'afterDelete', object: string, context: ExecutionContext | undefined): boolean {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts`, its docblock with it (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.opensAfterAbortUnit.call(hooksAndFunctionsHost.of(this), event, object, context);
  }

  private async inAfterAbortUnit<T>(write: () => Promise<T>): Promise<T> {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts`, its docblock with it (see `HookDispatchHost`).
    const host: ThisParameterType<typeof inAfterAbortUnit> = {
      transaction: (...a) => this.transaction(...a),
    };
    return (inAfterAbortUnit<T>).call(host, write);
  }

  private buildPerRowAfterContexts(
    object: string,
    event: 'afterUpdate' | 'afterDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
    payload?: Record<string, unknown>,
  ): HookContext[] {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts`, its docblock with it (see `HookDispatchHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof buildPerRowAfterContexts> = {
      get _registry() { return readRegistry(); },
    };
    return buildPerRowAfterContexts.call(host, object, event, rows, batchCtx, payload);
  }

  private async dispatchPerRowBeforeHooks(
    object: string,
    event: 'beforeUpdate' | 'beforeDelete',
    rows: Record<string, unknown>[],
    batchCtx: HookContext,
  ): Promise<void> {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts`, its docblock with it (see `HookDispatchHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof dispatchPerRowBeforeHooks> = {
      get _registry() { return readRegistry(); },
      triggerHooks: (...a) => this.triggerHooks(...a),
    };
    return dispatchPerRowBeforeHooks.call(host, object, event, rows, batchCtx);
  }

  private dispatchUnscopedMultiWriteHooks(
    event: 'beforeUpdate' | 'beforeDelete',
    object: string,
    batchCtx: HookContext,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts`, its docblock with it (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.dispatchUnscopedMultiWriteHooks.call(hooksAndFunctionsHost.of(this), event, object, batchCtx);
  }

  private assertBulkPerRowHookBudget(object: string, event: string, matched: number): void {
    // [#25522 cut 6] The body moved to `engine-hook-dispatch.ts`, its docblock with it; it reads no member.
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
   *
   * [#30065, ADR-0146 D9 `action`] The one exception: a key a declared
   * action override holds ({@link registerActionOverride}) keeps the
   * override on top when the declared base's handler arrives, and that
   * handler takes the place beneath it, the one a removal of the override
   * binds again. A marketplace base's handlers are bound by its rehydrate
   * after the authored-action resync bound the override, so the base's body
   * arrives second and must not replace the override's. [#30542] The
   * declared base's handler is the one registered while the registry's code
   * artifact of the action is that package's, on this object; any other
   * registration under the key, one with no package included, replaces the
   * override and is warned like every other.
   */
  registerAction(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.registerAction.call(actionsHost.of(this), objectName, actionName, handler, packageName);
  }

  /**
   * [#30065, ADR-0146 D9 `action`] Bind a declared action override's handler
   * over the key the base's handler holds, keeping the base's underneath.
   *
   * The `.custom` pair's declared override of a base's action keeps the
   * base's name, so its body registers under the base's `<object>:<name>`
   * key. Unlike {@link registerAction}, the replaced handler is not dropped:
   * it is kept beneath the override's, and {@link removeActionsByPackage}
   * of the override's package puts it back. So "Restore package original"
   * runs the base's handler again, in the same step that removes the
   * override's, and no window has both or neither bound. No collision is
   * warned: the replacement is the declared one. The entry is marked as an
   * override, so the base's handler registered after it (by
   * {@link registerAction}) slots beneath it instead of replacing it.
   *
   * @param base [#30542] The package the override declares it overrides
   *   (`overrides.package`). Only that package's handler slots beneath the
   *   override; without it, any package's does.
   */
  registerActionOverride(objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName: string, base?: string): void {
    return ActionsFacet.registerActionOverride.call(actionsHost.of(this), objectName, actionName, handler, packageName, base);
  }

  /**
   * Execute a named action on an object.
   */
  executeAction(objectName: string, actionName: string, ctx: any): Promise<any> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.executeAction.call(actionsHost.of(this), objectName, actionName, ctx);
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
    return ActionsFacet.listRegisteredActions.call(actionsHost.of(this));
  }

  /**
   * Remove all actions registered by a specific package.
   *
   * [#30065] A handler {@link registerActionOverride} bound over another
   * package's is replaced by that package's again, rather than leaving the
   * key empty; a package removed from beneath an override leaves the
   * override bound, with nothing beneath it to restore.
   */
  removeActionsByPackage(packageName: string): void {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.removeActionsByPackage.call(actionsHost.of(this), packageName);
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
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.setActionActivationStore.call(actionsHost.of(this), store);
  }

  /**
   * [ADR-0126 §8] Load the ledger into the engine's projection, returning the
   * names it switched off so the host can report them in its boot audit.
   *
   * Called once per boot AFTER the authored-action re-sync, for the reason the
   * governance inventory runs there: the registry is final for the boot, so the
   * audit line describes the deployment that will actually serve requests.
   */
  hydrateActionActivations(): Promise<string[]> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.hydrateActionActivations.call(actionsHost.of(this));
  }

  /**
   * Is this DECLARED action armed for this installation (ADR-0126 §8)?
   * Absence of a ledger row means the packaged default — active — so a stock
   * boot answers `true` for everything, exactly as it always has.
   */
  isActionEnabled(actionName: string): boolean {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.isActionEnabled.call(actionsHost.of(this), actionName);
  }

  /** Every action name the ledger currently switches off (operability reads). */
  listDisabledActions(): string[] {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.listDisabledActions.call(actionsHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.getDisabledActions.call(actionsHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.describeDisabledAction.call(actionsHost.of(this), actionName);
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
  setActionActive(row: ActionActivationRow, options?: ActionActivationWriteOptions): Promise<void> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.setActionActive.call(actionsHost.of(this), row, options);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerHeldFileResolver.call(securityResolversHost.of(this), fn);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerFieldOwnedFileReadAuthorizer.call(securityResolversHost.of(this), fn);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerWriteGateProbe.call(securityResolversHost.of(this), fn);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerWriteWallVerdict.call(securityResolversHost.of(this), fn);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerEffectiveObjectPermissionsResolver.call(securityResolversHost.of(this), fn);
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
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.registerInsertRecomputeListener.call(securityResolversHost.of(this), id, fn);
  }

  /**
   * The states {@link composeReadableIdsAtBoundary} has already reported for
   * this engine. It records only that the report was made and caches no
   * verdict: every composition resolves the service afresh.
   */
  private readonly readableIdsSecurityReported = new Set<'absent' | 'unusable'>();

  private resolveReadableIdsSecurity(): ReadableIdsSecurityResolution {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.resolveReadableIdsSecurity.call(securityResolversHost.of(this));
  }

  private composeReadableIdsAtBoundary<A extends QueryAST>(
    object: string,
    operation: 'find' | 'findOne' | 'count' | 'aggregate',
    ast: A,
    context: ExecutionContext | undefined,
  ): Promise<A> {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return (SecurityResolversFacet.composeReadableIdsAtBoundary<A>).call(securityResolversHost.of(this), object, operation, ast, context);
  }

  private async composeReadableIdsChain<N>(
    chain: ReadableIdsChain,
    node: N,
    sites: readonly ComposableReadableIdsSite[],
    ancestors: readonly string[],
  ): Promise<N> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
    const host: ThisParameterType<typeof composeReadableIdsChain> = {
      refuseUncomposableReadableIdsClasses: (...a) => this.refuseUncomposableReadableIdsClasses(...a),
      readableIdsScopeOf: (...a) => this.readableIdsScopeOf(...a),
      composeReadableIdsChain: (...a) => this.composeReadableIdsChain(...a),
    };
    return (composeReadableIdsChain<N>).call(host, chain, node, sites, ancestors);
  }

  private refuseUncomposableReadableIdsClasses(
    object: string,
    operation: string,
    sites: readonly ComposableReadableIdsSite[],
  ): string[] {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.refuseUncomposableReadableIdsClasses.call(securityResolversHost.of(this), object, operation, sites);
  }

  private uncomposableReadableIdsParent(object: string, parent: string):
    | { class: 'object-scoped-read-middleware' }
    | { class: 'other-datasource'; objectDatasource: string | undefined; parentDatasource: string | undefined }
    | undefined {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.uncomposableReadableIdsParent.call(securityResolversHost.of(this), object, parent);
  }

  /**
   * [ADR-0139 D5.2 / D5.3 · ADR-0049] Every registered `controlled_by_parent`
   * detail whose master the engine composes no `ReadableIds` leaf over — a
   * master an object-scoped read middleware narrows, or one bound to another
   * datasource than the detail — judged by the read path's own predicate
   * ({@link uncomposableReadableIdsParent}). A detail's access derives from its
   * one master `master_detail` (ADR-0055 §1: the required one, or as amended
   * its only one declared `required: false`), so such a declaration is one
   * the runtime cannot honour: `ObjectQLPlugin` refuses the boot on any entry.
   *
   * Both facts are deployment facts (the datasource mapping, a package's
   * default datasource, lifecycle routing, the middleware registrations), so
   * the answer is final only once every plugin has registered its middleware —
   * which several do inside their own `kernel:ready` handler. Asked earlier, it
   * is short. A detail with no single master, or whose master the
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

  private async readableIdsScopeOf(
    object: string,
    operation: string,
    parent: string,
    svc: ReadableIdsSecurity,
    context: ExecutionContext | undefined,
  ): Promise<{ scope: FilterCondition | undefined } | null> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof readableIdsScopeOf> = {
      get logger() { return readLogger(); },
    };
    return readableIdsScopeOf.call(host, object, operation, parent, svc, context);
  }

  private async resolveOptionPermissions(
    schema: unknown,
    payloads: ReadonlyArray<Record<string, unknown> | null | undefined>,
    resolution: PermissionResolution | undefined,
  ): Promise<(payload: Record<string, unknown> | null | undefined) => EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it; it reads no member of the class.
    return resolveOptionPermissions(schema, payloads, resolution);
  }

  private permissionResolution(context: ExecutionContext | undefined): PermissionResolution | undefined {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
    const readEffectiveObjectPermissionsResolver = () => this._effectiveObjectPermissionsResolver;
    const host: ThisParameterType<typeof permissionResolution> = {
      get _effectiveObjectPermissionsResolver() { return readEffectiveObjectPermissionsResolver(); },
      buildEvalUser: (...a) => this.buildEvalUser(...a),
    };
    return permissionResolution.call(host, context);
  }

  private async resolveFormulaPermissions(
    object: string,
    plan: readonly FormulaPlanEntry[],
    records: readonly unknown[],
    context: ExecutionContext | undefined,
    resolution: PermissionResolution | undefined,
  ): Promise<EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
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

  private resolveFormulaRelated(
    schema: any,
    plan: readonly FormulaPlanEntry[],
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
    query?: EngineQueryOptions,
  ): Promise<FormulaRelated | undefined> {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.resolveFormulaRelated.call(securityResolversHost.of(this), schema, plan, rows, context, query);
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
  serveFormulaField(
    objectName: string,
    record: Record<string, unknown>,
    field: string,
    context?: ExecutionContext,
  ): Promise<unknown> {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts` (see `SecurityResolversHost`).
    return SecurityResolversFacet.serveFormulaField.call(securityResolversHost.of(this), objectName, record, field, context);
  }

  /**
   * [#29961] The values `object`'s stored computed fields ({@link planStoredExpressions})
   * take over rows ALREADY stored, computed and served exactly as a write
   * computes them: the declared option labels, the one hop, and the `can()`
   * map, under `context`. Index-aligned with `rows`, keyed by every stored
   * computed field the object declares; evaluated over copies, writes nothing.
   *
   * For a row that never went through a write since its field was declared —
   * `os migrate stored-expressions` (`stored-expression-backfill.ts`) and the
   * boot advisory it shares. A field that does not evaluate computes `null`,
   * the write's answer, and is told to `onFault` when given (else the engine's
   * once-per-field report).
   */
  computeStoredExpressionsOver(
    object: string,
    rows: ReadonlyArray<Record<string, unknown>>,
    context?: ExecutionContext,
    onFault?: (field: string, message: string) => void,
  ): Promise<Array<Record<string, unknown>>> {
    return SecurityResolversFacet.computeStoredExpressionsOver.call(securityResolversHost.of(this), object, rows, context, onFault);
  }

  private formulaOptionLabels(
    schema: unknown,
    plan: FormulaPlanEntry[],
    context: { locale?: string } | undefined,
  ): EvalOptionLabels | undefined {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.formulaOptionLabels.call(securityResolversHost.of(this), schema, plan, context);
  }

  /**
   * [#22019] The (object, field) pairs whose formula fault this engine instance
   * has already reported — see {@link reportFormulaFault}.
   */
  private readonly formulaFaultReported = new Set<string>();

  private formulaFaultSink(object: string): FormulaFaultSink {
    // [#29986 codemod] The body moved to `engine-security-resolvers.ts`, its docblock with it (see `SecurityResolversHost`).
    return SecurityResolversFacet.formulaFaultSink.call(securityResolversHost.of(this), object);
  }

  private reportFormulaFault(object: string, field: string, error: EvalError): void {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
    const readFormulaFaultReported = () => this.formulaFaultReported;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof reportFormulaFault> = {
      get formulaFaultReported() { return readFormulaFaultReported(); },
      get logger() { return readLogger(); },
    };
    return reportFormulaFault.call(host, object, field, error);
  }

  private async resolveDefaultPermissions(
    object: string,
    rows: ReadonlyArray<unknown>,
    context: ExecutionContext | undefined,
    resolution: PermissionResolution | undefined,
    /** Only these fields' defaults count — the insert's re-default pass keeps no others. */
    onlyFields?: readonly string[],
  ): Promise<(row: unknown) => EvalPermissions | undefined> {
    // [#25522 cut 15] The body moved to `engine-readable-ids-permission-formula.ts`, its docblock with it (see `ReadableIdsPermissionFormulaHost`).
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
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.attachAuthzInvalidationPubSub.call(middlewareAndContextHost.of(this), pubsub, nodeId);
  }

  /** Tear down the `authz.invalidated` bridge. Safe to call multiple times. */
  detachAuthzInvalidationPubSub(): void {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.detachAuthzInvalidationPubSub.call(middlewareAndContextHost.of(this));
  }

  /**
   * Register a middleware function
   * Middlewares execute in onion model around every data operation.
   * @param fn The middleware function
   * @param options Optional: target object filter
   */
  registerMiddleware(fn: EngineMiddleware, options?: { object?: string }): void {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.registerMiddleware.call(middlewareAndContextHost.of(this), fn, options);
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
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.hasObjectMiddleware.call(middlewareAndContextHost.of(this), objectName);
  }

  private executeWithMiddleware(ctx: OperationContext, executor: () => Promise<any>): Promise<any> {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.executeWithMiddleware.call(middlewareAndContextHost.of(this), ctx, executor);
  }

  private buildSession(execCtx?: ExecutionContext): HookContext['session'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`, its docblock with it; it reads no member.
    return buildSession(execCtx);
  }

  private buildProvenance(execCtx?: ExecutionContext): HookContext['provenance'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`, its docblock with it; it reads no member.
    return buildProvenance(execCtx);
  }

  private buildReferentialFieldClear(execCtx?: ExecutionContext): true | undefined {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it.
    return MiddlewareAndContextFacet.buildReferentialFieldClear(execCtx);
  }

  private claimReferentialCascadeDelete(object: string, id: unknown): true | undefined {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.claimReferentialCascadeDelete.call(middlewareAndContextHost.of(this), object, id);
  }

  private buildEvalUser(
    execCtx?: ExecutionContext,
  ): { id: string; positions: string[]; organizationId: string | null } | undefined {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`, its docblock with it; it reads no member.
    return buildEvalUser(execCtx);
  }

  private buildUser(execCtx?: ExecutionContext): HookContext['user'] {
    // [#25522 cut 9] The body moved to `engine-execution-plumbing.ts`, its docblock with it; it reads no member.
    return buildUser(execCtx);
  }

  private buildDriverOptions(
    object: string,
    execCtx?: ExecutionContext,
    base?: any,
    scope: { writeTarget?: boolean; recordedVerdict?: unknown } = {},
  ): any {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
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

  private driverReadScope(
    execCtx: ExecutionContext | undefined,
    recordedVerdict: unknown,
  ): { tenantId: string; tenantIds?: string[] } | undefined {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof driverReadScope> = {
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return driverReadScope.call(host, execCtx, recordedVerdict);
  }

  private engineLayer0Verdict(
    execCtx: ExecutionContext | undefined,
    activeOrganization: string | undefined,
  ): TenantLayer0Verdict {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof engineLayer0Verdict> = {
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return engineLayer0Verdict.call(host, execCtx, activeOrganization);
  }

  private wallExemptedOperation(execCtx: ExecutionContext | undefined, recordedVerdict: unknown): boolean {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof wallExemptedOperation> = {
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return wallExemptedOperation.call(host, execCtx, recordedVerdict);
  }

  private driverWriteTarget(
    execCtx: ExecutionContext | undefined,
  ): { tenantId: string; tenantIds?: string[] } | undefined {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
    const host: ThisParameterType<typeof driverWriteTarget> = {
      resolveEnginePosture: (...a) => this.resolveEnginePosture(...a),
    };
    return driverWriteTarget.call(host, execCtx);
  }

  private resolveEnginePosture(): TenancyPosture {
    // [#25522 cut 12] The body moved to `engine-driver-options.ts`, its docblock with it (see `DriverOptionsHost`).
    const readTenancyPostureProvider = () => this.tenancyPostureProvider;
    const host: ThisParameterType<typeof resolveEnginePosture> = {
      get tenancyPostureProvider() { return readTenancyPostureProvider(); },
    };
    return resolveEnginePosture.call(host);
  }

  private probeInstallOrganizations(): Promise<readonly string[]> {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.probeInstallOrganizations.call(middlewareAndContextHost.of(this));
  }

  private invalidateOrganizationProbe(): void {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.invalidateOrganizationProbe.call(middlewareAndContextHost.of(this));
  }

  private resolveSystemInsertOrganization(
    object: string,
    execCtx: ExecutionContext | undefined,
    rows: readonly Record<string, unknown>[],
  ): Promise<string | undefined> {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.resolveSystemInsertOrganization.call(middlewareAndContextHost.of(this), object, execCtx, rows);
  }

  private transactionCoversDriverFor(object: string, tx: unknown): boolean {
    // [#29986 codemod] The body moved to `engine-middleware-and-context.ts`, its docblock with it (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.transactionCoversDriverFor.call(middlewareAndContextHost.of(this), object, tx);
  }

  private resolveNowDefault(fieldType: unknown, instant: Date): string {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it.
    return DefaultsAndAutonumbersFacet.resolveNowDefault(fieldType, instant);
  }

  private normalizeExpressionDefault(fieldType: unknown, value: unknown): unknown {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.normalizeExpressionDefault.call(defaultsAndAutonumbersHost.of(this), fieldType, value);
  }

  private buildHookApi(execCtx?: ExecutionContext): ScopedContext {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.buildHookApi.call(defaultsAndAutonumbersHost.of(this), execCtx);
  }

  private resolveOptionDefault(field: { type?: unknown; options?: unknown; multiple?: unknown }): unknown {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it.
    return DefaultsAndAutonumbersFacet.resolveOptionDefault(field);
  }

  private applyFieldDefaults(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    nowSnapshot?: Date,
    permissions?: EvalPermissions,
  ): Record<string, unknown> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.applyFieldDefaults.call(defaultsAndAutonumbersHost.of(this), object, record, execCtx, nowSnapshot, permissions);
  }

  private defaultFieldEntries(object: string): Array<{
    name: string; type?: unknown; defaultValue?: unknown; options?: unknown; multiple?: unknown;
  }> | undefined {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.defaultFieldEntries.call(defaultsAndAutonumbersHost.of(this), object);
  }

  private applyAutonumbers(
    object: string,
    record: Record<string, unknown>,
    execCtx?: ExecutionContext,
    driverOwnsAutonumber?: boolean,
  ): Promise<IssuedAutonumber[]> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.applyAutonumbers.call(defaultsAndAutonumbersHost.of(this), object, record, execCtx, driverOwnsAutonumber);
  }

  private adoptExplicitAutonumber(
    object: string,
    field: string,
    tokens: ReturnType<typeof parseAutonumberFormat>,
    record: Record<string, unknown>,
    value: string,
    now: Date,
    timezone?: string,
  ): void {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.adoptExplicitAutonumber.call(defaultsAndAutonumbersHost.of(this), object, field, tokens, record, value, now, timezone);
  }

  private createWithAutonumberResync(
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
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.createWithAutonumberResync.call(defaultsAndAutonumbersHost.of(this), driver, object, row, driverOptions, issued, execCtx, driverOwnsAutonumber, driverIssued, readers);
  }

  private isIssuedAutonumberCollision(error: unknown, issued: IssuedAutonumber[]): boolean {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it.
    return DefaultsAndAutonumbersFacet.isIssuedAutonumberCollision(error, issued);
  }

  private warnAutonumberReadersUnserved(object: string, plan: readonly FormulaPlanEntry[], driver: unknown): void {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.warnAutonumberReadersUnserved.call(defaultsAndAutonumbersHost.of(this), object, plan, driver);
  }

  private seedAutonumber(
    object: string,
    field: string,
    prefix: string,
    suffix: string,
    execCtx?: ExecutionContext,
  ): Promise<number> {
    // [#29986 codemod] The body moved to `engine-defaults-and-autonumbers.ts`, its docblock with it (see `DefaultsAndAutonumbersHost`).
    return DefaultsAndAutonumbersFacet.seedAutonumber.call(defaultsAndAutonumbersHost.of(this), object, field, prefix, suffix, execCtx);
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
  registerApp(registeredBody: any, scope?: ArtifactInstallScope, source: Exclude<InstalledPackageSource, 'authored'> = 'code'): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.registerApp.call(registrationHost.of(this), registeredBody, scope, source);
  }

  private registerPackageBody(
      manifest: any,
      id: string,
      namespace: string | undefined,
      version: string | undefined,
      source: Exclude<InstalledPackageSource, 'authored'>,
      scope: ArtifactInstallScope | undefined,
  ): void {
    // [#29986 codemod] The body moved to `engine-registration.ts`, its docblock with it (see `RegistrationHost`).
    return RegistrationFacet.registerPackageBody.call(registrationHost.of(this), manifest, id, namespace, version, source, scope);
  }

  private resolveNavObjectNames(app: any, namespace: string): any {
    // [#25522 cut 17] The body moved to `engine-package-registration.ts`, its docblock with it; it reads no member of the class.
    return resolveNavObjectNames(app, namespace);
  }

  private registerPlugin(plugin: any, parentId: string, parentNamespace?: string, parentVersion?: string) {
    // [#25522 cut 17] The body moved to `engine-package-registration.ts`, its docblock with it (see `PackageRegistrationHost`).
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

  private registerMetadataCollections(source: any, ownerId: string, sourceLabel: string, ownerVersion?: string) {
    // [#29986 codemod] The body moved to `engine-registration.ts`, its docblock with it (see `RegistrationHost`).
    return RegistrationFacet.registerMetadataCollections.call(registrationHost.of(this), source, ownerId, sourceLabel, ownerVersion);
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
  registerDriver(driver: IDataDriver, isDefault: boolean = false): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.registerDriver.call(registrationHost.of(this), driver, isDefault);
  }

  private supplyFileColumnsMovedResolver(driver: IDataDriver): void {
    // [#29986 codemod] The body moved to `engine-registration.ts`, its docblock with it (see `RegistrationHost`).
    return RegistrationFacet.supplyFileColumnsMovedResolver.call(registrationHost.of(this), driver);
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
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.unregisterDriver.call(registrationHost.of(this), name);
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
    return RegistrationFacet.registerDatasourceDef.call(registrationHost.of(this), def);
  }

  private applyExternalDriverFloor(name: string): void {
    // [#29986 codemod] The body moved to `engine-registration.ts`, its docblock with it (see `RegistrationHost`).
    return RegistrationFacet.applyExternalDriverFloor.call(registrationHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.listDatasourceDefs.call(registrationHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.markDatasourceUnavailable.call(registrationHost.of(this), info);
  }

  /** Drop a {@link markDatasourceUnavailable} record (successful (re)connect / pool removal). */
  clearDatasourceUnavailable(name: string): void {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.clearDatasourceUnavailable.call(registrationHost.of(this), name);
  }

  /**
   * Name of the DEFAULT driver, when one is registered (#3826). The default
   * driver keeps its natural name (`registerDriver(driver, true)` — nothing
   * routes by `drivers.get('default')`), so the datasource connection layer's
   * `asDefault` idempotency guard needs this rather than a name lookup.
   */
  getDefaultDriverName(): string | undefined {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.getDefaultDriverName.call(registrationHost.of(this));
  }

  /**
   * Datasources that were declared but are NOT usable, with the reason class.
   *
   * Distinct from {@link checkDriversHealth}, which answers "can a REGISTERED
   * driver serve a query right now" and therefore cannot see these at all — a
   * datasource that never connected was never registered (framework#3827).
   */
  listUnavailableDatasources(): Array<{ name: string } & DatasourceUnavailableInfo> {
    // [#29986 codemod] The body moved to `engine-registration.ts` (see `RegistrationHost`).
    return RegistrationFacet.listUnavailableDatasources.call(registrationHost.of(this));
  }

  private assertWriteAllowed(objectName: string, operation: 'insert' | 'update' | 'delete'): void {
    // [#29986 codemod] The body moved to `engine-registration.ts`, its docblock with it (see `RegistrationHost`).
    return RegistrationFacet.assertWriteAllowed.call(registrationHost.of(this), objectName, operation);
  }

  /**
   * [#30370] Is the external write gate (ADR-0015 §5.3 Gate 3) CLOSED on
   * `objectName`? `true` exactly when every insert / update / delete on it is
   * refused `403 EXTERNAL_WRITE_FORBIDDEN`: the object sits on a federated
   * datasource (`schemaMode !== 'managed'`) and not both
   * `datasource.external.allowWrites` and `object.external.writable` opt in.
   * `false` for a managed datasource, an object with no datasource, and an
   * unknown object (the gate judges none of them).
   *
   * The write gate itself reads this same verdict, so the two can never
   * disagree. A read-only question for the effective-permission map
   * (`buildEffectiveObjectPermissions` in `@objectstack/core`), which must not
   * offer a write the data plane refuses. Holds for every caller alike: no
   * permission set, super-user bypass included, opens a closed gate.
   */
  isExternalWriteForbidden(objectName: string): boolean {
    return RegistrationFacet.isExternalWriteForbidden.call(registrationHost.of(this), objectName);
  }

  /**
   * Set the realtime service for publishing data change events.
   * Should be called after kernel resolves the realtime service.
   *
   * @param service - An IRealtimeService instance for event publishing
   */
  setRealtimeService(service: IRealtimeService): void {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.setRealtimeService.call(referencesAndMasterDetailHost.of(this), service);
  }

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
    // [#25522 cut 4] The body moved to `engine-realtime-publish.ts`, its docblock with it (see `RealtimePublishHost`).
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

  private async publishBulkDataEvent(
    action: 'updated' | 'deleted',
    object: string,
    input: { matched: unknown; context?: ExecutionContext; tenantLayer0Verdict?: unknown },
  ): Promise<void> {
    // [#25522 cut 4] The body moved to `engine-realtime-publish.ts`, its docblock with it (see `RealtimePublishHost`).
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
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.setI18nService.call(referencesAndMasterDetailHost.of(this), service);
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
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.setHomeLocalizationResolver.call(referencesAndMasterDetailHost.of(this), resolver);
  }

  private homeLocalizationResolver?: HomeLocalizationResolver;

  /**
   * [ADR-0144 D5, D7 parameter 1] What the write-time home projection reads,
   * for a caller that projects a STORED row as a write would: the serving a
   * write under `context` reads each organization's home currency and
   * timezone and the rate rows through (memoized for the serving's life), and
   * the organization a write converts a row under. The explicit recompute
   * (`recomputeHomeAmounts`, `os migrate recompute-home-amounts`) projects
   * stored rows with these and `projectHomeAmounts`, so its preview is the
   * write's own computation, never a copy of it.
   */
  homeAmountReadsFor(context?: ExecutionContext): HomeAmountReads {
    // [ADR-0144] The body lives in `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.homeAmountReadsFor.call(referencesAndMasterDetailHost.of(this), context);
  }

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

  private static homeAmountOrganizationOf(
    row: Record<string, unknown> | null | undefined,
    context: ExecutionContext | undefined,
    derived?: string | undefined,
  ): string | undefined {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it.
    return ReferencesAndMasterDetailFacet.homeAmountOrganizationOf(row, context, derived);
  }

  private previewHomeAmounts(
    object: string,
    schema: unknown,
    mode: 'insert' | 'update',
    row: Record<string, unknown>,
    image: Record<string, unknown>,
    context: ExecutionContext | undefined,
    recordId: unknown,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.previewHomeAmounts.call(referencesAndMasterDetailHost.of(this), object, schema, mode, row, image, context, recordId);
  }

  private projectHomeAmountsOntoPatch(
    object: string,
    plan: readonly HomeAmountPlanEntry[],
    prior: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown>,
    context: ExecutionContext | undefined,
    recordId: unknown,
    serving: HomeAmountServing = this.homeAmountServing(context),
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.projectHomeAmountsOntoPatch.call(referencesAndMasterDetailHost.of(this), object, plan, prior, patch, context, recordId, serving);
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

  private negotiatedMessageLocale(requested: string | undefined): string | undefined {
    // [#25522 cut 1] The body moved to `engine-validation-messages.ts`, its docblock with it (see `ValidationMessageHost`).
    const readI18nService = () => this.i18nService;
    const host: ThisParameterType<typeof negotiatedMessageLocale> = {
      get i18nService() { return readI18nService(); },
    };
    return negotiatedMessageLocale.call(host, requested);
  }

  private objectDisplayLabel(
    objectName: string,
    declaredLabel: unknown,
    ctx: { locale?: string; translate?: (key: string, locale: string, params?: Record<string, unknown>) => string },
  ): string {
    // [#25522 cut 1] The body moved to `engine-validation-messages.ts`, its docblock with it; it reads no member.
    return objectDisplayLabel(objectName, declaredLabel, ctx);
  }

  private async assertReferencesResolve(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    supplied: Record<string, unknown> | null | undefined,
    context: any,
    msgCtx?: { locale?: string; translate?: any; objectName?: string },
    storedRows?: StoredReferenceRows,
  ): Promise<void> {
    // [#25522 cut 10] The body moved to `engine-referential-integrity.ts`, its docblock with it (see `ReferentialIntegrityHost`).
    // [#30205] `referenceRow` answers a referenced user's ban state from the existence probe's own read.
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof assertReferencesResolve> = {
      get logger() { return readLogger(); },
      // [#29029] The stored rows a refused value is forgiven against are read through the caller's own door.
      find: (...a) => this.find(...a),
      callerReadableReferenceExists: (...a) => this.callerReadableReferenceExists(...a),
      callerReadableReferenceRow: (...a) => this.callerReadableReferenceRow(...a),
      referenceExists: (...a) => this.referenceExists(...a),
      referenceRow: (...a) => this.referenceRow(...a),
    };
    return assertReferencesResolve.call(host, schema, data, supplied, context, msgCtx, storedRows);
  }

  private referenceRow(target: string, id: unknown, context: ExecutionContext | undefined, extraFields: readonly string[]): Promise<Record<string, unknown> | false | null> {
    // [#30205] The body lives in `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.referenceRow.call(referencesAndMasterDetailHost.of(this), target, id, context, extraFields);
  }

  private referenceExists(target: string, id: unknown, context?: ExecutionContext): Promise<boolean | null> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.referenceExists.call(referencesAndMasterDetailHost.of(this), target, id, context);
  }

  private callerReadableReferenceExists(
    target: string,
    id: unknown,
    context: ExecutionContext | undefined,
  ): Promise<boolean | null> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.callerReadableReferenceExists.call(referencesAndMasterDetailHost.of(this), target, id, context);
  }

  private callerReadableReferenceRow(
    target: string,
    id: unknown,
    context: ExecutionContext | undefined,
    extraFields: readonly string[],
  ): Promise<Record<string, unknown> | false | null> {
    // [#29029, #30205] The body lives in `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.callerReadableReferenceRow.call(referencesAndMasterDetailHost.of(this), target, id, context, extraFields);
  }

  private async masterDetailHeadersCallerReads(
    master: string,
    ids: ReadonlyArray<unknown>,
    context: ExecutionContext | undefined,
  ): Promise<ReadonlySet<string>> {
    // [#25522 cut 10] The body moved to `engine-referential-integrity.ts`, its docblock with it (see `ReferentialIntegrityHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof masterDetailHeadersCallerReads> = {
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
    };
    return masterDetailHeadersCallerReads.call(host, master, ids, context);
  }

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
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts`, its docblock with it; it reads no member of the class.
    return settleMasterDetailLanding<H>(args);
  }

  private resolveMasterDetailParent(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRow: Record<string, unknown> | null | undefined,
    context: ExecutionContext | undefined,
  ): Promise<Record<string, unknown> | null> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.resolveMasterDetailParent.call(referencesAndMasterDetailHost.of(this), schema, data, priorRow, context);
  }

  private resolveMasterDetailParents(
    schema: any,
    data: Record<string, unknown> | null | undefined,
    priorRows: ReadonlyArray<Record<string, unknown>> | null | undefined,
    context: ExecutionContext | undefined,
  ): Promise<(row: Record<string, unknown> | undefined) => Record<string, unknown> | null> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.resolveMasterDetailParents.call(referencesAndMasterDetailHost.of(this), schema, data, priorRows, context);
  }

  private async resolvePreviewParents(
    schema: unknown,
    views: ReadonlyArray<Record<string, unknown>>,
    storedRows: ReadonlyArray<Record<string, unknown> | undefined>,
    context: ExecutionContext | undefined,
  ): Promise<{
    parents: Array<Record<string, unknown> | null>;
    previousParents: Array<Record<string, unknown> | null | undefined>;
  }> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts`, its docblock with it (see `MasterDetailRelatedHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof resolvePreviewParents> = {
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
      resolveMasterDetailParents: (...a) => this.resolveMasterDetailParents(...a),
      materializeParentHeader: (...a) => this.materializeParentHeader(...a),
    };
    return resolvePreviewParents.call(host, schema, views, storedRows, context);
  }

  private async resolvePredicateRelated(
    schema: any,
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
  ): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts`, its docblock with it (see `MasterDetailRelatedHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolvePredicateRelated> = {
      buildReferentialFieldClear: (...a) => this.buildReferentialFieldClear(...a),
      get _registry() { return readRegistry(); },
      resolveOneHopRelated: (...a) => this.resolveOneHopRelated(...a),
    };
    return resolvePredicateRelated.call(host, schema, rows, context);
  }

  private async resolveOneHopRelated(
    schema: any,
    wanted: ReadonlyMap<string, ReadonlySet<string>>,
    rows: ReadonlyArray<Record<string, unknown> | undefined | null>,
    context: unknown,
    authority: 'predicate' | 'caller',
  ): Promise<((row: Record<string, unknown> | undefined | null) => RelatedRecordBinding | undefined)> {
    // [#25522 cut 14] The body moved to `engine-master-detail-related.ts`, its docblock with it (see `MasterDetailRelatedHost`).
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

  private materializeParentHeader(master: string, row: Record<string, unknown>): Record<string, unknown> {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.materializeParentHeader.call(referencesAndMasterDetailHost.of(this), master, row);
  }

  private masterDeclaredFields(master: string): Record<string, unknown> | undefined {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.masterDeclaredFields.call(referencesAndMasterDetailHost.of(this), master);
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
    return ReferencesAndMasterDetailFacet.inspectDanglingReferences.call(referencesAndMasterDetailHost.of(this), options);
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
    return ReferencesAndMasterDetailFacet.inspectCascadeDelete.call(referencesAndMasterDetailHost.of(this), object, id);
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
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts` (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.getCascadeDeleteObjects.call(referencesAndMasterDetailHost.of(this), object);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.setCryptoProvider.call(secretsAndRoutingHost.of(this), provider);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.getKeyedDigest.call(secretsAndRoutingHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.onCryptoProviderChange.call(secretsAndRoutingHost.of(this), listener);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.setTenancyPostureProvider.call(secretsAndRoutingHost.of(this), provider);
  }

  private async encryptSecretFields(
    object: string,
    row: Record<string, unknown>,
    context: ExecutionContext | undefined,
    driverOptions: unknown,
    storedRows: StoredRowsReader,
  ): Promise<PendingSecretRow[]> {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const readCryptoProvider = () => this.cryptoProvider;
    const host: ThisParameterType<typeof encryptSecretFields> = {
      get _registry() { return readRegistry(); },
      get cryptoProvider() { return readCryptoProvider(); },
      getDriver: (...a) => this.getDriver(...a),
    };
    return encryptSecretFields.call(host, object, row, context, driverOptions, storedRows);
  }

  private async persistSecretRows(pending: readonly PendingSecretRow[], written: PendingSecretRow[]): Promise<void> {
    // [#27495] The body lives in `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
    const host: ThisParameterType<typeof persistSecretRows> = {
      getDriver: (...a) => this.getDriver(...a),
    };
    return persistSecretRows.call(host, pending, written);
  }

  private async releaseSecretHandles(
    object: string,
    slots: readonly SecretHandleSlot[],
    context: ExecutionContext | undefined,
    occasion: 'refused' | 'retired',
  ): Promise<void> {
    // [#27495] The body lives in `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
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

  private refuseEmptyPasswordFields(object: string, row: Record<string, unknown>): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof refuseEmptyPasswordFields> = {
      get _registry() { return readRegistry(); },
    };
    return refuseEmptyPasswordFields.call(host, object, row);
  }

  private maskSecretFields(object: string, rows: any): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof maskSecretFields> = {
      get _registry() { return readRegistry(); },
      omitInternalFields: (...a) => this.omitInternalFields(...a),
    };
    return maskSecretFields.call(host, object, rows);
  }

  private omitInternalFields(object: string, rows: any): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof omitInternalFields> = {
      get _registry() { return readRegistry(); },
    };
    return omitInternalFields.call(host, object, rows);
  }

  private stripSearchCompanionFromRead(
    rows: unknown,
    requestedFields: readonly string[] | undefined,
    context: ExecutionContext | undefined,
  ): void {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it; it reads no member.
    stripSearchCompanionFromRead(rows, requestedFields, context);
  }

  private privilegedReadDriverOptions(object: string): { transaction: unknown } | undefined {
    // [#25522 cut 5] The body moved to `engine-secret-internal-fields.ts`, its docblock with it (see `SecretInternalFieldsHost`).
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.getSchema.call(secretsAndRoutingHost.of(this), objectName);
  }

  private resolveObjectName(name: string): string {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts`, its docblock with it (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.resolveObjectName.call(secretsAndRoutingHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.judgeFilter.call(secretsAndRoutingHost.of(this), objectName, where, options);
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

  private isSystemLedgerObject(objectName: string): boolean {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts`, its docblock with it (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.isSystemLedgerObject.call(secretsAndRoutingHost.of(this), objectName);
  }

  private getDriver(objectName: string): IDataDriver {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts`, its docblock with it (see `DatasourceRoutingHost`).
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

  private resolveDatasourceBinding(objectName: string): {
    datasource: string;
    via: 'explicit' | 'mapping' | 'lifecycle' | 'package' | 'default';
    /** Owning package, on `via: 'package'` only — for the debug line. */
    packageId?: string;
  } | undefined {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts`, its docblock with it (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.resolveDatasourceBinding.call(secretsAndRoutingHost.of(this), objectName);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.resolveEffectiveDatasource.call(secretsAndRoutingHost.of(this), objectName);
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
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.resolveMappedDatasource.call(secretsAndRoutingHost.of(this), objectName);
  }

  private resolveDatasourceFromMapping(
    objectName: string,
    object?: any
  ): string | null {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts`, its docblock with it (see `DatasourceRoutingHost`).
    const readDatasourceMapping = () => this.datasourceMapping;
    const host: ThisParameterType<typeof resolveDatasourceFromMapping> = {
      get datasourceMapping() { return readDatasourceMapping(); },
      matchPattern: (...a) => this.matchPattern(...a),
    };
    return resolveDatasourceFromMapping.call(host, objectName, object);
  }

  private matchPattern(objectName: string, pattern: string): boolean {
    // [#25522 cut 2] The body moved to `engine-datasource-routing.ts`, its docblock with it; it reads no member.
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
  }>): void {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.setDatasourceMapping.call(secretsAndRoutingHost.of(this), rules);
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
  init(): Promise<void> {
    // [#29986 codemod] The body moved to `engine-secrets-and-routing.ts` (see `SecretsAndRoutingHost`).
    return SecretsAndRoutingFacet.init.call(secretsAndRoutingHost.of(this));
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

  private objectHasMediaField(objectSchema: any): boolean {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it.
    return MigrationStateFacet.objectHasMediaField(objectSchema);
  }
  private static readonly mediaFieldPresence = new WeakMap<object, boolean>();

  private mediaValueShapeStrictFor(objectSchema: any): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.mediaValueShapeStrictFor.call(migrationStateHost.of(this), objectSchema);
  }

  private objectHasCoveredValueField(objectSchema: any): boolean {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it.
    return MigrationStateFacet.objectHasCoveredValueField(objectSchema);
  }
  private static readonly coveredValueFieldPresence = new WeakMap<object, boolean>();

  private valueShapeStrictFor(objectSchema: any): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.valueShapeStrictFor.call(migrationStateHost.of(this), objectSchema);
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
  isFileReferencesMigrationVerified(): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts` (see `MigrationStateHost`).
    return MigrationStateFacet.isFileReferencesMigrationVerified.call(migrationStateHost.of(this));
  }

  private supplyTenantKeyCertifiedResolver(driver: IDataDriver): void {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts`, its docblock with it (see `MigrationFlagsHost`).
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

  private readFileReferencesFlagRow(): Promise<MigrationFlagRead> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts`, its docblock with it (see `MigrationFlagsHost`).
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
  haveFileColumnsMoved(): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts` (see `MigrationStateHost`).
    return MigrationStateFacet.haveFileColumnsMoved.call(migrationStateHost.of(this));
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

  private readMigrationFlagMemoized(
    slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified',
    migrationId: string,
    verifiedLog: string,
  ): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.readMigrationFlagMemoized.call(migrationStateHost.of(this), slot, migrationId, verifiedLog);
  }

  private readMigrationFlagRowMemoized(
    slot: 'fileReferencesMigrationVerified' | 'valueShapesMigrationVerified',
    migrationId: string,
    verifiedLog: string,
  ): Promise<MigrationFlagRead> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.readMigrationFlagRowMemoized.call(migrationStateHost.of(this), slot, migrationId, verifiedLog);
  }

  private async readMigrationFlagVerified(
    migrationId: string,
    verifiedLog?: string,
  ): Promise<MigrationFlagRead> {
    // [#25522 cut 13] The body moved to `engine-migration-flags.ts`, its docblock with it (see `MigrationFlagsHost`).
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
    // [#29986 codemod] The body moved to `engine-migration-state.ts` (see `MigrationStateHost`).
    return MigrationStateFacet.valueShapeViolationsAdmitted.call(migrationStateHost.of(this));
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

  private admittedViolationSink(object: string): AdmittedValueShapeViolationSink {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.admittedViolationSink.call(migrationStateHost.of(this), object);
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

  private recordObservedDeviation(migrationId: string): void {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.recordObservedDeviation.call(migrationStateHost.of(this), migrationId);
  }

  private retractCreationAttestation(migrationId: string): void {
    // [#29986 codemod] The body moved to `engine-migration-state.ts`, its docblock with it (see `MigrationStateHost`).
    return MigrationStateFacet.retractCreationAttestation.call(migrationStateHost.of(this), migrationId);
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
    // [#29986 codemod] The body moved to `engine-migration-state.ts` (see `MigrationStateHost`).
    return MigrationStateFacet.invalidateDataMigrationFlags.call(migrationStateHost.of(this));
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

  destroy(): Promise<void> {
    // [#29986 codemod] The body moved to `engine-migration-state.ts` (see `MigrationStateHost`).
    return MigrationStateFacet.destroy.call(migrationStateHost.of(this));
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

  private invalidateSummaryIndex(): void {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.invalidateSummaryIndex.call(summariesAndExpansionHost.of(this));
  }

  private buildSummaryIndex(): {
    byChild: Map<string, SummaryDescriptor[]>;
    byParent: Map<string, SummaryDescriptor[]>;
  } {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.buildSummaryIndex.call(summariesAndExpansionHost.of(this));
  }

  /** `registry.objectRevision` the cached {@link summaryIndex} was built at. */
  private summaryIndexRevision = -1;

  private ensureSummaryIndexes(): void {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.ensureSummaryIndexes.call(summariesAndExpansionHost.of(this));
  }

  private getSummaryDescriptors(childObject: string): SummaryDescriptor[] {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.getSummaryDescriptors.call(summariesAndExpansionHost.of(this), childObject);
  }

  private summaryForeignKeyColumns(childObject: string): string[] {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.summaryForeignKeyColumns.call(summariesAndExpansionHost.of(this), childObject);
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
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts` (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.getOwnedSummaryDescriptors.call(summariesAndExpansionHost.of(this), parentObject);
  }

  /**
   * [#30377] Recompute, on every parent row, the roll-up `summary` fields
   * `packageId` adds to other packages' objects by extension, writing a row
   * only where its stored value differs. An enable of a disabled package runs
   * this by itself ({@link SchemaRegistry.onPackageEnabled}): while the
   * package was disabled those fields were withheld from the roll-up index, so
   * the child writes made then recomputed nothing. Public so an operator can
   * re-run it after a failure the enable logged. Never throws on a row: each
   * failure is in the report, and logged at `error`.
   */
  refreshSummariesEnabledBy(packageId: string): Promise<SummaryEnableRefreshReport> {
    return refreshSummariesExtendedBy(this, this.logger, packageId);
  }

  /** [#30377] Resolves once the summary recomputes the enables so far started ({@link refreshSummariesEnabledBy}) have settled, so a door can answer after them. */
  summaryRefreshSettled(): Promise<void> {
    return summaryRefreshesSettled(this);
  }

  private initializeSummaryFields(object: string, record: any): any {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.initializeSummaryFields.call(summariesAndExpansionHost.of(this), object, record);
  }

  private recomputeSummaries(
    childObject: string,
    records: any,
    previous: any,
    execCtx?: ExecutionContext,
  ): Promise<SummaryRecomputeFailure[]> {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.recomputeSummaries.call(summariesAndExpansionHost.of(this), childObject, records, previous, execCtx);
  }

  private expandRelatedRecords(
    objectName: string,
    records: any[],
    expand: Record<string, QueryAST>,
    depth: number = 0,
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    // [#29986 codemod] The body moved to `engine-summaries-and-expansion.ts`, its docblock with it (see `SummariesAndExpansionHost`).
    return SummariesAndExpansionFacet.expandRelatedRecords.call(summariesAndExpansionHost.of(this), objectName, records, expand, depth, execCtx);
  }

  private async serveReferenceNames(
    objectName: string,
    records: any[],
    fieldName: string,
    referenceObject: string,
    execCtx?: ExecutionContext,
  ): Promise<void> {
    // The body lives in `engine-reference-name-visible.ts`, its docblock with it (see `ReferenceNameVisibleHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof serveReferenceNames> = {
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
      find: (...a) => this.find(...a),
      resolveReadableIdsSecurity: (...a) => this.resolveReadableIdsSecurity(...a),
      formulaReadsReference,
    };
    return serveReferenceNames.call(host, objectName, records, fieldName, referenceObject, execCtx);
  }

  private async resolveFileReferences(
    objectName: string,
    records: any[],
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts`, its docblock with it (see `FileReferenceHydrationHost`).
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

  private async callerMayReadSysFile(execCtx?: ExecutionContext): Promise<boolean> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts`, its docblock with it (see `FileReferenceHydrationHost`).
    const host: ThisParameterType<typeof callerMayReadSysFile> = {
      resolveReadableIdsSecurity: (...a) => this.resolveReadableIdsSecurity(...a),
    };
    return callerMayReadSysFile.call(host, execCtx);
  }

  private async serveRefusedFileHydration(
    objectName: string,
    records: any[],
    fileFields: string[],
    uniqueIds: string[],
    execCtx?: ExecutionContext,
  ): Promise<any[]> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts`, its docblock with it (see `FileReferenceHydrationHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof serveRefusedFileHydration> = {
      readParentDerivedFiles: (...a) => this.readParentDerivedFiles(...a),
      get logger() { return readLogger(); },
    };
    return serveRefusedFileHydration.call(host, objectName, records, fileFields, uniqueIds, execCtx);
  }

  private async servableFileRows(objectName: string, rows: any[]): Promise<Map<string, any>> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts`, its docblock with it (see `FileReferenceHydrationHost`).
    const readHeldFileResolver = () => this._heldFileResolver;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof servableFileRows> = {
      get _heldFileResolver() { return readHeldFileResolver(); },
      get logger() { return readLogger(); },
    };
    return servableFileRows.call(host, objectName, rows);
  }

  private async readParentDerivedFiles(
    objectName: string,
    records: any[],
    uniqueIds: string[],
    execCtx?: ExecutionContext,
  ): Promise<Map<string, { ownerId: string; row: any | null }>> {
    // [#25522 cut 11] The body moved to `engine-file-reference-hydration.ts`, its docblock with it (see `FileReferenceHydrationHost`).
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

  private async resolveWhereTokens(
    ast: QueryAST | undefined,
    execCtx: ExecutionContext | undefined,
    lowering: FilterLoweringOptions,
    position: 'where' | 'having' = 'where',
    operation = 'find',
  ): Promise<void> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts`, its docblock with it (see `QueryLoweringHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof resolveWhereTokens> = {
      get _registry() { return readRegistry(); },
      resolveRelateThenLowerWhere: (...a) => this.resolveRelateThenLowerWhere(...a),
    };
    return resolveWhereTokens.call(host, ast, execCtx, lowering, position, operation);
  }

  private resolveRelateThenLowerWhere<W>(
    object: string,
    operation: string,
    where: W,
    execCtx: ExecutionContext | undefined,
    lowering: FilterLoweringOptions,
  ): Promise<W> {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return (FindFacet.resolveRelateThenLowerWhere<W>).call(findHost.of(this), object, operation, where, execCtx, lowering);
  }

  /**
   * [#20802] The registry's declared schema of a related object, by name —
   * what the `where` door admits a nested-relation condition's keys against.
   */
  private readonly relatedSchemaOf = (name: string): unknown => this._registry.getObject(name);

  private async lowerRelationConditions<W>(
    object: string,
    operation: string,
    where: W,
    execCtx: ExecutionContext | undefined,
  ): Promise<W> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts`, its docblock with it (see `QueryLoweringHost`).
    const readRegistry = () => this._registry;
    const readRelatedSchemaOf = () => this.relatedSchemaOf;
    const host: ThisParameterType<typeof lowerRelationConditions> = {
      get _registry() { return readRegistry(); },
      get relatedSchemaOf() { return readRelatedSchemaOf(); },
      find: (...a) => this.find(...a),
    };
    return (lowerRelationConditions<W>).call(host, object, operation, where, execCtx);
  }

  private withResolvedWhere<T extends { where?: unknown; context?: ExecutionContext } | undefined>(
    object: string,
    operation: string,
    options: T,
    lowering: FilterLoweringOptions,
  ): Promise<T> {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return (FindFacet.withResolvedWhere<T>).call(findHost.of(this), object, operation, options, lowering);
  }

  private expandSearchOnAst(
    ast: QueryAST,
    schema: ServiceObject | undefined,
    context: ExecutionContext | undefined,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return FindFacet.expandSearchOnAst.call(findHost.of(this), ast, schema, context);
  }

  private async resolveSearchQueryableFields(
    object: string,
    context: ExecutionContext | undefined,
  ): Promise<ReadonlySet<string> | undefined> {
    // [#25522 cut 20] The body moved to `engine-query-lowering.ts`, its docblock with it (see `QueryLoweringHost`).
    const readSecurityServiceSourceSlot = () => (this as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT];
    const host: ThisParameterType<typeof resolveSearchQueryableFields> = {
      get [SECURITY_SERVICE_SOURCE_SLOT]() { return readSecurityServiceSourceSlot(); },
    };
    return resolveSearchQueryableFields.call(host, object, context);
  }

  private expandSearchOnOptions<T extends EngineAggregateOptions | EngineCountOptions>(
    object: string,
    query: T,
    options: EngineReadOptions | undefined,
  ): Promise<T> {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return (FindFacet.expandSearchOnOptions<T>).call(findHost.of(this), object, query, options);
  }

  private fillQueryAstDefaults<T extends Pick<QueryInput, 'orderBy' | 'search' | 'expand'>>(
    query: T,
  ): T & Pick<QueryAST, 'orderBy' | 'search'> & { expand?: Record<string, QueryAST> } {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return (FindFacet.fillQueryAstDefaults<T>).call(findHost.of(this), query);
  }

  private requireFindOnePredicate(object: string, ast: QueryAST): void {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it.
    return FindFacet.requireFindOnePredicate(object, ast);
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
      // The driver is handed `driverOptions` — the declared driver options and
      // nothing else; `input.options` stays the hooks' additive view of the bag.
      const driverOptions = this.buildDriverOptions(object, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);
      // [ADR-0139 D2] The executor boundary: the AST is final here — after the
      // doors, the middleware chain and `beforeFind` — so every `ReadableIds`
      // leaf is composed (or refused) on it, immediately before the driver.
      const driverAst = await this.composeReadableIdsAtBoundary(object, 'find', hookContext.input.ast as QueryAST, opCtx.context);

      try {
          let result = await driver.find(object, driverAst, driverOptions);

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

  private reportFindFailure(object: string, error: unknown): void {
    // [#29986 codemod] The body moved to `engine-find.ts`, its docblock with it (see `FindHost`).
    return FindFacet.reportFindFailure.call(findHost.of(this), object, error);
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
      // The driver is handed `driverOptions` alone, as in `find`.
      const driverOptions = this.buildDriverOptions(objectName, opCtx.context, hookContext.input.options as any, { recordedVerdict: opCtx.tenantLayer0Verdict });
      hookContext.input.options = mergeDriverOptionsIntoHookView(hookContext.input.options, driverOptions);
      // [ADR-0139 D2] The executor boundary, as in `find`.
      const driverAst = await this.composeReadableIdsAtBoundary(objectName, 'findOne', hookContext.input.ast as QueryAST, opCtx.context);

      let result = await driver.findOne(objectName, driverAst, driverOptions);

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
    // [#29986 codemod] The body moved to `engine-insert.ts`, its docblock with it (see `InsertHost`).
    return InsertFacet.staticReadonlyCreateStrip.call(insertHost.of(this), object, readonlySubject, row, supplied, context, pass);
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

  private updateByIdExpecting(
    driver: IDataDriver,
    object: string,
    id: unknown,
    data: Record<string, unknown>,
    expect: Readonly<Record<string, unknown>>,
    options: Parameters<IDataDriver['findOne']>[2],
  ): Promise<unknown> {
    // [#29986 codemod] The body moved to `engine-insert.ts`, its docblock with it (see `InsertHost`).
    return InsertFacet.updateByIdExpecting.call(insertHost.of(this), driver, object, id, data, expect, options);
  }

  /** [ADR-0142 D4] Set once the precondition's no-`updateMany` degradation has been logged. */
  private preconditionDegradedWarned = false;

  /** [ADR-0142 D5] The assignment seam, built on first use. */
  private assignmentEvaluator?: AssignmentRuleEvaluator;

  private ownershipQueueService(): AssignmentQueueService | null {
    // [#29986 codemod] The body moved to `engine-insert.ts`, its docblock with it (see `InsertHost`).
    return InsertFacet.ownershipQueueService.call(insertHost.of(this));
  }

  private assignment(): AssignmentRuleEvaluator {
    // [#29986 codemod] The body moved to `engine-insert.ts` (see `InsertHost`).
    return InsertFacet.assignment.call(insertHost.of(this));
  }

  private readUpdatePriorRow(
    object: string,
    id: unknown,
    context: ExecutionContext | undefined,
    base?: unknown,
  ): Promise<Record<string, unknown> | null> {
    // [#29986 codemod] The body moved to `engine-insert.ts` (see `InsertHost`).
    return InsertFacet.readUpdatePriorRow.call(insertHost.of(this), object, id, context, base);
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
  insertMany(object: string, rows: any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<InsertManyRowOutcome[]> {
    // [#29986 codemod] The body moved to `engine-insert.ts` (see `InsertHost`).
    return InsertFacet.insertMany.call(insertHost.of(this), object, rows, options);
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

  private planCascadeAtomicity(object: string): 'none' | 'split' | 'atomic' {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.planCascadeAtomicity.call(cascadePlanningHost.of(this), object);
  }

  private warnCascadeNotAtomic(object: string): void {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.warnCascadeNotAtomic.call(cascadePlanningHost.of(this), object);
  }

  private referenceProbeFilter(
    fieldName: string,
    fdef: { type?: unknown; multiple?: unknown },
    id: string | number,
  ): Record<string, unknown> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`, its docblock with it.
    return referenceProbeFilter(fieldName, fdef, id);
  }

  private static storedReferenceIncludes(stored: unknown, id: string | number): boolean {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.storedReferenceIncludes(stored, id);
  }

  private static remainderAfterMemberRemoval(
    stored: unknown,
    id: string | number,
    cleared?: ReadonlySet<string>,
  ): unknown[] {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.remainderAfterMemberRemoval(stored, id, cleared);
  }

  private static referenceCheckContext(context?: ExecutionContext): ExecutionContext {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.referenceCheckContext(context);
  }

  private recordReferenceCheckElevation(
    object: string,
    id: string | number,
    childName: string,
    fieldName: string,
    context?: ExecutionContext,
  ): void {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`, its docblock with it (see `DeleteCascadeHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof recordReferenceCheckElevation> = {
      get logger() { return readLogger(); },
    };
    return recordReferenceCheckElevation.call(host, object, id, childName, fieldName, context);
  }

  private dependentCountIsDisclosable(
    childName: string,
    probeWhere: Record<string, unknown>,
    probedIds: readonly string[],
    fieldName: string,
    multiValued: boolean,
    id: string | number,
    context?: ExecutionContext,
  ): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.dependentCountIsDisclosable.call(cascadePlanningHost.of(this), childName, probeWhere, probedIds, fieldName, multiValued, id, context);
  }

  private cascadeDeleteRelations(
    object: string,
    ids: ReadonlyArray<string | number>,
    context?: ExecutionContext,
    depth = 0,
    onCollected?: (set: CascadeDeleteSet) => Promise<void>,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.cascadeDeleteRelations.call(cascadePlanningHost.of(this), object, ids, context, depth, onCollected);
  }

  /**
   * [#30237, ADR-0148 D3] What the host handed over for the recycle bin's
   * retention: its resolver and the token to call it with. `undefined` until
   * {@link setRecycleBinRetention}: `OS_RECYCLE_BIN_RETENTION_DAYS`, else 30.
   */
  private recycleBinRetention: RecycleBinRetentionSettings | undefined;

  /** [#30237] The recycle bin's once-per-engine notices already given. */
  private readonly recycleBinNotices = new Set<string>();

  /**
   * [#30237, ADR-0148 D3] Install the host's retention resolver and the opaque
   * token it is called with (the one its `resolveFeatures` receives). The
   * engine asks once per delete operation that enters the bin and stamps the
   * answer on the entry; `ObjectQLPlugin` calls this from its
   * `recycleBinRetention` option.
   */
  setRecycleBinRetention(settings: RecycleBinRetentionSettings | undefined): void {
    this.recycleBinRetention = settings;
  }

  private openRecycleBinCapture(
    object: string,
    id: string | number,
    context: ExecutionContext | undefined,
    predicate: boolean,
  ): RecycleBinCapture | undefined {
    // [#30237] The body lives in `recycle-bin/capture.ts`, its docblock with it (see `RecycleBinCaptureHost`).
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const readCascadeDeleteSets = () => this.cascadeDeleteSets;
    const readRetention = () => this.recycleBinRetention;
    const readNotices = () => this.recycleBinNotices;
    const host: ThisParameterType<typeof openRecycleBinCapture> = {
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
      get cascadeDeleteSets() { return readCascadeDeleteSets(); },
      get recycleBinRetention() { return readRetention(); },
      get recycleBinNotices() { return readNotices(); },
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
    };
    return openRecycleBinCapture.call(host, object, id, context, predicate);
  }

  /**
   * [#27004] How many records of one object a single dependents probe asks
   * about: the predicate arm's `$in` delete batch, so neither statement
   * outgrows a driver's bind-parameter limit.
   */
  private static readonly REFERENCE_PROBE_BATCH = 500;

  private async collectCascadeDeleteSet(
    object: string,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    opts: { fileElevations: boolean } = { fileElevations: true },
  ): Promise<CascadeDeleteSet> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`, its docblock with it (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof collectCascadeDeleteSet> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
      fileReferenceCheckElevation: (...a) => this.fileReferenceCheckElevation(...a),
      probeReferencingRowsOfSet: (...a) => this.probeReferencingRowsOfSet(...a),
    };
    return collectCascadeDeleteSet.call(host, object, ids, context, objects, opts);
  }

  private cascadeRelationBehavior(
    object: string,
    child: ServiceObject,
    fieldName: string,
    fdef: any,
  ): string | undefined {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.cascadeRelationBehavior.call(cascadePlanningHost.of(this), object, child, fieldName, fdef);
  }

  private fileReferenceCheckElevation(
    set: CascadeDeleteSet,
    object: string,
    id: string | number,
    childName: string,
    fieldName: string,
    context: ExecutionContext | undefined,
  ): void {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.fileReferenceCheckElevation.call(cascadePlanningHost.of(this), set, object, id, childName, fieldName, context);
  }

  private probeReferencingRows(
    childName: string,
    fieldName: string,
    fdef: any,
    id: string | number | ReadonlyArray<string | number>,
    probeWhere: Record<string, unknown>,
    context: ExecutionContext | undefined,
  ): Promise<any[]> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.probeReferencingRows.call(cascadePlanningHost.of(this), childName, fieldName, fdef, id, probeWhere, context);
  }

  private referenceProbeFilterOfSet(
    fieldName: string,
    fdef: { type?: unknown; multiple?: unknown },
    ids: ReadonlyArray<string | number>,
  ): Record<string, unknown> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.referenceProbeFilterOfSet.call(cascadePlanningHost.of(this), fieldName, fdef, ids);
  }

  private probeReferencingRowsOfSet(
    childName: string,
    fieldName: string,
    fdef: any,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
  ): Promise<Map<string, any[]>> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.probeReferencingRowsOfSet.call(cascadePlanningHost.of(this), childName, fieldName, fdef, ids, context);
  }

  private walkReferencingRelations(
    object: string,
    ids: ReadonlyArray<string | number>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    cascadeSet: CascadeDeleteSet,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.walkReferencingRelations.call(cascadePlanningHost.of(this), object, ids, context, objects, cascadeSet);
  }

  private async refuseRestrictsInsideOwnCascade(
    cascadeSet: CascadeDeleteSet,
    roots: ReadonlyArray<{ object: string; id: string | number }>,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
  ): Promise<void> {
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`, its docblock with it (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof refuseRestrictsInsideOwnCascade> = {
      cascadeRelationBehavior: (...a) => this.cascadeRelationBehavior(...a),
      fileReferenceCheckElevation: (...a) => this.fileReferenceCheckElevation(...a),
      probeReferencingRowsOfSet: (...a) => this.probeReferencingRowsOfSet(...a),
      deleteRestrictedError: (...a) => this.deleteRestrictedError(...a),
      referenceProbeFilter: (...a) => this.referenceProbeFilter(...a),
    };
    return refuseRestrictsInsideOwnCascade.call(host, cascadeSet, roots, context, objects);
  }

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
    // [#25522 cut 19] The body moved to `engine-delete-cascade.ts`, its docblock with it (see `DeleteCascadeHost`).
    const host: ThisParameterType<typeof deleteRestrictedError> = {
      validationMessageContext: (...a) => this.validationMessageContext(...a),
      dependentCountIsDisclosable: (...a) => this.dependentCountIsDisclosable(...a),
      objectDisplayLabel: (...a) => this.objectDisplayLabel(...a),
    };
    return deleteRestrictedError.call(host, args);
  }

  private isTenantColumnSetNull(
    object: string,
    child: ServiceObject,
    fieldName: string,
    behavior: string | undefined,
  ): boolean {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.isTenantColumnSetNull(object, child, fieldName, behavior);
  }

  private static outlivesOrganization(child: ServiceObject): boolean {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.outlivesOrganization(child);
  }

  private static keepsOrganizationReference(child: ServiceObject, fieldName: string): boolean {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.keepsOrganizationReference(child, fieldName);
  }

  private countReferencingRowsOutside(
    childName: string,
    fieldName: string,
    fdef: any,
    id: string | number,
    cascadeSet: CascadeDeleteSet,
    context: ExecutionContext | undefined,
  ): Promise<{ where: Record<string, unknown>; count: number }> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.countReferencingRowsOutside.call(cascadePlanningHost.of(this), childName, fieldName, fdef, id, cascadeSet, context);
  }

  private static organizationCountContext(context?: ExecutionContext): ExecutionContext {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it.
    return CascadePlanningFacet.organizationCountContext(context);
  }

  private organizationCountIsDisclosable(
    childName: string,
    where: Record<string, unknown>,
    count: number,
    context: ExecutionContext | undefined,
  ): Promise<boolean> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.organizationCountIsDisclosable.call(cascadePlanningHost.of(this), childName, where, count, context);
  }

  private refuseOrganizationDeleteWhileOwned(
    id: string | number,
    context: ExecutionContext | undefined,
    objects: ServiceObject[],
    cascadeSet: CascadeDeleteSet,
  ): Promise<void> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts`, its docblock with it (see `CascadePlanningHost`).
    return CascadePlanningFacet.refuseOrganizationDeleteWhileOwned.call(cascadePlanningHost.of(this), id, context, objects, cascadeSet);
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
  organizationOwnedRowCounts(
    organizationId: string,
    options?: { exclude?: Iterable<string>; context?: ExecutionContext },
  ): Promise<Array<{ object: string; count: number }>> {
    // [#29986 codemod] The body moved to `engine-cascade-planning.ts` (see `CascadePlanningHost`).
    return CascadePlanningFacet.organizationOwnedRowCounts.call(cascadePlanningHost.of(this), organizationId, options);
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
              // the capture's compensation otherwise. A caller's `multi: true`
              // opens none, even here: the lifecycle sweep reaps by id with it.
              const runByIdDelete = async (writeContext?: ExecutionContext) => {
                const bin = this.openRecycleBinCapture(object, hookContext.input.id as string | number, writeContext, options?.multi === true);
                await this.cascadeDeleteRelations(object, [hookContext.input.id as string | number], writeContext, 0, bin?.onCollected)
                  .catch((e: unknown) => { throw cascadeStoppedRefusal(e, object); });
                const entry = await bin?.write();
                try {
                  return await driver.delete(
                    object,
                    hookContext.input.id as string,
                    this.buildDriverOptions(object, writeContext, hookContext.input.options as any),
                  );
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
    // [#29986 codemod] The body moved to `engine-delete-and-aggregate.ts` (see `DeleteAndAggregateHost`).
    return DeleteAndAggregateFacet.assertNoInternalFieldEvaluated.call(deleteAndAggregateHost.of(this), object, query, options);
  }

  private rejectCredentialAggregation(object: string, query: EngineAggregateOptions): void {
    // [#25522 cut 18] The body moved to `engine-count-aggregate.ts`, its docblock with it (see `CountAggregateHost`).
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof rejectCredentialAggregation> = {
      get _registry() { return readRegistry(); },
    };
    return rejectCredentialAggregation.call(host, object, query);
  }

  aggregate(object: string, query: EngineAggregateOptions, options?: EngineReadOptions): Promise<any[]> {
    // [#29986 codemod] The body moved to `engine-delete-and-aggregate.ts` (see `DeleteAndAggregateHost`).
    return DeleteAndAggregateFacet.aggregate.call(deleteAndAggregateHost.of(this), object, query, options);
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
  transaction<T>(
    callback: (trxCtx: any, info: EngineTransactionInfo) => Promise<T>,
    baseContext?: any,
    opts?: EngineTransactionOptions,
  ): Promise<T> {
    // [#29986 codemod] The body moved to `engine-transactions-section.ts` (see `TransactionsSectionHost`).
    return (TransactionsSectionFacet.transaction<T>).call(transactionsSectionHost.of(this), callback, baseContext, opts);
  }

  private runOpenedUnit<T>(trx: unknown, owner: IDataDriver, body: () => Promise<T>): Promise<T> {
    // [#29986 codemod] The body moved to `engine-transactions-section.ts`, its docblock with it (see `TransactionsSectionHost`).
    return (TransactionsSectionFacet.runOpenedUnit<T>).call(transactionsSectionHost.of(this), trx, owner, body);
  }

  private isClosedUnitHandle(handle: unknown): boolean {
    // [#29986 codemod] The body moved to `engine-transactions-section.ts`, its docblock with it (see `TransactionsSectionHost`).
    return TransactionsSectionFacet.isClosedUnitHandle.call(transactionsSectionHost.of(this), handle);
  }

  private newTransactionScope(owner: IDataDriver): TransactionScope {
    // [#29986 codemod] The body moved to `engine-transactions-section.ts`, its docblock with it (see `TransactionsSectionHost`).
    return TransactionsSectionFacet.newTransactionScope.call(transactionsSectionHost.of(this), owner);
  }

  private datasourceNameOf(driver: IDataDriver): string {
    // [#29986 codemod] The body moved to `engine-transactions-section.ts`, its docblock with it (see `TransactionsSectionHost`).
    return TransactionsSectionFacet.datasourceNameOf.call(transactionsSectionHost.of(this), driver);
  }

  private warnTransactionUnsupported(datasource: string | undefined, declaredUnsupported = false): void {
    // [#25522 cut 7] The body moved to `engine-execute-transactions.ts`, its docblock with it (see `ExecuteTransactionsHost`).
    const readTransactionUnsupportedReported = () => this.transactionUnsupportedReported;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof warnTransactionUnsupported> = {
      get transactionUnsupportedReported() { return readTransactionUnsupportedReported(); },
      get logger() { return readLogger(); },
    };
    return warnTransactionUnsupported.call(host, datasource, declaredUnsupported);
  }

  private enforceTransactionOrigin(
    objectName: string,
    driver: IDataDriver,
    operation: 'insert' | 'update' | 'delete',
  ): void {
    // [#25522 cut 7] The body moved to `engine-execute-transactions.ts`, its docblock with it (see `ExecuteTransactionsHost`).
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
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.unregisterObject.call(compatibilitySectionHost.of(this), name, packageId);
  }

  /**
   * Get an object definition by name.
   * Alias for getSchema() — matches @objectql/core API.
   */
  getObject(name: string): ServiceObject | undefined {
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.getObject.call(compatibilitySectionHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.getDriverByName.call(compatibilitySectionHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.getDriverForObject.call(compatibilitySectionHost.of(this), objectName);
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
  dropObjectSchema(objectName: string): Promise<void> {
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.dropObjectSchema.call(compatibilitySectionHost.of(this), objectName);
  }

  /**
   * Get a registered driver by datasource name.
   * Alias matching @objectql/core datasource() API.
   *
   * @throws Error if the datasource is not found
   */
  datasource(name: string): IDataDriver {
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.datasource.call(compatibilitySectionHost.of(this), name);
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
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.on.call(compatibilitySectionHost.of(this), event, objectName, handler, packageId);
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
  close(): Promise<void> {
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.close.call(compatibilitySectionHost.of(this));
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
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts` (see `CompatibilitySectionHost`).
    return CompatibilitySectionFacet.createContext.call(compatibilitySectionHost.of(this), ctx);
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
  static create(config: {
    datasources?: Record<string, IDataDriver>;
    objects?: Record<string, ServiceObject>;
    hooks?: Array<{ event: string; object: string; handler: (ctx: HookContext) => Promise<void> | void }>;
  }): Promise<ObjectQL> {
    // [#29986 codemod] The body moved to `engine-compatibility-section.ts`.
    return CompatibilitySectionFacet.create(config);
  }

  // [#29986 codemod] Fills `ObjectQLStatics` (declared above the class) for the facet modules.
  static {
    Object.defineProperties(ObjectQLStatics, {
      MAX_CASCADE_DEPTH: { get: () => ObjectQL.MAX_CASCADE_DEPTH },
      MAX_EXPAND_DEPTH: { get: () => ObjectQL.MAX_EXPAND_DEPTH },
      REFERENCE_PROBE_BATCH: { get: () => ObjectQL.REFERENCE_PROBE_BATCH },
      coveredValueFieldPresence: { get: () => ObjectQL.coveredValueFieldPresence },
      homeAmountOrganizationOf: { value: (...args: Parameters<typeof ObjectQL.homeAmountOrganizationOf>) => ObjectQL.homeAmountOrganizationOf(...args) },
      keepsOrganizationReference: { value: (...args: Parameters<typeof ObjectQL.keepsOrganizationReference>) => ObjectQL.keepsOrganizationReference(...args) },
      mediaFieldPresence: { get: () => ObjectQL.mediaFieldPresence },
      organizationCountContext: { value: (...args: Parameters<typeof ObjectQL.organizationCountContext>) => ObjectQL.organizationCountContext(...args) },
      outlivesOrganization: { value: (...args: Parameters<typeof ObjectQL.outlivesOrganization>) => ObjectQL.outlivesOrganization(...args) },
      referenceCheckContext: { value: (...args: Parameters<typeof ObjectQL.referenceCheckContext>) => ObjectQL.referenceCheckContext(...args) },
      remainderAfterMemberRemoval: { value: (...args: Parameters<typeof ObjectQL.remainderAfterMemberRemoval>) => ObjectQL.remainderAfterMemberRemoval(...args) },
      storedReferenceIncludes: { value: (...args: Parameters<typeof ObjectQL.storedReferenceIncludes>) => ObjectQL.storedReferenceIncludes(...args) },
    });
  }

  // [#29986 codemod] Installs each facet's host factory (`engine-facet-hosts.ts`): a static block adds
  // no member to the class, so the published `.d.ts` does not move.
  static {
    actionsHost.install((engine) => ({
      get actionActivation() { return engine.actionActivation; },
      get actions() { return engine.actions; },
      get logger() { return engine.logger; },
      get registry() { return engine.registry; },
    }));
    cascadePlanningHost.install((engine) => ({
      get _registry() { return engine._registry; },
      get cascadeDeleteSets() { return engine.cascadeDeleteSets; },
      get cascadeIssuedDeletes() { return engine.cascadeIssuedDeletes; },
      get cascadeNotAtomicReported() { return engine.cascadeNotAtomicReported; },
      cascadeRelationBehavior: (...a) => engine.cascadeRelationBehavior(...a),
      collectCascadeDeleteSet: (...a) => engine.collectCascadeDeleteSet(...a),
      count: (...a) => engine.count(...a),
      countReferencingRowsOutside: (...a) => engine.countReferencingRowsOutside(...a),
      get defaultDriver() { return engine.defaultDriver; },
      delete: (...a) => engine.delete(...a),
      deleteRestrictedError: (...a) => engine.deleteRestrictedError(...a),
      get drivers() { return engine.drivers; },
      fileReferenceCheckElevation: (...a) => engine.fileReferenceCheckElevation(...a),
      find: (...a) => engine.find(...a),
      getDriver: (...a) => engine.getDriver(...a),
      isTenantColumnSetNull: (...a) => engine.isTenantColumnSetNull(...a),
      get logger() { return engine.logger; },
      organizationCountIsDisclosable: (...a) => engine.organizationCountIsDisclosable(...a),
      probeReferencingRows: (...a) => engine.probeReferencingRows(...a),
      probeReferencingRowsOfSet: (...a) => engine.probeReferencingRowsOfSet(...a),
      recordReferenceCheckElevation: (...a) => engine.recordReferenceCheckElevation(...a),
      referenceProbeFilter: (...a) => engine.referenceProbeFilter(...a),
      referenceProbeFilterOfSet: (...a) => engine.referenceProbeFilterOfSet(...a),
      refuseOrganizationDeleteWhileOwned: (...a) => engine.refuseOrganizationDeleteWhileOwned(...a),
      refuseRestrictsInsideOwnCascade: (...a) => engine.refuseRestrictsInsideOwnCascade(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      update: (...a) => engine.update(...a),
      walkReferencingRelations: (...a) => engine.walkReferencingRelations(...a),
    }));
    compatibilitySectionHost.install((engine) => ({
      get _registry() { return engine._registry; },
      destroy: (...a) => engine.destroy(...a),
      get drivers() { return engine.drivers; },
      facade: engine,
      getDriver: (...a) => engine.getDriver(...a),
      getDriverForObject: (...a) => engine.getDriverForObject(...a),
      getSchema: (...a) => engine.getSchema(...a),
      registerHook: (...a) => engine.registerHook(...a),
    }));
    defaultsAndAutonumbersHost.install((engine) => ({
      adoptExplicitAutonumber: (...a) => engine.adoptExplicitAutonumber(...a),
      applyAutonumbers: (...a) => engine.applyAutonumbers(...a),
      get autonumberCounters() { return engine.autonumberCounters; },
      get autonumberReadersUnservedReported() { return engine.autonumberReadersUnservedReported; },
      defaultFieldEntries: (...a) => engine.defaultFieldEntries(...a),
      facade: engine,
      find: (...a) => engine.find(...a),
      getSchema: (...a) => engine.getSchema(...a),
      isIssuedAutonumberCollision: (...a) => engine.isIssuedAutonumberCollision(...a),
      get logger() { return engine.logger; },
      normalizeExpressionDefault: (...a) => engine.normalizeExpressionDefault(...a),
      resolveNowDefault: (...a) => engine.resolveNowDefault(...a),
      resolveOptionDefault: (...a) => engine.resolveOptionDefault(...a),
      seedAutonumber: (...a) => engine.seedAutonumber(...a),
      validationMessageContext: (...a) => engine.validationMessageContext(...a),
    }));
    deleteAndAggregateHost.install((engine) => ({
      get _registry() { return engine._registry; },
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      composeReadableIdsAtBoundary: (...a) => engine.composeReadableIdsAtBoundary(...a),
      executeWithMiddleware: (...a) => engine.executeWithMiddleware(...a),
      expandSearchOnOptions: (...a) => engine.expandSearchOnOptions(...a),
      getDriver: (...a) => engine.getDriver(...a),
      get logger() { return engine.logger; },
      rejectCredentialAggregation: (...a) => engine.rejectCredentialAggregation(...a),
      get relatedSchemaOf() { return engine.relatedSchemaOf; },
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      resolveWhereTokens: (...a) => engine.resolveWhereTokens(...a),
    }));
    findHost.install((engine) => ({
      get _registry() { return engine._registry; },
      expandSearchOnAst: (...a) => engine.expandSearchOnAst(...a),
      fillQueryAstDefaults: (...a) => engine.fillQueryAstDefaults(...a),
      get logger() { return engine.logger; },
      lowerRelationConditions: (...a) => engine.lowerRelationConditions(...a),
      resolveRelateThenLowerWhere: (...a) => engine.resolveRelateThenLowerWhere(...a),
      resolveSearchQueryableFields: (...a) => engine.resolveSearchQueryableFields(...a),
    }));
    hooksAndFunctionsHost.install((engine) => ({
      get _defaultActionRunner() { return engine._defaultActionRunner; },
      set _defaultActionRunner(v) { engine._defaultActionRunner = v; },
      get _defaultBodyRunner() { return engine._defaultBodyRunner; },
      set _defaultBodyRunner(v) { engine._defaultBodyRunner = v; },
      get defaultDriver() { return engine.defaultDriver; },
      get drivers() { return engine.drivers; },
      facade: engine,
      get functions() { return engine.functions; },
      getDriver: (...a) => engine.getDriver(...a),
      get hooks() { return engine.hooks; },
      isClosedUnitHandle: (...a) => engine.isClosedUnitHandle(...a),
      get logger() { return engine.logger; },
      get residualOwnerSources() { return engine.residualOwnerSources; },
      get txStore() { return engine.txStore; },
    }));
    insertHost.install((engine) => ({
      get _registry() { return engine._registry; },
      applyFieldDefaults: (...a) => engine.applyFieldDefaults(...a),
      get assignmentEvaluator() { return engine.assignmentEvaluator; },
      set assignmentEvaluator(v) { engine.assignmentEvaluator = v; },
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      count: (...a) => engine.count(...a),
      facade: engine,
      find: (...a) => engine.find(...a),
      getDriver: (...a) => engine.getDriver(...a),
      insert: (...a) => engine.insert(...a),
      get logger() { return engine.logger; },
      ownershipQueueService: (...a) => engine.ownershipQueueService(...a),
      get preconditionDegradedWarned() { return engine.preconditionDegradedWarned; },
      set preconditionDegradedWarned(v) { engine.preconditionDegradedWarned = v; },
      resolveDefaultPermissions: (...a) => engine.resolveDefaultPermissions(...a),
      update: (...a) => engine.update(...a),
    }));
    middlewareAndContextHost.install((engine) => ({
      get _registry() { return engine._registry; },
      get authzInvalidationBinding() { return engine.authzInvalidationBinding; },
      set authzInvalidationBinding(v) { engine.authzInvalidationBinding = v; },
      get authzInvalidationDetach() { return engine.authzInvalidationDetach; },
      set authzInvalidationDetach(v) { engine.authzInvalidationDetach = v; },
      get cascadeIssuedDeletes() { return engine.cascadeIssuedDeletes; },
      detachAuthzInvalidationPubSub: (...a) => engine.detachAuthzInvalidationPubSub(...a),
      find: (...a) => engine.find(...a),
      getDriver: (...a) => engine.getDriver(...a),
      get logger() { return engine.logger; },
      get middlewares() { return engine.middlewares; },
      get organizationProbeMemo() { return engine.organizationProbeMemo; },
      set organizationProbeMemo(v) { engine.organizationProbeMemo = v; },
      probeInstallOrganizations: (...a) => engine.probeInstallOrganizations(...a),
      resolveEnginePosture: (...a) => engine.resolveEnginePosture(...a),
      get txStore() { return engine.txStore; },
      get writeEpoch() { return engine.writeEpoch; },
    }));
    migrationStateHost.install((engine) => ({
      get _registry() { return engine._registry; },
      get admittedValueShapeViolations() { return engine.admittedValueShapeViolations; },
      get creationAttestationRetraction() { return engine.creationAttestationRetraction; },
      set creationAttestationRetraction(v) { engine.creationAttestationRetraction = v; },
      get deviationRecording() { return engine.deviationRecording; },
      set deviationRecording(v) { engine.deviationRecording = v; },
      get drivers() { return engine.drivers; },
      get fileReferencesMigrationVerified() { return engine.fileReferencesMigrationVerified; },
      set fileReferencesMigrationVerified(v) { engine.fileReferencesMigrationVerified = v; },
      findOne: (...a) => engine.findOne(...a),
      invalidateDataMigrationFlags: (...a) => engine.invalidateDataMigrationFlags(...a),
      isFileReferencesMigrationVerified: (...a) => engine.isFileReferencesMigrationVerified(...a),
      isValueShapesMigrationVerified: (...a) => engine.isValueShapesMigrationVerified(...a),
      get logger() { return engine.logger; },
      get migrationGatesAnnounced() { return engine.migrationGatesAnnounced; },
      set migrationGatesAnnounced(v) { engine.migrationGatesAnnounced = v; },
      noteAdmittedValueShapeViolation: (...a) => engine.noteAdmittedValueShapeViolation(...a),
      objectHasCoveredValueField: (...a) => engine.objectHasCoveredValueField(...a),
      objectHasMediaField: (...a) => engine.objectHasMediaField(...a),
      readFileReferencesFlagRow: (...a) => engine.readFileReferencesFlagRow(...a),
      readMigrationFlagRowMemoized: (...a) => engine.readMigrationFlagRowMemoized(...a),
      readMigrationFlagVerified: (...a) => engine.readMigrationFlagVerified(...a),
      get recordedDeviations() { return engine.recordedDeviations; },
      get retractedCreationAttestations() { return engine.retractedCreationAttestations; },
      unregisterDriver: (...a) => engine.unregisterDriver(...a),
      update: (...a) => engine.update(...a),
      get valueShapesMigrationVerified() { return engine.valueShapesMigrationVerified; },
      set valueShapesMigrationVerified(v) { engine.valueShapesMigrationVerified = v; },
      wasDatastoreCreatedFromEmpty: (...a) => engine.wasDatastoreCreatedFromEmpty(...a),
    }));
    referencesAndMasterDetailHost.install((engine) => ({
      get _registry() { return engine._registry; },
      cascadeRelationBehavior: (...a) => engine.cascadeRelationBehavior(...a),
      collectCascadeDeleteSet: (...a) => engine.collectCascadeDeleteSet(...a),
      find: (...a) => engine.find(...a),
      findOne: (...a) => engine.findOne(...a),
      homeAmountServing: (...a) => engine.homeAmountServing(...a),
      get homeLocalizationResolver() { return engine.homeLocalizationResolver; },
      set homeLocalizationResolver(v) { engine.homeLocalizationResolver = v; },
      get i18nService() { return engine.i18nService; },
      set i18nService(v) { engine.i18nService = v; },
      get logger() { return engine.logger; },
      masterDeclaredFields: (...a) => engine.masterDeclaredFields(...a),
      masterDetailHeadersCallerReads: (...a) => engine.masterDetailHeadersCallerReads(...a),
      materializeParentHeader: (...a) => engine.materializeParentHeader(...a),
      get realtimeService() { return engine.realtimeService; },
      set realtimeService(v) { engine.realtimeService = v; },
      referenceExists: (...a) => engine.referenceExists(...a),
      referenceRow: (...a) => engine.referenceRow(...a),
      resolveEnginePosture: (...a) => engine.resolveEnginePosture(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
    }));
    registrationHost.install((engine) => ({
      get _registry() { return engine._registry; },
      applyExternalDriverFloor: (...a) => engine.applyExternalDriverFloor(...a),
      convertPackageBodyForward: (...a) => engine.convertPackageBodyForward(...a),
      get datasourceDefs() { return engine.datasourceDefs; },
      get defaultDriver() { return engine.defaultDriver; },
      set defaultDriver(v) { engine.defaultDriver = v; },
      get drivers() { return engine.drivers; },
      haveFileColumnsMoved: (...a) => engine.haveFileColumnsMoved(...a),
      invalidateSummaryIndex: (...a) => engine.invalidateSummaryIndex(...a),
      get logger() { return engine.logger; },
      get manifests() { return engine.manifests; },
      registerDatasourceDef: (...a) => engine.registerDatasourceDef(...a),
      registerMetadataCollections: (...a) => engine.registerMetadataCollections(...a),
      registerPackageBody: (...a) => engine.registerPackageBody(...a),
      registerPlugin: (...a) => engine.registerPlugin(...a),
      resolveNavObjectNames: (...a) => engine.resolveNavObjectNames(...a),
      supplyFileColumnsMovedResolver: (...a) => engine.supplyFileColumnsMovedResolver(...a),
      supplyTenantKeyCertifiedResolver: (...a) => engine.supplyTenantKeyCertifiedResolver(...a),
      get unavailableDatasources() { return engine.unavailableDatasources; },
    }));
    secretsAndRoutingHost.install((engine) => ({
      get _registry() { return engine._registry; },
      get cryptoProvider() { return engine.cryptoProvider; },
      set cryptoProvider(v) { engine.cryptoProvider = v; },
      get cryptoProviderListeners() { return engine.cryptoProviderListeners; },
      get datasourceMapping() { return engine.datasourceMapping; },
      set datasourceMapping(v) { engine.datasourceMapping = v; },
      get defaultDriver() { return engine.defaultDriver; },
      get drivers() { return engine.drivers; },
      get logger() { return engine.logger; },
      get manifests() { return engine.manifests; },
      get relatedSchemaOf() { return engine.relatedSchemaOf; },
      resolveDatasourceBinding: (...a) => engine.resolveDatasourceBinding(...a),
      resolveDatasourceFromMapping: (...a) => engine.resolveDatasourceFromMapping(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      get tenancyPostureProvider() { return engine.tenancyPostureProvider; },
      set tenancyPostureProvider(v) { engine.tenancyPostureProvider = v; },
    }));
    securityResolversHost.install((engine) => ({
      get _effectiveObjectPermissionsResolver() { return engine._effectiveObjectPermissionsResolver; },
      set _effectiveObjectPermissionsResolver(v) { engine._effectiveObjectPermissionsResolver = v; },
      get _fieldOwnedFileReadAuthorizer() { return engine._fieldOwnedFileReadAuthorizer; },
      set _fieldOwnedFileReadAuthorizer(v) { engine._fieldOwnedFileReadAuthorizer = v; },
      get _heldFileResolver() { return engine._heldFileResolver; },
      set _heldFileResolver(v) { engine._heldFileResolver = v; },
      get _registry() { return engine._registry; },
      get _writeGateProbe() { return engine._writeGateProbe; },
      set _writeGateProbe(v) { engine._writeGateProbe = v; },
      get _writeWallVerdict() { return engine._writeWallVerdict; },
      set _writeWallVerdict(v) { engine._writeWallVerdict = v; },
      composeReadableIdsChain: (...a) => engine.composeReadableIdsChain(...a),
      facade: engine,
      formulaFaultSink: (...a) => engine.formulaFaultSink(...a),
      get formulaHopReads() { return engine.formulaHopReads; },
      formulaOptionLabels: (...a) => engine.formulaOptionLabels(...a),
      hasObjectMiddleware: (...a) => engine.hasObjectMiddleware(...a),
      get i18nService() { return engine.i18nService; },
      get insertRecomputeListeners() { return engine.insertRecomputeListeners; },
      get logger() { return engine.logger; },
      permissionResolution: (...a) => engine.permissionResolution(...a),
      get readableIdsSecurityReported() { return engine.readableIdsSecurityReported; },
      reportFormulaFault: (...a) => engine.reportFormulaFault(...a),
      resolveDatasourceBinding: (...a) => engine.resolveDatasourceBinding(...a),
      resolveFormulaPermissions: (...a) => engine.resolveFormulaPermissions(...a),
      resolveFormulaRelated: (...a) => engine.resolveFormulaRelated(...a),
      resolveOneHopRelated: (...a) => engine.resolveOneHopRelated(...a),
      resolveReadableIdsSecurity: (...a) => engine.resolveReadableIdsSecurity(...a),
      uncomposableReadableIdsParent: (...a) => engine.uncomposableReadableIdsParent(...a),
    }));
    summariesAndExpansionHost.install((engine) => ({
      get _registry() { return engine._registry; },
      buildSummaryIndex: (...a) => engine.buildSummaryIndex(...a),
      ensureSummaryIndexes: (...a) => engine.ensureSummaryIndexes(...a),
      expandRelatedRecords: (...a) => engine.expandRelatedRecords(...a),
      facade: engine,
      find: (...a) => engine.find(...a),
      getOwnedSummaryDescriptors: (...a) => engine.getOwnedSummaryDescriptors(...a),
      getSummaryDescriptors: (...a) => engine.getSummaryDescriptors(...a),
      invalidateSummaryIndex: (...a) => engine.invalidateSummaryIndex(...a),
      get logger() { return engine.logger; },
      serveReferenceNames: (...a) => engine.serveReferenceNames(...a),
      get summaryIndex() { return engine.summaryIndex; },
      set summaryIndex(v) { engine.summaryIndex = v; },
      get summaryIndexByParent() { return engine.summaryIndexByParent; },
      set summaryIndexByParent(v) { engine.summaryIndexByParent = v; },
      get summaryIndexRevision() { return engine.summaryIndexRevision; },
      set summaryIndexRevision(v) { engine.summaryIndexRevision = v; },
      get summaryRetryOptions() { return engine.summaryRetryOptions; },
      update: (...a) => engine.update(...a),
    }));
    transactionsSectionHost.install((engine) => ({
      datasourceNameOf: (...a) => engine.datasourceNameOf(...a),
      get defaultDriver() { return engine.defaultDriver; },
      get drivers() { return engine.drivers; },
      newTransactionScope: (...a) => engine.newTransactionScope(...a),
      get openedUnits() { return engine.openedUnits; },
      runOpenedUnit: (...a) => engine.runOpenedUnit(...a),
      get txStore() { return engine.txStore; },
      warnTransactionUnsupported: (...a) => engine.warnTransactionUnsupported(...a),
    }));
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

  find(query: any = {}): Promise<any[]> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.find.call(objectRepositoryHost.of(this), query);
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
  findOne(query: any = {}): Promise<Record<string, any> | null> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.findOne.call(objectRepositoryHost.of(this), query);
  }

  insert(data: any): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.insert.call(objectRepositoryHost.of(this), data);
  }

  /** Alias for insert() — matches @objectql/core convention */
  create(data: any): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.create.call(objectRepositoryHost.of(this), data);
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
  update(data: any, options: any = {}): Promise<Record<string, any> | number | null> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.update.call(objectRepositoryHost.of(this), data, options);
  }

  /** Update a single record by ID */
  updateById(id: string | number, data: any): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.updateById.call(objectRepositoryHost.of(this), id, data);
  }

  delete(options: any = {}): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.delete.call(objectRepositoryHost.of(this), options);
  }

  /** Delete a single record by ID */
  deleteById(id: string | number): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.deleteById.call(objectRepositoryHost.of(this), id);
  }

  count(query: any = {}): Promise<number> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.count.call(objectRepositoryHost.of(this), query);
  }

  /** Aggregate query */
  aggregate(query: any = {}): Promise<any[]> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.aggregate.call(objectRepositoryHost.of(this), query);
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
  execute(actionName: string, params?: any): Promise<any> {
    // [#30052 codemod] The body moved to `engine-object-repository.ts` (see `ObjectRepositoryHost`).
    return ObjectRepositoryFacet.execute.call(objectRepositoryHost.of(this), actionName, params);
  }

  // [#30052 codemod] Installs the host of `ObjectRepositoryFacet` (`engine-scoped-hosts.ts`): a static
  // block adds no member to the class, so the published `.d.ts` does not move.
  static {
    objectRepositoryHost.install((instance) => ({
      get context() { return instance.context; },
      get engine() { return instance.engine; },
      insert: (...a) => instance.insert(...a),
      get objectName() { return instance.objectName; },
    }));
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
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.object.call(scopedContextHost.of(this), name);
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
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.sudo.call(scopedContextHost.of(this));
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
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.withRunAs.call(scopedContextHost.of(this), runAs, ref);
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

  private releaseJoinedHandle(handle: unknown): boolean {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts`, its docblock with it (see `ScopedContextHost`).
    return ScopedContextFacet.releaseJoinedHandle.call(scopedContextHost.of(this), handle);
  }

  private txDriver(): any | undefined {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts`, its docblock with it (see `ScopedContextHost`).
    return ScopedContextFacet.txDriver.call(scopedContextHost.of(this));
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
  beginTransaction(): Promise<{ ctx: ScopedContext; handle: unknown; owned: boolean } | null> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.beginTransaction.call(scopedContextHost.of(this));
  }

  /**
   * Commit a handle obtained from {@link beginTransaction}.
   *
   * ABSTAINS for a JOINED handle (#6406): committing a transaction this context
   * did not open would land the inner writes early and take the outcome away
   * from the outer owner — the durability half of the D2 defect.
   */
  commitTransaction(handle: unknown): Promise<void> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.commitTransaction.call(scopedContextHost.of(this), handle);
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
  rollbackTransaction(handle: unknown): Promise<void> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.rollbackTransaction.call(scopedContextHost.of(this), handle);
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
  serveFormulaField(objectName: string, record: Record<string, unknown>, field: string): Promise<unknown> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.serveFormulaField.call(scopedContextHost.of(this), objectName, record, field);
  }

  // [#30052 codemod] Installs the host of `ScopedContextFacet` (`engine-scoped-hosts.ts`): a static
  // block adds no member to the class, so the published `.d.ts` does not move.
  static {
    scopedContextHost.install((instance) => ({
      get appAuthored() { return instance.appAuthored; },
      derive: (...a) => instance.derive(...a),
      get engine() { return instance.engine; },
      get executionContext() { return instance.executionContext; },
      get joinedHandles() { return instance.joinedHandles; },
      releaseJoinedHandle: (...a) => instance.releaseJoinedHandle(...a),
      txDriver: (...a) => instance.txDriver(...a),
    }));
  }
}
