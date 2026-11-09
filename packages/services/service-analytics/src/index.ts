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
export type { DatasetCatalogAdmission } from './analytics-service.js';

// Dataset AI tools (ADR-0149 D2–D4)
export {
  createDatasetTools,
  getDatasetToolDefinitions,
  DATASET_TOOL_DEFAULT_MAX_ROWS,
} from './dataset-tools.js';
export type {
  DatasetTools,
  DatasetToolsDeps,
  DatasetToolCall,
  DatasetToolSource,
  DatasetToolDelegationProbe,
} from './dataset-tools.js';
export { matchDatasetTerms } from './dataset-term-matcher.js';
export type { MatchableMember } from './dataset-term-matcher.js';

// Strategies
export { NativeSQLStrategy } from './strategies/native-sql-strategy.js';
export { ObjectQLStrategy } from './strategies/objectql-strategy.js';
export type { AnalyticsStrategy, StrategyContext, AnalyticsDriverCapabilities } from './strategies/types.js';

// Note: InMemoryStrategy is exported from @objectstack/driver-memory
