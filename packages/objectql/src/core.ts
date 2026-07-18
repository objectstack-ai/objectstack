// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Lean engine entry (ADR-0076). Exposes the data engine surface — engine,
// registry, hooks, validation, in-memory aggregation, utilities — WITHOUT the
// kernel plugin (`ObjectQLPlugin`), the kernel factory, or any metadata
// management (`@objectstack/metadata-protocol`). Embedders that want only the
// engine (e.g. a thin gateway) import from `@objectstack/objectql/core` so the
// 268KB metadata protocol is never pulled into their dependency graph.
//
// A boundary ratchet (ADR-0076 D2) keeps this entry free of protocol/plugin
// imports; do not add `./plugin`, `./kernel-factory`, or `@objectstack/metadata-protocol`
// re-exports here.

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
  containsCJK,
} from './search-companion.js';
export type { CompanionFieldMeta, CompanionObjectMeta } from './search-companion.js';

// Engine
export { ObjectQL, ObjectRepository, ScopedContext } from './engine.js';
export type { ObjectQLHostContext, HookHandler, HookEntry, OperationContext, EngineMiddleware } from './engine.js';

// In-memory aggregation fallback
export { applyInMemoryAggregation, bucketDateValue } from './in-memory-aggregation.js';

// Hook binder & wrappers (declarative-metadata → engine glue)
export { bindHooksToEngine } from './hook-binder.js';
export type { BindHooksOptions, BindHooksResult } from './hook-binder.js';
export { wrapDeclarativeHook } from './hook-wrappers.js';
export type { WrapDeclarativeOptions } from './hook-wrappers.js';

// Validation
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
