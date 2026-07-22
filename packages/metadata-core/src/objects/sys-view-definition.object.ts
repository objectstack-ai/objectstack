// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_view_definition — Runtime View Storage ("Object has-many View")
 *
 * Persists view definitions authored at RUNTIME by end users — the `shared`
 * and `personal` layers of the view model (see spec `ViewItemSchema`). The
 * `package` layer ships from `*.view.ts` source and lives in the metadata
 * registry; it is NOT stored here.
 *
 * Why a dedicated object (not the `sys_metadata` overlay): runtime views are
 * data, not admin metadata customisation. They carry an `owner`, a visibility
 * `scope`, and are queried per-user — so they belong in a typed, permissioned
 * ObjectQL object rather than the global metadata registry (which a personal
 * "My hot leads" view should never pollute).
 *
 * CRUD flows through ObjectQL's generic data API (`/api/v1/data/
 * sys_view_definition`) — no bespoke per-view REST endpoints. The runtime
 * switcher reads the `package` layer via `GET /meta/view?object=<object>` and
 * merges these rows client-side, filtered to `scope='shared'` OR
 * `owner=<current user>`.
 *
 * This is a system object (isSystem: true) — protected from deletion and
 * auto-provisioned on first use.
 */
export const SysViewDefinitionObject = ObjectSchema.create({
  name: 'sys_view_definition',
  label: 'View Definition',
  pluralLabel: 'View Definitions',
  icon: 'layout-grid',
  isSystem: true,
  description:
    'Runtime-authored view definitions (shared / personal layers). The package layer ships from source.',

  fields: {
    /** Primary Key (UUID) */
    id: Field.text({ label: 'ID', required: true, readonly: true }),

    /**
     * Globally-unique qualified view id, `<object>.<viewKey>`, matching the
     * spec `ViewItemSchema.name`. For personal views the runtime may suffix
     * to keep it unique per owner.
     */
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
    }),

    /** Bound object — the foreign key used to aggregate views for the switcher. */
    object: Field.text({
      label: 'Object',
      required: true,
      searchable: true,
      maxLength: 255,
    }),

    /** Whether `config` is a ListView (list family) or a FormView. */
    view_kind: Field.select(['list', 'form'], {
      label: 'View Kind',
      required: true,
      defaultValue: 'list',
    }),

    /** Display label (plain string; i18n keys also accepted). */
    label: Field.text({ label: 'Label', required: false, maxLength: 255 }),

    /** Whether this is the object's default view in the switcher. */
    is_default: Field.boolean({ label: 'Is Default', required: false, defaultValue: false }),

    /** Sort order within the object's switcher / left rail. */
    view_order: Field.number({ label: 'Order', required: false, defaultValue: 0 }),

    /**
     * Identity layer. Only `shared` and `personal` are stored at runtime;
     * `package` views come from source.
     */
    scope: Field.select(['shared', 'personal'], {
      label: 'Scope',
      required: true,
      defaultValue: 'personal',
    }),

    /** Owner user id — set when scope = personal; null for shared. */
    owner: Field.text({ label: 'Owner', required: false, maxLength: 255 }),

    /** Hidden from the switcher (per-user / per-org declutter). */
    hidden: Field.boolean({ label: 'Hidden', required: false, defaultValue: false }),

    /** The ListView / FormView configuration payload. */
    config: Field.json({
      label: 'Config',
      required: true,
      description: 'ListView or FormView configuration (matches spec ViewItem.config).',
    }),

    /** Organization for multi-tenant isolation. */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Organization for multi-tenant isolation.',
    }),

    /** Lifecycle state. */
    state: Field.select(['draft', 'active', 'archived'], {
      label: 'State',
      required: false,
      defaultValue: 'active',
    }),

    /** Audit fields. */
    created_by: Field.lookup('sys_user', { label: 'Created By', required: false, readonly: true }),
    created_at: Field.datetime({ label: 'Created At', required: false, readonly: true }),
    updated_by: Field.lookup('sys_user', { label: 'Updated By', required: false }),
    updated_at: Field.datetime({ label: 'Updated At', required: false }),
  },

  indexes: [
    // A given view name is unique per (organization, owner) among active rows —
    // a shared view (owner NULL) and each user's personal views don't collide.
    {
      name: 'idx_sys_view_def_active',
      fields: ['name', 'organization_id', 'owner'],
      unique: true,
      partial: "state = 'active'",
    },
    // The switcher query: views for one object within a tenant.
    { name: 'idx_sys_view_def_object', fields: ['organization_id', 'object'] },
    { fields: ['scope'] },
    { fields: ['owner'] },
    { fields: ['state'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
  },
});
