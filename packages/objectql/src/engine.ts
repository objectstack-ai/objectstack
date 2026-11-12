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
import { parseAutonumberFormat } from '@objectstack/spec/data';
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
  stripSearchCompanionFromRead,
  type PendingSecretRow,
  type SecretHandleSlot,
  type StoredRowsReader,
} from './engine-secret-internal-fields.js';
// [#30237, ADR-0148] The recycle bin's write side: the capture body, and the
// retention seam the host hands over (`RecycleBinCaptureHost`).
import { openRecycleBinCapture, type RecycleBinCapture } from './recycle-bin/capture.js';
import { emptyRecycleBin, purgeRecycleBinEntry, type RecycleBinRemovalOptions } from './recycle-bin/purge.js';
import type { RecycleBinRetentionSettings } from './recycle-bin/retention.js';
import { restoreRecycleBinEntry, type RecycleBinRestoreOptions, type RecycleBinRestoreResult } from './recycle-bin/restore.js';
import { listRecycleBin, type RecycleBinDeleteObservability, type RecycleBinListOptions, type RecycleBinListResult } from './recycle-bin/list.js';
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
import { formulaReadsReference, serveReferenceNames } from './engine-reference-name-visible.js';
// [#25522 cut 12] The driver options every driver call receives, and the tenancy
// posture and Layer 0 verdict they are scoped by; the methods of the same names
// below hand each body the members it reads (`DriverOptionsHost`).
import { buildDriverOptions, driverReadScope, driverWriteTarget, engineLayer0Verdict, resolveEnginePosture, wallExemptedOperation } from './engine-driver-options.js';
// [#25522 cut 13] The `sys_migration` flag reads, the certification question a
// driver is handed, and the admitted-violation tally and boot advisory; the
// methods of the same names below hand each body the members it reads (`MigrationFlagsHost`).
import { announceOpenMigrationGates, isOrganizationOwnershipCertified, isValueShapesMigrationVerified, noteAdmittedValueShapeViolation, readFileReferencesFlagRow, readMigrationFlagVerified, supplyTenantKeyCertifiedResolver, wasDatastoreCreatedFromEmpty } from './engine-migration-flags.js';
import { ExecutionContext, type InstalledPackageSource } from '@objectstack/spec/kernel';
// [#27884] The stored-row read gate, registered on the family's tables below.
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
  type PackageScopedHolderSource,
  RUNTIME_COMPATIBILITY_PACKAGE_ID,
  type RetryOptions,
} from '@objectstack/core';
import { WriteEpoch } from './write-epoch.js';
import { SummaryRecomputeError, type SummaryRecomputeFailure } from './summary-errors.js';
import { TransactionUnsupportedError } from './transaction-errors.js';
import {
  type SummaryDescriptor,
} from './summary-aggregate.js';
import { refreshSummariesExtendedBy, summaryRefreshesSettled, type SummaryEnableRefreshReport } from './summary-enable-refresh.js';
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
import { AssignmentRuleEvaluator, type AssignmentQueueService } from './assignment-rules.js';
// [#8682] The write-path loggers' redaction — bound values never reach the log.
// [#21274] …and its boundary face — nor the error that leaves the engine.
// [#21385] It lives in `@objectstack/types` now, so `driver-sql`'s own log lines
// call the same cut; nothing about it changed in the move.
// [#8844] The runtime half of #8686's ruling: a system-context write on a
// tenant-scoped object resolves the install's organization the way a session
// write does, or is refused rather than filed under the `__global__`
// pseudo-tenant. The decision is a pure function of measured facts; this file
// supplies the facts and turns a `refuse` into the throw.
import {
  type SystemWriteOrganizationDecision,
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
import {
  type HomeAmountPlanEntry,
  type HomeAmountReads,
  type HomeAmountServing,
  type HomeLocalizationResolver,
} from './home-amount-projection.js';
import { SchemaRegistry, type ArtifactInstallScope } from './registry.js';
import { type EvalError, type EvalOptionLabels, type EvalPermissions } from '@objectstack/formula';
// [commit 3c1bbd2a8] The ONE spelling of "which object does an aggregated `defineView`
// container bind to", imported rather than re-spelled — from the LEAF subpath,
// for the reason the `/errors` import above states (commit 3bd9b3498). See
// `resolveMetadataItemName` below for why this registrar lost its fourth copy.
// [#20331] The divergent view-container `name` refusal — the ONE judge this
// registrar and `os validate` both call.
import { type BindHooksOptions } from './hook-binder.js';
import type { AdmittedValueShapeViolation, AdmittedValueShapeViolationSink, ValidationMessageContext } from './validation/record-validator.js';
import type { RelatedRecordBinding } from './validation/rule-validator.js';
import { stripReadonlyFields, staticReadonlyInsertSubject } from './validation/rule-validator.js';
// [#14088] The before-phase write recorder — the provenance channel the static
// `readonly` strip needs to tell a hook's write from a caller's echo of the
// SAME value. Armed and sealed in `update()`; the module owns the argument for
// why neither end may move.
// [commit 706ad0fcc] The hide pass's other half: when a hook faults reaching THROUGH a
// key that pass withheld, this names the key, says the platform withheld it,
// and points at `ctx.previous` — the module owns the measurement and the
// reason the explanation cannot be composed any further downstream.
import { UnscopedHookApi, SEED_USER_GRANTS, APP_AUTHORED_HOOK_API, type HookRunAs, type HookRunAsRef, type RunAsDerivableApi } from './hook-run-as.js';
// [#6457] The master-detail header a `parent`-scoped predicate reads is made
// total over the MASTER's declared fields before it leaves this engine — the
// same helper every other server seam materialises with (#1871/#4649/#4953).
// [#21571] The declared column set — the read verbs' default projection, their
// explicit-projection filter and the write path's undeclared-key door, one list.
// [#21777] "Is this schema the remote's?" One predicate, shared with the boot sync.
// [#21910, #21918] And its injected-column refinement, which both cascade walks ask.
// [#27277] The correctness floor over a plugin driver on an external datasource.
// [#25522 cut 14] The master-detail landing, the preview's parents and the
// related reads a validation rule makes; the methods of the same names below
// hand each body the members it reads (`MasterDetailRelatedHost`). Imported after
// every module those bodies import, so the engine's module evaluation order
// is what it was.
import { priorMasterIdsCallerReads, resolveOneHopRelated, resolvePredicateRelated, resolvePreviewParents, settleMasterDetailLanding } from './engine-master-detail-related.js';
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
  DISPATCHABLE_HOOK_EVENTS, SECURITY_SERVICE_SOURCE_SLOT, assertDispatchableHookEvent, assertValidHookExcludeObjects,
  planStoredExpressions,
} from './engine-top-level.js';
import type {
  AdmittedValueShapeViolationTally, AutonumberReaders, CascadeDeleteSet, CascadeIssuedDelete, DatasourceDef,
  EngineMiddleware, EngineReadOptions, FieldOwnedFileReadAuthorizer, FormulaFaultSink, FormulaPlanEntry,
  FormulaRelated, FunctionEntry, FunctionRegistrationOptions, HeldFileResolver, HookEntry, HookHandler,
  IssuedAutonumber, MigrationFlagRead, OperationContext, PermissionResolution, ReadableIdsChain, ReadableIdsSecurity,
  ReadableIdsSecurityResolution, TransactionScope, UnservableControlledByParentMaster, WriteWallVerdict,
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
import { ActionsFacet, type ActionHandlerEntry, type ExecuteActionOptions } from './engine-actions.js';
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
// [#29986 codemod] Update: the methods of the same names below hand the bodies what they read (`UpdateHost`).
import { UpdateFacet } from './engine-update.js';
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
  summariesAndExpansionHost, transactionsSectionHost, updateHost,
} from './engine-facet-hosts.js';
// [#30052 codemod] Repository bound to one object and one execution context: the methods of the same names on `ObjectRepository` hand the bodies what they read (`ObjectRepositoryHost`).
import { ObjectRepositoryFacet } from './engine-object-repository.js';
// [#30052 codemod] Scoped execution context: repositories, elevation, transactions: the methods of the same names on `ScopedContext` hand the bodies what they read (`ScopedContextHost`).
import { ScopedContextFacet } from './engine-scoped-context.js';
// [#30052 codemod] The scoped facets' hosts, one per instance, which each class's static block builds.
import { objectRepositoryHost, scopedContextHost } from './engine-scoped-hosts.js';
import { captureStoredExpressions, type StoredExpressionCapture } from './stored-expression-backfill.js';

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

  // Action registry: key = "objectName:actionName" — the UNQUALIFIED slot, what
  // a call that names no package runs ([ADR-0150 D5, #31697]: two packages
  // on one key, and a package beside host code or a plugin on the object-less
  // key, are refused, `executeAction`).
  private actions = new Map<string, ActionHandlerEntry>();

  // [ADR-0150 D4, #31673] The action engine keyed `(package, objectName, name)`:
  // package coordinate (`actionHandlerCoordinate`) → "objectName:actionName" →
  // that package's handler. A call that names its package reads it.
  private packageActions = new Map<string, Map<string, ActionHandlerEntry>>();

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

  // [ADR-0150 D4, #31716] The same registrations by holder: function name →
  // registering package (the owner read as its package id; `null` for an
  // owner-less registration) → that package's entry. `functions` above keeps
  // one entry per name, the last-registered; this keeps every holder, so a
  // referrer's function can be resolved in its package
  // (`resolvePackageScopedFunction` over `functionHoldersOf`).
  private functionHolders = new Map<string, Map<string | null, FunctionEntry>>();

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
    // [#29986 codemod] The body moved to `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    this.logger = HooksAndFunctionsFacet.constructLogger(hostContext);
    HooksAndFunctionsFacet.construct.call(hooksAndFunctionsHost.of(this));
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

  /**
   * Every holder of the function `name` (ADR-0150 D4): each package that
   * registered one under that name, with its own entry, and an owner-less
   * registration as the platform's item (`platformItem`: code a plugin or
   * the host registers, in every caller's reach like `sys`) — the holder set
   * `resolvePackageScopedFunction` resolves a flow `script` node's function
   * over, in the calling flow's package. A snapshot, taken at the call. The flow
   * `script` node resolves through it (#32073), and `bindHooksToEngine` reads
   * a hook's own package's entry from it. `resolveFunction` and
   * `resolveFunctionEntry` keep answering the one last-registered entry per
   * name.
   */
  functionHoldersOf(name: string): PackageScopedHolderSource<Readonly<FunctionEntry>> {
    // [#31716] The body lives in `engine-hooks-and-functions.ts` (see `HooksAndFunctionsHost`).
    return HooksAndFunctionsFacet.functionHoldersOf.call(hooksAndFunctionsHost.of(this), name);
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
   *
   * [ADR-0150 D4, #31673] Handlers are keyed `(package, objectName, name)`.
   * `options.packageId` names the package coordinate the caller resolved the
   * action's declaration to (`resolveActionByPackage`; `''` the environment's
   * own): that package's handler runs, else the one handler registered under
   * the key when there is exactly one, else nothing (the "not found" miss).
   * Omitted, the call names no package: it runs the handler registered under
   * `objectName:actionName`, except that it is refused `409 RESOURCE_CONFLICT`
   * naming every owner — never the last registration — when two or more
   * packages hold a handler under the key (epic ruling record 6729825528,
   * letter A), or when the key is object-less and a package holds one beside
   * host code or a plugin (the G2 obligation, record 6742974046). Host code or
   * a plugin beside one package on an object-bound key keeps the last
   * registration (ADR-0150 D5, #31697; epic ruling record 6762267053).
   */
  executeAction(objectName: string, actionName: string, ctx: any, options?: ExecuteActionOptions): Promise<any> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.executeAction.call(actionsHost.of(this), objectName, actionName, ctx, options);
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
   *
   * [ADR-0150 D4, #31673] With `options.packageId`, the handlers a call naming
   * that package dispatches (`executeAction`'s package-keyed answer), one per
   * key, each with the `coordinate` whose slot holds it, so a reader gating
   * that call judges the handler it runs. Without it,
   * the unqualified slot, as before.
   */
  listRegisteredActions(options?: ExecuteActionOptions): Array<{ objectName: string; actionName: string; package?: string; coordinate?: string }> {
    // [#29986 codemod] The body moved to `engine-actions.ts` (see `ActionsHost`).
    return ActionsFacet.listRegisteredActions.call(actionsHost.of(this), options);
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

  /**
   * [#32527] Capture `object`'s stored computed fields before a metadata door
   * makes a change to it live, and hand back the fill that change owes:
   * {@link StoredExpressionCapture.fillChanged}, called once the change is
   * served, fills every stored row of each stored computed field that now
   * computes something new (added, turned from a formula, its expression
   * changed) with the write's own computation — `stored-expression-backfill.ts`
   * carries the contract. The metadata protocol reaches it through its host
   * engine, which cannot import this package.
   */
  captureStoredExpressions(object: string): StoredExpressionCapture {
    return captureStoredExpressions(this, this.logger, object);
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
    action: 'created' | 'updated' | 'deleted' | 'restored',
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

  private homeAmountServing(context: ExecutionContext | undefined): HomeAmountServing {
    // [#29986 codemod] The body moved to `engine-references-and-master-detail.ts`, its docblock with it (see `ReferencesAndMasterDetailHost`).
    return ReferencesAndMasterDetailFacet.homeAmountServing.call(referencesAndMasterDetailHost.of(this), context);
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
    serving?: HomeAmountServing,
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

  private async priorMasterIdsCallerReads(
    schema: unknown,
    rows: ReadonlyArray<Record<string, unknown> | null | undefined>,
    context: ExecutionContext | undefined,
  ): Promise<Array<{ readonly id: string | number | undefined } | null>> {
    // The body lives in `engine-master-detail-related.ts`, its docblock with it (see `MasterDetailRelatedHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof priorMasterIdsCallerReads> = {
      find: (...a) => this.find(...a),
      get logger() { return readLogger(); },
    };
    return priorMasterIdsCallerReads.call(host, schema, rows, context);
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

  /**
   * [ADR-0131 D9] The organization a SYSTEM-context write that carries none
   * resolves to on this engine — the decision its own system insert makes
   * (`resolveSystemInsertOrganization`), from the same three inputs: the
   * posture in force (the injected tenancy-posture accessor, else the
   * deployment's), the install's organizations (the memoised probe, capped at
   * two), and whether this composition registers `sys_organization` at all.
   * The predicate is `@objectstack/core`'s `resolveSystemWriteOrganization`,
   * never a second spelling of it.
   *
   * For a caller that runs system work with no organization of its own and
   * wants to carry, ahead of its writes, the organization those writes would
   * be stamped with — a job that declares no `organization` resolves its pull's
   * context here, so the pull's reads scope by the organization its writes
   * land in. Not a write and not a gate: it refuses nothing itself. A `refuse`
   * decision is the answer the write would turn into its refusal, and the
   * write stays the one that refuses.
   *
   * A probe that could not run (an outage, not an empty table) propagates, as
   * it does on the insert.
   */
  systemWriteOrganization(): Promise<SystemWriteOrganizationDecision> {
    // [#31823] The body lives in `engine-middleware-and-context.ts` (see `MiddlewareAndContextHost`).
    return MiddlewareAndContextFacet.systemWriteOrganization.call(middlewareAndContextHost.of(this));
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
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof encryptSecretFields> = {
      get _registry() { return readRegistry(); },
      get cryptoProvider() { return readCryptoProvider(); },
      get logger() { return readLogger(); },
      getDriver: (...a) => this.getDriver(...a),
      // A ref on a non-system write is compared against its own rows as the caller's read door serves them.
      find: (...a) => this.find(...a),
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

  find(object: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<any[]> {
    // [#29986 codemod] The body moved to `engine-find.ts` (see `FindHost`).
    return FindFacet.find.call(findHost.of(this), object, query, options);
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
  findOne(objectName: string, query?: EngineQueryOptions, options?: EngineReadOptions): Promise<Record<string, any> | null> {
    // [#29986 codemod] The body moved to `engine-find.ts` (see `FindHost`).
    return FindFacet.findOne.call(findHost.of(this), objectName, query, options);
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
      homeAmountServing: (...a) => this.homeAmountServing(...a),
      find: (...a) => this.find(...a),
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
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
  insert(object: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any> {
    // [#29986 codemod] The body moved to `engine-insert.ts` (see `InsertHost`).
    return InsertFacet.insert.call(insertHost.of(this), object, data, options);
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
  update(object: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<Record<string, any> | number | null> {
    // [#29986 codemod] The body moved to `engine-update.ts` (see `UpdateHost`).
    return UpdateFacet.update.call(updateHost.of(this), object, data, options);
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
    skip: boolean,
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
    return openRecycleBinCapture.call(host, object, id, context, skip);
  }

  /**
   * [#30237, ADR-0148 D1] Purge one recycle-bin entry: its rows can no longer be
   * restored. `true` when the entry was removed; `false` when no entry with that
   * id is visible to the caller's organization, or the composition registers no
   * bin (`PlatformObjectsPlugin`).
   *
   * Authorized as the `purge` operation on the object the entry's rows belong
   * to, the recycle-bin manager's verb (`@objectstack/plugin-security` maps it
   * to `manageRecycleBin`). A caller the tenant wall denies sees no entry. The
   * body lives in `recycle-bin/purge.ts`, its docblock with it.
   */
  purge(entryId: string | number, options?: RecycleBinRemovalOptions): Promise<boolean> {
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof purgeRecycleBinEntry> = {
      get _registry() { return readRegistry(); },
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      executeWithMiddleware: (...a) => this.executeWithMiddleware(...a),
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return purgeRecycleBinEntry.call(host, entryId, options);
  }

  /**
   * [#30237, ADR-0148 D1] Empty the recycle bin of one object: remove every
   * entry of `object` the caller's organization holds, and answer how many.
   * `0` when the composition registers no bin. A platform object (`sys_`,
   * `cloud_`, `ai_`) is refused `400`: the bin never takes one.
   *
   * One `purge` operation on `object`, so one authorization covers the act,
   * as for {@link purge}. The body lives in `recycle-bin/purge.ts`.
   */
  empty(object: string, options?: RecycleBinRemovalOptions): Promise<number> {
    const readRegistry = () => this._registry;
    const host: ThisParameterType<typeof emptyRecycleBin> = {
      get _registry() { return readRegistry(); },
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      executeWithMiddleware: (...a) => this.executeWithMiddleware(...a),
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return emptyRecycleBin.call(host, object, options);
  }

  /**
   * [#30237, ADR-0148 D2] Restore one recycle-bin entry: write its rows back
   * under their original ids, the master first, with `created_by` /
   * `created_at` as they were and no insert hook run; re-link the references
   * the delete cleared that nothing has changed since; recompute roll-ups; and
   * publish `data.record.restored` for every row. The entry is removed. Answers
   * what came back, or `null` when no entry with that id is visible to the
   * caller's organization, or the composition registers no bin.
   *
   * The entry is the unit: a restore that would write over a live row, under
   * a parent that is not there, or into an object that no longer exists is
   * refused `409` (`RESTORE_UNIQUE_VALUE_TAKEN`, `RESTORE_PARENT_PURGED`,
   * `RESTORE_PARENT_IN_RECYCLE_BIN`, `RESTORE_PACKAGE_UNINSTALLED`) and writes
   * nothing.
   *
   * Authorized as the `restore` operation on the object of the entry's master
   * row (`@objectstack/plugin-security` maps it to `allowRestoreOwnDeleted`);
   * a caller then restores only an entry it deleted unless it holds
   * `manageRecycleBin` on the object, asked of the registered
   * effective-permission resolver and refused when none answers. The body
   * lives in `recycle-bin/restore.ts`, its docblock with it.
   */
  restore(entryId: string | number, options?: RecycleBinRestoreOptions): Promise<RecycleBinRestoreResult | null> {
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const readResolver = () => this._effectiveObjectPermissionsResolver;
    const host: ThisParameterType<typeof restoreRecycleBinEntry> = {
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
      get effectiveObjectPermissionsResolver() { return readResolver(); },
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      executeWithMiddleware: (...a) => this.executeWithMiddleware(...a),
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
      transaction: (...a) => this.transaction(...a),
      update: (...a) => this.update(...a),
      recomputeSummaries: (...a) => this.recomputeSummaries(...a),
      publishDataEvent: (...a) => this.publishDataEvent(...a),
    };
    return restoreRecycleBinEntry.call(host, entryId, options);
  }

  /**
   * [#30237, ADR-0148 D5] One page of the recycle-bin entries of `object` that
   * the caller's organization holds, newest first, each with its snapshot.
   * An empty page when the composition registers no bin or the tenant wall
   * denies the caller; a platform object is refused `400`.
   *
   * Listing is the recycle-bin manager's: a caller whose effective permissions
   * do not grant `manageRecycleBin` on `object` is refused `403
   * PERMISSION_DENIED`, and so is every caller when no effective-permission
   * resolver answers. The snapshot is served unmasked; field-level security is
   * the caller's to apply. The body lives in `recycle-bin/list.ts`, its
   * docblock with it.
   */
  listRecycleBin(object: string, options?: RecycleBinListOptions): Promise<RecycleBinListResult> {
    const readRegistry = () => this._registry;
    const readLogger = () => this.logger;
    const readResolver = () => this._effectiveObjectPermissionsResolver;
    const host: ThisParameterType<typeof listRecycleBin> = {
      get _registry() { return readRegistry(); },
      get logger() { return readLogger(); },
      get effectiveObjectPermissionsResolver() { return readResolver(); },
      getDriver: (...a) => this.getDriver(...a),
      buildDriverOptions: (...a) => this.buildDriverOptions(...a),
      engineLayer0Verdict: (...a) => this.engineLayer0Verdict(...a),
    };
    return listRecycleBin.call(host, object, options);
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

  delete(object: string, options?: EngineDeleteOptions & RecycleBinDeleteObservability): Promise<boolean | number> {
    // [#29986 codemod] The body moved to `engine-delete-and-aggregate.ts` (see `DeleteAndAggregateHost`).
    return DeleteAndAggregateFacet.delete.call(deleteAndAggregateHost.of(this), object, options);
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
    packageId: string = RUNTIME_COMPATIBILITY_PACKAGE_ID,
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
      get packageActions() { return engine.packageActions; },
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
      assertBulkPerRowHookBudget: (...a) => engine.assertBulkPerRowHookBudget(...a),
      assertWriteAllowed: (...a) => engine.assertWriteAllowed(...a),
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      buildHookApi: (...a) => engine.buildHookApi(...a),
      buildPerRowAfterContexts: (...a) => engine.buildPerRowAfterContexts(...a),
      buildProvenance: (...a) => engine.buildProvenance(...a),
      buildSession: (...a) => engine.buildSession(...a),
      buildUser: (...a) => engine.buildUser(...a),
      cascadeDeleteRelations: (...a) => engine.cascadeDeleteRelations(...a),
      claimReferentialCascadeDelete: (...a) => engine.claimReferentialCascadeDelete(...a),
      composeReadableIdsAtBoundary: (...a) => engine.composeReadableIdsAtBoundary(...a),
      delete: (...a) => engine.delete(...a),
      dispatchPerRowBeforeHooks: (...a) => engine.dispatchPerRowBeforeHooks(...a),
      dispatchUnscopedMultiWriteHooks: (...a) => engine.dispatchUnscopedMultiWriteHooks(...a),
      enforceTransactionOrigin: (...a) => engine.enforceTransactionOrigin(...a),
      executeWithMiddleware: (...a) => engine.executeWithMiddleware(...a),
      expandSearchOnOptions: (...a) => engine.expandSearchOnOptions(...a),
      facade: engine,
      getDriver: (...a) => engine.getDriver(...a),
      getSummaryDescriptors: (...a) => engine.getSummaryDescriptors(...a),
      hasHooksFor: (...a) => engine.hasHooksFor(...a),
      inAfterAbortUnit: (...a) => engine.inAfterAbortUnit(...a),
      invalidateOrganizationProbe: (...a) => engine.invalidateOrganizationProbe(...a),
      get logger() { return engine.logger; },
      openRecycleBinCapture: (...a) => engine.openRecycleBinCapture(...a),
      opensAfterAbortUnit: (...a) => engine.opensAfterAbortUnit(...a),
      planCascadeAtomicity: (...a) => engine.planCascadeAtomicity(...a),
      publishBulkDataEvent: (...a) => engine.publishBulkDataEvent(...a),
      publishDataEvent: (...a) => engine.publishDataEvent(...a),
      get realtimeService() { return engine.realtimeService; },
      recomputeSummaries: (...a) => engine.recomputeSummaries(...a),
      rejectCredentialAggregation: (...a) => engine.rejectCredentialAggregation(...a),
      get relatedSchemaOf() { return engine.relatedSchemaOf; },
      releaseSecretHandles: (...a) => engine.releaseSecretHandles(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      resolveWhereTokens: (...a) => engine.resolveWhereTokens(...a),
      summaryForeignKeyColumns: (...a) => engine.summaryForeignKeyColumns(...a),
      transaction: (...a) => engine.transaction(...a),
      triggerHooks: (...a) => engine.triggerHooks(...a),
      warnCascadeNotAtomic: (...a) => engine.warnCascadeNotAtomic(...a),
      withResolvedWhere: (...a) => engine.withResolvedWhere(...a),
    }));
    findHost.install((engine) => ({
      get _registry() { return engine._registry; },
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      buildHookApi: (...a) => engine.buildHookApi(...a),
      buildProvenance: (...a) => engine.buildProvenance(...a),
      buildSession: (...a) => engine.buildSession(...a),
      buildUser: (...a) => engine.buildUser(...a),
      composeReadableIdsAtBoundary: (...a) => engine.composeReadableIdsAtBoundary(...a),
      executeWithMiddleware: (...a) => engine.executeWithMiddleware(...a),
      expandRelatedRecords: (...a) => engine.expandRelatedRecords(...a),
      expandSearchOnAst: (...a) => engine.expandSearchOnAst(...a),
      facade: engine,
      fillQueryAstDefaults: (...a) => engine.fillQueryAstDefaults(...a),
      formulaFaultSink: (...a) => engine.formulaFaultSink(...a),
      formulaOptionLabels: (...a) => engine.formulaOptionLabels(...a),
      getDriver: (...a) => engine.getDriver(...a),
      get logger() { return engine.logger; },
      lowerRelationConditions: (...a) => engine.lowerRelationConditions(...a),
      maskSecretFields: (...a) => engine.maskSecretFields(...a),
      permissionResolution: (...a) => engine.permissionResolution(...a),
      get relatedSchemaOf() { return engine.relatedSchemaOf; },
      reportFindFailure: (...a) => engine.reportFindFailure(...a),
      requireFindOnePredicate: (...a) => engine.requireFindOnePredicate(...a),
      resolveFileReferences: (...a) => engine.resolveFileReferences(...a),
      resolveFormulaPermissions: (...a) => engine.resolveFormulaPermissions(...a),
      resolveFormulaRelated: (...a) => engine.resolveFormulaRelated(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      resolveRelateThenLowerWhere: (...a) => engine.resolveRelateThenLowerWhere(...a),
      resolveSearchQueryableFields: (...a) => engine.resolveSearchQueryableFields(...a),
      resolveWhereTokens: (...a) => engine.resolveWhereTokens(...a),
      stripSearchCompanionFromRead: (...a) => engine.stripSearchCompanionFromRead(...a),
      triggerHooks: (...a) => engine.triggerHooks(...a),
    }));
    hooksAndFunctionsHost.install((engine) => ({
      get _defaultActionRunner() { return engine._defaultActionRunner; },
      set _defaultActionRunner(v) { engine._defaultActionRunner = v; },
      get _defaultBodyRunner() { return engine._defaultBodyRunner; },
      set _defaultBodyRunner(v) { engine._defaultBodyRunner = v; },
      get _registry() { return engine._registry; },
      get defaultDriver() { return engine.defaultDriver; },
      get drivers() { return engine.drivers; },
      facade: engine,
      get functions() { return engine.functions; },
      get functionHolders() { return engine.functionHolders; },
      getDriver: (...a) => engine.getDriver(...a),
      get hooks() { return engine.hooks; },
      isClosedUnitHandle: (...a) => engine.isClosedUnitHandle(...a),
      get logger() { return engine.logger; },
      get manifests() { return engine.manifests; },
      registerMiddleware: (...a) => engine.registerMiddleware(...a),
      get residualOwnerSources() { return engine.residualOwnerSources; },
      get txStore() { return engine.txStore; },
    }));
    insertHost.install((engine) => ({
      get _registry() { return engine._registry; },
      admittedViolationSink: (...a) => engine.admittedViolationSink(...a),
      applyAutonumbers: (...a) => engine.applyAutonumbers(...a),
      applyFieldDefaults: (...a) => engine.applyFieldDefaults(...a),
      assertReferencesResolve: (...a) => engine.assertReferencesResolve(...a),
      assertWriteAllowed: (...a) => engine.assertWriteAllowed(...a),
      assignment: (...a) => engine.assignment(...a),
      get assignmentEvaluator() { return engine.assignmentEvaluator; },
      set assignmentEvaluator(v) { engine.assignmentEvaluator = v; },
      get autonumberCounters() { return engine.autonumberCounters; },
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      buildEvalUser: (...a) => engine.buildEvalUser(...a),
      buildHookApi: (...a) => engine.buildHookApi(...a),
      buildProvenance: (...a) => engine.buildProvenance(...a),
      buildSession: (...a) => engine.buildSession(...a),
      buildUser: (...a) => engine.buildUser(...a),
      count: (...a) => engine.count(...a),
      createWithAutonumberResync: (...a) => engine.createWithAutonumberResync(...a),
      encryptSecretFields: (...a) => engine.encryptSecretFields(...a),
      enforceTransactionOrigin: (...a) => engine.enforceTransactionOrigin(...a),
      executeWithMiddleware: (...a) => engine.executeWithMiddleware(...a),
      facade: engine,
      find: (...a) => engine.find(...a),
      formulaFaultSink: (...a) => engine.formulaFaultSink(...a),
      formulaOptionLabels: (...a) => engine.formulaOptionLabels(...a),
      getDriver: (...a) => engine.getDriver(...a),
      getSchema: (...a) => engine.getSchema(...a),
      getSummaryDescriptors: (...a) => engine.getSummaryDescriptors(...a),
      homeAmountServing: (...a) => engine.homeAmountServing(...a),
      inAfterAbortUnit: (...a) => engine.inAfterAbortUnit(...a),
      initializeSummaryFields: (...a) => engine.initializeSummaryFields(...a),
      insert: (...a) => engine.insert(...a),
      get insertRecomputeListeners() { return engine.insertRecomputeListeners; },
      invalidateOrganizationProbe: (...a) => engine.invalidateOrganizationProbe(...a),
      isIssuedAutonumberCollision: (...a) => engine.isIssuedAutonumberCollision(...a),
      get logger() { return engine.logger; },
      mediaValueShapeStrictFor: (...a) => engine.mediaValueShapeStrictFor(...a),
      opensAfterAbortUnit: (...a) => engine.opensAfterAbortUnit(...a),
      ownershipQueueService: (...a) => engine.ownershipQueueService(...a),
      permissionResolution: (...a) => engine.permissionResolution(...a),
      persistSecretRows: (...a) => engine.persistSecretRows(...a),
      get preconditionDegradedWarned() { return engine.preconditionDegradedWarned; },
      set preconditionDegradedWarned(v) { engine.preconditionDegradedWarned = v; },
      publishDataEvent: (...a) => engine.publishDataEvent(...a),
      get realtimeService() { return engine.realtimeService; },
      recomputeSummaries: (...a) => engine.recomputeSummaries(...a),
      refuseEmptyPasswordFields: (...a) => engine.refuseEmptyPasswordFields(...a),
      releaseSecretHandles: (...a) => engine.releaseSecretHandles(...a),
      resolveDefaultPermissions: (...a) => engine.resolveDefaultPermissions(...a),
      resolveFormulaPermissions: (...a) => engine.resolveFormulaPermissions(...a),
      resolveFormulaRelated: (...a) => engine.resolveFormulaRelated(...a),
      resolveMasterDetailParents: (...a) => engine.resolveMasterDetailParents(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      resolveOptionPermissions: (...a) => engine.resolveOptionPermissions(...a),
      resolvePredicateRelated: (...a) => engine.resolvePredicateRelated(...a),
      resolveSystemInsertOrganization: (...a) => engine.resolveSystemInsertOrganization(...a),
      staticReadonlyCreateStrip: (...a) => engine.staticReadonlyCreateStrip(...a),
      triggerHooks: (...a) => engine.triggerHooks(...a),
      update: (...a) => engine.update(...a),
      validationMessageContext: (...a) => engine.validationMessageContext(...a),
      valueShapeStrictFor: (...a) => engine.valueShapeStrictFor(...a),
      warnAutonumberReadersUnserved: (...a) => engine.warnAutonumberReadersUnserved(...a),
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
    updateHost.install((engine) => ({
      get _registry() { return engine._registry; },
      admittedViolationSink: (...a) => engine.admittedViolationSink(...a),
      assertBulkPerRowHookBudget: (...a) => engine.assertBulkPerRowHookBudget(...a),
      assertReferencesResolve: (...a) => engine.assertReferencesResolve(...a),
      assertWriteAllowed: (...a) => engine.assertWriteAllowed(...a),
      buildDriverOptions: (...a) => engine.buildDriverOptions(...a),
      buildEvalUser: (...a) => engine.buildEvalUser(...a),
      buildHookApi: (...a) => engine.buildHookApi(...a),
      buildPerRowAfterContexts: (...a) => engine.buildPerRowAfterContexts(...a),
      buildProvenance: (...a) => engine.buildProvenance(...a),
      buildReferentialFieldClear: (...a) => engine.buildReferentialFieldClear(...a),
      buildSession: (...a) => engine.buildSession(...a),
      buildUser: (...a) => engine.buildUser(...a),
      dispatchPerRowBeforeHooks: (...a) => engine.dispatchPerRowBeforeHooks(...a),
      dispatchUnscopedMultiWriteHooks: (...a) => engine.dispatchUnscopedMultiWriteHooks(...a),
      encryptSecretFields: (...a) => engine.encryptSecretFields(...a),
      enforceTransactionOrigin: (...a) => engine.enforceTransactionOrigin(...a),
      executeWithMiddleware: (...a) => engine.executeWithMiddleware(...a),
      facade: engine,
      formulaFaultSink: (...a) => engine.formulaFaultSink(...a),
      formulaOptionLabels: (...a) => engine.formulaOptionLabels(...a),
      getDriver: (...a) => engine.getDriver(...a),
      getSchema: (...a) => engine.getSchema(...a),
      hasHooksFor: (...a) => engine.hasHooksFor(...a),
      homeAmountServing: (...a) => engine.homeAmountServing(...a),
      inAfterAbortUnit: (...a) => engine.inAfterAbortUnit(...a),
      invalidateOrganizationProbe: (...a) => engine.invalidateOrganizationProbe(...a),
      get logger() { return engine.logger; },
      mediaValueShapeStrictFor: (...a) => engine.mediaValueShapeStrictFor(...a),
      opensAfterAbortUnit: (...a) => engine.opensAfterAbortUnit(...a),
      permissionResolution: (...a) => engine.permissionResolution(...a),
      persistSecretRows: (...a) => engine.persistSecretRows(...a),
      priorMasterIdsCallerReads: (...a) => engine.priorMasterIdsCallerReads(...a),
      projectHomeAmountsOntoPatch: (...a) => engine.projectHomeAmountsOntoPatch(...a),
      publishBulkDataEvent: (...a) => engine.publishBulkDataEvent(...a),
      publishDataEvent: (...a) => engine.publishDataEvent(...a),
      readUpdatePriorRow: (...a) => engine.readUpdatePriorRow(...a),
      get realtimeService() { return engine.realtimeService; },
      recomputeSummaries: (...a) => engine.recomputeSummaries(...a),
      refuseEmptyPasswordFields: (...a) => engine.refuseEmptyPasswordFields(...a),
      get relatedSchemaOf() { return engine.relatedSchemaOf; },
      releaseSecretHandles: (...a) => engine.releaseSecretHandles(...a),
      resolveFormulaPermissions: (...a) => engine.resolveFormulaPermissions(...a),
      resolveFormulaRelated: (...a) => engine.resolveFormulaRelated(...a),
      resolveMasterDetailParent: (...a) => engine.resolveMasterDetailParent(...a),
      resolveMasterDetailParents: (...a) => engine.resolveMasterDetailParents(...a),
      resolveObjectName: (...a) => engine.resolveObjectName(...a),
      resolveOptionPermissions: (...a) => engine.resolveOptionPermissions(...a),
      resolvePredicateRelated: (...a) => engine.resolvePredicateRelated(...a),
      settleMasterDetailLanding: (...a) => engine.settleMasterDetailLanding(...a),
      summaryForeignKeyColumns: (...a) => engine.summaryForeignKeyColumns(...a),
      triggerHooks: (...a) => engine.triggerHooks(...a),
      update: (...a) => engine.update(...a),
      updateByIdExpecting: (...a) => engine.updateByIdExpecting(...a),
      validationMessageContext: (...a) => engine.validationMessageContext(...a),
      valueShapeStrictFor: (...a) => engine.valueShapeStrictFor(...a),
      withResolvedWhere: (...a) => engine.withResolvedWhere(...a),
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
   * ({@link derive}); read by {@link sudo} and {@link object}.
   */
  private appAuthored = false;

  private derive(executionContext: ExecutionContext): ScopedContext {
    // [#30975] The body moved to `engine-scoped-context.ts`, its docblock with it (see `ScopedContextHost`).
    return ScopedContextFacet.derive.call(scopedContextHost.of(this), executionContext);
  }

  /**
   * Get a repository scoped to this context.
   *
   * [ADR-0148 D3, ruling A recorded in 6691358077] On an app-authored hook's
   * api ({@link APP_AUTHORED_HOOK_API}) and every api derived from it, the
   * repository's `delete(…, { permanent })` is refused (`400
   * VALIDATION_ERROR`, `param: 'permanent'`): app-authored code cannot purge,
   * so its deletes enter the recycle bin, under any `runAs`. Platform code's
   * api is not app-authored, and keeps the engine's permanent delete.
   */
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
    // [#30975] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.appAuthoredHookApi.call(scopedContextHost.of(this));
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
   *  - a context that already carries a membership set
   *    (`accessible_org_ids`) keeps it, and one that carries none takes the
   *    resolver's, so the organization wall judges the hook as it judges the
   *    user's request (ADR-0093 D8.1, as amended);
   *  - a context that already carries an email keeps it verbatim (the
   *    session's, on a request-resolved context); only a context with none
   *    takes the resolved one;
   *  - a context that needs none of the four resolves nothing and is
   *    returned as is. One that lacks only the email is NOT that context: it
   *    resolves, and takes the email alone.
   *
   * The peer list is the members of the context's `tenantId`, the user
   * included; a context with no `tenantId` gets the user alone, as an
   * organisation-less request does. A resolver failure (an unreadable
   * permission store) is thrown to the caller, which then asks again with
   * `membershipUnread`: that call resolves nothing, and a context that carries
   * no membership set takes an empty one — a membership the hook could not
   * read is not a current one (ADR-0093 D8.1, as amended).
   *
   * Called on the api {@link withRunAs}`('user')` derived, which is never
   * elevated, so it does not re-judge the elevation flag.
   *
   * Keyed on {@link SEED_USER_GRANTS}, a symbol the package entry does not
   * export, so it is no nameable member of this class's published face (see
   * the symbol's docblock in `hook-run-as.ts`).
   */
  [SEED_USER_GRANTS](opts?: { membershipUnread?: true }): Promise<ScopedContext> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.seedUserGrants.call(scopedContextHost.of(this), opts);
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
  transaction(
    callback: (trxCtx: ScopedContext, info: EngineTransactionInfo) => Promise<any>,
    opts?: EngineTransactionOptions,
  ): Promise<any> {
    // [#30052 codemod] The body moved to `engine-scoped-context.ts` (see `ScopedContextHost`).
    return ScopedContextFacet.transaction.call(scopedContextHost.of(this), callback, opts);
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
      set appAuthored(v) { instance.appAuthored = v; },
      derive: (...a) => instance.derive(...a),
      get engine() { return instance.engine; },
      get executionContext() { return instance.executionContext; },
      facade: instance,
      get joinedHandles() { return instance.joinedHandles; },
      releaseJoinedHandle: (...a) => instance.releaseJoinedHandle(...a),
      txDriver: (...a) => instance.txDriver(...a),
    }));
  }
}
