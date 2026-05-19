// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_metadata_history — Metadata Version History Object
 *
 * Stores historical snapshots of metadata changes for version tracking,
 * audit trail, and rollback capabilities.
 *
 * This is a system object (isSystem: true) — protected from deletion and
 * automatically provisioned when metadata history is enabled.
 *
 * Each record represents a single version snapshot of a metadata item,
 * created whenever the metadata is modified, published, or reverted.
 *
 * @see MetadataHistoryRecordSchema in metadata-persistence.zod.ts
 */
export const SysMetadataHistoryObject = ObjectSchema.create({
  name: 'sys_metadata_history',
  label: 'Metadata History',
  pluralLabel: 'Metadata History',
  icon: 'history',
  isSystem: true,
  managedBy: 'system',
  description: 'Version history and audit trail for metadata changes',

  fields: {
    /** Primary Key (UUID) */
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    /** Foreign key to sys_metadata.id */
    metadata_id: Field.lookup('sys_metadata', {
      label: 'Metadata',
      required: true,
      readonly: true,
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

    /** Version number at this snapshot */
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

    /** Historical metadata snapshot (JSON payload) */
    metadata: Field.textarea({
      label: 'Metadata',
      required: true,
      readonly: true,
      description: 'JSON-serialized metadata snapshot at this version',
    }),

    /** SHA-256 checksum of metadata content */
    checksum: Field.text({
      label: 'Checksum',
      required: true,
      readonly: true,
      maxLength: 64,
    }),

    /** Checksum of the previous version */
    previous_checksum: Field.text({
      label: 'Previous Checksum',
      required: false,
      readonly: true,
      maxLength: 64,
    }),

    /** Human-readable description of changes */
    change_note: Field.textarea({
      label: 'Change Note',
      required: false,
      readonly: true,
      description: 'Description of what changed in this version',
    }),

    /** Organization ID for multi-tenant isolation */
    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      description: 'Organization for multi-tenant isolation.',
    }),

    /** Environment ID — null = platform-global, set = env-scoped */
    project_id: Field.text({
      label: 'Environment ID',
      required: false,
      readonly: true,
      maxLength: 255,
      description: 'Scopes this history entry to a specific environment.',
    }),

    /** User who made this change */
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
    { fields: ['metadata_id', 'version'], unique: true },
    { fields: ['metadata_id', 'recorded_at'] },
    { fields: ['type', 'name'] },
    { fields: ['recorded_at'] },
    { fields: ['operation_type'] },
    { fields: ['organization_id'] },
    { fields: ['project_id'] },
  ],

  enable: {
    trackHistory: false, // Don't track history of history records
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'], // Read-only via API
    trash: false,
  },
});
