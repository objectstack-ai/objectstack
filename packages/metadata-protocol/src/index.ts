// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ObjectStackProtocolImplementation, ConcurrentUpdateError, normalizeViewMetadata, graftNormalizedOperators, graftFoldedFormSections, stripReadDecorations } from './protocol.js';
// [#5138] The 404 envelope every single-record path answers, exported so the
// ObjectQL FALLBACK in `@objectstack/runtime`'s `callData` builds the SAME one
// instead of minting a second not-found shape. See `recordNotFoundError`.
export { recordNotFoundError } from './protocol.js';
// [#8443] The ADR-0112 disclosure rule (#8086 / #8136 / #8333), exported for
// the SECOND seed-apply producer: `@objectstack/runtime`'s package-publish door
// keeps a fallback apply for protocols that do not self-apply, and it reports
// failure as data on the same `seedApplied` field. Both halves travel together
// because both are needed to apply the rule without losing authoring feedback:
// `clientFacingFailureText` withholds what was never declared, and
// `seedRequestValidationError` is what DECLARES the one population that must
// still be quoted (a malformed seed body). Exporting is enabling-only — no
// behaviour in this package changes.
export { clientFacingFailureText, seedRequestValidationError } from './protocol.js';
// [#7823] The write-response half of the `internal: true` guarantee — THE
// single helper every generic write ingress routes its response records
// through (A-prime ruling, 2026-08-13). Tripwire-enforced; see the module
// header for why it lives at the ingress and not in the engine.
export {
  omitInternalFieldsFromWriteResponse,
  collectInternalWriteResponseFields,
} from './write-response-internal-fields.js';
export { createMetadataProtocolPlugin, assembleMetadataProtocol, shouldRunPlatformMigrations } from './plugin.js';
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

// [#8629] `sys_setting`'s declared ROW IDENTITY, delivered as a runtime
// NULL-safe UNIQUE migration — the same paradigm again, for the object whose
// `user_id` key part is NULL on every tenant- and global-scope row and was
// therefore constraining nothing there (maintainer ruling 2026-08-14: route 1
// now, refuse-to-migrate on duplicates, never keep-newest).
export {
    ensureSysSettingIdentityIndex,
    resolveSysSettingIndexExec,
    buildSysSettingIdentityIndexSql,
    buildSysSettingDuplicateProbeSql,
    buildSysSettingPresenceSql,
    sysSettingIdentityKeyParts,
    SYS_SETTING_TABLE,
    SYS_SETTING_IDENTITY_INDEX_NAME,
    SYS_SETTING_IDENTITY_PROBE_INDEX_NAME,
    SYS_SETTING_IDENTITY_INDEX_COLUMNS,
    SYS_SETTING_NULL_SENTINELS,
} from './migrations/sys-setting-identity-index.js';
export type {
    EnsureSysSettingIndexLogger,
    EnsureSysSettingIndexStatus,
    EnsureSysSettingIndexResult,
} from './migrations/sys-setting-identity-index.js';
// #8686 — the seed/API tenancy split. Unlike its two siblings above this
// migration moves stored ROWS rather than tightening an index, so it is
// single-tenant-guarded and reports (never renumbers) identifiers already minted
// twice (maintainer ruling 2026-08-15: contract option 1, stored data shape 2).
export {
    backfillSeedTenancy,
    resolveSeedTenancySeam,
    resolveSeedTenancyExec,
    normalizeRows,
    buildSequencesPresenceSql,
    buildSplitProbeSql,
    buildOrganizationProbeSql,
    buildCollisionProbeSql,
    buildStampSql,
    buildCounterMergeSql,
    buildGlobalCounterDeleteSql,
    SEQUENCES_TABLE,
    GLOBAL_TENANT,
    ORGANIZATION_FIELD,
    ORGANIZATION_TABLE,
} from './migrations/seed-tenancy-backfill.js';
export type { SeedTenancySeam } from './migrations/seed-tenancy-backfill.js';
export type {
    SeedTenancyExec,
    SeedTenancyLogger,
    SeedTenancyBackfillStatus,
    SeedTenancyBackfillResult,
    SeedTenancySplit,
    SeedTenancyCollision,
} from './migrations/seed-tenancy-backfill.js';
export type { UninstallCleanup, UninstallCleanupOutcome } from './protocol.js';
// [#9960] The ONE declared shape of the `deletePackage` seam, exported so the
// two consumers that speak it (`@objectstack/rest`'s direct-mount package
// registrar and the `@objectstack/runtime` dispatcher twin) type the seam
// against the producer's contract instead of restating it locally.
export type { DeletePackageRequest, DeletePackageResponse } from './protocol.js';
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

// [#8154] The metadata read path's per-type credential redaction (consuming
// #8300's `@objectstack/spec/kernel` registry) and its write-path inverse.
// `decorateMetadataItem` above already composes the read half — these are
// exported for the exits decoration does not reach, and so the invariant is
// testable from the package surface rather than only through a live protocol.
export {
  carryForwardRedactedValues,
  hasMetadataRedactor,
  redactMetadataItem,
  redactMetadataItems,
} from './metadata-redaction.js';

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
