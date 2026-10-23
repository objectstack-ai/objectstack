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
  // managedBy: 'engine-owned' — the metadata table backs every other config
  // object. Writing rows directly here bypasses the typed Zod APIs and
  // would let an admin inject malformed payloads. The "All Metadata"
  // menu is therefore a read-only debug surface (Export only); typed
  // edits flow through the dedicated per-type pages (Approval Process,
  // Sharing Rule, etc.).
  managedBy: 'engine-owned',
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
        'The package release this metadata was installed from. Empty for built-in platform metadata and for changes made in this environment.',
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

    /**
     * The bundle member this row overlays, for a metadata type whose identity
     * is a pair (`ITEM_KEY_DISCRIMINATORS` in `../item-key-discriminators.ts`,
     * today `email_template`'s `(name, locale)`).
     *
     * NULL is the type's CANONICAL member, which is also every row of a type
     * whose identity is `name` alone — so those rows never carry a value and
     * stay byte-identical. A non-canonical member stores the value the body
     * declares (`itemDiscriminator`), so two locales of one template are two
     * rows. Written by the overlay repository from the body, never authored;
     * part of the overlay uniqueness key below and of the runtime index
     * (`metadata-protocol`'s `migrations/overlay-index.ts`).
     */
    bundle_member: Field.text({
      label: 'Bundle Member',
      required: false,
      maxLength: 100,
      description:
        'Bundle member (e.g. the locale of an email template) this overlay row customizes. Null = the canonical member.',
    }),

    /** JSON payload — the actual metadata configuration */
    metadata: Field.textarea({
      label: 'Metadata',
      required: true,
      description: 'JSON-serialized metadata payload',
    }),

    /**
     * [#24395] A draft row's per-key provenance — the entries the strict draft
     * read serves as `draftChanges` (`GetMetaItemResponseSchema` in
     * `@objectstack/spec/api`): which authoring surface, actor and instant last
     * changed each key path of the draft body. JSON-serialized array, written
     * by the overlay repository's draft save, never authored.
     *
     * On the row, ⛔ never inside `metadata`: publishing and discarding a draft
     * both delete its row, so the entries go with it. NULL on every active row
     * and on a draft row whose saves recorded none.
     */
    draft_changes: Field.textarea({
      label: 'Draft Changes',
      required: false,
      description:
        'JSON-serialized per-key provenance of a pending draft: which surface (copilot, studio, api), actor and time last changed each key path. Null on active rows.',
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

    /**
     * @deprecated ADR-0005 (revised 2026-05): per-env DBs replace per-project
     * isolation. `environment_id` is no longer written by saveMetaItem and not
     * consulted by overlay reads. Kept for legacy rows; new writes leave it
     * NULL. Will be dropped in a future schema migration.
     */
    environment_id: Field.lookup('sys_environment', {
      label: 'Environment (deprecated)',
      required: false,
      // ADR-0131 D6 — overlays are environment rows.
      description: 'DEPRECATED. Overlays are environment rows; no tenant column.',
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

  // [ADR-0131 D6/D7, C7b] Tenant-less: an overlay is the environment's. The
  // declared organization column is retired (ADR-0087 semantic entry
  // 18.sys-metadata-organization-column-retired), and `systemFields.tenant: false`
  // keeps the engine from injecting one back; the v18 ceremony
  // (`os migrate organization-ownership --apply`) promotes or reports the
  // legacy organization rows first, then drops the physical column.
  systemFields: { tenant: false },

  indexes: [
    // ADR-0005 (revised 2026-05) + ADR-0048 + ADR-0131 D6: overlay uniqueness
    // is scoped by (type, name, package_id, bundle_member) — the environment's
    // key; the organization left it with the column (C7b). `package_id` is
    // part of the discriminator so two installed packages shipping the same
    // `type`/`name` each get their OWN customization row (a package-less /
    // global overlay uses NULL). `bundle_member` is the bundled type's member
    // (#22877): two locales of one email template are two overlay rows; NULL
    // is the canonical member and every undiscriminated type's row.
    // environment_id is deprecated and not part of the discriminator.
    //
    // ⚠️ The active-row restriction is NOT declared here, and never was in any
    // effective sense: this entry carried `partial: "state = 'active'"` until
    // #5248 / #4943 retired the key, and no driver ever emitted the predicate
    // — `syncDeclaredIndexes` builds indexes through knex's `table.unique()`,
    // which cannot express a `WHERE`. So the shape this declaration has always
    // materialized is the UNRESTRICTED unique index below; dropping the key is
    // a zero-DDL change (verified byte-for-byte against the created SQL).
    //
    // What actually delivers active-row scoping is the runtime layer:
    // `protocol.ts ensureOverlayIndex` issues a DROP-then-CREATE migration for
    // `CREATE UNIQUE INDEX … ON sys_metadata (type, name,
    // COALESCE(package_id,''), COALESCE(bundle_member,'')) WHERE state =
    // 'active'` — which additionally fixes NULL-distinctness for package-less
    // rows and canonical members, something this declaration could not
    // express either. This entry is therefore the
    // coarser fallback that a driver without that runtime migration gets: it
    // still prevents duplicate ACTIVE overlays, at the cost of also colliding
    // with archived/reset rows.
    {
      name: 'idx_sys_metadata_overlay_active',
      fields: ['type', 'name', 'package_id', 'bundle_member'],
      unique: 'global',
    },
    { fields: ['type', 'scope'] },
    { fields: ['package_version_id'] },
    { fields: ['state'] },
    { fields: ['namespace'] },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // #3220 — sys_metadata is `managedBy: 'engine-owned'`: customization overlays are
    // authored ONLY through the metadata-protocol RPC (its engine writes carry a
    // transaction context, not a user session), never the generic /data route.
    // Neither the framework nor the Console (objectui) POSTs /data/sys_metadata,
    // so the generic write verbs were a latent hole for a user-context raw write
    // the bucket forbids. Reads stay open for the Setup "Data Model" grids.
    apiMethods: ['get', 'list'],
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
