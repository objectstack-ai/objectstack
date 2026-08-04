// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Core service
export { AnalyticsService } from './analytics-service.js';
export type { AnalyticsServiceConfig } from './analytics-service.js';

// Kernel plugin
export { AnalyticsServicePlugin } from './plugin.js';
export type { AnalyticsServicePluginOptions } from './plugin.js';

// Cube registry
export { CubeRegistry } from './cube-registry.js';

// Dataset semantic layer (ADR-0021)
export { compileDataset } from './dataset-compiler.js';
export type {
  CompiledDataset,
  DatasetCompileOptions,
  DerivedMeasureSpec,
  RelationshipResolver,
  RelationshipTarget,
} from './dataset-compiler.js';

export {
  resolveDimensionLabels,
  pickDisplayField,
  createOrderLabelResolver,
  withLabelFetchCache,
} from './dimension-labels.js';
export type { DimensionLabelDeps, FieldMetaLite, OrderLabelResolver } from './dimension-labels.js';
export {
  DatasetExecutor,
  evaluateDerivedMeasures,
  combineFilters,
  shiftRange,
  mergeByDimensions,
  fillEmptyGroups,
} from './dataset-executor.js';
export type { DatasetSelection, CompareTo } from './dataset-executor.js';
export { compileScopedFilterToSql } from './read-scope-sql.js';

// Strategies
export { NativeSQLStrategy } from './strategies/native-sql-strategy.js';
export { ObjectQLStrategy } from './strategies/objectql-strategy.js';
export type { AnalyticsStrategy, StrategyContext, AnalyticsDriverCapabilities } from './strategies/types.js';

// Note: InMemoryStrategy is exported from @objectstack/driver-memory
