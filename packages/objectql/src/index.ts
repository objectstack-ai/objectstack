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

// Export Protocol Implementation
export { ObjectStackProtocolImplementation } from './protocol.js';

// ADR-0008 PR-10b: MetadataRepository wrapper over the existing sys_metadata table.
export { SysMetadataRepository } from './sys-metadata-repository.js';
export type { SysMetadataEngine, SysMetadataRepositoryOptions } from './sys-metadata-repository.js';

// Export Engine
export { ObjectQL, ObjectRepository, ScopedContext } from './engine.js';
export type { ObjectQLHostContext, HookHandler, HookEntry, OperationContext, EngineMiddleware } from './engine.js';

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
