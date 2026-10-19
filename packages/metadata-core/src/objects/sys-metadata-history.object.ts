// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_history — Metadata Version History / Event Log
 *
 * Append-only durable log of every overlay change made through
 * `SysMetadataRepository.put` / `delete` (ADR-0008 §10 M1). Each row is a
 * single event in the environment's event log; rows are NEVER
 * mutated after insertion. The legacy `DatabaseLoader` writes the same
 * shape from its own put/restore code paths.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Key design points (ADR-0008 §0 amendment + M1):
 *
 *  • Keyed by `(type, name)` only — `environment_id` was removed in the
 *    branch/project-removal amendment, and `organization_id` with ADR-0131
 *    D6 (the overlay axis is the environment's; C7b retired the column).
 *    The original `metadata_id` column (a downgraded plain-text version of
 *    the old `sys_metadata.id` FK) was removed in the M1 follow-up — joins
 *    go through `(type, name, version)` exclusively.
 *
 *  • `event_seq` is the environment's monotonic event-log cursor.
 *    Producers compute `MAX(event_seq) + 1` inside the same transaction as
 *    the parent `sys_metadata` write.
 *
 *  • `version` is the per-(type,name) lineage counter. Producers compute
 *    `MAX(version) + 1 WHERE type = T AND name = N` so delete + recreate
 *    continues incrementing instead of restarting at 1.
 *
 *  • `metadata` / `checksum` are nullable — DELETE rows have no body or
 *    hash. Readers must tolerate null on both columns.
 *
 *  • `source` records the producer ('sys-metadata-repo', 'fs',
 *    'studio', …) and feeds MetadataEvent.source on history() reads.
 *
 *  Indexes are purpose-built for the two dominant read patterns:
 *    1. per-item history view      → `(type, name, version)`
 *    2. environment event replay   → `(event_seq)`
 * ─────────────────────────────────────────────────────────────────────
 */
export const SysMetadataHistoryObject = ObjectSchema.create({
  name: 'sys_metadata_history',
  label: 'Metadata History',
  pluralLabel: 'Metadata History',
  icon: 'history',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Durable event log of metadata overlay changes (environment-wide, append-only)',

  fields: {
    /** Primary Key (UUID) */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    /** Per-org monotonic event sequence (durable cursor for replay). */
    event_seq: Field.number({
      label: 'Event Seq',
      required: true,
      readonly: true,
      description: 'Per-organization monotonic event log cursor.',
    }),

    /** Machine name (denormalized for easier querying) */
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      readonly: true,
      maxLength: 255,
    }),

    /** Metadata type (denormalized for easier querying) */
    type: Field.text({
      label: 'Metadata Type',
      required: true,
      searchable: true,
      readonly: true,
      maxLength: 100,
    }),

    /** Per-(org,type,name) lineage counter at this snapshot. */
    version: Field.number({
      label: 'Version',
      required: true,
      readonly: true,
    }),

    /** Type of operation that created this history entry */
    operation_type: Field.select(['create', 'update', 'publish', 'revert', 'delete'], {
      label: 'Operation Type',
      required: true,
      readonly: true,
    }),

    /**
     * Historical metadata snapshot (JSON payload).
     * Null for `operation_type = 'delete'` — the row carries no body.
     */
    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      readonly: true,
      description: 'JSON-serialized metadata snapshot at this version (null for deletes).',
    }),

    /** SHA-256 checksum of metadata content (null for deletes). */
    checksum: Field.text({
      label: 'Checksum',
      required: false,
      readonly: true,
      maxLength: 80,
    }),

    /** Checksum of the previous version (null for the first event). */
    previous_checksum: Field.text({
      label: 'Previous Checksum',
      required: false,
      readonly: true,
      maxLength: 80,
    }),

    /** Human-readable description of changes (= MetadataEvent.message). */
    change_note: Field.textarea({
      label: 'Change Note',
      required: false,
      readonly: true,
      description: 'Description of what changed in this version.',
    }),

    /**
     * Producer of the event ('sys-metadata-repo', 'fs', 'studio',
     * 'api', …). Defaults to 'sys-metadata-repo' on the canonical
     * write path; preserved on history() reads as MetadataEvent.source.
     */
    source: Field.text({
      label: 'Source',
      required: false,
      readonly: true,
      maxLength: 64,
    }),

    /**
     * User who made this change (= MetadataEvent.actor).
     *
     * NULL when the write had no human actor — a system-initiated write
     * (boot metadata sync, a data migration, a scheduled job). #4556: this
     * column used to receive the sentinel STRING `'system'`, which is not
     * any `sys_user` id, so a lookup column declared as a foreign key held
     * a value no join could ever resolve. NULL is the standard expression
     * of "no link" and is what `deleteBehavior: 'set_null'` already means
     * here, so the declared type and the stored value now agree.
     */
    recorded_by: Field.lookup('sys_user', {
      label: 'Recorded By',
      required: false,
      readonly: true,
      description:
        'User who made this change. NULL = system-initiated (boot sync, migration, scheduled job) — never a sentinel string.',
    }),

    /** When was this version recorded */
    recorded_at: Field.datetime({
      label: 'Recorded At',
      required: true,
      readonly: true,
    }),
  },

  // [ADR-0131 D6/D7, C7b] Tenant-less, like the overlays it records: the
  // declared organization column is retired (ADR-0087 semantic entry
  // 18.sys-metadata-history-organization-column-retired), and `systemFields.tenant: false`
  // keeps the engine from injecting one back. The v18 ceremony
  // (`os migrate organization-ownership --apply`) drops the physical column.
  systemFields: { tenant: false },
  // [ADR-0131 D7, the #22107 precedent] With no organization column there is
  // no tenant wall, and a walled deployment's `organization_admin` holds a
  // `'*'` grant — so without an object-level gate the generic data door would
  // serve every organization's rows of this table (every item version body). D7 governs it by
  // object permission: `studio.access`, platform-scoped (no tenant
  // administrator holds it by role) and admitted by every door that serves
  // this table's trail (`/meta/:type/:name/history`, `/audit` and `/diff` admit
  // it beside `manage_metadata`; `/packages/:id/commits` admits it alone).
  // `requiredPermissions` is an AND-gate, so it names the one capability all
  // of those doors admit — and not `setup.access`, which organization admins
  // DO hold (plugin-security's `PLATFORM_ADMIN_ONLY_CAPABILITIES` excludes it
  // on purpose). [#23546] None of those doors admits `setup.access` either, so
  // the data door and the trail doors refuse an organization admin alike.
  // Platform code reads under the system context, which the gate does not stop.
  requiredPermissions: ['studio.access'],

  indexes: [
    // The environment's event cursor and each item's lineage are unique
    // environment-wide. Organization-layer history kept its own per-org
    // sequences, so a legacy database holds duplicates on both keys, and a
    // boot cannot build either index until the v18 ceremony has made them
    // unique (a unique index that meets duplicates is logged and skipped).
    { fields: ['event_seq'], unique: 'global' },
    { fields: ['type', 'name', 'version'], unique: 'global' },
    { fields: ['type', 'name', 'recorded_at'] },
    // ADR-0009: getByHash() lookup — execution-pinned types resolve a
    // historical body by content hash via this index.
    { fields: ['type', 'name', 'checksum'] },
    { fields: ['type', 'name'] },
    { fields: ['recorded_at'] },
    { fields: ['operation_type'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
  },
});
