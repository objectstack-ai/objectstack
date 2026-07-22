// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_history — Metadata Version History / Event Log
 *
 * Append-only durable log of every overlay change made through
 * `SysMetadataRepository.put` / `delete` (ADR-0008 §10 M1). Each row is a
 * single event in the per-organisation event log; rows are NEVER
 * mutated after insertion. The legacy `DatabaseLoader` writes the same
 * shape from its own put/restore code paths.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Key design points (ADR-0008 §0 amendment + M1):
 *
 *  • Keyed by `(organization_id, type, name)` only — `environment_id` was
 *    removed in the branch/project-removal amendment. The original
 *    `metadata_id` column (a downgraded plain-text version of the old
 *    `sys_metadata.id` FK) was removed in the M1 follow-up — joins go
 *    through `(organization_id, type, name, version)` exclusively.
 *
 *  • `event_seq` is the per-org monotonic event-log cursor. Producers
 *    compute `MAX(event_seq) + 1 WHERE organization_id = X` inside the
 *    same transaction as the parent `sys_metadata` write.
 *
 *  • `version` is the per-(org,type,name) lineage counter. Producers
 *    compute `MAX(version) + 1 WHERE organization_id = X AND type = T
 *    AND name = N` so delete + recreate continues incrementing instead
 *    of restarting at 1.
 *
 *  • `metadata` / `checksum` are nullable — DELETE rows have no body or
 *    hash. Readers must tolerate null on both columns.
 *
 *  • `source` records the producer ('sys-metadata-repo', 'fs',
 *    'studio', …) and feeds MetadataEvent.source on history() reads.
 *
 *  Indexes are purpose-built for the two dominant read patterns:
 *    1. per-item history view  → `(organization_id, type, name, version)`
 *    2. org-wide event replay   → `(organization_id, event_seq)`
 * ─────────────────────────────────────────────────────────────────────
 */
export const SysMetadataHistoryObject = ObjectSchema.create({
  name: 'sys_metadata_history',
  label: 'Metadata History',
  pluralLabel: 'Metadata History',
  icon: 'history',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Durable event log of metadata overlay changes (per-org, append-only)',

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

    /** Organization ID for multi-tenant isolation */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      description: 'Organization for multi-tenant isolation.',
    }),

    /** User who made this change (= MetadataEvent.actor). */
    recorded_by: Field.lookup('sys_user', {
      label: 'Recorded By',
      required: false,
      readonly: true,
    }),

    /** When was this version recorded */
    recorded_at: Field.datetime({
      label: 'Recorded At',
      required: true,
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['organization_id', 'event_seq'], unique: true },
    { fields: ['organization_id', 'type', 'name', 'version'], unique: true },
    { fields: ['organization_id', 'type', 'name', 'recorded_at'] },
    // ADR-0009: getByHash() lookup — execution-pinned types resolve a
    // historical body by content hash via this index.
    { fields: ['organization_id', 'type', 'name', 'checksum'] },
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
