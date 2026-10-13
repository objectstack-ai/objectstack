// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: the TABLE shapes of the four retired security-catalog row
 * objects — `sys_position`, `sys_capability`, `sys_permission_set` and
 * `sys_position_permission_set` (ADR-0131 D3; retired from the plugin by C3
 * stage 8). Fields, indexes and validations only, as the last release that
 * declared them stored them.
 *
 * A suite that models an EXISTING database — rows a release before the
 * retirement wrote, which stay in the physical tables until the
 * organization-ownership migration (ADR-0131 D10) takes them — registers these
 * on its own engine. No runtime code declares them any more, and a suite that
 * only boots the platform registers none of them.
 */

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';
import { F } from '@objectstack/spec';
import { reservedIdentityNamesCelList, reservedIdentityNameMessage } from '../objects/reserved-identity-names.js';

const RESERVED_IDENTITY_NAME_CONDITION =
  `record.name in ${reservedIdentityNamesCelList()}`
  + ` && !(record.managed_by in ['platform', 'system'])`;

export const SysPosition = ObjectSchema.create({
  name: 'sys_position',
  label: 'Position',
  pluralLabel: 'Positions',
  isSystem: true,
  managedBy: 'config',
  displayNameField: 'label',
  nameField: 'label',
  fields: {
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
        'Machine name for the position, unique per organization ' +
        '(e.g. sales_manager, hr_specialist)',
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

    is_default: Field.boolean({
      label: 'Default Position',
      defaultValue: false,
      description: 'Automatically assigned to new users',
      group: 'Status',
    }),

    delegatable: Field.boolean({
      label: 'Delegatable',
      defaultValue: false,
      description: 'ADR-0091 D3: holders may self-service delegate this position, time-boxed.',
      group: 'Status',
    }),

    managed_by: Field.select({
      label: 'Managed By',
      readonly: true,
      defaultValue: 'admin',
      description:
        'Record provenance, on the one platform / package / admin vocabulary that capabilities, ' +
        'permission sets and positions all share: platform = framework built-in ' +
        '(read-only) / package = stack/package-declared / admin = tenant-created. Legacy rows ' +
        'may carry system (== platform) / config (== package) / user (== admin).',
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
      group: 'System',
    }),

    id: Field.text({
      label: 'Position ID',
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
    { fields: ['name'], unique: 'organization' },
    { fields: ['active'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },

  validations: [
    {
      type: 'cross_field',
      name: 'reserved_identity_name',
      label: 'Reserved built-in identity name',
      description:
        'ADR-0068 D2 reserves the built-in identity names for the framework. Only the platform’s own '
        + 'catalog seed may spell one; a tenant- or package-authored position must choose another name.',
      fields: ['name', 'managed_by'],
      condition: { dialect: 'cel', source: RESERVED_IDENTITY_NAME_CONDITION },
      severity: 'error',
      message: reservedIdentityNameMessage('name'),
    },
  ],
});

export const SysCapability = ObjectSchema.create({
  name: 'sys_capability',
  label: 'Capability',
  pluralLabel: 'Capabilities',
  isSystem: true,
  managedBy: 'config',
  displayNameField: 'label',
  nameField: 'label',
  fields: {
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

    package_id: Field.text({
      label: 'Owning Package',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Package that ships this capability (absent = platform-curated or admin-created).',
      group: 'Classification',
    }),

    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      description:
        'Catalogue/visibility flag for filtering and review. It has NO authorization effect: permission-set grants and resource requiredPermissions match capability names as strings and never read this row, so clearing it revokes nothing.',
      group: 'Status',
    }),

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
    { fields: ['name'], unique: 'organization' },
    { fields: ['scope'] },
    { fields: ['active'] },
    { fields: ['package_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});

export const SysPermissionSet = ObjectSchema.create({
  name: 'sys_permission_set',
  label: 'Permission Set',
  pluralLabel: 'Permission Sets',
  isSystem: true,
  managedBy: 'config',
  displayNameField: 'label',
  nameField: 'label',
  fields: {
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
        'Machine name for the permission set, unique per organization. This is the set’s ' +
        'metadata identity (ADR-0094) and cannot be changed after creation — the data door ' +
        'rejects a rename; clone the set to a new name instead.',
      readonlyWhen: P`record.id != null && record.id != ''`,
      group: 'Identity',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      group: 'Identity',
    }),

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

    active: Field.boolean({
      label: 'Active',
      defaultValue: true,
      group: 'Status',
    }),

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

    managed_by: Field.select({
      label: 'Managed By',
      required: false,
      readonly: true,
      defaultValue: 'admin',
      description:
        "Record provenance, on the one platform / package / admin vocabulary that capabilities, " +
        "permission sets and positions all share: 'platform' = shipped by the " +
        "platform; 'package' = versioned package metadata (re-seeded on upgrade, read-mostly " +
        "for admins); 'admin' = created/owned in this environment by an administrator " +
        "(live-edited, never touched by package seeding). Legacy rows may carry 'user' (== admin).",
      options: [
        { value: 'platform', label: 'Platform' },
        { value: 'package', label: 'Package' },
        { value: 'admin', label: 'Admin' },
      ],
      group: 'Provenance',
    }),

    customized: Field.boolean({
      label: 'Customized',
      defaultValue: false,
      readonly: true,
      description:
        'This packaged permission set has an environment customization overlay (ADR-0094). ' +
        'Reset it (delete through the data door) to return to the shipped baseline.',
      group: 'Provenance',
    }),

    drift_status: Field.select({
      label: 'Declaration Drift',
      required: false,
      readonly: true,
      description:
        "Cause of a declared≠enforced mismatch for this package-declared set. 'overlay_shadow' = a Studio-" +
        "authored environment overlay is shadowing the packaged declaration. 'provenance_skip' = this row predates package provenance tracking, so boot sync " +
        "treats it as environment-authored and never reconciles it with the package (no automated fix — file " +
        "an issue / see the ops runbook for the manual adoption recipe). Absent = enforced grants match the " +
        "shipped artifact, or this set is not currently package-declared.",
      options: [
        { value: 'overlay_shadow', label: 'Overlay shadow' },
        { value: 'provenance_skip', label: 'Provenance skip' },
        { value: 'other', label: 'Drift (other)' },
      ],
      group: 'Provenance',
    }),

    drift_detail: Field.textarea({
      label: 'Drift Detail',
      required: false,
      readonly: true,
      description: 'Human-readable detail for `drift_status` — names the grant-count mismatch and its cause.',
      group: 'Provenance',
    }),

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
    { fields: ['name'], unique: 'organization' },
    { fields: ['active'] },
    { fields: ['package_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});

export const SysPositionPermissionSet = ObjectSchema.create({
  name: 'sys_position_permission_set',
  label: 'Position Permission Set',
  pluralLabel: 'Position Permission Sets',
  isSystem: true,
  managedBy: 'system-data',
  displayNameField: 'display_title',
  nameField: 'display_title',
  fields: {
    id: Field.text({
      label: 'Binding ID',
      required: true,
      readonly: true,
      description: 'UUID of the position-permission-set binding.',
    }),

    display_title: Field.formula({
      label: 'Title',
      returnType: 'text',
      expression: F`record.position_id + ' → ' + record.permission_set_id`,
      description: 'Record title: the position and the permission set bound to it (computed on read)',
    }),

    position_id: Field.lookup('sys_position', {
      label: 'Position',
      required: true,
      description: 'Foreign key to sys_position.',
    }),

    permission_set_id: Field.lookup('sys_permission_set', {
      label: 'Permission Set',
      required: true,
      description: 'Foreign key to sys_permission_set.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['position_id', 'permission_set_id'], unique: 'global' },
    { fields: ['position_id'] },
    { fields: ['permission_set_id'] },
  ],

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});

/** The four retired table shapes above. */
export const LEGACY_CATALOG_OBJECTS = [SysPosition, SysCapability, SysPermissionSet, SysPositionPermissionSet] as const;

/**
 * `objects` plus every retired catalog table it does not already declare — for
 * a suite that boots the plugin's own objects AND models an existing database's
 * catalog rows, whether or not the plugin still declares those tables.
 */
export function withLegacyCatalogTables<T extends { name: string }>(objects: readonly T[]): Array<T | (typeof LEGACY_CATALOG_OBJECTS)[number]> {
  const declared = new Set(objects.map((o) => o.name));
  return [...objects, ...LEGACY_CATALOG_OBJECTS.filter((o) => !declared.has(o.name))];
}
