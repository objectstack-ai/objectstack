// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';

/**
 * Identity tables managed by the better-auth plugin (see
 * `packages/platform-objects/src/identity/`). Mutations to these tables
 * MUST flow through the better-auth API endpoints (sign-up, password
 * reset, organization invite/remove-member, api-key/create, …) rather
 * than the generic CRUD pipeline so that password hashing, token
 * signing, email verification, invitation flows and scope hashing all
 * fire correctly.
 *
 * The default member/viewer permission sets therefore explicitly DENY
 * `allowCreate / allowEdit / allowDelete` on these objects while still
 * permitting reads (subject to the rest of the RLS chain). Admin
 * permission sets keep their `*` wildcard so they can rescue data
 * directly when needed.
 *
 * Each entry mirrors the `managedBy: 'better-auth'` flag declared on
 * the corresponding object schema in `packages/platform-objects/src/identity/`.
 */
const BETTER_AUTH_MANAGED_OBJECTS = [
  'sys_user',
  'sys_account',
  'sys_session',
  'sys_organization',
  'sys_member',
  'sys_invitation',
  'sys_team',
  'sys_team_member',
  'sys_api_key',
  'sys_two_factor',
  'sys_verification',
  'sys_jwks',
  'sys_device_code',
  'sys_oauth_application',
  'sys_oauth_access_token',
  'sys_oauth_refresh_token',
  'sys_oauth_consent',
] as const;

const denyWritesOnManagedObjects = (): Record<string, {
  allowRead: boolean;
  allowCreate: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
}> => Object.fromEntries(
  BETTER_AUTH_MANAGED_OBJECTS.map((name) => [
    name,
    { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  ]),
);

/**
 * Default permission sets seeded by the platform.
 *
 * These are referenced by name (`admin_full_access`, `member_default`,
 * `viewer_readonly`) from `sys_role_permission_set` rows or assigned
 * directly to users via `sys_user_permission_set`.
 *
 * The runtime SecurityPlugin reads these via the metadata service when a
 * permission set name appears in the request `ExecutionContext.permissions[]`.
 *
 * Each entry is run through `PermissionSetSchema.parse(...)` so Zod fills
 * in the boolean/`priority`/`enabled` defaults — keeping the literal
 * source readable while still satisfying the strict output type.
 *
 * `objects: { '*': … }` uses the wildcard sentinel honoured by
 * `PermissionEvaluator` — admins do not need an explicit row per object.
 * Per-object entries fully override the wildcard for that object (see
 * `PermissionEvaluator.checkObjectPermission` — lookup, not merge).
 *
 * RLS policies use the canonical `current_user.*` placeholders compiled
 * by `RLSCompiler`. The active organization is exposed under
 * `current_user.organization_id` (sourced from
 * `ExecutionContext.tenantId` at request time) — there is no rewrite
 * step or `tenantField` indirection in SecurityPlugin. Schemas with a
 * different physical tenant column should fork these defaults.
 */
export const defaultPermissionSets: PermissionSet[] = [
  PermissionSetSchema.parse({
    name: 'admin_full_access',
    label: 'Administrator — Full Access',
    isProfile: true,
    objects: {
      '*': {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
        viewAllRecords: true,
        modifyAllRecords: true,
      },
    },
    systemPermissions: ['manage_users', 'manage_metadata', 'setup.access'],
  }),
  PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member — Standard Access',
    isProfile: true,
    objects: {
      '*': {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
      },
      // Identity tables are managed by better-auth — no direct writes.
      ...denyWritesOnManagedObjects(),
    },
    rowLevelSecurity: [
      {
        name: 'tenant_isolation',
        object: '*',
        operation: 'all',
        using: 'organization_id = current_user.organization_id',
      },
      {
        name: 'owner_only_writes',
        object: '*',
        operation: 'update',
        using: 'owner_id = current_user.id',
      },
      {
        name: 'owner_only_deletes',
        object: '*',
        operation: 'delete',
        using: 'owner_id = current_user.id',
      },
      // ── better-auth system tables that lack `organization_id` and would
      //    otherwise be left unprotected by the wildcard rule above. ────
      //
      // The security plugin's RLS injector treats wildcard policies that
      // target a missing field as `RLS_DENY_FILTER` (zero rows) unless a
      // per-object policy contributes an alternate match. Each `*_self`
      // policy below restores per-user visibility on a better-auth table
      // that has `user_id` but no `organization_id`. Tables without
      // `user_id` (`sys_verification`, `sys_jwks`, empty `sys_passkey`)
      // stay DENY for non-admins by design — only platform admins (via
      // `admin_full_access`, which has no RLS) should inspect them.
      {
        name: 'sys_organization_self',
        object: 'sys_organization',
        operation: 'all',
        using: 'id = current_user.organization_id',
      },
      {
        name: 'sys_user_self',
        object: 'sys_user',
        operation: 'select',
        using: 'id = current_user.id',
      },
      {
        name: 'sys_session_self',
        object: 'sys_session',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_account_self',
        object: 'sys_account',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_team_member_self',
        object: 'sys_team_member',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_two_factor_self',
        object: 'sys_two_factor',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_user_preference_self',
        object: 'sys_user_preference',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_api_key_self',
        object: 'sys_api_key',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_device_code_self',
        object: 'sys_device_code',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_access_token_self',
        object: 'sys_oauth_access_token',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_refresh_token_self',
        object: 'sys_oauth_refresh_token',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_consent_self',
        object: 'sys_oauth_consent',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
    ],
  }),
  PermissionSetSchema.parse({
    name: 'viewer_readonly',
    label: 'Viewer — Read-Only',
    isProfile: true,
    objects: {
      '*': {
        allowRead: true,
        allowCreate: false,
        allowEdit: false,
        allowDelete: false,
      },
      // Belt-and-suspenders: explicit deny on managed objects even though
      // the wildcard already denies — keeps the policy readable when
      // future relaxations might widen the wildcard.
      ...denyWritesOnManagedObjects(),
    },
    rowLevelSecurity: [
      {
        name: 'tenant_isolation',
        object: '*',
        operation: 'select',
        using: 'organization_id = current_user.organization_id',
      },
      {
        name: 'sys_organization_self',
        object: 'sys_organization',
        operation: 'select',
        using: 'id = current_user.organization_id',
      },
      {
        name: 'sys_user_self',
        object: 'sys_user',
        operation: 'select',
        using: 'id = current_user.id',
      },
      // ── Per-user visibility on better-auth tables that lack
      //    `organization_id` (matches the `member_default` carve-outs).
      {
        name: 'sys_session_self',
        object: 'sys_session',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_account_self',
        object: 'sys_account',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_team_member_self',
        object: 'sys_team_member',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_two_factor_self',
        object: 'sys_two_factor',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_user_preference_self',
        object: 'sys_user_preference',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_api_key_self',
        object: 'sys_api_key',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_device_code_self',
        object: 'sys_device_code',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_access_token_self',
        object: 'sys_oauth_access_token',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_refresh_token_self',
        object: 'sys_oauth_refresh_token',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
      {
        name: 'sys_oauth_consent_self',
        object: 'sys_oauth_consent',
        operation: 'select',
        using: 'user_id = current_user.id',
      },
    ],
  }),
];
