// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field, RECYCLE_BIN_ENTRY_FIELDS, RECYCLE_BIN_OBJECT } from '@objectstack/spec/data';

/**
 * sys_recycle_bin — the recycle bin: one entry per delete operation
 * (ADR-0148 D1, card #30237).
 *
 * When a by-id delete removes a business record, the engine reads the rows
 * the delete removes (the record and its master-detail cascade, in cascade
 * order) into ONE entry here, records the `set_null` references the delete
 * clears, and then deletes physically as before. No read path filters on this
 * table; a deleted record is gone from every query the moment its delete
 * commits.
 *
 * ## Fields
 *
 * Built from `RECYCLE_BIN_ENTRY_FIELDS` (`@objectstack/spec/data`), the one
 * field list the spec's `RecycleBinEntrySchema` shares, so the table and the
 * contract cannot drift. Every field is read-only.
 *
 * ## Writers and readers
 *
 * `managedBy: 'engine-owned'`: the engine's recycle-bin paths are the only
 * writers. The entry is written raw through this object's driver, inside the
 * delete's own unit of work (`@objectstack/objectql`, `recycle-bin/capture.ts`),
 * never through `engine.insert`, so no insert hook, audit mirror or activity
 * row fires for the bookkeeping of a delete the audit already records.
 *
 * ⛔ No generic data-API method (`apiEnabled: false`, `apiMethods: []`): the
 * snapshot holds every field of the deleted rows, so a listing must apply the
 * field-level security of the live object it came from (ADR-0148 D4). The
 * engine's restore, purge and empty paths and their REST doors are that
 * reader, under `allowRestoreOwnDeleted` / `manageRecycleBin`.
 *
 * ## Retention
 *
 * Each entry carries its own deadline, `purge_after`, stamped at delete time
 * from the retention in days the host resolver, `OS_RECYCLE_BIN_RETENTION_DAYS`
 * or the default of 30 answered (ADR-0148 D3). The lifecycle sweep reaps an
 * entry once that deadline has passed (`ttl` on `purge_after`, expiring the
 * moment the stamped deadline does), and asks no resolver: a later change of
 * the retention never shortens a window a person was already shown. A
 * settings override can only lengthen it.
 *
 * ## Organization delete
 *
 * The entry belongs to the organization whose record it holds. Its tenant
 * column cascades (seat ruling on #30237 Q4): deleting the organization
 * deletes its entries, rather than keeping a snapshot of rows the
 * organization's delete has removed (ADR-0148 D4). An engine-owned object is
 * otherwise never counted against an organization delete.
 *
 * Registered by `PlatformObjectsPlugin` (`../plugin.ts`).
 *
 * @namespace sys
 */
export const SysRecycleBin = ObjectSchema.create({
  name: RECYCLE_BIN_OBJECT,
  label: 'Recycle Bin Entry',
  pluralLabel: 'Recycle Bin',
  icon: 'trash-2',
  isSystem: true,
  managedBy: 'engine-owned',
  access: { default: 'private' },
  description:
    'One entry per delete operation: the rows a delete removed, kept until their purge deadline so they can be restored under their original ids.',
  nameField: 'record_id', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['object_name', 'record_id', 'record_count', 'deleted_by', 'deleted_at', 'purge_after'],

  fields: {
    ...RECYCLE_BIN_ENTRY_FIELDS,

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      // [#30237 Q4] The organization's delete takes its entries with it.
      deleteBehavior: 'cascade',
      description: 'The organization whose record the entry holds. Deleting the organization deletes its entries.',
    }),
  },

  indexes: [
    // The entries of one record, newest first: the Console's undo and the
    // per-object listing read by these two.
    { fields: ['object_name', 'record_id'], unique: false },
    // The lifecycle sweep's access path.
    { fields: ['purge_after'], unique: false },
    // A person's own entries (`allowRestoreOwnDeleted`).
    { fields: ['deleted_by'], unique: false },
  ],

  lifecycle: {
    class: 'transient',
    // The deadline is the stamped column itself, so the window is zero: an
    // entry is due the moment `purge_after` passes, and never before.
    ttl: { field: 'purge_after', expireAfter: '0h' },
  },

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
