// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_business_unit — Business Unit (canonical org/data-partition tree, ADR-0057 D2)
 *
 * The persistent, hierarchical org chart node. **This is distinct from
 * `sys_team`** (which is the flat better-auth collaboration grouping).
 *
 * A single tenant typically has one `kind='company'` root, then nested
 * `division` / `department` / `office` nodes underneath. The
 * `kind` enum is purely a display/categorisation hint — the recursive
 * structure works identically regardless of value.
 *
 * Drives:
 *   - `recipient_type='business_unit'` sharing rules
 *   - `bu:` approver prefix in the approval engine
 *   - Report rollups and manager chains in CRM/PM apps
 *
 * @namespace sys
 */
export const SysBusinessUnit = ObjectSchema.create({
  name: 'sys_business_unit',
  label: 'Business Unit',
  pluralLabel: 'Business Units',
  icon: 'building',
  isSystem: true,
  managedBy: 'platform',
  description: 'Canonical Business Unit tree — hierarchical org/data-partition node (company / division / department / region / office). ADR-0057 D2.',
  displayNameField: 'name',
  titleFormat: '{name}',
  compactLayout: ['name', 'kind', 'parent_business_unit_id', 'manager_user_id'],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_business_unit' },
      columns: ['name', 'code', 'kind', 'parent_business_unit_id', 'manager_user_id', 'effective_from'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 100 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_business_unit' },
      columns: ['name', 'code', 'kind', 'effective_to'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'effective_to', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    by_kind: {
      type: 'grid',
      name: 'by_kind',
      label: 'By Kind',
      data: { provider: 'object', object: 'sys_business_unit' },
      columns: ['kind', 'name', 'code', 'parent_business_unit_id', 'manager_user_id', 'active'],
      sort: [{ field: 'kind', order: 'asc' }, { field: 'name', order: 'asc' }],
      grouping: { fields: [{ field: 'kind', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_departments: {
      type: 'grid',
      name: 'all_departments',
      label: 'All',
      data: { provider: 'object', object: 'sys_business_unit' },
      columns: ['name', 'code', 'kind', 'parent_business_unit_id', 'manager_user_id', 'active'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 100 },
    },
  },

  fields: {
    // ── Identity ─────────────────────────────────────────────────
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      group: 'Identity',
    }),

    code: Field.text({
      label: 'Code',
      required: false,
      searchable: true,
      maxLength: 64,
      description: 'Short stable code (e.g. EMEA-SALES). Unique within tenant.',
      group: 'Identity',
    }),

    kind: Field.select(
      ['company', 'division', 'department', 'office', 'cost_center'],
      {
        label: 'Kind',
        required: true,
        defaultValue: 'department',
        description: 'Categorisation hint — does not change graph semantics.',
        group: 'Identity',
      },
    ),

    // ── Hierarchy ────────────────────────────────────────────────
    parent_business_unit_id: Field.lookup('sys_business_unit', {
      label: 'Parent Business Unit',
      required: false,
      description: 'Self-reference for the org tree. Null = root of tenant.',
      group: 'Hierarchy',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      // Optional: single-tenant deployments have no organization row (org-scoping
      // is multi-tenant-only, nothing auto-stamps one) — requiring it would make
      // the object uncreatable single-tenant. In multi-tenant, OrgScopingPlugin
      // auto-stamps this from the active tenant and tenant-isolation RLS hides any
      // null-org row (fail-closed). ADR-0057 addendum.
      required: false,
      description: 'Tenant scope. Null in single-tenant; auto-stamped in multi-tenant.',
      group: 'Hierarchy',
    }),

    // ── Leadership ───────────────────────────────────────────────
    manager_user_id: Field.lookup('sys_user', {
      label: 'Business Unit Head',
      required: false,
      description: 'User responsible for this org unit (business unit head / lead).',
      group: 'Leadership',
    }),

    // ── Lifecycle ────────────────────────────────────────────────
    active: Field.boolean({
      label: 'Active',
      required: false,
      defaultValue: true,
      description: 'When false, members are not expanded by graph queries.',
      group: 'Lifecycle',
    }),

    effective_from: Field.datetime({
      label: 'Effective From',
      required: false,
      description: 'When this business unit came into existence (HRIS sync).',
      group: 'Lifecycle',
    }),

    effective_to: Field.datetime({
      label: 'Effective To',
      required: false,
      description: 'When this business unit was retired (HRIS sync).',
      group: 'Lifecycle',
    }),

    external_ref: Field.text({
      label: 'External Reference',
      required: false,
      maxLength: 200,
      description: 'ID in upstream HRIS (Workday / SAP HR / 北森).',
      group: 'Lifecycle',
    }),

    // ── System ───────────────────────────────────────────────────
    id: Field.text({
      label: 'Business Unit ID',
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
    { fields: ['organization_id'] },
    { fields: ['parent_business_unit_id'] },
    { fields: ['code', 'organization_id'], unique: true },
    { fields: ['active'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: true,
    mru: false,
  },
});
