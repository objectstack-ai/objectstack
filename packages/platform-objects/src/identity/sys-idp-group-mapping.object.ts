// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_idp_group_mapping — which permission set an identity provider's group
 * grants (ADR-0134 D4's group seam, filled for permission sets only).
 *
 * One row says: a member of THIS group, pushed by THIS source, holds THIS
 * permission set in THIS organization. The source is a SCIM connection today
 * (`source_kind: 'scim'`, `source_id` = the connection id the bearer verifies
 * as); the kind column is there so an SSO provider's group claim can name its
 * provider the same way later, without a second mapping model.
 *
 * Who writes it: the platform administrator, through plugin-auth's
 * `/admin/scim/set-group-mapping` and `/admin/scim/delete-group-mapping`
 * mounts — the same gate as the SCIM credential door (ADR-0068 D2). The data
 * API is list-only (`apiMethods` below), so no other writer exists. The door
 * refuses, at save, a permission set outside the organization boundary
 * (plugin-security's `organizationBoundaryFailure`: the administrator sets,
 * the agent ceilings, superuser wildcards, an `adminScope`, a capability not
 * scoped to the organization): an identity provider's group never confers
 * administrator standing.
 *
 * Who reads it: the SCIM `projection` (`scim-group-projection.ts`) when a
 * group's membership changes. A group is matched by its `externalId` when the
 * row names one, else by its `displayName`; the row names exactly one.
 *
 * @namespace sys
 */
export const SysIdpGroupMapping = ObjectSchema.create({
  name: 'sys_idp_group_mapping',
  label: 'IdP Group Mapping',
  pluralLabel: 'IdP Group Mappings',
  icon: 'users',
  isSystem: true,
  // plugin-auth's admin door is the only writer; no user CRUD, no better-auth model.
  managedBy: 'engine-owned',
  // [ADR-0066 D3] Admin-only identity configuration, the same object-level
  // capability gate as the SCIM credential store beside it.
  requiredPermissions: ['manage_platform_settings'],
  protection: {
    lock: 'full',
    reason: 'ObjectStack-owned identity-provider group mapping — written only through the platform-admin SCIM door.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Maps an identity provider group to the permission set its members are granted',
  displayNameField: 'permission_set',
  nameField: 'permission_set', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['source_id', 'group_external_id', 'group_display_name', 'permission_set'],

  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All',
      data: { provider: 'object', object: 'sys_idp_group_mapping' },
      columns: ['source_kind', 'source_id', 'group_external_id', 'group_display_name', 'permission_set', 'organization_id'],
      sort: [{ field: 'source_id', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    source_kind: Field.select({
      label: 'Source Kind',
      required: true,
      defaultValue: 'scim',
      description: 'What pushes the group: a SCIM connection.',
      group: 'Source',
      options: [{ value: 'scim', label: 'SCIM Connection' }],
    }),

    source_id: Field.text({
      label: 'Source ID',
      required: true,
      maxLength: 255,
      description: 'The SCIM connection ID the group arrives through, e.g. "okta-prod".',
      group: 'Source',
    }),

    group_external_id: Field.text({
      label: 'Group External ID',
      required: false,
      maxLength: 255,
      description: 'The group\'s externalId as the identity provider sends it. Set this or the display name, not both.',
      group: 'Group',
    }),

    group_display_name: Field.text({
      label: 'Group Display Name',
      required: false,
      maxLength: 255,
      description: 'The group\'s displayName, matched exactly. Used when the mapping names no external ID.',
      group: 'Group',
    }),

    permission_set: Field.text({
      label: 'Permission Set',
      required: true,
      maxLength: 100,
      description: 'The permission set a member of the group is granted. Administrator sets are refused.',
      group: 'Grant',
    }),

    organization_id: Field.text({
      label: 'Organization',
      required: false,
      maxLength: 255,
      description: 'The organization the grant is made in: the organization that owns the SCIM connection.',
      group: 'Grant',
    }),

    created_at: Field.datetime({ label: 'Created At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
    updated_at: Field.datetime({ label: 'Updated At', defaultValue: 'NOW()', readonly: true, group: 'System' }),
  },

  indexes: [
    { fields: ['source_kind', 'source_id'] },
    { fields: ['organization_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Written only through plugin-auth's platform-admin door, which judges the
    // permission set against the organization boundary before any row lands.
    apiMethods: ['list'],
  },
});
