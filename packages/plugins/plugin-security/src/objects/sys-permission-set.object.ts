// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';

/**
 * sys_permission_set — System Permission Set Object
 *
 * Named groupings of fine-grained permissions.
 * Permission sets can be bound to positions or granted directly to users
 * for granular access control.
 *
 * @namespace sys
 */
export const SysPermissionSet = ObjectSchema.create({
  name: 'sys_permission_set',
  label: 'Permission Set',
  pluralLabel: 'Permission Sets',
  icon: 'lock',
  isSystem: true,
  managedBy: 'config',
  // ADR-0010 §3.7 — RBAC primitive; tenants may add custom rows
  // (created via UI / API) but the schema itself is locked.
  protection: {
    lock: 'no-overlay',
    reason: 'RBAC schema is platform-defined — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  description: 'Named permission groupings for fine-grained access control',
  displayNameField: 'label',
  nameField: 'label', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{label}',
  highlightFields: ['label', 'name', 'active'],

  // Custom actions — permission sets are templates bound to positions or
  // users (via sys_position_permission_set / sys_user_permission_set). The
  // sysadmin operations that don't live on the parent-detail tabs are
  // lifecycle (activate/deactivate without losing assignments) and
  // clone (build a new permset by tweaking an existing one). Both hit
  // the generic data CRUD endpoint — managedBy: 'config' permits it.
  actions: [
    {
      name: 'activate_permission_set',
      label: 'Activate',
      icon: 'circle-check',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_permission_set/{id}',
      bodyExtra: { active: true },
      successMessage: 'Permission set activated',
      refreshAfter: true,
    },
    {
      name: 'deactivate_permission_set',
      label: 'Deactivate',
      icon: 'circle-off',
      variant: 'danger',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_permission_set/{id}',
      bodyExtra: { active: false },
      confirmText: 'Deactivate this permission set? Existing assignments stay in place but stop granting access until re-activated.',
      successMessage: 'Permission set deactivated',
      refreshAfter: true,
    },
    {
      name: 'clone_permission_set',
      label: 'Clone',
      icon: 'copy',
      variant: 'secondary',
      mode: 'custom',
      locations: ['list_item', 'record_header'],
      type: 'api',
      method: 'POST',
      target: '/api/v1/data/sys_permission_set',
      bodyExtra: { active: true },
      successMessage: 'Permission set cloned',
      refreshAfter: true,
      params: [
        { name: 'label', label: 'New Display Name', type: 'text', required: true },
        { name: 'name', label: 'New API Name', type: 'text', required: true, helpText: 'Unique snake_case machine name' },
        { field: 'description', defaultFromRow: true },
        { field: 'object_permissions', defaultFromRow: true },
        { field: 'field_permissions', defaultFromRow: true },
      ],
    },
  ],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_permission_set' },
      columns: ['label', 'name', 'description', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_permission_set' },
      columns: ['label', 'name', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_permsets: {
      type: 'grid',
      name: 'all_permsets',
      label: 'All',
      data: { provider: 'object', object: 'sys_permission_set' },
      // [ADR-0094] Surface provenance + the customized flag so admins can tell
      // a packaged set (and whether they've overlaid it) from an env set.
      columns: ['label', 'name', 'managed_by', 'customized', 'active', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
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
      description:
        'Unique machine name for the permission set. This is the set’s metadata identity ' +
        '(ADR-0094) and cannot be changed after creation — the data door rejects a rename; ' +
        'clone the set to a new name instead.',
      // [ADR-0094] The name is the metadata key the record projects from, so it
      // is immutable once the record exists. `record.id` is server-assigned:
      // absent on the create form (editable), present on edit (locked). The
      // data-door write-through independently rejects a rename (400), so this
      // is the matching UI affordance rather than the only guard.
      readonlyWhen: P`record.id != null && record.id != ''`,
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    // ── Permissions ──────────────────────────────────────────────
    object_permissions: Field.textarea({
      label: 'Object Permissions',
      required: false,
      description: 'JSON-serialized object-level CRUD permissions',
      group: 'Permissions',
    }),

    field_permissions: Field.textarea({
      label: 'Field Permissions',
      required: false,
      description: 'JSON-serialized field-level read/write permissions',
      group: 'Permissions',
    }),

    system_permissions: Field.textarea({
      label: 'System Permissions',
      required: false,
      description: 'JSON-serialized array of system capability names (e.g. ["setup.access","studio.access","manage_users"])',
      group: 'Permissions',
    }),

    row_level_security: Field.textarea({
      label: 'Row-Level Security',
      required: false,
      description: 'JSON-serialized array of row-level security policies (USING/CHECK clauses)',
      group: 'Permissions',
    }),

    tab_permissions: Field.textarea({
      label: 'Tab Permissions',
      required: false,
      description: 'JSON-serialized map of app tab visibility (visible | hidden | default_on | default_off)',
      group: 'Permissions',
    }),

    admin_scope: Field.textarea({
      label: 'Delegated Admin Scope',
      required: false,
      description:
        '[ADR-0090 D12] JSON-serialized AdminScope: { businessUnit, includeSubtree, manageAssignments, ' +
        'manageBindings, authorEnvironmentSets, assignablePermissionSets[] }. Holding this set makes the ' +
        'user a SCOPED administrator within the declared business-unit subtree; enforced by the ' +
        'delegated-admin write gate.',
      group: 'Permissions',
    }),

    // ── Status ───────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    // ── Provenance (ADR-0086 D3) ─────────────────────────────────
    package_id: Field.text({
      label: 'Owning Package',
      required: false,
      readonly: true,
      maxLength: 255,
      description:
        'Package that ships this permission set (absent = environment-authored). ' +
        'Populated by bootstrapDeclaredPermissions; makes package uninstall/upgrade well-defined.',
      group: 'Provenance',
    }),

    managed_by: Field.text({
      label: 'Managed By',
      required: false,
      readonly: true,
      maxLength: 16,
      description:
        "Record provenance: 'package' = versioned package metadata (re-seeded on upgrade, " +
        "read-mostly for admins); 'platform'/'user' = environment config (live-edited, never " +
        'touched by package seeding). Absent on legacy rows.',
      group: 'Provenance',
    }),

    // [ADR-0094] TRUE when this package-owned set is currently shadowed by an
    // environment overlay (customized in this env, away from its shipped
    // baseline). Projector-maintained; deleting the overlay (reset) clears it.
    // Only meaningful on `managed_by:'package'` rows.
    customized: Field.boolean({
      label: 'Customized',
      defaultValue: false,
      readonly: true,
      description:
        'This packaged permission set has an environment customization overlay (ADR-0094). ' +
        'Reset it (delete through the data door) to return to the shipped baseline.',
      group: 'Provenance',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Permission Set ID',
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
    { fields: ['name'], unique: true },
    { fields: ['active'] },
    // ADR-0086 D3 — uninstall/upgrade query: "this package's own sets".
    { fields: ['package_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: true,
  },
});
