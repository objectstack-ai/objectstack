// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

// [ADR-0148 D1/D5, card #30235] Declared here, beside the other platform
// infrastructure objects, and deliberately NOT registered yet: nothing writes
// or reads the bin until the engine slice (#30237) lands the snapshot on
// delete, restore, purge, empty and the TTL reap. That slice registers it in
// `PlatformObjectsPlugin` (the `sys_secret` precedent: an engine-written store
// registered as platform infrastructure) and declares how the reap reads
// `purge_after`. The Console's admin page (#30239) lists it.

/**
 * sys_recycle_bin — the recycle bin: one entry per delete operation.
 *
 * On delete, the engine snapshots the rows the delete removes, the master and
 * its master-detail cascade in cascade order, into one entry here, and then
 * deletes physically. A restore writes the rows back under their original ids,
 * keeping `created_by` / `created_at`, and emits `data.record.restored`, never a
 * create. A purge removes the entry; emptying the bin purges every entry the
 * caller manages. The entry is the unit of restore: a detail that went with its
 * master comes back with its master, never alone.
 *
 * The purge deadline is stamped at delete time from the days the host
 * retention resolver answers (else `OS_RECYCLE_BIN_RETENTION_DAYS`, else 30),
 * so a later change of that answer never shortens a window a person was
 * already shown. Stored by the default datasource, organization-owned like
 * every other row.
 *
 * managedBy: 'engine-owned' and no generic API method: the snapshot holds every
 * field of the deleted rows, and a listing must apply field-level security on
 * the live object, so entries are read only through the recycle-bin doors.
 * Secret-channel refs are never written into the snapshot.
 *
 * @namespace sys
 */
export const SysRecycleBin = ObjectSchema.create({
  name: 'sys_recycle_bin',
  label: 'Recycle Bin Entry',
  pluralLabel: 'Recycle Bin',
  icon: 'trash-2',
  isSystem: true,
  managedBy: 'engine-owned',
  access: { default: 'private' },
  description:
    'One entry per delete operation: the rows the delete removed, who deleted them and when, and the stamped purge deadline. Written and read only by the engine\'s recycle-bin paths.',
  highlightFields: ['object_name', 'record_id', 'deleted_by', 'deleted_at', 'purge_after'],

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
      description: 'Entry id. One entry per delete operation.',
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The object the delete operation targeted: the master of the cascade set.',
    }),

    record_id: Field.text({
      label: 'Record ID',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The id of the record the delete operation targeted, restored unchanged.',
    }),

    record_count: Field.number({
      label: 'Rows',
      required: true,
      readonly: true,
      description: 'How many rows the snapshot holds: the master and its cascaded details.',
    }),

    snapshot: Field.json({
      label: 'Snapshot',
      required: true,
      readonly: true,
      description:
        'The cascade set as it stood at delete time, the master first, then its details in cascade order, plus the set_null references the delete cleared (`RecycleBinSnapshotSchema`). Secret-channel refs are left out.',
    }),

    deleted_by: Field.lookup('sys_user', {
      label: 'Deleted By',
      readonly: true,
      description: 'The principal who deleted the rows. A person restores the entries they deleted.',
    }),

    deleted_at: Field.datetime({
      label: 'Deleted At',
      required: true,
      readonly: true,
      description: 'When the delete operation committed.',
    }),

    retention_days: Field.number({
      label: 'Retention (days)',
      required: true,
      readonly: true,
      description: 'The days the retention resolver answered at delete time (else the configured default), a positive whole number.',
    }),

    purge_after: Field.datetime({
      label: 'Purge After',
      required: true,
      readonly: true,
      description: 'The purge deadline, stamped at delete time as deleted_at plus retention_days. No entry is purged before it.',
    }),
  },

  indexes: [
    { fields: ['purge_after'], unique: false },
    { fields: ['deleted_by', 'deleted_at'], unique: false },
    { fields: ['object_name', 'record_id'], unique: false },
  ],

  enable: {
    trackHistory: false,
    // Fail closed: no generic data-API method. The listing applies field-level
    // security on the live object, which a generic read of `snapshot` cannot.
    apiMethods: [],
  },
});
