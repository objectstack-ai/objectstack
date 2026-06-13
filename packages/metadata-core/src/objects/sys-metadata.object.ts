// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata — System Metadata Object
 *
 * Canonical ObjectStack object definition for the metadata persistence table.
 * Stores all platform-scope and user-scope metadata records (Objects, Views,
 * Flows, etc.) using the MetadataRecordSchema envelope.
 *
 * This is a system object (isSystem: true) — protected from deletion and
 * automatically provisioned by the DatabaseLoader on first use.
 *
 * @see MetadataRecordSchema in metadata-persistence.zod.ts
 */
export const SysMetadataObject = ObjectSchema.create({
  name: 'sys_metadata',
  label: 'System Metadata',
  pluralLabel: 'System Metadata',
  icon: 'settings',
  isSystem: true,
  // managedBy: 'system' — the metadata table backs every other config
  // object. Writing rows directly here bypasses the typed Zod APIs and
  // would let an admin inject malformed payloads. The "All Metadata"
  // menu is therefore a read-only debug surface (Export only); typed
  // edits flow through the dedicated per-type pages (Approval Process,
  // Sharing Rule, etc.).
  managedBy: 'system',
  description: 'Stores platform and user-scope metadata records (objects, views, flows, etc.)',

  fields: {
    /** Primary Key (UUID) */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    /** Machine name — unique identifier used in code references */
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
    }),

    /** Metadata type (e.g. "object", "view", "flow") */
    type: Field.text({
      label: 'Metadata Type',
      required: true,
      searchable: true,
      maxLength: 100,
    }),

    /** Namespace / module grouping (e.g. "crm", "core") */
    namespace: Field.text({
      label: 'Namespace',
      required: false,
      defaultValue: 'default',
      maxLength: 100,
    }),

    /** Package that owns/delivered this metadata (legacy string identifier, kept for compat) */
    package_id: Field.text({
      label: 'Package ID',
      required: false,
      maxLength: 255,
      description: 'Legacy package manifest ID string. Use package_version_id for new records.',
    }),

    /**
     * FK → sys_package_version (UUID). Set for metadata that belongs to a specific
     * package release snapshot. NULL = platform-built-in or environment override.
     */
    package_version_id: Field.lookup('sys_package_version', {
      label: 'Package Version',
      required: false,
      description:
        'Foreign key to sys_package_version (UUID). Null = platform-built-in or env-level override.',
    }),

    /** Who manages this record: package, platform, or user */
    managed_by: Field.select(['package', 'platform', 'user'], {
      label: 'Managed By',
      required: false,
    }),

    /** Scope: system (code), platform (admin DB), user (personal DB) */
    scope: Field.select(['system', 'platform', 'user'], {
      label: 'Scope',
      required: true,
      defaultValue: 'platform',
    }),

    /** JSON payload — the actual metadata configuration */
    metadata: Field.textarea({
      label: 'Metadata',
      required: true,
      description: 'JSON-serialized metadata payload',
    }),

    /** Parent metadata name for extension/override */
    extends: Field.text({
      label: 'Extends',
      required: false,
      maxLength: 255,
    }),

    /** Merge strategy when extending parent metadata */
    strategy: Field.select(['merge', 'replace'], {
      label: 'Strategy',
      required: false,
      defaultValue: 'merge',
    }),

    /** Owner user ID (for user-scope items) */
    owner: Field.text({
      label: 'Owner',
      required: false,
      maxLength: 255,
    }),

    /** Lifecycle state */
    state: Field.select(['draft', 'active', 'archived', 'deprecated'], {
      label: 'State',
      required: false,
      defaultValue: 'active',
    }),

    /** Organization ID for multi-tenant isolation */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      description: 'Organization for multi-tenant isolation.',
    }),

    /**
     * @deprecated ADR-0005 (revised 2026-05): per-env DBs replace per-project
     * isolation. `environment_id` is no longer written by saveMetaItem and not
     * consulted by overlay reads. Kept for legacy rows; new writes leave it
     * NULL. Will be dropped in a future schema migration.
     */
    environment_id: Field.lookup('sys_environment', {
      label: 'Environment (deprecated)',
      required: false,
      description: 'DEPRECATED. Use organization_id for tenant isolation.',
    }),

    /** Version number for optimistic concurrency */
    version: Field.number({
      label: 'Version',
      required: false,
      defaultValue: 1,
    }),

    /** Content checksum for change detection (e.g. `sha256:<64 hex>` = 71 chars) */
    checksum: Field.text({
      label: 'Checksum',
      required: false,
      maxLength: 71,
    }),

    /** Origin of this metadata record */
    source: Field.select(['filesystem', 'database', 'api', 'migration'], {
      label: 'Source',
      required: false,
    }),

    /** Classification tags (JSON array) */
    tags: Field.textarea({
      label: 'Tags',
      required: false,
      description: 'JSON-serialized array of classification tags',
    }),

    /** Audit fields */
    created_by: Field.lookup('sys_user', {
      label: 'Created By',
      required: false,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: false,
      readonly: true,
    }),

    updated_by: Field.lookup('sys_user', {
      label: 'Updated By',
      required: false,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
    }),
  },

  indexes: [
    // ADR-0005 (revised 2026-05) + ADR-0048: overlay uniqueness is scoped by
    // (type, name, organization_id, package_id), restricted to active rows so
    // resets / archived versions don't collide. `package_id` is part of the
    // discriminator so two installed packages shipping the same `type`/`name`
    // each get their OWN customization row (a package-less / global overlay
    // uses NULL). environment_id is deprecated and not part of the
    // discriminator. The runtime layer (protocol.ts ensureOverlayIndex) issues
    // a DROP-then-CREATE migration that uses `COALESCE(package_id,'')` so the
    // package-less rows stay unique among themselves (SQLite treats NULLs as
    // distinct in a plain unique index); this declaration is the fallback shape
    // for drivers without the runtime migration.
    {
      name: 'idx_sys_metadata_overlay_active',
      fields: ['type', 'name', 'organization_id', 'package_id'],
      unique: true,
      partial: "state = 'active'",
    },
    { name: 'idx_sys_metadata_org_type', fields: ['organization_id', 'type'] },
    { fields: ['type', 'scope'] },
    { fields: ['package_version_id'] },
    { fields: ['state'] },
    { fields: ['namespace'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
  },

  // Named list views — power the Setup App "Data Model" group so admins
  // can browse object/field metadata in a typed grid instead of the raw
  // `All Metadata` debug surface. Each entry pre-filters by `type` and
  // shows the columns that matter for that type. The dedicated visual
  // designer (objectui's <ObjectManager> / <FieldDesigner>) deep-links
  // from the row's `Edit in Designer` action; the grid stays useful for
  // search, audit (state / updated_at) and triage.
  listViews: {
    only_objects: {
      type: 'grid',
      name: 'only_objects',
      label: 'Objects',
      data: { provider: 'object', object: 'sys_metadata' },
      columns: ['name', 'namespace', 'scope', 'managed_by', 'state', 'updated_at'],
      filter: [{ field: 'type', operator: 'equals', value: 'object' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    only_fields: {
      type: 'grid',
      name: 'only_fields',
      label: 'Fields',
      data: { provider: 'object', object: 'sys_metadata' },
      columns: ['name', 'namespace', 'scope', 'managed_by', 'state', 'updated_at'],
      filter: [{ field: 'type', operator: 'equals', value: 'field' }],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    all_metadata: {
      type: 'grid',
      name: 'all_metadata',
      label: 'All',
      data: { provider: 'object', object: 'sys_metadata' },
      columns: ['name', 'type', 'namespace', 'scope', 'state', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },
});
