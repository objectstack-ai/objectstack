// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_app — Org-scoped catalog of apps across all projects in an organization.
 *
 * Mirrors per-project app metadata into the control-plane DB so the Studio
 * frontend can render a workspace-style "all apps in this org" view with a
 * single org-filtered query, without fanning out to every project DB.
 *
 * Kept thin on purpose: only the card-level fields (name, label, icon,
 * project_name, …) needed to render the catalog. The full app definition
 * remains authoritative in the project DB and is fetched on demand when the
 * user enters an app.
 *
 * Sync source: `AppCatalogService` listens for `app:registered` /
 * `app:unregistered` kernel hooks fired from project kernels (both
 * package-installed and user-created apps).
 *
 * **Stored in the Control Plane DB (not in project DBs).**
 *
 * @namespace sys
 */
export const SysApp = ObjectSchema.create({
  name: 'sys_app',
  label: 'App',
  pluralLabel: 'Apps',
  icon: 'layout-grid',
  isSystem: true,
  managedBy: 'config',
  description: 'Org-scoped catalog of apps across all projects (sys_app).',
  titleFormat: '{label}',
  compactLayout: ['label', 'project_name', 'source', 'active'],

  fields: {
    id: Field.text({
      label: 'App Catalog ID',
      required: true,
      readonly: true,
      description: 'UUID of this catalog entry (stable, never reused).',
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

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: true,
      description:
        'Foreign key to sys_organization. Drives tenant isolation — ' +
        'ControlPlaneProxyDriver auto-injects this filter on all reads.',
    }),

    project_id: Field.lookup('sys_project', {
      label: 'Project',
      required: true,
      description: 'Foreign key to sys_project. The project this app lives in.',
    }),

    project_name: Field.text({
      label: 'Project Name',
      required: false,
      description:
        'Denormalized project display name. Cached here so the catalog list ' +
        'avoids a JOIN against sys_project for card rendering.',
    }),

    name: Field.text({
      label: 'App Name',
      required: true,
      description: 'Short, machine name of the app (snake_case). Unique within a project.',
    }),

    label: Field.text({
      label: 'Display Label',
      required: false,
      description: 'Human-readable display label shown on the catalog card.',
    }),

    icon: Field.text({
      label: 'Icon',
      required: false,
      description: 'Icon identifier (e.g. lucide name, emoji, or URL).',
    }),

    branding: Field.textarea({
      label: 'Branding',
      required: false,
      description:
        'JSON-serialized branding subset (color, logo, …) used for catalog rendering.',
    }),

    is_default: Field.boolean({
      label: 'Is Default',
      required: false,
      defaultValue: false,
      description: 'Whether this is the default app for its project.',
    }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      description: 'Whether the app is currently enabled in its project kernel.',
    }),

    source: Field.select({
      label: 'Source',
      required: true,
      defaultValue: 'package',
      description: 'Where this app originates from.',
      options: [
        { value: 'package', label: 'Package' },
        { value: 'user', label: 'User' },
      ],
    }),

    package_id: Field.lookup('sys_package', {
      label: 'Package',
      required: false,
      description:
        'Foreign key to sys_package when source = package. Null for user-created apps.',
    }),
  },

  indexes: [
    { fields: ['project_id', 'name'], unique: true },
    { fields: ['organization_id'] },
    { fields: ['project_id'] },
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
