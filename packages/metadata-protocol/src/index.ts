// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ObjectStackProtocolImplementation, ConcurrentUpdateError, normalizeViewMetadata, graftNormalizedOperators, graftFoldedFormSections, stripReadDecorations } from './protocol.js';
// [#5138] The 404 envelope every single-record path answers, exported so the
// ObjectQL FALLBACK in `@objectstack/runtime`'s `callData` builds the SAME one
// instead of minting a second not-found shape. See `recordNotFoundError`.
export { recordNotFoundError } from './protocol.js';
// [#7823] The write-response half of the `internal: true` guarantee — THE
// single helper every generic write ingress routes its response records
// through (A-prime ruling, 2026-08-13). Tripwire-enforced; see the module
// header for why it lives at the ingress and not in the engine.
export {
  omitInternalFieldsFromWriteResponse,
  collectInternalWriteResponseFields,
} from './write-response-internal-fields.js';
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

// [#7560] ADR-0070's read-only-package rule. The authoring path (`saveMetaItem`
// → `WRITABLE_PACKAGE_REQUIRED`) and the `/packages` lifecycle gate in
// `@objectstack/runtime` (`PATCH /:id/disable`, `DELETE /:id`) both ask it, so
// "which packages are read-only" has ONE definition rather than two that drift.
export { isWritablePackage, READ_ONLY_PACKAGE_SCOPES } from './package-writability.js';
export type { PackageWritabilityEngine } from './package-writability.js';

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
