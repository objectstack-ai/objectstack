// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0110] Action governance — addressing vocabulary + the D5 inventory.
// The engine owns the action-handler map, so the audit of that map and the
// key derivation dispatch uses both live here; @objectstack/runtime
// re-exports them so both packages read ONE implementation.
export {
  GLOBAL_ACTION_OBJECT_KEY,
  isObjectLessActionKey,
  actionHandlerObjectKeys,
  resolveActionHandlerKeys,
  reconcileActionRegistrations,
  collectEngineActionDeclarations,
  runActionGovernanceInventory,
} from './action-governance.js';
export type { GovernanceLogger } from './action-governance.js';

// Export Registry
export { 
  SchemaRegistry,
  applySystemFields,
  computeFQN,
  parseFQN,
  RESERVED_NAMESPACES,
  DEFAULT_OWNER_PRIORITY,
  DEFAULT_EXTENDER_PRIORITY,
} from './registry.js';
export type { ObjectContributor, SchemaRegistryOptions } from './registry.js';

// Search-normalization companion column (#2486 — pinyin recall). Shared by
// the registry's compile-time provisioning seam, the engine's `$search`
// expansion, and plugin-pinyin-search's populate hooks.
export {
  SEARCH_COMPANION_FIELD,
  SEARCH_COMPANION_NORMALIZERS,
  provisionSearchCompanion,
  resolveSearchCompanionSources,
  isCompanionSourceEligible,
  isCompanionMatchableTerm,
  isSearchCompanionRequested,
  stripSearchCompanion,
  containsCJK,
} from './search-companion.js';
export type { CompanionFieldMeta, CompanionObjectMeta } from './search-companion.js';

// Export Protocol Implementation

// ADR-0008 PR-10b: MetadataRepository wrapper over the existing sys_metadata table.

// Export Engine
export { ObjectQL, ObjectRepository, ScopedContext } from './engine.js';
export type { HookHandler, HookEntry, OperationContext, EngineMiddleware } from './engine.js';
export type { AdmittedValueShapeViolationTally } from './engine.js';
export { SummaryRecomputeError } from './summary-errors.js';
export type { SummaryRecomputeFailure } from './summary-errors.js';
// [#5126] Thrown by `update` when `options.strictReadonlyWrites` is set and the
// payload would have had read-only fields stripped. Exported so an in-process
// caller (a cron / server-side plugin) can narrow on the class; the `code` is
// the boundary-crossing identity.
export { ReadonlyFieldRejectedError } from './readonly-strict-errors.js';
// Boot guard: thrown by `ObjectQL.init()` when a registered driver's connect()
// fails (framework#3741). Hosts that boot the engine themselves can catch it to
// render their own "database unreachable" message.
export { DriverConnectError, DatasourceUnavailableError } from './driver-connect-errors.js';
export type {
  DriverConnectFailure,
  DriverHealth,
  DatasourceUnavailableInfo,
  DatasourceUnavailableKind,
} from './driver-connect-errors.js';
export type { InsertManyRowOutcome } from './engine.js';
// [#5696] Thrown by `transaction(cb, base, { require: true })` when the
// datasource cannot give a real transaction. Exported so a caller that fails
// closed can narrow on the class; `code` is the boundary-crossing identity.
export { TransactionUnsupportedError } from './transaction-errors.js';
// [#5351/#5696] Thrown when a BUSINESS write inside an open transaction()
// resolves to a driver that transaction does not cover. Append-only system
// ledgers (lifecycle.class audit/telemetry/event) are carved out and never
// raise it. Narrow on the class in-process; `code` crosses package boundaries.
export { CrossDatasourceTransactionWriteError } from './transaction-errors.js';

// [#4550] The delete-dispatch contract, exported so a TEST DOUBLE that stands
// in for the engine can import the producer's own decision rather than
// re-deriving it. A fake looser than the contract it replaces is how #4434
// shipped a REST route that 500'd for every caller with its suite green.
// `scripts/check-engine-double-contract.mjs` is the gate that keeps new
// engine doubles on this.
export {
  resolveEngineDeleteDispatch,
  assertEngineDeleteDispatch,
  scalarDeleteId,
  ENGINE_DELETE_REJECT_MESSAGE,
  ENGINE_DELETE_DISPATCH_CASES,
} from './engine-delete-dispatch.js';
export type {
  EngineDeleteDispatch,
  EngineDeleteDispatchInput,
  EngineDeleteDispatchCase,
} from './engine-delete-dispatch.js';

// [#5480] The update-dispatch contract, on exactly the same terms — `update`
// has the same three-way dispatch, and a predicate write is no less
// destructive than a predicate delete (it rewrites every matching row's
// fields). Until this existed, a double could be bound to the producer for one
// write verb and structurally could not be for the other (#5393).
export {
  resolveEngineUpdateDispatch,
  assertEngineUpdateDispatch,
  scalarUpdateId,
  ENGINE_UPDATE_REJECT_MESSAGE,
  ENGINE_UPDATE_DISPATCH_CASES,
} from './engine-update-dispatch.js';
export type {
  EngineUpdateDispatch,
  EngineUpdateDispatchInput,
  EngineUpdateDispatchData,
  EngineUpdateDispatchCase,
} from './engine-update-dispatch.js';

// Export in-memory aggregation fallback (used by engine.aggregate when the
// driver lacks native groupBy/aggregations support; also useful for tests).
export { applyInMemoryAggregation, bucketDateValue } from './in-memory-aggregation.js';

// Export Hook Binder & Wrappers (declarative-metadata → engine glue)
export { bindHooksToEngine } from './hook-binder.js';
export type { BindHooksOptions, BindHooksResult } from './hook-binder.js';
export { wrapDeclarativeHook, HookConditionError } from './hook-wrappers.js';
// `HookConditionLimitation` was exported here until #5574 and is RETIRED —
// see the note above `HookConditionError` in `hook-wrappers.ts`. Its two members
// described a batch-scoped `before*` dispatch that no longer exists.
export type { WrapDeclarativeOptions } from './hook-wrappers.js';

// Export Validation
export { ValidationError, validateRecord } from './validation/record-validator.js';
export type { FieldValidationError } from './validation/record-validator.js';
// [ADR-0104 / #4769] The counterexample a boot produces by ADMITTING an
// off-shape value. Exported because the fresh-datastore attestation
// (`@objectstack/platform-objects`) reads it before certifying anything: a
// boot may not prove a contract it has itself just broken.
export type {
    AdmittedValueShapeViolation,
    AdmittedValueShapeViolationSink,
} from './validation/record-validator.js';
// [ADR-0104 D1 / #3438] The value-shape scan behind `os migrate value-shapes`.
// Read-only by design: it produces the evidence and the CALLER records the
// flag. The engine deliberately does not depend on `@objectstack/platform-objects`
// (readers of a flag use the spec contract; only writers take that dependency),
// so the composition lives with the command, not here.
export {
    scanValueShapes,
    valueShapeScanPassed,
    formatValueShapeScanReport,
} from './validation/scan-value-shapes.js';
export type {
    ValueShapeFinding,
    ValueShapeScanReport,
    ValueShapeScanEngine,
    ValueShapeScanOptions,
    ValueShapeScanLogger,
} from './validation/scan-value-shapes.js';
// [#6063 / #5749] The one-off backfill behind `os migrate summary-nulls`, and
// the roll-up core it shares with the engine. Same package as the roll-up it
// repairs (the owning-package half of the migration-family shape: the CLI holds
// only the command shell).
export {
    backfillSummaryNulls,
    formatSummaryBackfillReport,
    summaryBackfillComplete,
} from './summary-backfill.js';
export type {
    SummaryBackfillReport,
    SummaryBackfillFieldOutcome,
    SummaryBackfillFailure,
    SummaryBackfillEngine,
    SummaryBackfillLogger,
    SummaryBackfillOptions,
} from './summary-backfill.js';
export { summaryEmptySetValue, summaryNullIsBackfillable, aggregateSummaryValue } from './summary-aggregate.js';
export type { SummaryDescriptor, SummaryAggregateEngine } from './summary-aggregate.js';
export { evaluateValidationRules, needsPriorRecord, legalNextStates } from './validation/rule-validator.js';
export type { EvaluateRulesOptions } from './validation/rule-validator.js';
export {
    InMemoryHookMetricsRecorder,
    noopHookMetricsRecorder,
} from './hook-metrics.js';
export type {
    HookMetricsRecorder,
    HookMetricLabel,
    HookMetricOutcome,
    HookSkipReason,
} from './hook-metrics.js';

// Export LifecycleService (ADR-0057 — declarative retention/rotation/archival)
export {
  LifecycleService,
  DEFAULT_LIFECYCLE_SWEEP_MS,
  DEFAULT_LIFECYCLE_INITIAL_DELAY_MS,
} from './lifecycle/lifecycle-service.js';
export type {
  LifecycleServiceOptions,
  LifecycleSweepReport,
  LifecycleSweepEntry,
  LifecycleEngineLike,
  LifecycleObjectLike,
  LifecycleSettingsLike,
  LifecycleGovernanceAlert,
  LifecycleReapGuard,
  // [#5195] Consumer-declared floors on settings-driven window overrides.
  LifecycleRetentionFloor,
  LifecycleFloorViolation,
} from './lifecycle/lifecycle-service.js';
export { parseLifecycleDuration } from './lifecycle/duration.js';
export { lifecycleSettingsManifest } from './lifecycle/lifecycle-settings.js';

// [#4551] Read-only referential-integrity audit — the reporting half of the
// `isSystem` exemption #4441 deliberately left in the write-path guard.
export {
  auditDanglingReferences,
  SECURITY_SURFACE_OBJECTS,
  DEFAULT_ROWS_PER_OBJECT,
  DEFAULT_MAX_ROWS,
} from './integrity/dangling-reference-audit.js';
export type {
  DanglingReference,
  DanglingReferenceReport,
  DanglingReferenceAuditOptions,
  DanglingReferenceAuditPort,
  AuditableObject,
  // [#4747] The teardown bit the audit reads — exported alongside the options
  // type that names it, so a caller can spell the parameter it passes.
  AuditAbortSignal,
} from './integrity/dangling-reference-audit.js';

// Export MetadataFacade
export { MetadataFacade } from './metadata-facade.js';

// Export Plugin Shim
export { ObjectQLPlugin } from './plugin.js';

// Export Kernel Factory
export { createObjectQLKernel } from './kernel-factory.js';
export type { ObjectQLKernelOptions } from './kernel-factory.js';

// Export secret-field channel helpers (for hosts / privileged consumers)
export {
  SECRET_REF_PREFIX,
  SECRET_MASK,
  makeSecretRef,
  isSecretRef,
  parseSecretRef,
  collectSecretFields,
  collectMaskedReadFields,
  collectCredentialFields,
} from './secret-fields.js';

// Export Utilities
export {
  toTitleCase,
  convertIntrospectedSchemaToObjects,
} from './util.js';
export type {
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedTable,
  IntrospectedSchema,
} from './util.js';

// Seed loader — materializes `seed` metadata into rows (used by publishMetaItem
// and the runtime dispatcher/app plugins).

// ADR-0038 L3 — post-publish runtime probes (one real read per published
// artifact); findings are BuildIssue-shaped with layer 'runtime'.
