// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Lean engine entry (ADR-0076). Exposes the data engine surface — engine,
// registry, hooks, validation, in-memory aggregation, utilities — WITHOUT the
// kernel plugin (`ObjectQLPlugin`), the kernel factory, or any metadata
// management (`@objectstack/metadata-protocol`). Embedders that want only the
// engine (e.g. a thin gateway) import from `@objectstack/objectql/core` so
// `@objectstack/metadata-protocol` is never pulled into their dependency graph.
//
// A boundary ratchet (ADR-0076 D2) keeps this entry free of protocol/plugin
// imports; do not add `./plugin`, `./kernel-factory`, or `@objectstack/metadata-protocol`
// re-exports here. That ratchet — not a byte figure — is what backs the sentence
// above; see core-boundary.ratchet.test.ts for why no size is quoted (#9803).

// Registry
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

// Search-normalization companion column (#2486 — pinyin recall)
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

// Engine
export { ObjectQL, ObjectRepository, ScopedContext } from './engine.js';
export type { HookHandler, HookEntry, OperationContext, EngineMiddleware } from './engine.js';

// Boot guard: thrown by `ObjectQL.init()` when a registered driver's connect()
// fails (framework#3741). Embedders that boot the engine themselves can catch
// it to render their own "database unreachable" message.
export { DriverConnectError, DatasourceUnavailableError } from './driver-connect-errors.js';
export type {
  DriverConnectFailure,
  DriverHealth,
  DatasourceUnavailableInfo,
  DatasourceUnavailableKind,
} from './driver-connect-errors.js';

// In-memory aggregation fallback
export { applyInMemoryAggregation, bucketDateValue } from './in-memory-aggregation.js';

// Hook binder & wrappers (declarative-metadata → engine glue)
export { bindHooksToEngine } from './hook-binder.js';
export type { BindHooksOptions, BindHooksResult } from './hook-binder.js';
export { wrapDeclarativeHook, HookConditionError } from './hook-wrappers.js';
// `HookConditionLimitation` was exported here until #5574 and is RETIRED —
// see the note above `HookConditionError` in `hook-wrappers.ts`. Its two members
// described a batch-scoped `before*` dispatch that no longer exists.
export type { WrapDeclarativeOptions } from './hook-wrappers.js';

// Validation
export { ValidationError, validateRecord } from './validation/record-validator.js';
export type { FieldValidationError } from './validation/record-validator.js';
export { evaluateValidationRules, needsPriorRecord, legalNextStates } from './validation/rule-validator.js';
export type { EvaluateRulesOptions } from './validation/rule-validator.js';
// #4953 — published so a package that duplicates this algorithm for its own
// zero-build-dependency reasons (`@objectstack/trigger-record-change`'s
// structural mirror, `record-change-trigger.ts`) has a TEST-TIME way to
// verify its copy still agrees, instead of the two silently drifting behind
// one doc comment's word.
export { materializeDeclaredFields } from './declared-fields.js';
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

// MetadataFacade
export { MetadataFacade } from './metadata-facade.js';

// Secret-field channel helpers
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

// Utilities
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
