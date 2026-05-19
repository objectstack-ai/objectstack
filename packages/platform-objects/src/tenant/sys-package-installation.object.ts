// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_package_installation — Per-project package installation record.
 *
 * Models the pairing between a project and a specific, immutable package
 * version snapshot (`sys_package_version`). Only one version of a given package
 * may be active per project at a time (enforced by UNIQUE on
 * `(project_id, package_id)`).
 *
 * **Upgrade** = atomic UPDATE of `package_version_id` to a newer version UUID.
 * **Rollback** = atomic UPDATE of `package_version_id` to an older version UUID.
 * Version history is tracked via the sequence of `package_version_id` changes
 * on this row (and an optional sys_package_installation_history audit table).
 *
 * **Stored in the Control Plane DB (not in project DBs).**
 * Project DBs contain only business data rows — zero system tables.
 *
 * See `docs/adr/0003-package-as-first-class-citizen.md` for the full rationale.
 *
 * @namespace sys
 */
export const SysPackageInstallation = ObjectSchema.create({
  name: 'sys_package_installation',
  label: 'Package Installation',
  pluralLabel: 'Package Installations',
  icon: 'package',
  isSystem: true,
  managedBy: 'config',
  description: 'Per-project package installation registry (sys_package_installation).',
  titleFormat: '{package_id} @ {project_id}',
  compactLayout: ['package_version_id', 'project_id', 'status', 'installed_at'],

  fields: {
    id: Field.text({
      label: 'Installation ID',
      required: true,
      readonly: true,
      description: 'UUID of this installation record (stable, never reused).',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Creation timestamp (ISO-8601).',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
      description: 'Last update timestamp — changes on upgrade, rollback, enable/disable (ISO-8601).',
    }),

    project_id: Field.lookup('sys_project', {
      label: 'Project',
      required: true,
      description: 'Foreign key to sys_project. The project that owns this installation.',
    }),

    package_version_id: Field.lookup('sys_package_version', {
      label: 'Package Version',
      required: true,
      description:
        'Foreign key to sys_package_version. The specific, immutable release snapshot ' +
        'currently installed in this project. Upgrading = swapping this field to a newer ' +
        'version. Rollback = swapping to an older version.',
    }),

    package_id: Field.lookup('sys_package', {
      label: 'Package',
      required: true,
      description:
        'Foreign key to sys_package. Denormalized from the linked package_version row ' +
        'at install time to enforce the UNIQUE (project_id, package_id) constraint without a JOIN.',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'installed',
      description: 'Current lifecycle status of this installation within the project.',
      options: [
        { value: 'installed', label: 'Installed' },
        { value: 'installing', label: 'Installing' },
        { value: 'upgrading', label: 'Upgrading' },
        { value: 'disabled', label: 'Disabled' },
        { value: 'error', label: 'Error' },
      ],
    }),

    enabled: Field.boolean({
      label: 'Enabled',
      required: true,
      defaultValue: true,
      description:
        'Whether the package metadata is actively loaded into this project. ' +
        'Disabled packages are installed but their schema is not visible to the runtime.',
    }),

    settings: Field.textarea({
      label: 'Settings',
      required: false,
      description:
        'JSON-serialized per-installation configuration overrides. ' +
        'Keys mirror the package manifest configurationSchema.properties.',
    }),

    installed_at: Field.datetime({
      label: 'Installed At',
      required: true,
      defaultValue: 'NOW()',
      description: 'Timestamp when this installation was first created (ISO-8601).',
    }),

    installed_by: Field.lookup('sys_user', {
      label: 'Installed By',
      required: false,
      description: 'User who performed the initial install. Null for system-automated installs.',
    }),

    error_message: Field.textarea({
      label: 'Error Message',
      required: false,
      description: 'Error details when status is error. Cleared on next successful install/upgrade.',
    }),
  },

  indexes: [
    { fields: ['project_id', 'package_id'], unique: true },
    { fields: ['project_id'] },
    { fields: ['package_id'] },
    { fields: ['package_version_id'] },
    { fields: ['status'] },
  ],

  enable: {
    trackHistory: false,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
    mru: false,
  },
});
