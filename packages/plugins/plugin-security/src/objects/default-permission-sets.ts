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
    systemPermissions: [
      'manage_users',
      'manage_metadata',
      'manage_platform_settings',
      'setup.access',
      'studio.access',
    ],
  }),
  // ── Organization Administrator ──────────────────────────────────────
  //
  // Third tier between platform admin (`admin_full_access`) and rank-and-file
  // member. Lives at the *organization* scope: full CRUD on business
  // objects within their org (governed by `tenant_isolation` RLS), plus
  // `setup.access` so the Setup app shell is reachable.
  //
  // **Deliberately withheld** vs `admin_full_access`:
  //   - `studio.access` — schema-design surfaces are platform-level (a
  //     tenant cannot mutate the shared metadata) and Studio is hidden.
  //   - `manage_metadata` — same reasoning.
  //   - `manage_platform_settings` — global settings manifests
  //     (mail / storage / AI / knowledge) and platform-only Setup pages
  //     (sharing rules, audit logs, OAuth apps, JWKS, …) require this
  //     and are hidden / 403'd for org admins. Tenant-scoped manifests
  //     (`branding`, `feature_flags`) keep using `setup.access` so org
  //     admins CAN configure their own org's branding.
  //
  // **Anti-escalation**: writes to the global RBAC tables
  // (`sys_role`, `sys_permission_set`, `sys_role_permission_set`,
  // `sys_user_permission_set`, `sys_user_role`) are denied. Allowing
  // them would let an org admin bind `admin_full_access` (which has no
  // RLS) to themselves and break out of tenant isolation. Reads are
  // permitted so the Roles / Permission Sets nav entries still render.
  //
  // Auto-granted to every `sys_member` whose role contains `owner` or
  // `admin` by `plugin-security/src/auto-org-admin-grant.ts`.
  PermissionSetSchema.parse({
    name: 'organization_admin',
    label: 'Organization Administrator',
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
      // Identity tables — go through better-auth endpoints (invite,
      // accept, remove-member, transfer, …) rather than raw CRUD.
      ...denyWritesOnManagedObjects(),
      // RBAC tables — read-only to prevent privilege escalation.
      sys_role: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_role_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_user_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_user_role: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    systemPermissions: ['manage_org_users', 'setup.access'],
    rowLevelSecurity: [
      {
        name: 'tenant_isolation',
        object: '*',
        operation: 'all',
        using: 'organization_id = current_user.organization_id',
      },
      // ── better-auth system tables that lack `organization_id` and would
      //    otherwise be denied by the wildcard policy. Same self-only
      //    carve-outs as `member_default` — an org admin does not get to
      //    inspect cross-tenant identity rows.
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
        name: 'sys_user_org_members',
        object: 'sys_user',
        operation: 'select',
        using: 'id IN (current_user.org_user_ids)',
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
      // OAuth applications a user has registered themselves (self-service
      // developer flow exposed in the Account app's Developer section).
      // `sys_oauth_application` has no `organization_id` so the wildcard
      // `tenant_isolation` policy would otherwise deny every row.
      {
        name: 'sys_oauth_application_self',
        object: 'sys_oauth_application',
        operation: 'all',
        using: 'user_id = current_user.id',
      },
      // Org-scoped visibility for organization-owned identity-adjacent
      // tables. Org admins may inspect their own org's invitations and
      // memberships (read; writes still flow through better-auth).
      {
        name: 'sys_member_org',
        object: 'sys_member',
        operation: 'select',
        using: 'organization_id = current_user.organization_id',
      },
      {
        name: 'sys_invitation_org',
        object: 'sys_invitation',
        operation: 'select',
        using: 'organization_id = current_user.organization_id',
      },
      {
        name: 'sys_team_org',
        object: 'sys_team',
        operation: 'select',
        using: 'organization_id = current_user.organization_id',
      },
    ],
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
      // Owner-scoped writes/deletes for rank-and-file members: you may modify
      // and delete the records you created, not other users'. Keyed on
      // `created_by` — the column the engine stamps on EVERY record — rather
      // than `owner_id`, which author-defined objects almost never declare. The
      // old `owner_id` key referenced a missing column on real objects, so
      // `computeRlsFilter` dropped the policy and the scoping silently no-op'd
      // (any member could edit/delete any record — #1985). These policies are
      // ENFORCED on writes via the security middleware's pre-image check (a
      // by-id update/delete never builds an RLS `where`, so the predicate is
      // verified against the target row before the mutation). Objects that
      // model transferable ownership with a dedicated owner field should
      // override these with a per-object policy.
      {
        name: 'owner_only_writes',
        object: '*',
        operation: 'update',
        using: 'created_by = current_user.id',
      },
      {
        name: 'owner_only_deletes',
        object: '*',
        operation: 'delete',
        using: 'created_by = current_user.id',
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
      // Org collaborators: members can see other users in the same
      // organization. Without this, owner/assignee lookups, @-mention
      // suggestions, reviewer pickers and team-roster surfaces all
      // collapse to just the current user. `org_user_ids` is
      // pre-resolved by runtime/resolve-execution-context from
      // `sys_member` for the active organization. Sensitive credential
      // tables (`sys_account`, `sys_session`, `sys_api_key`, …) keep
      // their stricter self-only carve-outs above.
      {
        name: 'sys_user_org_members',
        object: 'sys_user',
        operation: 'select',
        using: 'id IN (current_user.org_user_ids)',
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
      // OAuth applications a user has registered themselves (Account →
      // Developer → OAuth Applications). `sys_oauth_application` has no
      // `organization_id`, so without this carve-out the wildcard
      // `tenant_isolation` policy returns zero rows even for the owner.
      {
        name: 'sys_oauth_application_self',
        object: 'sys_oauth_application',
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
      // Org collaborators (read-only): see `sys_user_org_members` in
      // `member_default` for rationale.
      {
        name: 'sys_user_org_members',
        object: 'sys_user',
        operation: 'select',
        using: 'id IN (current_user.org_user_ids)',
      },
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
