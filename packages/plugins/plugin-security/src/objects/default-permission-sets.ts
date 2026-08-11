// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import {
  MCP_AGENT_PERMISSION_SET_READ,
  MCP_AGENT_PERMISSION_SET_WRITE,
  MCP_AGENT_PERMISSION_SET_RESTRICTED,
} from '@objectstack/spec/ai';

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
 * This is the COMPILE-TIME BASELINE. At `kernel:ready` it is unioned with the
 * live registry by `applyManagedWriteDenies` (see `managed-object-write-denies.ts`),
 * which injects a deny entry for every registered `managedBy: 'better-auth'`
 * object the baseline missed — so a newly-declared identity table is covered
 * automatically without editing this list. The baseline still matters: it covers
 * the pre-`kernel:ready` window and hook-less test-stub kernels where the
 * registry may be empty. `objects/default-permission-sets.test.ts` pins this
 * list bidirectionally against the `@objectstack/platform-objects` schemas so it
 * cannot silently rot again (the drift that motivated ADR-0092's registry-driven
 * rule).
 */
export const BETTER_AUTH_MANAGED_OBJECTS = [
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
  'sys_scim_provider',
  'sys_sso_provider',
  'sys_oauth_application',
  'sys_oauth_access_token',
  'sys_oauth_refresh_token',
  'sys_oauth_consent',
  'sys_oauth_resource',
  'sys_oauth_client_resource',
  'sys_oauth_client_assertion',
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
 * `viewer_readonly`) from `sys_position_permission_set` rows or assigned
 * directly to users via `sys_user_permission_set`.
 *
 * The runtime SecurityPlugin reads these via the metadata service when a
 * permission set name appears in the request `ExecutionContext.permissions[]`.
 *
 * Each entry is run through `PermissionSetSchema.parse(...)` so Zod fills
 * in the boolean/`enabled` defaults — keeping the literal
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
const baseDefaultPermissionSets: PermissionSet[] = [
  PermissionSetSchema.parse({
    name: 'admin_full_access',
    label: 'Administrator — Full Access',
    objects: {
      '*': {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
        viewAllRecords: true,
        modifyAllRecords: true,
        // [#3544] Export is an OPT-IN grant and is deliberately NOT implied by
        // the super-user bits — "may see all data" and "may take a bulk copy of
        // it" are separable on purpose (SAP S_GUI 61 / segregation of duties).
        // Stated explicitly so the platform administrator keeps export, and so
        // a deployment wanting that separation has one obvious line to remove.
        allowExport: true,
      },
    },
    systemPermissions: [
      'manage_users',
      'manage_metadata',
      'manage_platform_settings',
      // [ADR-0111 D9] Sharing administration — gates the sharing-rule surface
      // and (in the DEPTH extension) non-owner share management.
      'manage_sharing',
      'setup.access',
      'setup.write',
      'studio.access',
    ],
  }),
  // ── Organization Administrator ──────────────────────────────────────
  //
  // Third tier between platform admin (`admin_full_access`) and rank-and-file
  // member. Lives at the *organization* scope: full CRUD on business
  // objects within their org (governed by the Layer 0 tenant wall, ADR-0095 D1), plus
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
  // (`sys_position`, `sys_permission_set`, `sys_position_permission_set`,
  // `sys_user_permission_set`, `sys_user_position`) are denied. Allowing
  // them would let an org admin bind `admin_full_access` (which has no
  // RLS) to themselves and break out of tenant isolation. Reads are
  // permitted so the Roles / Permission Sets nav entries still render.
  //
  // Auto-granted to every `sys_member` whose role contains `owner` or
  // `admin` by `plugin-security/src/auto-org-admin-grant.ts` — but ONLY under a
  // posture that enforces an organization wall. A wall-less deployment gets the
  // derived `organization_admin_no_bypass` variant instead, because nothing
  // would bound the `viewAllRecords`/`modifyAllRecords` bits below
  // (ADR-0105 D4 / finding F2). See `deriveWallLessOrgAdmin` at the end of this
  // file — the variant is derived from THIS declaration, never copied.
  PermissionSetSchema.parse({
    name: ORGANIZATION_ADMIN,
    label: 'Organization Administrator',
    objects: {
      '*': {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
        viewAllRecords: true,
        modifyAllRecords: true,
        // [#3544] Explicit — the super-user bits do not imply export. Bounded
        // by this set's organization wall (the `tenant_isolation` RLS below),
        // so it is an org-scoped export, never a cross-tenant one.
        allowExport: true,
      },
      // Identity tables — go through better-auth endpoints (invite,
      // accept, remove-member, transfer, …) rather than raw CRUD.
      ...denyWritesOnManagedObjects(),
      // RBAC tables — read-only to prevent privilege escalation.
      sys_position: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_position_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_user_permission_set: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_user_position: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    rowLevelSecurity: [
      // [ADR-0095 D1] The wildcard `tenant_isolation` policy RETIRED here — the
      // tenant wall is now Layer 0 (`tenant-layer.ts`), AND-composed ahead of and
      // independently of business RLS. Keeping it as an OR-merged RLS policy is
      // what let a permissive business policy widen tenant scope (W1). The
      // per-object `_org` / `_self` carve-outs below are NOT tenant walls — they
      // are identity-table scoping and stay.
      // ── better-auth system tables that lack `organization_id` and would
      //    otherwise be denied by the wildcard policy. Same self-only
      //    carve-outs as `member_default` — an org admin does not get to
      //    inspect cross-tenant identity rows.
      {
        name: 'sys_organization_self',
        object: 'sys_organization',
        operation: 'all',
        using: 'id == current_user.organization_id',
      },
      {
        name: 'sys_user_self',
        object: 'sys_user',
        operation: 'select',
        using: 'id == current_user.id',
      },
      {
        name: 'sys_user_org_members',
        object: 'sys_user',
        operation: 'select',
        using: 'id in current_user.org_user_ids',
      },
      {
        name: 'sys_session_self',
        object: 'sys_session',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_account_self',
        object: 'sys_account',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_team_member_self',
        object: 'sys_team_member',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_two_factor_self',
        object: 'sys_two_factor',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_user_preference_self',
        object: 'sys_user_preference',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_api_key_self',
        object: 'sys_api_key',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_device_code_self',
        object: 'sys_device_code',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_access_token_self',
        object: 'sys_oauth_access_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_refresh_token_self',
        object: 'sys_oauth_refresh_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_consent_self',
        object: 'sys_oauth_consent',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      // OAuth applications a user has registered themselves (self-service
      // developer flow exposed in the Account app's Developer section).
      // `sys_oauth_application` has no `organization_id`; this `_self` carve-out
      // is its Layer 1 scoping (Layer 0 is inert on a non-tenant object).
      {
        name: 'sys_oauth_application_self',
        object: 'sys_oauth_application',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      // Org-scoped visibility for organization-owned identity-adjacent
      // tables. Org admins may inspect their own org's invitations and
      // memberships (read; writes still flow through better-auth).
      {
        name: 'sys_member_org',
        object: 'sys_member',
        operation: 'select',
        using: 'organization_id == current_user.organization_id',
      },
      {
        name: 'sys_invitation_org',
        object: 'sys_invitation',
        operation: 'select',
        using: 'organization_id == current_user.organization_id',
      },
      {
        name: 'sys_team_org',
        object: 'sys_team',
        operation: 'select',
        using: 'organization_id == current_user.organization_id',
      },
    ],
  }),
  PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member — Standard Access',
    objects: {
      // [#5491] NO `'*'` WILDCARD GRANT. This set is the additive `everyone`
      // baseline — it resolves for EVERY authenticated member — and object
      // permissions merge most-permissively, so a wildcard here was not a
      // default, it was a FLOOR no app could get under. An application that
      // declared an explicit all-false deny on one of its objects still had
      // create, read and edit on it (only `allowDelete` stayed profile-driven,
      // because this set never granted it), and `security/explain` said so
      // outright: "create on 'crm_opportunity' is granted by [member_default]".
      // HotCRM's 17.0 GA sweep measured the consequence across 5 profiles ×
      // 17 objects: 21 of 21 create-denial probes returned 201, and on
      // `public_read` objects a non-holder read ALL rows.
      //
      // Maintainer ruling (2026-08-07): the platform baseline narrows to
      // explicit-allow. Object access comes from OWDs plus profile /
      // permission-set declarations only — declared IS enforced. Deny-precedence
      // merge semantics were considered and REJECTED; do not reintroduce a
      // wildcard here "with a priority", and do not reintroduce one at all.
      //
      // What a member still gets from this set is what the set can actually
      // NAME: read on the better-auth identity tables (below), self-service on
      // their own preferences, and the `_self` RLS carve-outs that scope both.
      // Everything else is the application's to declare.
      //
      // [ADR-0090 D5, #2753] There is still NO `allowDelete` anywhere in this
      // set: delete/purge/transfer are anchor-forbidden bits and the bootstrap
      // binds this set to the `everyone` anchor, so it must stay anchor-safe.
      // Deleting records is not a baseline right; grant it per object via an
      // ordinary (position-distributed) set where the domain calls for it.
      // The owner-scoped delete RLS below is KEPT as a narrowing defense for
      // members who receive a delete bit from such a set.
      //
      // [#3544] NO `allowExport` either, for the same reason and deliberately:
      // granting export here would hand bulk egress to every authenticated user
      // and make the opt-in axis a no-op. Do not "fix" its absence.
      //
      // Identity tables are managed by better-auth — readable, never written
      // directly. With the wildcard gone this is no longer a narrowing overlay
      // but the grant itself: it is what keeps `/auth/me`, the org switcher and
      // the Account app working for a member with no application profile.
      ...denyWritesOnManagedObjects(),
      // Self-service preferences. NOT a better-auth table, so it is not covered
      // by the block above, and its `sys_user_preference_self` RLS policy below
      // (`operation: 'all'`) declares exactly this intent: a member reads and
      // writes their OWN preference rows. Under the wildcard that grant was
      // implicit; making it explicit is the migration, not a widening — the
      // effective access for a member is byte-identical.
      sys_user_preference: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
      // [#7344] The personal inbox, READ-ONLY. Same reasoning as the line above,
      // applied to the other pair of platform objects a platform app points every
      // authenticated member at: the Account app's `Inbox` group declares a
      // Notifications entry with `requiresObject: 'sys_inbox_message'`
      // (`packages/platform-objects/src/apps/account.app.ts`) and declares no
      // `requiredPermissions`, so the app is reachable by design while the object
      // behind the entry was named by no shipped set — every non-admin got
      // `403 PERMISSION_DENIED` and the bell's notification half was structurally
      // zero. `sys_notification_receipt` rides along because read-state lives
      // there (ADR-0030), not on the inbox row, so the entry needs both.
      //
      // Maintainer ruling (2026-08-11): READ grants only. Rows are produced by
      // the always-on `inbox` messaging channel keyed on the recipient
      // (`service-messaging/src/inbox-channel.ts`) under the service's own engine
      // access, and mark-read is served by `/api/v1/notifications` rather than the
      // generic data API — so no create/edit bit is needed by the flow, and
      // `allowDelete` stays false like everything else in this anchor-bound set.
      // `sys_activity` is deliberately NOT included: it is not a per-user-scoped
      // shape (no `user_id` to scope by), and it is a separate question if it ever
      // matters. Two NAMED additions in #5491's explicit-allow shape — the
      // `_self` policies below scope both to the caller — not a widening pattern
      // and not a step back toward a wildcard.
      sys_inbox_message: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
      sys_notification_receipt: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    rowLevelSecurity: [
      // [ADR-0095 D1] The wildcard `tenant_isolation` policy RETIRED here — the
      // tenant wall is now Layer 0 (`tenant-layer.ts`). Its old OR-merge with the
      // owner-scoped policies below is exactly what widened a member's by-id write
      // back to org-wide (W1's write-side twin); Layer 0 now AND-composes the
      // tenant scope, so `owner_only_writes/deletes` finally narrow as intended.
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
      // [ADR-0090 P2] Applicability domain made EXPLICIT: with the baseline
      // resolving additively for every authenticated principal (the
      // `everyone` anchor — no more fallback cliff), these members-only
      // write restrictions must say who they bind. `org_member` is the
      // rank-and-file membership identity; org admins/owners and platform
      // admins are outside the domain, matching the pre-anchor behavior
      // where they simply never resolved this set.
      {
        name: 'owner_only_writes',
        object: '*',
        operation: 'update',
        using: 'created_by == current_user.id',
        positions: ['org_member'],
      },
      {
        name: 'owner_only_deletes',
        object: '*',
        operation: 'delete',
        using: 'created_by == current_user.id',
        positions: ['org_member'],
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
        using: 'id == current_user.organization_id',
      },
      {
        name: 'sys_user_self',
        object: 'sys_user',
        operation: 'select',
        using: 'id == current_user.id',
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
        using: 'id in current_user.org_user_ids',
      },
      {
        name: 'sys_session_self',
        object: 'sys_session',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_account_self',
        object: 'sys_account',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_team_member_self',
        object: 'sys_team_member',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_two_factor_self',
        object: 'sys_two_factor',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_user_preference_self',
        object: 'sys_user_preference',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_api_key_self',
        object: 'sys_api_key',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_device_code_self',
        object: 'sys_device_code',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_access_token_self',
        object: 'sys_oauth_access_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_refresh_token_self',
        object: 'sys_oauth_refresh_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_consent_self',
        object: 'sys_oauth_consent',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      // OAuth applications a user has registered themselves (Account →
      // Developer → OAuth Applications). `sys_oauth_application` has no
      // `organization_id`; this `_self` carve-out is its Layer 1 scoping
      // (Layer 0 is inert on a non-tenant object).
      {
        name: 'sys_oauth_application_self',
        object: 'sys_oauth_application',
        operation: 'all',
        using: 'user_id == current_user.id',
      },
      // [#7344] The personal inbox (Account → Inbox → Notifications, and the
      // console bell). Neither object declares `organization_id`, so Layer 0 is
      // inert on them exactly as it is on `sys_oauth_application` above and these
      // `_self` policies ARE their row scoping — without them the read bit added
      // to `objects` would be org-wide, which is the one outcome the ruling's
      // "RLS-scoped to the caller" forbids. `select` (not `all`) because the
      // grants are read-only; the writer is the inbox channel, not the member.
      {
        name: 'sys_inbox_message_self',
        object: 'sys_inbox_message',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_notification_receipt_self',
        object: 'sys_notification_receipt',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
    ],
  }),
  PermissionSetSchema.parse({
    name: 'viewer_readonly',
    label: 'Viewer — Read-Only',
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
      // [ADR-0095 D1] The wildcard `tenant_isolation` policy RETIRED here — the
      // tenant wall is now Layer 0 (`tenant-layer.ts`). The `_self` carve-outs
      // below are identity-table scoping, not tenant walls, and stay.
      {
        name: 'sys_organization_self',
        object: 'sys_organization',
        operation: 'select',
        using: 'id == current_user.organization_id',
      },
      {
        name: 'sys_user_self',
        object: 'sys_user',
        operation: 'select',
        using: 'id == current_user.id',
      },
      // Org collaborators (read-only): see `sys_user_org_members` in
      // `member_default` for rationale.
      {
        name: 'sys_user_org_members',
        object: 'sys_user',
        operation: 'select',
        using: 'id in current_user.org_user_ids',
      },
      {
        name: 'sys_session_self',
        object: 'sys_session',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_account_self',
        object: 'sys_account',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_team_member_self',
        object: 'sys_team_member',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_two_factor_self',
        object: 'sys_two_factor',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_user_preference_self',
        object: 'sys_user_preference',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_api_key_self',
        object: 'sys_api_key',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_device_code_self',
        object: 'sys_device_code',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_access_token_self',
        object: 'sys_oauth_access_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_refresh_token_self',
        object: 'sys_oauth_refresh_token',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
      {
        name: 'sys_oauth_consent_self',
        object: 'sys_oauth_consent',
        operation: 'select',
        using: 'user_id == current_user.id',
      },
    ],
  }),

  // ── [ADR-0090 D10] MCP agent ceiling sets ────────────────────────────────
  // The capability ceiling an OAuth-authenticated MCP agent runs under,
  // derived from the token's consented scopes (see
  // `scopesToAgentPermissionSets`). These are ONE SIDE of the D10 intersection:
  // the delegating user's own sets provide all row/owner/tenant narrowing, so
  // these carry pure CRUD bits and NO row-level security. They are never bound
  // to a position or an audience anchor — the producer
  // (`resolve-execution-context`) injects them onto the agent principal's
  // context directly — so the anchor high-privilege gate does not apply.
  PermissionSetSchema.parse({
    name: MCP_AGENT_PERMISSION_SET_READ,
    label: 'MCP Agent — Read Only',
    description:
      'Read-only ceiling for an AI agent acting on behalf of a user (OAuth `data:read`). ' +
      'Bounded by the delegating user via the ADR-0090 D10 intersection.',
    objects: {
      '*': { allowRead: true },
    },
  }),
  PermissionSetSchema.parse({
    name: MCP_AGENT_PERMISSION_SET_WRITE,
    label: 'MCP Agent — Read & Write',
    description:
      'Read+write ceiling for an AI agent acting on behalf of a user (OAuth `data:write`). ' +
      'Full CRUD, still bounded by the delegating user via the ADR-0090 D10 intersection. ' +
      'Identity tables stay read-only (better-auth managed).',
    objects: {
      '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      // Even a write-scoped agent must not mutate better-auth identity tables
      // directly — a belt to the intersection's braces (the user's baseline
      // already denies these, but an admin delegator would not).
      ...denyWritesOnManagedObjects(),
    },
  }),
  PermissionSetSchema.parse({
    name: MCP_AGENT_PERMISSION_SET_RESTRICTED,
    label: 'MCP Agent — No Data Access',
    description:
      'No-object-access floor for an agent with no data scope (e.g. `actions:execute` only). ' +
      'Keeps the resolved set list non-empty so enforcement fails CLOSED, never open.',
    objects: {},
  }),
];

/**
 * [ADR-0105 D4] Derive the wall-less org-admin variant
 * ({@link ORGANIZATION_ADMIN_NO_BYPASS}) from `organization_admin` by dropping
 * the wildcard `viewAllRecords`/`modifyAllRecords` bits — everything else
 * (object grants, managed-write denies, anti-escalation RBAC read-only rules,
 * system permissions, the 15 identity RLS carve-outs) is carried over verbatim.
 *
 * DERIVED, never a second literal: two hand-maintained copies of a
 * high-privilege set are a drift waiting to happen, and the drift would be a
 * silent privilege difference. The only intended delta is the superuser bits,
 * so the only thing this function may do is remove them.
 *
 * `auto-org-admin-grant` picks between the two by posture: a wall-enforcing
 * posture bounds the bits (grant `organization_admin`); a wall-less one does
 * not (grant this).
 */
function deriveWallLessOrgAdmin(base: PermissionSet): PermissionSet {
  const objects: Record<string, any> = { ...(base.objects ?? {}) };
  const { viewAllRecords: _v, modifyAllRecords: _m, ...wildcardWithoutBypass } =
    (objects['*'] ?? {}) as Record<string, unknown>;
  objects['*'] = wildcardWithoutBypass;
  return PermissionSetSchema.parse({
    ...base,
    name: ORGANIZATION_ADMIN_NO_BYPASS,
    label: 'Organization Administrator (no record bypass)',
    description:
      'Organization administration WITHOUT blanket record visibility. Granted instead of ' +
      '`organization_admin` when the tenancy posture enforces no organization wall, where nothing ' +
      'would bound the superuser bits (ADR-0105 D4 / finding F2). Ownership, sharing and business ' +
      'RLS still apply; grant `admin_full_access` (or an explicit set carrying the bits) when a ' +
      'deployment-wide data superuser is genuinely intended.',
    objects,
  });
}

export const defaultPermissionSets: PermissionSet[] = (() => {
  const orgAdmin = baseDefaultPermissionSets.find((ps) => ps.name === ORGANIZATION_ADMIN);
  if (!orgAdmin) return baseDefaultPermissionSets;
  // Placed directly after its parent so the seeded row order stays stable and
  // the two variants read as a pair.
  const idx = baseDefaultPermissionSets.indexOf(orgAdmin);
  return [
    ...baseDefaultPermissionSets.slice(0, idx + 1),
    deriveWallLessOrgAdmin(orgAdmin),
    ...baseDefaultPermissionSets.slice(idx + 1),
  ];
})();
