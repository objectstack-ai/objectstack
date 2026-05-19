// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_package — Control Plane Package Registry
 *
 * One row per logical package (also called Solution in Power Platform,
 * Unlocked Package in Salesforce, Application in ServiceNow).
 * The package itself carries only identity and publishing metadata.
 * Actual content (objects, views, flows…) lives in sys_package_version.
 *
 * Addressable by the globally unique `manifest_id` (reverse-domain string).
 * The `manifest_id` is immutable once set — renaming a package requires
 * creating a new package entry.
 *
 * **This table lives in the Control Plane only.**
 *
 * See `docs/adr/0003-package-as-first-class-citizen.md` for the full rationale.
 *
 * @namespace sys
 */
export const SysPackage = ObjectSchema.create({
  name: 'sys_package',
  label: 'Package',
  pluralLabel: 'Packages',
  icon: 'package',
  isSystem: true,
  managedBy: 'config',
  description: 'Control-plane registry of installable packages / solutions (sys_package).',
  titleFormat: '{display_name}',
  compactLayout: ['display_name', 'manifest_id', 'visibility', 'created_at'],

  fields: {
    id: Field.text({
      label: 'Package ID',
      required: true,
      readonly: true,
      description: 'UUID of the package (stable, never reused).',
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
      description: 'Last update timestamp (ISO-8601).',
    }),

    manifest_id: Field.text({
      label: 'Manifest ID',
      required: true,
      readonly: true,
      maxLength: 255,
      description:
        'Globally unique reverse-domain package identifier (e.g. com.acme.crm). ' +
        'Immutable once set. Used as the stable public key for dependency declarations.',
    }),

    owner_org_id: Field.lookup('sys_organization', {
      label: 'Owner Organization',
      required: true,
      description: 'Organization that owns and publishes this package.',
    }),

    display_name: Field.text({
      label: 'Display Name',
      required: true,
      maxLength: 128,
      description: 'Human-readable name shown in Studio and Marketplace.',
    }),

    description: Field.textarea({
      label: 'Description',
      required: false,
      description: 'Short package description shown in search results and install dialogs (max 512 chars).',
    }),

    readme: Field.textarea({
      label: 'Readme',
      required: false,
      description: 'Long-form package documentation (markdown). Displayed on the Marketplace detail page.',
    }),

    visibility: Field.select({
      label: 'Visibility',
      required: true,
      defaultValue: 'private',
      description:
        'Controls who can discover and install the package. ' +
        'private = owner org only; org = all envs in owner org; marketplace = public registry.',
      options: [
        { value: 'private', label: 'Private' },
        { value: 'org', label: 'Organization' },
        { value: 'marketplace', label: 'Marketplace' },
      ],
    }),

    category: Field.text({
      label: 'Category',
      required: false,
      maxLength: 100,
      description: 'Primary category for Marketplace filtering (e.g. crm, hr, finance, devtools).',
    }),

    tags: Field.textarea({
      label: 'Tags',
      required: false,
      description: 'JSON-serialized array of search/filter tags (e.g. ["salesforce","sync","crm"]).',
    }),

    icon_url: Field.url({
      label: 'Icon URL',
      required: false,
      description: 'URL to the package icon image displayed in Studio and Marketplace.',
    }),

    homepage_url: Field.url({
      label: 'Homepage URL',
      required: false,
      description: 'URL to the package homepage or external documentation site.',
    }),

    license: Field.text({
      label: 'License',
      required: false,
      maxLength: 64,
      description: 'SPDX license identifier (e.g. MIT, Apache-2.0, proprietary).',
    }),

    created_by: Field.lookup('sys_user', {
      label: 'Created By',
      required: true,
      description: 'User that registered this package in the Control Plane.',
    }),
  },

  indexes: [
    { fields: ['manifest_id'], unique: true },
    { fields: ['owner_org_id'] },
    { fields: ['visibility'] },
    { fields: ['owner_org_id', 'visibility'] },
  ],

  enable: {
    trackHistory: false,
    searchable: true,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update'],
    trash: false,
    mru: false,
  },
});
