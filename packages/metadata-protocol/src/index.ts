// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ObjectStackProtocolImplementation, ConcurrentUpdateError, normalizeViewMetadata, graftNormalizedOperators, stripReadDecorations } from './protocol.js';
export { createMetadataProtocolPlugin, assembleMetadataProtocol } from './plugin.js';
export type { MetadataProtocolPluginOptions } from './plugin.js';
export type { UninstallCleanup, UninstallCleanupOutcome } from './protocol.js';
export type { MetadataMutationEvent, MetadataMutationProjector, MutationProjectionOutcome } from './protocol.js';
export type { MetadataAuthoringGate, MetadataAuthoringGateContext } from './protocol.js';

export { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';
export type {
  SysMetadataEngine,
  SysMetadataRepositoryOptions,
  OverlayState,
  ExtendedOperation,
} from './sys-metadata-repository.js';

export { formatStoredMigrationReport, storedMigrationClean } from './stored-migration.js';
export type {
  StoredMigrationNotice,
  StoredMigrationOutcome,
  StoredMigrationReport,
  StoredMigrationRow,
} from './stored-migration.js';

export {
  computeMetadataDiagnostics,
  computeViewReferenceDiagnostics,
  decorateMetadataItem,
  decorateMetadataItems,
} from './metadata-diagnostics.js';
export type { MetadataDiagnostics } from './metadata-diagnostics.js';

export type { MetadataHostEngine } from './host-engine.js';

export { SeedLoaderService } from './seed-loader.js';
export { runBuildProbes } from './build-probes.js';
export type {
  RuntimeBuildIssue,
  BuildProbeReport,
  RunBuildProbesOptions,
  ProbeEngine,
  ProbeAnalytics,
} from './build-probes.js';
