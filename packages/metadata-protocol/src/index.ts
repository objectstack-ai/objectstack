// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ObjectStackProtocolImplementation, ConcurrentUpdateError, normalizeViewMetadata, graftNormalizedOperators, stripReadDecorations } from './protocol.js';
// [#5138] The 404 envelope every single-record path answers, exported so the
// ObjectQL FALLBACK in `@objectstack/runtime`'s `callData` builds the SAME one
// instead of minting a second not-found shape. See `recordNotFoundError`.
export { recordNotFoundError } from './protocol.js';
export { createMetadataProtocolPlugin, assembleMetadataProtocol } from './plugin.js';
export type { MetadataProtocolPluginOptions, AssembleMetadataProtocolOptions } from './plugin.js';
// [#6710] The declared authoring channel — the explicit expression of ADR-0005's
// "package author's own bootstrap channel", replacing the `environmentId ===
// undefined` proxy the #4463 gate used to key its activation off.
export type { MetadataAuthoringChannel } from './protocol.js';

// [#5839] `sys_view_definition`'s active-row uniqueness, delivered as a runtime
// partial-UNIQUE migration (the `ensureOverlayIndex` paradigm, for the one other
// table that declared the same intent with nothing behind it).
export {
    ensureViewDefinitionActiveIndex,
    resolveIndexExec,
    buildActiveIndexSql,
    classifyIndexFailure,
    VIEW_DEFINITION_TABLE,
    VIEW_ACTIVE_INDEX_NAME,
    VIEW_ACTIVE_PROBE_INDEX_NAME,
    VIEW_ACTIVE_INDEX_COLUMNS,
} from './migrations/view-definition-active-index.js';
export type {
    IndexExec,
    EnsureViewIndexLogger,
    EnsureViewIndexStatus,
    EnsureViewIndexResult,
} from './migrations/view-definition-active-index.js';
export type { UninstallCleanup, UninstallCleanupOutcome } from './protocol.js';
export type { MetadataMutationEvent, MetadataMutationProjector, MutationProjectionOutcome } from './protocol.js';
export type { MetadataAuthoringGate, MetadataAuthoringGateContext } from './protocol.js';

export { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';
export type {
  SysMetadataEngine,
  SysMetadataRepositoryOptions,
  OverlayState,
  ExtendedOperation,
  DraftDrainFailure,
} from './sys-metadata-repository.js';

export { formatStoredMigrationReport, storedMigrationClean } from './stored-migration.js';
export type {
  StoredFlowCanonicalization,
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

// #4556 — the `sys_metadata_history.recorded_by` sentinel → NULL conversion,
// as an ADR-0119 D2 migration plan. Run by `os migrate recorded-by`.
export {
  createRecordedBySentinelPlan,
  findSentinelHistoryRows,
  METADATA_HISTORY_OBJECT,
  RECORDED_BY_SENTINEL,
  RECORDED_BY_SENTINEL_PLAN_ID,
} from './migrations/recorded-by-sentinel.js';
export type { SentinelHistoryRow } from './migrations/recorded-by-sentinel.js';

export { SeedLoaderService } from './seed-loader.js';
export { runBuildProbes } from './build-probes.js';
export type {
  RuntimeBuildIssue,
  BuildProbeReport,
  RunBuildProbesOptions,
  ProbeEngine,
  ProbeAnalytics,
} from './build-probes.js';
