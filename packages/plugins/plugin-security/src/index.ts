// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-security
 * 
 * Security Plugin for ObjectStack
 * Provides RBAC, Row-Level Security (RLS), and Field-Level Security runtime.
 */

export { SecurityPlugin } from './security-plugin.js';
export { PermissionEvaluator } from './permission-evaluator.js';
export { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
export { FieldMasker, maskFieldValue, MASK_CHAR } from './field-masker.js';
export { assertReadableQueryFields, collectQueryFields, collectConditionFields } from './predicate-guard.js';
export { PermissionDeniedError, isPermissionDeniedError } from './errors.js';
export {
  securityObjects,
  securityDefaultPermissionSets,
  securityPluginManifestHeader,
  SECURITY_PLUGIN_ID,
  SECURITY_PLUGIN_VERSION,
} from './manifest.js';
export {
  reconcileOrgAdminGrant,
  backfillOrgAdminGrants,
  // [#4586] The auto-grant's machine-provenance marker + its `reason` builder.
  // Exported so a reader of the grant table (explain surfaces, compliance
  // exports, tests) matches the ONE prefix this writer stamps instead of
  // re-deriving the string.
  AUTO_ORG_ADMIN_GRANT_REASON_PREFIX,
  autoOrgAdminGrantReason,
} from './auto-org-admin-grant.js';
export { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
// [#11974 / #11663 L4] The read-only platform-admin audit surface (registered
// as the `platformAdmin` service by SecurityPlugin) — config-derived standing
// for the deployment's declared administrators, since walled postures mint no
// grant row to query any more.
export {
  createPlatformAdminService,
  resolvePlatformAdminStanding,
} from './platform-admin-service.js';
export type {
  PlatformAdminService,
  PlatformAdminStandingEntry,
  PlatformAdminConfiguredEmails,
} from './platform-admin-service.js';
// [ADR-0105 D8] Scoped-invitation placement — issuance gate + accept-time apply.
export {
  INVITATION_PLACEMENT_SERVICE,
  createInvitationPlacementService,
  readPlacementIntent,
} from './invitation-placement.js';
export type {
  InvitationPlacementIntent,
  InvitationPlacementService,
} from './invitation-placement.js';
export { bootstrapDeclaredPermissions } from './bootstrap-declared-permissions.js';
// [ADR-0094] sys_permission_set pure-projection machinery.
export {
  permissionSetRowFields,
  permissionSetBodyFromRow,
  upsertEnvPermissionSet,
  projectPermissionMutation,
  registerPermissionSetProjection,
  createPermissionSetWriteThrough,
  reconcilePermissionSetProjection,
} from './permission-set-projection.js';
export type {
  PermissionSeedOutcome,
  ProjectionDeps,
  ProjectionReconcileOutcome,
  WriteThroughDeps,
} from './permission-set-projection.js';
export { cleanupPackagePermissions } from './cleanup-package-permissions.js';
export type { PackagePermissionCleanupOutcome } from './cleanup-package-permissions.js';
export { objectPostureGate, registerObjectPostureGate } from './object-posture-gate.js';
export type { ObjectPostureGateContext } from './object-posture-gate.js';
export { claimSeedOwnership } from './claim-seed-ownership.js';
export { normalizeManagedByVocab } from './normalize-managed-by.js';
export {
  appDefaultPermissionSetName,
  appSecurityPluginOptions,
  composeHumanBaselinePermissionSets,
  PLATFORM_BASELINE_PERMISSION_SET,
} from './app-default-permission-set.js';
export { DelegatedAdminGate, isTenantAdmin } from './delegated-admin-gate.js';
export { assertEngineOwnedWriteAllowed, ENGINE_OWNED_BUCKETS } from './system-write-guard.js';
export type { EngineOwnedSchemaLike } from './system-write-guard.js';
export { explainAccess, buildContextForUser } from './explain-engine.js';
export type { ExplainEngineDeps, ExplainInput } from './explain-engine.js';
export type { DelegatedAdminGateDeps } from './delegated-admin-gate.js';
export {
  syncAudienceBindingSuggestions,
  reconcileAudienceBindingSuggestions,
  reapOrganizationLessSuggestions,
  listSuggestionOrganizationIds,
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  SuggestionNotFoundError,
  SuggestionStateError,
} from './suggested-audience-bindings.js';
export type {
  SuggestionDeps,
  SuggestionListFilter,
  SuggestionSyncOutcome,
  SuggestionReconcileOutcome,
  SuggestionReconcileScope,
} from './suggested-audience-bindings.js';
// [field report — rc→GA declared≠enforced surfacing] "declared ≠ enforced"
// per-set diagnostics (overlay_shadow / provenance_skip) + the sanctioned
// operator discard action.
export {
  computePermissionSetDriftDiagnostics,
  persistPermissionSetDriftDiagnostics,
  runPermissionSetDriftDiagnostics,
} from './permission-set-drift.js';
export type {
  PermissionSetDriftStatus,
  PermissionSetDriftDiagnostic,
  DriftDiagnosticsOptions,
} from './permission-set-drift.js';
export {
  discardPermissionSetOverlay,
  PermissionSetNotFoundError,
  PermissionSetOverlayStateError,
} from './permission-set-overlay-discard.js';
export type {
  PermissionSetOverlayDiscardDeps,
  PermissionSetOverlayDiscardResult,
} from './permission-set-overlay-discard.js';
// [maintainer ruling 2026-08-24 — 「同意 第一步(创业阶段,Salesforce 式)」]
// Lock the base, clone to customize: the write-door provenance rule and its
// refusals, plus the DETECTION READING for overlays that already exist.
// ⛔ The reading reaps nothing — disposition of existing forks is a follow-up
// reading for the maintainer.
export {
  ENV_PROJECTION_MARKER,
  classifyPackagedPermissionSet,
  assertPermissionSetNotPackageDeclared,
  PackagedPermissionSetLockedError,
  PackagedPermissionSetProvenanceUnknownError,
} from './packaged-permission-set-lock.js';
export type {
  PackagedSetVerdict,
  LayeredProbe,
} from './packaged-permission-set-lock.js';
// [#11843 — maintainer ruling 2026-08-25, option B] The lock's METADATA-door
// registration: the pre-persistence authoring-gate seam consults the SAME
// classifier and throws the SAME error classes as the data door above.
export { registerPackagedPermissionSetLockGate } from './packaged-permission-set-lock-gate.js';
export type { PermissionSetLockGateContext } from './packaged-permission-set-lock-gate.js';
export {
  OVERLAY_PAGE_LIMIT,
  detectPackagedPermissionSetOverlays,
  reportPackagedPermissionSetOverlays,
} from './packaged-permission-set-overlay-detection.js';
export type {
  PackagedPermissionSetOverlayFinding,
  PackagedPermissionSetOverlayReading,
  OverlayDetectionOptions,
} from './packaged-permission-set-overlay-detection.js';
