// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { INVITATION_ROLE_OPTIONS } from '@objectstack/spec/identity';

/**
 * sys_organization — System Organization Object
 *
 * Multi-organization support for the ObjectStack platform.
 * Backed by better-auth's organization plugin.
 *
 * @namespace sys
 */
export const SysOrganization = ObjectSchema.create({
  name: 'sys_organization',
  label: 'Organization',
  pluralLabel: 'Organizations',
  icon: 'building-2',
  isSystem: true,
  managedBy: 'better-auth',
  // [#15873 — maintainer ruling 2026-09-07, option (a), verbatim 「同意」]
  // Declares the generic EDIT affordance so `enable.apiMethods` below can
  // keep `update`: a `managedBy` object runs through
  // `reconcileManagedApiMethods` (objectql registry, ADR-0092 / ADR-0103 D3),
  // which strips any write verb the resolved affordances do not grant and only
  // warns. Without this line the declaration and the runtime disagree
  // silently, one layer deeper than the method gate — the second silent gate
  // #7727 measured on `sys_api_key`. `create` / `delete` stay bucket-default
  // (off): organizations are created and destroyed through better-auth's own
  // endpoints (the row actions below).
  //
  // Safe to open only because the enforcement it fronts already exists (ADR-0092
  // D4's sequencing rule — the affordance never ships ahead of the guard): the
  // D2 identity write guard clamps every user-context update on this table to
  // the registered column whitelist, `MANAGED_EXTENSION_EDITABLE_FIELDS
  // .sys_organization` in plugin-auth — the platform-owned extension columns
  // (`require_mfa`, `parent_organization_id`, `sort_order`, `timezone`) and
  // nothing else. Per D4's form-rendering constraint, every column outside that
  // whitelist is marked `readonly` below, so the edit form cannot offer a write
  // the server will refuse or strip.
  userActions: { edit: true },
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Organizations for multi-tenant grouping',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'slug'],

  // Custom actions — generic create / delete are suppressed (better-auth-
  // managed), and better-auth's own columns (`name`, `slug`, `logo`) are
  // edited ONLY through better-auth's `organization/update`: the
  // `update_organization` row action (all three) and the name/logo-only
  // `rename_organization` (record header and row) below. The generic `update` the
  // data door admits since #15873 reaches the platform-owned extension columns
  // alone (see `userActions` above and `enable.apiMethods` at the bottom);
  // admins still need to create new orgs from the Setup app.
  actions: [
    {
      name: 'create_organization',
      label: 'Create Organization',
      icon: 'plus',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/create',
      successMessage: 'Organization created',
      refreshAfter: true,
      // Hidden when the deployment is provisioned in single-org mode
      // (`OS_MULTI_ORG_ENABLED=false`). `features.multiOrgEnabled` is
      // populated by the console/account shells from `/auth/config`;
      // we default to visible when the flag is undefined so we don't
      // accidentally hide the button while auth config is still loading.
      requiresFeature: 'multiOrgEnabled',
      params: [
        { field: 'name', required: true },
        { field: 'slug', required: true },
        { field: 'logo' },
      ],
    },
    {
      name: 'update_organization',
      label: 'Edit Organization',
      icon: 'pencil',
      mode: 'edit',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update',
      recordIdParam: 'organizationId',
      // better-auth `organization/update` nests editable fields under `data`.
      bodyShape: { wrap: 'data' },
      // Org-admin actions are multi-org-only; hide them in single-org for
      // consistency with `create_organization` (the org list is empty there,
      // but this also guards direct record-URL access). The grades that reach
      // `organization/update` are owner and admin (ADR-0108 D1).
      requiresFeature: 'multiOrgEnabled',
      requiresMembershipReach: 'update_organization',
      successMessage: 'Organization updated',
      refreshAfter: true,
      params: [
        { field: 'name', required: true, defaultFromRow: true },
        { field: 'slug', required: true, defaultFromRow: true },
        { field: 'logo', defaultFromRow: true },
      ],
    },
    {
      name: 'delete_organization',
      label: 'Delete Organization',
      icon: 'trash',
      variant: 'danger',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/delete',
      recordIdParam: 'organizationId',
      requiresFeature: 'multiOrgEnabled',
      // `organization/delete` admits the owner alone (ADR-0108 D1).
      requiresMembershipReach: 'delete_organization',
      confirmText: 'Delete this organization? All members will lose access immediately. This cannot be undone.',
      successMessage: 'Organization deleted',
      refreshAfter: true,
    },
    {
      // Switch the caller's active organization context. Standard
      // better-auth endpoint; no extra params needed (org id ships as
      // the row id). Used from the Setup list and the record header so
      // admins can context-switch without leaving the page.
      name: 'set_active_organization',
      label: 'Set Active',
      icon: 'check-circle-2',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/set-active',
      recordIdParam: 'organizationId',
      requiresFeature: 'multiOrgEnabled',
      successMessage: 'Active organization switched',
      refreshAfter: true,
    },
    {
      // FOURTH mirror of `invite_user` (sys_user, sys_invitation, sys_member
      // carry the other three — keep all four consistent), here because a
      // `page:header`'s `actions` are ids resolved against the page object's
      // OWN actions only (spec `component.zod.ts`, page:header), so the
      // organization record page cannot offer an invite from a mirror on
      // another object. Ruling 6228318638 (B′ on #24034): declared at
      // `record_header`, primary, first by `order`.
      //
      // The record IS the organization, so its id rides as `organizationId`
      // instead of better-auth's active-org fallback — an admin on another
      // org's page invites into that org, not into whichever one is active.
      name: 'invite_user',
      label: 'Invite User',
      // Same wording as the sys_user / sys_invitation / sys_member mirrors.
      description:
        'Invite someone by email address. They join this organization with the chosen role when they accept the invitation.',
      icon: 'user-plus',
      variant: 'primary',
      // Lower than every sibling (unset = 0), so the stable `order` sort puts
      // it first in the record header.
      order: -1,
      locations: ['record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      recordIdParam: 'organizationId',
      // Same gates as the other three mirrors: the org CAPABILITY (not
      // multi-org, ADR-0093 D9) and the grades that reach the endpoint
      // (ADR-0108 D1) — owner, admin and delegated_admin.
      requiresFeature: 'organization',
      requiresMembershipReach: 'invite_member',
      // `${result.email}`: the invitee's address from the invitation row
      // invite-member answers (see sys_user's mirror).
      successMessage: 'Invitation sent to ${result.email}',
      refreshAfter: true,
      params: [
        // ⚠️ Neither `email` nor `role` is a field of sys_organization, so
        // both params name their owner via `objectOverride` — an unresolvable
        // field-backed param degrades to an unlabelled text input with
        // nothing red anywhere (see sys_member's mirror). Otherwise the shape
        // is sys_invitation's: both required, and the role picker offers only
        // what this caller may grant ([ADR-0105 D8] `INVITATION_ROLE_OPTIONS`).
        { field: 'email', objectOverride: 'sys_invitation', required: true },
        { field: 'role', objectOverride: 'sys_invitation', required: true, options: [...INVITATION_ROLE_OPTIONS] },
      ],
    },
    {
      // Current user leaves the org. Distinct from `delete_organization`
      // (admin-only, destroys the org) — `leave` only removes the caller's
      // own membership. Better-auth: `organization/leave { organizationId }`.
      name: 'leave_organization',
      label: 'Leave Organization',
      icon: 'log-out',
      variant: 'danger',
      // Higher than every sibling (unset = 0), so it sorts LAST: with
      // `invite_user` leading, the header's three inline slots go to the
      // invite, `set_active_organization` and `rename_organization`, and this
      // one folds into the `⋯` overflow's destructive band (objectui's
      // page:header split, default `maxVisible` 3). Without it, registration
      // order kept it inline as the third button. Ungated by grade: every
      // grade may leave.
      order: 1,
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      target: '/api/v1/auth/organization/leave',
      recordIdParam: 'organizationId',
      requiresFeature: 'multiOrgEnabled',
      // Names what is lost (#24021's copy half, ruling 6228318638 item 2).
      confirmText: 'Leave this organization? You will lose access to its environments and members.',
      successMessage: 'You have left the organization',
      refreshAfter: true,
    },
    {
      // Rename the organization: its `name` and `logo`, never its `slug`.
      // The same better-auth door as `update_organization` above
      // (`organization/update`, fields nested under `data`), with no `slug`
      // param, so the body carries no slug and the stored one is kept:
      // better-auth's slug-taken check and plugin-auth's
      // `beforeUpdateOrganization` slug guard both run only on a sent slug.
      //
      // One door per field. A record page reaches no `list_item` action, so
      // this one is declared at `record_header` too, and nothing on that page
      // sends a slug to better-auth. `update_organization` is the slug door of
      // a composition without the cloud orchestrator. Where the orchestrator
      // governs the slug, the composition that serves its route declares the
      // slug action itself, bound to this object by `objectName` and attached
      // to it as served; this object declares no action whose door only one
      // composition mounts.
      name: 'rename_organization',
      label: 'Rename Organization',
      icon: 'pencil',
      variant: 'secondary',
      mode: 'edit',
      locations: ['record_header', 'list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/update',
      recordIdParam: 'organizationId',
      bodyShape: { wrap: 'data' },
      requiresFeature: 'multiOrgEnabled',
      // The same door as `update_organization`, so the same grades.
      requiresMembershipReach: 'update_organization',
      successMessage: 'Organization renamed',
      refreshAfter: true,
      params: [
        { field: 'name', required: true, defaultFromRow: true },
        { field: 'logo', defaultFromRow: true },
      ],
    },
  ],

  listViews: {
    all_orgs: {
      type: 'grid',
      name: 'all_orgs',
      label: 'All',
      data: { provider: 'object', object: 'sys_organization' },
      columns: ['name', 'slug', 'created_at', 'updated_at'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  // [ADR-0095 D1, 2026-10-18 note] This object's default row scope: the one policy
  // plugin-security's shipped permission sets spread for it today (the `_self`
  // carve-outs in `default-permission-sets.ts`), moved here verbatim. Layer 0 is inert
  // on this table (no organization column), so Layer 1 silence means this scope, not no
  // filter. The security plugin's row-policy collection applies it when no set the
  // caller holds carries a row policy for the object and operation; the shipped sets
  // still carry it, so their holders read as before. An `extend` contribution cannot set
  // or loosen it (refused at registration).
  defaultRowScope: {
    name: 'sys_organization_self',
    operation: 'all',
    using: 'id == current_user.organization_id',
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    // ADR-0092 D4 — with the generic edit affordance open (#15873), every
    // better-auth-owned column is `readonly` so the standard edit form renders
    // it non-editable. This is UX only: the server boundary is plugin-auth's
    // identity write guard (ADR-0092 D2), which strips these from a
    // user-context update regardless — and a mixed payload that carries one
    // beside a whitelisted column lands the whitelisted column and drops this
    // one, so a form that offered it would report success on an edit that
    // never happened. `name` / `slug` / `logo` change through better-auth's
    // `organization/update` (the `update_organization` row action, whose
    // params are declared on the action, not read off these flags). The
    // engine's own static-`readonly` strip exempts system-context writers, so
    // better-auth's adapter (which stamps `isSystem`) still writes them.
    name: Field.text({
      label: 'Name',
      required: true,
      readonly: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    slug: Field.text({
      label: 'Slug',
      required: false,
      readonly: true,
      searchable: true,
      maxLength: 255,
      description: 'URL-friendly identifier',
      group: 'Identity',
    }),

    // ── Branding ─────────────────────────────────────────────────
    logo: Field.url({
      label: 'Logo',
      required: false,
      readonly: true,
      group: 'Branding',
    }),

    // ── Configuration ────────────────────────────────────────────
    // better-auth's own `metadata` column (its organization schema declares
    // it); not an extension field, so readonly under D4 like the three above.
    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      readonly: true,
      description: 'JSON-serialized organization metadata',
      group: 'Configuration',
    }),

    // ADR-0069 D3 — per-org MFA tightening above the global floor. When true,
    // members of this org must enrol TOTP to access data (enforced at the
    // session-validation gate). An org can only tighten, never loosen, the
    // global `mfa_required` setting.
    require_mfa: Field.boolean({
      label: 'Require Multi-Factor Auth',
      required: false,
      defaultValue: false,
      group: 'Configuration',
      description: 'When true, every member of this organization must enroll an authenticator app to access data.',
    }),

    // #14238 — maintainer ruling 2026-09-02, option A (verbatim 「同意」): the
    // organization's IANA zone, the ROOT DEFAULT of the business-unit chain. A
    // `sys_business_unit` whose `timezone` is null, and whose ancestors' are
    // all null, resolves to this value; a null here resolves to `UTC`. So an
    // existing deployment computes every date boundary in UTC until an
    // administrator sets this column — exactly what it did before the column
    // existed — and the changeset's migration note says so in those words.
    //
    // No `defaultValue`, deliberately: "UTC" has ONE spelling in this contract
    // (unset), not two (unset on rows that predate the column, 'UTC' on rows
    // minted after it). Not a limitation — better-auth's `organization/create`
    // inserts through the ObjectQL engine (`objectql-adapter.ts`), so a schema
    // default WOULD reach new rows; it is omitted so that a reader handles one
    // shape instead of a pair that means the same thing.
    //
    // Nothing on the platform reads this column yet, and no resolver ships with
    // it (the ruling: option B waits for a second consumer) — the documented
    // resolution order lives on `sys_business_unit.timezone`. ⚠️ Distinct from
    // the settings door's `localization.timezone` (service-settings, tenant
    // scope, default `UTC`), the deployment-wide default analytics buckets
    // dates in today; how the two relate is the resolver's question, not this
    // column's, and this column does not read or write that setting.
    //
    // Owned by objectql, not better-auth: an ADR-0105 D7 extension field,
    // registered in plugin-auth's `MANAGED_EXTENSION_FIELDS` (whose collision
    // guard proves better-auth's organization schema owns no `timezone` at the
    // pinned version) and generically editable under the ADR-0092 D2 whitelist
    // (`MANAGED_EXTENSION_EDITABLE_FIELDS`) — the path `require_mfa` above and
    // the D6 group-structure fields below take. ⚠️ Same shape as
    // `sys_business_unit.timezone` by design (`text`, optional, `maxLength: 64`,
    // `valueDomain: 'iana_time_zone'`, no default): the card's thesis is that
    // every author invents this column differently, and the platform's own two
    // precedents (`sys_job`, `sys_report_schedule`) disagreed on length, default
    // AND validation — #15872 closed the validation dimension by giving both
    // this same `valueDomain`, and left the other two as each reader expects.
    // The ruled pair is one spelling, pinned in `org-hierarchy-timezone.test.ts`.
    timezone: Field.text({
      label: 'Timezone',
      required: false,
      maxLength: 64,
      valueDomain: 'iana_time_zone',
      description:
        'IANA time zone (e.g. UTC, Asia/Shanghai) date boundaries are computed in for this organization — the root default every business unit without a zone of its own inherits. Unset means UTC.',
      group: 'Configuration',
    }),

    // ── Group structure (ADR-0105 D6) ────────────────────────────
    //
    // ⛔ REPORTING DIMENSION ONLY. These fields describe how organizations roll
    // up for consolidated reporting, navigation and ordering. They are NOT an
    // authorization axis, and two red lines keep them that way:
    //
    //   1. **No permission inheritance along the org axis.** A parent
    //      organization confers NOTHING on its children. Cross-org visibility
    //      comes from membership union (`accessible_org_ids`, ADR-0105 D2) —
    //      never from walking this tree. Re-adding a second permission
    //      hierarchy is the mistake ADR-0057 D5 retired and ADR-0090 D3
    //      finalized for positions; it stays retired for organizations.
    //   2. **Business-unit trees remain org-internal.** `sys_business_unit` is
    //      org-scoped, and every BU mechanism (`unit_and_subordinates` sharing,
    //      `adminScope` delegation, depth scopes) operates within ONE
    //      organization. There is no cross-org tree.
    //
    // Both are lint-enforced (`validateOrgAxisRedLines` in @objectstack/lint):
    // an RLS policy, sharing rule or scope that reads `parent_organization_id`
    // is a build error, not a runtime surprise.
    parent_organization_id: Field.lookup('sys_organization', {
      label: 'Parent Organization',
      required: false,
      group: 'Group Structure',
      description:
        'Reporting/grouping parent. Grants NOTHING — visibility across organizations comes from membership, never from this reference.',
    }),

    sort_order: Field.number({
      label: 'Sort Order',
      required: false,
      group: 'Group Structure',
      description: 'Display order among sibling organizations. Presentation only.',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Organization ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['slug'], unique: 'global' },
    { fields: ['name'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // Setup's identity records are not discussion surfaces (objectui#12614 item 1):
    // no Discussion feed, and a comment create on one answers 403 FEEDS_DISABLED.
    feeds: false,
    // #1591 closed the generic writes on this table — "refused by the identity
    // write guard (ADR-0092 D2) and owned by better-auth; HTTP answers 405
    // before the 403" — and that reasoning still holds for better-auth's own
    // columns, which the D2 whitelist keeps refusing on this path. It never
    // covered the platform-owned extension columns, which better-auth neither
    // reads nor writes and which `MANAGED_EXTENSION_EDITABLE_FIELDS` had
    // declared editable through the ordinary path while this gate 405'd every
    // PATCH before the engine was reached (#15873). Ruled 2026-09-07, option
    // (a): the data door admits `update`, and the D2 whitelist does the column
    // gating — a user-context PATCH of `name` is now refused by the guard's own
    // verdict (403 PERMISSION_DENIED) instead of the method gate's 405, and
    // `create` / `delete` stay 405. `update` alone, no `bulk`: the ruling
    // widened one verb, and the single-record-only choice is on the record in
    // `SINGLE_RECORD_WRITE_ONLY` (`api-methods-batch-conformance.test.ts`,
    // @objectstack/spec), whose stale-entry check fails if `bulk` is added
    // here without retiring it.
    apiMethods: ['get', 'list', 'update'],
  },
});
