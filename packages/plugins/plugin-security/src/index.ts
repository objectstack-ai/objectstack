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
export { FieldMasker } from './field-masker.js';
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
} from './auto-org-admin-grant.js';
export { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
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
export { claimSeedOwnership } from './claim-seed-ownership.js';
export { appDefaultPermissionSetName } from './app-default-permission-set.js';
export { DelegatedAdminGate, isTenantAdmin } from './delegated-admin-gate.js';
export { explainAccess, buildContextForUser } from './explain-engine.js';
export type { ExplainEngineDeps, ExplainInput } from './explain-engine.js';
export type { DelegatedAdminGateDeps } from './delegated-admin-gate.js';
export {
  syncAudienceBindingSuggestions,
  listAudienceBindingSuggestions,
  confirmAudienceBindingSuggestion,
  dismissAudienceBindingSuggestion,
  SuggestionNotFoundError,
  SuggestionStateError,
} from './suggested-audience-bindings.js';
export type { SuggestionDeps, SuggestionListFilter, SuggestionSyncOutcome } from './suggested-audience-bindings.js';
