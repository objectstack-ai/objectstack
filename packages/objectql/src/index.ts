// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
  containsCJK,
} from './search-companion.js';
export type { CompanionFieldMeta, CompanionObjectMeta } from './search-companion.js';

// Export Protocol Implementation
export { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

// ADR-0008 PR-10b: MetadataRepository wrapper over the existing sys_metadata table.
export { SysMetadataRepository } from '@objectstack/metadata-protocol';
export type { SysMetadataEngine, SysMetadataRepositoryOptions } from '@objectstack/metadata-protocol';

// Export Engine
export { ObjectQL, ObjectRepository, ScopedContext } from './engine.js';
export type { ObjectQLHostContext, HookHandler, HookEntry, OperationContext, EngineMiddleware } from './engine.js';
export { SummaryRecomputeError } from './summary-errors.js';
export type { SummaryRecomputeFailure } from './summary-errors.js';

// Export in-memory aggregation fallback (used by engine.aggregate when the
// driver lacks native groupBy/aggregations support; also useful for tests).
export { applyInMemoryAggregation, bucketDateValue } from './in-memory-aggregation.js';

// Export Hook Binder & Wrappers (declarative-metadata → engine glue)
export { bindHooksToEngine } from './hook-binder.js';
export type { BindHooksOptions, BindHooksResult } from './hook-binder.js';
export { wrapDeclarativeHook } from './hook-wrappers.js';
export type { WrapDeclarativeOptions } from './hook-wrappers.js';

// Export Validation
export { ValidationError, validateRecord } from './validation/record-validator.js';
export type { FieldValidationError } from './validation/record-validator.js';
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
} from './lifecycle/lifecycle-service.js';
export { parseLifecycleDuration } from './lifecycle/duration.js';
export { lifecycleSettingsManifest } from './lifecycle/lifecycle-settings.js';

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
export { SeedLoaderService } from '@objectstack/metadata-protocol';

// ADR-0038 L3 — post-publish runtime probes (one real read per published
// artifact); findings are BuildIssue-shaped with layer 'runtime'.
export { runBuildProbes } from '@objectstack/metadata-protocol';
export type { RuntimeBuildIssue, BuildProbeReport, RunBuildProbesOptions } from '@objectstack/metadata-protocol';
