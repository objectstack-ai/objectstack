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
export { type MetadataLoader, type MetadataKeyedItem } from './loaders/loader-interface.js';
export { MemoryLoader } from './loaders/memory-loader.js';
export { RemoteLoader } from './loaders/remote-loader.js';
export { DatabaseLoader, type DatabaseLoaderOptions } from './loaders/database-loader.js';

// [#14921] The ambiguous-stem refusal. Published from the ROOT entry, not only
// from `./node` beside `FilesystemLoader`: the error reaches consumers through
// `MetadataManager.listNames()` / `list()`, which live here, and a caller that
// wants to tell "this deployment's metadata tree names one item twice" apart
// from a storage outage needs the predicate wherever it catches — not only
// where the loader is constructed.
export {
  AmbiguousMetadataStemError,
  isAmbiguousMetadataStemError,
  AMBIGUOUS_METADATA_STEM_CODE,
  AMBIGUOUS_METADATA_STEM_STATUS,
} from './loaders/ambiguous-metadata-stem.js';

// Objects
export { SysMetadataObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

// Routes
// NOTE: `registerMetadataHistoryRoutes` (Hono-style) was removed —
// the canonical history / publish / rollback / diff REST surface
// lives in `packages/rest/src/rest-server.ts` and is wired by the
// REST plugin on every running app.

// Utils
export { calculateChecksum, generateSimpleDiff, generateDiffSummary } from './utils/metadata-history-utils.js';
export { HistoryCleanupManager } from './utils/history-cleanup.js';

// Serializers
export { type MetadataSerializer, type SerializeOptions } from './serializers/serializer-interface.js';
export { JSONSerializer } from './serializers/json-serializer.js';
export { YAMLSerializer } from './serializers/yaml-serializer.js';
export * as Migration from './migration/index.js';
export { TypeScriptSerializer } from './serializers/typescript-serializer.js';

// View container binding
//
// [#14399] `deriveViewContainerObject` is this package's ONE spelling of "which
// object does an aggregated `defineView` container bind to" — the container's
// own top-level `object` first, then `list.data.object`, `form.data.object`,
// and the row's own `name` last (its own docblock carries the ruling). It is
// published here because the ObjectQL boot-loop registrar
// (`packages/objectql/src/engine.ts`, `resolveMetadataItemName`) is a SOURCE
// registrar for the same containers and has to mint the same registry key: it
// used to consult the row's `name` FIRST, so a container whose `name` differs
// from its `object` registered under two different keys depending on which
// registrar loaded it. `packages/objectql` already declares this package as a
// dependency and nothing here depends on it, so the import is the repair — a
// fifth hand-copy of the chain is the defect, not the fix.
export { deriveViewContainerObject } from './view-container-expansion.js';

// Re-export types from spec
export type {
  MetadataFormat,
  MetadataStats,
  MetadataLoadOptions,
  MetadataSaveOptions,
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

// Re-export IMetadataService contract.
// [#4538] `MetadataExportOptions` / `MetadataImportOptions` moved into this
// block: this package used to re-export the same-named system-entry bags
// (`output`/`source`-flavored, removed with #4538) while `MetadataManager`
// implements the contracts shapes — the public re-export was pointing at the
// wrong declaration.
export type {
  IMetadataService,
  MetadataWatchCallback,
  MetadataWatchHandle,
  MetadataExportOptions,
  MetadataImportOptions,
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
