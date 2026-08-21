// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical registry of PLATFORM-PROVIDED object names (issue #3583).
 *
 * A stack legitimately references objects it does not itself define — the
 * platform contributes `sys_user`, an installed plugin contributes
 * `sys_approval_request`, the cloud runtime contributes `sys_app`. Every
 * cross-reference check therefore needs an answer to "is this name real, or a
 * typo?", and until this module existed each one guessed with a **prefix
 * heuristic** (`name.startsWith('sys_')` in `validate-flow-trigger-readiness`
 * and `validate-security-posture`; `/^(sys_|cloud_|ai_)/` in `stack.zod.ts`).
 *
 * A prefix guess cannot distinguish `sys_user` (real) from
 * `sys_approval_process` (fictional — removed by ADR-0019, registered by
 * nothing), so every fictional platform-prefixed reference shipped silently.
 * That is exactly the bug class the HotCRM audit found, and the reason this
 * list is a **curated set of real names** rather than a pattern.
 *
 * Structure mirrors the {@link PLATFORM_CAPABILITIES} precedent: the contract
 * package owns the list (everything depends on spec, so no dependency
 * inversion), and the OWNING packages carry conformance tests asserting the
 * list matches what they actually register. Lint consumes it through the
 * documented `@objectstack/spec` dependency — it never imports
 * `platform-objects` or a plugin (see `@objectstack/lint`'s one-way rule).
 *
 * Maintenance contract: adding an object to a platform package means adding
 * its name here. The owning package's conformance test fails otherwise — an
 * out-of-date registry is worse than the heuristic it replaced, because
 * consumers now trust it.
 */

/**
 * Objects contributed by packages IN THIS REPOSITORY, grouped by owning
 * package. Each group is the exact set that package registers.
 */
export const PLATFORM_OBJECTS_BY_PACKAGE: Readonly<Record<string, readonly string[]>> = {
  /** `@objectstack/metadata-core` — metadata storage & commit history. */
  'metadata-core': [
    'sys_metadata',
    'sys_metadata_audit',
    'sys_metadata_commit',
    'sys_metadata_history',
    'sys_view_definition',
  ],
  /** `@objectstack/platform-objects` — identity, org, auth, settings, jobs. */
  'platform-objects': [
    'sys_account',
    'sys_api_key',
    'sys_attachment',
    'sys_business_unit',
    'sys_business_unit_member',
    'sys_device_code',
    'sys_email',
    'sys_email_template',
    'sys_import_job',
    'sys_invitation',
    'sys_job',
    'sys_job_queue',
    'sys_job_run',
    'sys_jwks',
    'sys_member',
    'sys_migration',
    'sys_migration_journal',
    'sys_notification',
    'sys_oauth_access_token',
    'sys_oauth_application',
    'sys_oauth_client_assertion',
    'sys_oauth_client_resource',
    'sys_oauth_consent',
    'sys_oauth_refresh_token',
    'sys_oauth_resource',
    'sys_organization',
    'sys_report_schedule',
    'sys_saved_report',
    'sys_scim_provider',
    'sys_secret',
    'sys_session',
    'sys_setting',
    'sys_setting_audit',
    'sys_sso_provider',
    'sys_team',
    'sys_team_member',
    'sys_two_factor',
    'sys_user',
    'sys_user_preference',
    'sys_verification',
  ],
  /** `@objectstack/plugin-approvals` — ADR-0019 approval-as-flow-node runtime. */
  'plugin-approvals': [
    'sys_approval_action',
    'sys_approval_approver',
    'sys_approval_delegation',
    'sys_approval_request',
    'sys_approval_token',
  ],
  /** `@objectstack/plugin-audit` — audit trail & activity feed (ADR-0052). */
  'plugin-audit': ['sys_activity', 'sys_audit_log', 'sys_comment'],
  /** `@objectstack/plugin-security` — ADR-0090 permission model v2. */
  'plugin-security': [
    'sys_audience_binding_suggestion',
    'sys_capability',
    'sys_permission_set',
    'sys_position',
    'sys_position_permission_set',
    'sys_user_permission_set',
    'sys_user_position',
  ],
  /** `@objectstack/plugin-sharing` — record shares & share links. */
  'plugin-sharing': ['sys_record_share', 'sys_share_link', 'sys_sharing_rule'],
  /** `@objectstack/plugin-webhooks` — outbound webhook registrations. */
  'plugin-webhooks': ['sys_webhook'],
  /** `@objectstack/service-automation` — flow run history + dispatch-idempotency ledger. */
  'service-automation': ['sys_automation_run', 'sys_flow_dispatch'],
  /** `@objectstack/service-messaging` — notification & delivery pipeline. */
  'service-messaging': [
    'sys_http_delivery',
    'sys_inbox_message',
    'sys_notification_delivery',
    'sys_notification_preference',
    'sys_notification_receipt',
    'sys_notification_subscription',
    'sys_notification_template',
  ],
  /** `@objectstack/service-realtime` — presence state. */
  'service-realtime': ['sys_presence'],
  /** `@objectstack/service-storage` — file storage & upload sessions. */
  'service-storage': ['sys_file', 'sys_upload_session'],
} as const;

/**
 * Objects contributed by the CLOUD runtime (`@objectstack/service-tenant`,
 * defined in the separate `cloud` repository). They do not exist in a
 * single-environment OSS runtime, which is precisely why `NavigationItem`
 * documents `requiresObject: 'sys_app'` as the way to reference one safely.
 *
 * Listed here so a cloud-targeted stack is not told its references are
 * fictional. They cannot be conformance-tested from this repo — the cloud repo
 * owns that half of the contract.
 */
export const CLOUD_PROVIDED_OBJECT_NAMES: readonly string[] = [
  'sys_app',
  'sys_environment',
  'sys_environment_member',
  'sys_package',
  'sys_package_installation',
];

/**
 * Every platform-provided object name (this repo + cloud), for fast membership
 * checks in lint rules and cross-reference validation.
 */
export const PLATFORM_PROVIDED_OBJECT_NAMES: ReadonlySet<string> = new Set([
  ...Object.values(PLATFORM_OBJECTS_BY_PACKAGE).flat(),
  ...CLOUD_PROVIDED_OBJECT_NAMES,
]);

/**
 * Namespace prefixes reserved for platform-provided objects. A stack's own
 * objects may not use them (`defineStack` namespace rules), so an unresolved
 * name carrying one of these is "expected from elsewhere" rather than "surely a
 * typo" — the distinction that drives severity (see
 * {@link isPlatformProvidedObjectName}).
 */
export const PLATFORM_OBJECT_PREFIXES: readonly string[] = ['sys_', 'cloud_', 'ai_'];

/**
 * Does `name` carry a reserved platform namespace prefix?
 *
 * This is the OLD heuristic, kept as an explicit, named predicate because it
 * still answers a real question — "could this name legitimately come from
 * outside this stack?" — for third-party packages the registry cannot know
 * about. Callers must NOT use it as proof the object exists; pair it with
 * {@link isPlatformProvidedObjectName} to tell a real platform object from a
 * fictional one.
 */
export function hasPlatformObjectPrefix(name: string): boolean {
  return PLATFORM_OBJECT_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Is `name` a KNOWN platform-provided object (registered by a package in this
 * repo, or by the cloud runtime)?
 *
 * `true` means the reference resolves against a real object contributed
 * outside the stack. `false` for a platform-prefixed name means "no known
 * package registers this" — the `sys_approval_process` case: advisory, not
 * fatal, because a third-party package may legitimately provide it.
 */
export function isPlatformProvidedObjectName(name: string): boolean {
  return PLATFORM_PROVIDED_OBJECT_NAMES.has(name);
}
