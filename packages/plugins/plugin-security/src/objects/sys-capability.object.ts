// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_capability — Capability definition registry (ADR-0066 D1).
 *
 * Promotes authorization *capabilities* from bare strings to first-class
 * records. A capability is layer 1 of the ADR-0066 three-way separation
 * (capability / assignment / requirement): "what can be done"
 * (`manage_users`, `manage_platform_settings`, `export_data`, …). The
 * platform/packages DEFINE capabilities; admins EXTEND them in Setup.
 *
 * `PermissionSet.systemPermissions[]` (assignment) and a resource's
 * `requiredPermissions[]` (requirement) reference a capability **by name** —
 * so this table is the catalog/definition, NOT the grant. Existing string
 * capabilities are back-compat seeded as rows with the same `name`, so all
 * current references keep resolving (no migration).
 *
 * Named `sys_capability` (not `sys_permission` as the ADR loosely floats) to
 * avoid collision with `sys_permission_set` and to match the "capability"
 * vocabulary used throughout ADR-0066.
 *
 * @namespace sys
 */
export const SysCapability = ObjectSchema.create({
  name: 'sys_capability',
  label: 'Capability',
  pluralLabel: 'Capabilities',
  icon: 'badge-check',
  isSystem: true,
  managedBy: 'config',
  // ADR-0010 §3.7 — RBAC primitive; tenants/admins may add custom rows
  // (created via UI / API) but the schema itself is locked.
  protection: {
    lock: 'no-overlay',
    reason: 'Capability registry schema is platform-defined — see ADR-0066 / ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Authorization capability definitions (ADR-0066 D1). Referenced by name from permission-set systemPermissions and resource requiredPermissions.',
  displayNameField: 'label',
  nameField: 'label', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{label}',
  // [#8535] `active` is deliberately NOT highlighted. It is a catalogue flag with
  // no authorization effect (see the field's own comment), and record-header
  // prominence next to `scope`/`managed_by` is itself a claim that it belongs to
  // the authorization posture. Demoting it is half the fix; rewording the dialog
  // is the other half — a truthful dialog under a field still presented as
  // first-class tells the admin the flag matters after all.
  highlightFields: ['label', 'name', 'scope', 'managed_by'],

  actions: [
    {
      name: 'activate_capability',
      label: 'Activate',
      icon: 'circle-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_capability/{id}',
      bodyExtra: { active: true },
      successMessage: 'Capability activated',
      refreshAfter: true,
    },
    {
      name: 'deactivate_capability',
      label: 'Deactivate',
      icon: 'circle-off',
      // [#8535] Was `danger`. A danger variant is a claim in itself — it tells the
      // admin the click has consequences proportionate to a security control. This
      // one writes a catalogue column and nothing else.
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_capability/{id}',
      bodyExtra: { active: false },
      // [#8535] This used to read: "Deactivate this capability? Grants and resource
      // requirements that reference it stop resolving until re-activated." No code
      // path has ever enforced that. `PermissionEvaluator.getSystemPermissions()`
      // unions `permissionSets[].systemPermissions` — plain strings — and
      // `requiredPermissions` is compared against that string set; neither loads a
      // `sys_capability` row. The two production readers of the table are both
      // seeders (`bootstrap-system-capabilities.ts`,
      // `bootstrap-declared-capabilities.ts`), which WRITE `active: true` on insert
      // and never read it back.
      //
      // The direction of that falsehood was the dangerous one: an admin withdrawing
      // a capability was told in a confirmation dialog that the withdrawal took
      // effect, and it silently did not — the escalation is what they believed they
      // had prevented. ADR-0049 enforce-or-remove; the maintainer ruled (2026-08-13)
      // that enforcement is NOT the answer here — putting the registry on the
      // authorization hot path is an architectural change (caching, fail-closed
      // semantics, org-authored rows influencing platform capabilities) that needs
      // its own designed card if capability lifecycle management ever earns real
      // pull. So the claim is withdrawn instead, and the dialog now states the
      // non-effect explicitly rather than merely omitting the promise: an admin who
      // remembers the old wording has to be told it was wrong, not left to infer it.
      confirmText:
        'Deactivate this capability? This is a catalogue flag only: it marks the row inactive for filtering and review in Setup. Authorization is NOT affected — permission sets that grant this capability, and resources that require it, match it by name and keep resolving exactly as before.',
      successMessage: 'Capability deactivated',
      refreshAfter: true,
    },
  ],

  // [#8535] `active` was a column in ALL THREE views. It is now shown only in
  // `all_capabilities` — the full-catalogue view, where a catalogue attribute
  // genuinely belongs and stays observable and filterable for the admin who sets
  // it. The two SCOPED views (`platform`, `org`) are the ones an admin works in
  // to reason about who can do what, and a column sitting next to `managed_by`
  // there reads as part of the authorization posture. Dropping it from all three
  // was rejected as the opposite error: a flag the product lets you set but never
  // lets you see is its own kind of dishonest surface.
  listViews: {
    platform: {
      type: 'grid',
      name: 'platform',
      label: 'Platform',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'managed_by'],
      filter: [{ field: 'scope', operator: 'equals', value: 'platform' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    org: {
      type: 'grid',
      name: 'org',
      label: 'Organization',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'managed_by'],
      filter: [{ field: 'scope', operator: 'equals', value: 'org' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_capabilities: {
      type: 'grid',
      name: 'all_capabilities',
      label: 'All',
      data: { provider: 'object', object: 'sys_capability' },
      columns: ['label', 'name', 'scope', 'managed_by', 'active'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    label: Field.text({
      label: 'Display Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    name: Field.text({
      label: 'API Name',
      required: true,
      searchable: true,
      maxLength: 100,
      description: 'Unique capability key referenced by systemPermissions / requiredPermissions (e.g. manage_users, setup.access).',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Classification ───────────────────────────────────────────
    scope: Field.select({
      label: 'Scope',
      required: true,
      defaultValue: 'platform',
      description: 'platform = a platform-wide power; org = scoped to an organization.',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'org', label: 'Organization' },
      ],
      group: 'Classification',
    }),

    managed_by: Field.select({
      label: 'Managed By',
      required: true,
      defaultValue: 'admin',
      description: 'platform/package-owned capabilities are shipped and not user-deletable; admin-owned are created in Setup.',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
      group: 'Classification',
    }),

    // [ADR-0066 D1 / ADR-0086 D3] Owning package for a capability DECLARED by a
    // package via `defineCapability` (absent = platform-curated or admin-created).
    // Populated by bootstrapDeclaredCapabilities; makes package uninstall/upgrade
    // of a capability well-defined and gives the derived-from-systemPermissions
    // back-door an explicit, attributable replacement.
    package_id: Field.text({
      label: 'Owning Package',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Package that ships this capability (absent = platform-curated or admin-created).',
      group: 'Classification',
    }),

    // ── Status ───────────────────────────────────────────────────
    // [#8535] Catalogue flag, NOT an enforcement switch. It carried no
    // `description` at all, which is how the `deactivate_capability` dialog
    // became the only place its meaning was stated — and that statement was
    // false. The semantics are declared here now, negative half included, so the
    // field documents its own inertness at the point an author or an admin meets
    // it. If capability lifecycle ever becomes enforceable it arrives as a
    // designed feature with its own card (maintainer ruling, 2026-08-13), and
    // this comment plus the description are what must change with it.
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      description:
        'Catalogue/visibility flag for filtering and review. It has NO authorization effect: permission-set grants and resource requiredPermissions match capability names as strings and never read this row, so clearing it revokes nothing.',
      group: 'Status',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Capability ID',
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
    // [ADR-0120 D1, #8323] `'organization'`, NOT bare `true`.
    //
    // Admins EXTEND this registry in Setup (`managed_by: 'admin'`, `scope:
    // 'org'`), so a capability name is one holder per organization, not one
    // across the installation. Bare `true` on a DECLARED index is the
    // positional spelling of `'global'` (listed columns verbatim), which made
    // `name` an installation-wide key: an organization could probe whether ANY
    // other organization — or the platform seed — already held a name, by
    // reading 409-vs-201 on a row it has no permission to see.
    //
    // Platform-seeded rows carry no organization, and the organization key part
    // is NULL-safe (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so
    // they remain unique among themselves.
    //
    // [#8470] This comment used to end "…and `bootstrapSystemCapabilities`'
    // upsert-by-name is unaffected". That was WRONG, and the correction belongs
    // next to the index that unmasked it. Widening the key to per-organization
    // made the two-row state (platform row + an org's row, same `name`)
    // REACHABLE, and the seeder's `find({ name }, limit: 1)` had no way to say
    // which of the two it meant. The index is not the defect and must not be
    // narrowed back — that would reinstate #8323's cross-tenant existence
    // oracle. The seeder now scopes its curated lookup to `managed_by:
    // 'platform'` + `organization_id: null`, i.e. exactly the bucket this key
    // part keeps a singleton.
    { fields: ['name'], unique: 'organization' },
    { fields: ['scope'] },
    { fields: ['active'] },
    // [ADR-0086 D3] uninstall/upgrade query: "this package's own capabilities".
    { fields: ['package_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // `bulk` = the batch shape of the verbs above; the gate is `bulk ∧ child`
    // (#3391 P1), so omitting it 405s /batch and the *Many routes (#3026).
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});
