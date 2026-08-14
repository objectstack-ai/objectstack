// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Security Module
 * 
 * Provides security features for the ObjectStack microkernel:
 * - Plugin signature verification
 * - Plugin configuration validation
 * - Permission and capability enforcement
 * 
 * @module @objectstack/core/security
 */

export {
  PluginSignatureVerifier,
  type PluginSignatureConfig,
  type SignatureVerificationResult,
} from './plugin-signature-verifier.js';

// Canonical Ed25519 artifact-signature contract (ADR-0025 F3), shared
// byte-for-byte with the cloud control plane's package-signing.
export {
  SIGNATURE_ALG,
  type KeyInput,
  type ParsedSignature,
  type PublisherVerifyResult,
  type PluginArtifactVerifyResult,
  generateEd25519KeyPair,
  signPayload,
  parseSignature,
  verifyPayload,
  counterSignPayload,
  verifyPublisherSignature,
  verifyPlatformSignature,
  verifyPluginArtifact,
} from './plugin-artifact-signature.js';

export {
  PluginConfigValidator,
  createPluginConfigValidator,
} from './plugin-config-validator.js';

export {
  PluginPermissionEnforcer,
  SecurePluginContext,
  createPluginPermissionEnforcer,
  buildPermissionsFromGrants,
  type PluginPermissions,
  type PermissionCheckResult,
} from './plugin-permission-enforcer.js';

// Advanced security components (Phase 2)
export {
  PluginPermissionManager,
  type PermissionGrant,
  type PermissionCheckResult as PluginPermissionCheckResult,
} from './permission-manager.js';

export {
  PluginSandboxRuntime,
  type SandboxContext,
  type ResourceUsage,
} from './sandbox-runtime.js';

export {
  PluginSecurityScanner,
  type ScanTarget,
  type SecurityIssue,
} from './security-scanner.js';

export {
  API_KEY_PREFIX,
  hashApiKey,
  generateApiKey,
  extractApiKey,
  parseScopes,
  isExpired,
  resolveApiKeyPrincipal,
  resolveApiKeyAdmission,
  effectiveTenancyPosture,
  type GeneratedApiKey,
  type ApiKeyPrincipal,
  type ApiKeyAdmission,
  type ApiKeyRefusalReason,
  type TenancyPostureSource,
} from './api-key.js';

export {
  resolveAuthzContext,
  resolveUserAuthzGrants,
  resolveLocalizationContext,
  type ResolvedAuthzContext,
  type ResolveAuthzInput,
  type UserAuthzGrants,
  type ResolveUserAuthzGrantsOptions,
  type ResolveLocalizationInput,
} from './resolve-authz-context.js';

// #6216 (maintainer ruling 2026-08-08, Option A) — the SINGLE ExecutionContext
// assembly shared by every transport entry point, with the anonymous face as
// two NAMED entries (fail-closed default / explicit guest) instead of drift.
export {
  assembleExecutionContext,
  assembleExecutionContextOrGuest,
  ENTRY_EXECUTION_CONTEXT_FIELDS,
  type EntryExecutionContextField,
  type ExecutionContextEntryFields,
  type ExecutionContextAssemblyInput,
  type OAuthTokenProvenance,
  type EntryLocalization,
} from './assemble-execution-context.js';

// ADR-0095 D2/D3 — the monotonic posture ladder: derivation from capability
// grants + the rung→injection-rule mapping and its tested invariants.
export {
  POSTURE_LADDER,
  POSTURE_RANK,
  POSTURE_INJECTION_RULE,
  derivePosture,
  postureVisibleRows,
  type PostureEvidence,
  type LadderRow,
  type LadderPrincipal,
} from './posture-ladder.js';
export {
  isAuthGateAllowlisted,
  evaluateAuthGate,
  normalizeAuthGate,
  type AuthGate,
} from './auth-gate.js';

// #2567 — the single anonymous-deny decision shared by every HTTP seam.
export {
  shouldDenyAnonymous,
  ANONYMOUS_DENY_BODY,
  ANONYMOUS_DENY_STATUS,
  ANONYMOUS_DENY_CODE,
  ANONYMOUS_DENY_MESSAGE,
  type AnonymousDenyInput,
} from './anonymous-deny.js';

// ADR-0091 D1/D2 — grant validity windows, the shared resolution-time predicate.
export { isGrantActive, isGrantExpired, type GrantValidityWindow } from './grant-validity.js';

// ADR-0049 enforce-or-remove — the `active` flag on the RBAC grant catalogues
// (`sys_permission_set` / `sys_position`). One predicate for the resolver that
// enforces it and the break-glass guard that simulates a write to it.
export { isRowActive, type ActivatableRow } from './row-active.js';

// [#7678] ADR-0090 D5/D9 — the audience-binding suggestion `?status=` vocabulary,
// shared by the runtime dispatcher's `/security` domain and the live REST route.
export {
  AUDIENCE_BINDING_SUGGESTION_STATUSES,
  AUDIENCE_BINDING_SUGGESTION_STATUS_VALUES,
  isAudienceBindingSuggestionStatus,
  unknownAudienceBindingSuggestionStatusMessage,
  type AudienceBindingSuggestionStatus,
} from './audience-binding-suggestion-status.js';

// #7284 — the `__` operation-private-key convention, the CONSUMER half of the
// ExecutionContext lifecycle `assemble-execution-context.ts` opens. One owner
// for the rule three packages had hand-copied (#7141 / #7145 / #7204).
export {
  OPERATION_PRIVATE_KEY_PREFIX,
  withoutOperationPrivateKeys,
} from './operation-private-keys.js';
