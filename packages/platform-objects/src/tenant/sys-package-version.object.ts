// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_package_version — Immutable Package Release Snapshot
 *
 * One row per versioned release of a package. Once `status` transitions
 * from `draft` to `published`, the `manifest_json` and `checksum` fields
 * are sealed and MUST NOT change.
 *
 * The triple `(package_id, version)` is UNIQUE — a package can only publish
 * each semver string once.
 *
 * Installing a package means pointing a `sys_package_installation` row at a
 * specific `sys_package_version` UUID. Upgrading swaps that pointer atomically.
 *
 * **This table lives in the Control Plane only.**
 *
 * See `docs/adr/0003-package-as-first-class-citizen.md` for the full rationale.
 *
 * @namespace sys
 */
export const SysPackageVersion = ObjectSchema.create({
  name: 'sys_package_version',
  label: 'Package Version',
  pluralLabel: 'Package Versions',
  icon: 'tag',
  isSystem: true,
  managedBy: 'config',
  description: 'Immutable release snapshot of a package (sys_package_version).',
  titleFormat: '{package_id} v{version}',
  compactLayout: ['package_id', 'version', 'status', 'published_at'],

  fields: {
    id: Field.text({
      label: 'Version ID',
      required: true,
      readonly: true,
      description: 'UUID of this package version row (stable, never reused).',
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
      description: 'Last update timestamp (ISO-8601). Only modified while status is draft.',
    }),

    package_id: Field.lookup('sys_package', {
      label: 'Package',
      required: true,
      description: 'Foreign key to sys_package (the parent package).',
    }),

    version: Field.text({
      label: 'Version',
      required: true,
      maxLength: 64,
      description: 'Semantic version string (e.g. 1.2.3, 2.0.0-beta.1). Follows semver spec.',
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      defaultValue: 'draft',
      description:
        'Lifecycle status. draft = being authored, may be mutated. ' +
        'published = immutable snapshot, installable in any environment. ' +
        'deprecated = published but superseded; new installs blocked.',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
        { value: 'deprecated', label: 'Deprecated' },
      ],
    }),

    manifest_json: Field.textarea({
      label: 'Manifest JSON',
      required: false,
      description:
        'Full package manifest serialized as JSON. Frozen on publish — ' +
        'writing to this field after status = published is rejected by the service layer.',
    }),

    checksum: Field.text({
      label: 'Checksum',
      required: false,
      maxLength: 64,
      readonly: true,
      description: 'SHA-256 hex digest of manifest_json. Computed and set on publish. Used for tamper detection.',
    }),

    release_notes: Field.textarea({
      label: 'Release Notes',
      required: false,
      description: 'Human-readable changelog for this version (markdown). Optional.',
    }),

    min_platform_version: Field.text({
      label: 'Min Platform Version',
      required: false,
      maxLength: 32,
      description:
        'Minimum ObjectStack platform version required to run this version ' +
        '(semver, e.g. 4.0.0). Denormalized from manifest_json for fast validation.',
    }),

    is_pre_release: Field.boolean({
      label: 'Pre-release',
      required: true,
      defaultValue: false,
      description:
        'Whether this is a pre-release version (alpha, beta, rc). ' +
        'Pre-release versions are not installed by default when resolving "latest".',
    }),

    published_at: Field.datetime({
      label: 'Published At',
      required: false,
      description: 'Timestamp when this version was published. Null while status is draft.',
    }),

    published_by: Field.lookup('sys_user', {
      label: 'Published By',
      required: false,
      description: 'User who published this version. Set on the draft → published transition.',
    }),

    created_by: Field.lookup('sys_user', {
      label: 'Created By',
      required: true,
      description: 'User that created this version row.',
    }),
  },

  indexes: [
    { fields: ['package_id', 'version'], unique: true },
    { fields: ['package_id'] },
    { fields: ['status'] },
    { fields: ['package_id', 'status'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update'],
    trash: false,
    mru: false,
  },
});
