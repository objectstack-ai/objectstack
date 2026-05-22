// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/metadata
 * 
 * Metadata loading, saving, and persistence for ObjectStack.
 * Implements the IMetadataService contract from @objectstack/spec.
 */

// Main Manager
export { MetadataManager, type WatchCallback, type MetadataManagerOptions } from './metadata-manager.js';

// Plugin
export { MetadataPlugin } from './plugin.js';

// Loaders
export { type MetadataLoader } from './loaders/loader-interface.js';
export { MemoryLoader } from './loaders/memory-loader.js';
export { RemoteLoader } from './loaders/remote-loader.js';
export { DatabaseLoader, type DatabaseLoaderOptions } from './loaders/database-loader.js';

// Objects
export { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/platform-objects/metadata';

// Routes
export { registerMetadataHistoryRoutes } from './routes/history-routes.js';

// Utils
export { calculateChecksum, generateSimpleDiff, generateDiffSummary } from './utils/metadata-history-utils.js';
export { HistoryCleanupManager } from './utils/history-cleanup.js';

// Serializers
export { type MetadataSerializer, type SerializeOptions } from './serializers/serializer-interface.js';
export { JSONSerializer } from './serializers/json-serializer.js';
export { YAMLSerializer } from './serializers/yaml-serializer.js';
export * as Migration from './migration/index.js';
export { TypeScriptSerializer } from './serializers/typescript-serializer.js';

// Re-export types from spec
export type {
  MetadataFormat,
  MetadataStats,
  MetadataLoadOptions,
  MetadataSaveOptions,
  MetadataExportOptions,
  MetadataImportOptions,
  MetadataLoadResult,
  MetadataSaveResult,
  MetadataWatchEvent,
  MetadataCollectionInfo,
  MetadataLoaderContract,
  MetadataManagerConfig,
  MetadataHistoryRecord,
  MetadataHistoryQueryOptions,
  MetadataHistoryQueryResult,
  MetadataDiffResult,
  MetadataHistoryRetentionPolicy,
} from '@objectstack/spec/system';

// Re-export IMetadataService contract
export type {
  IMetadataService,
  MetadataWatchCallback,
  MetadataWatchHandle,
  MetadataTypeInfo,
  MetadataImportResult,
} from '@objectstack/spec/contracts';

// Re-export kernel types for plugin protocol
export type {
  MetadataType,
  MetadataTypeRegistryEntry,
  MetadataPluginConfig,
  MetadataPluginManifest,
  MetadataQuery,
  MetadataQueryResult,
  MetadataValidationResult,
  MetadataBulkResult,
  MetadataDependency,
} from '@objectstack/spec/kernel';

// Re-export the new Repository contract (ADR-0008) so downstream consumers
// (ObjectQL schema registry, Studio, CLI) can import from one place.
export type {
  MetadataRepository,
  MetadataEvent,
  MetadataItem,
  MetadataItemHeader,
  MetaRef,
  WatchFilter,
  HistoryOptions,
} from '@objectstack/metadata-core';
