// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_import_job — Asynchronous Data Import Job
 *
 * Each row tracks one bulk import submitted through the async import API
 * (`POST /data/:object/import/jobs`). The client sends the whole payload
 * (rows[] or a base64 xlsx) in one request; the server persists this row,
 * processes the batch in the background, and streams progress by updating the
 * counters below. Readers poll `progress` / `results` and list history.
 *
 * Persisting to the DB (rather than in-memory) means progress and history
 * survive a server restart and are queryable per object / per user.
 *
 * Writers: the rest-server import-job worker.
 * Readers: the Import Wizard (progress + history), dashboards.
 *
 * @namespace sys
 */
export const SysImportJob = ObjectSchema.create({
  name: 'sys_import_job',
  label: 'Import Job',
  pluralLabel: 'Import Jobs',
  icon: 'upload',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Asynchronous bulk-import job state, progress, and history',
  displayNameField: 'object_name',
  nameField: 'object_name', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{object_name} import @ {created_at}',
  highlightFields: ['object_name', 'status', 'processed_rows', 'total_rows', 'created_at'],

  fields: {
    id: Field.text({ label: 'Job ID', required: true, readonly: true, group: 'System' }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      maxLength: 255,
      searchable: true,
      description: 'API name of the object being imported into',
      group: 'Identity',
    }),

    status: Field.select(
      ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
      { label: 'Status', required: true, defaultValue: 'pending', group: 'State' },
    ),

    // ── progress counters (updated as the worker streams through the batch) ──
    total_rows: Field.number({ label: 'Total Rows', required: true, defaultValue: 0, group: 'Progress' }),
    processed_rows: Field.number({ label: 'Processed Rows', required: true, defaultValue: 0, group: 'Progress' }),
    created_count: Field.number({ label: 'Created', required: false, defaultValue: 0, group: 'Progress' }),
    updated_count: Field.number({ label: 'Updated', required: false, defaultValue: 0, group: 'Progress' }),
    skipped_count: Field.number({ label: 'Skipped', required: false, defaultValue: 0, group: 'Progress' }),
    error_count: Field.number({ label: 'Errors', required: false, defaultValue: 0, group: 'Progress' }),

    // ── request echo (so history is self-describing without the payload) ──
    write_mode: Field.select(
      ['insert', 'update', 'upsert'],
      { label: 'Write Mode', required: false, defaultValue: 'insert', group: 'Request' },
    ),
    dry_run: Field.boolean({ label: 'Dry Run', required: false, defaultValue: false, group: 'Request' }),
    run_automations: Field.boolean({ label: 'Run Automations', required: false, defaultValue: false, group: 'Request' }),
    treat_as_historical: Field.boolean({ label: 'Treat As Historical', required: false, defaultValue: false, group: 'Request' }),

    // ── outcome ──
    error: Field.textarea({ label: 'Fatal Error', required: false, group: 'Outcome' }),
    results: Field.json({
      label: 'Row Results (sample)',
      required: false,
      description: 'Capped sample of per-row results (failures first) for the UI',
      group: 'Outcome',
    }),

    // ── undo / logical rollback ──
    undo_log: Field.json({
      label: 'Undo Log',
      required: false,
      description: 'Reversal instructions ({created:[ids], updated:[{id,before}]}) captured for small non-dry-run jobs so the import can be undone',
      group: 'Outcome',
    }),
    reverted_at: Field.datetime({
      label: 'Reverted At',
      required: false,
      description: 'Set when the import was undone (created records deleted, updated records restored)',
      group: 'Outcome',
    }),

    // ── lifecycle timestamps ──
    started_at: Field.datetime({ label: 'Started At', required: false, group: 'State' }),
    completed_at: Field.datetime({ label: 'Completed At', required: false, group: 'State' }),
    // [#11374 route A] The value is `context.userId`, stamped by the rest-server
    // import route (`String(context?.userId ?? context?.user?.id ?? '')` in
    // `rest-server.ts`) — i.e. a `sys_user.id`. The bound is derived by
    // referenced-column transitivity from three converging in-repo producers,
    // never guessed:
    //   - the physical column the id itself lives in: driver-sql creates every
    //     table's primary key as `table.string('id').primary()`, which is knex's
    //     `varchar(255)`, so no id this column can ever receive exceeds 255;
    //   - what this column would be if it were declared like its siblings: every
    //     other actor column on a platform object is `Field.lookup('sys_user')`,
    //     which driver-sql emits at `DEFAULT_STRING_VARCHAR_CHARS` = 255;
    //   - the landed text declarations for the same value class:
    //     `sys_metadata_audit.actor`, `sys_metadata_commit.actor` and
    //     `sys_view_definition.owner` all declare `maxLength: 255`.
    // The floor is cleared with room to spare: a minted platform id is 26
    // characters (measured on #11431, where honouring a bound below that made a
    // column structurally unable to hold any id at all).
    // 255 is also <= the 768-character utf8mb4 key ceiling, so the
    // `(created_by, created_at)` index below is expressible on MySQL — which is
    // the whole point: unbounded, this column was emitted TEXT and MySQL refused
    // the index with `ER_BLOB_KEY_WITHOUT_LENGTH`, landing the object
    // registered-but-broken.
    created_by: Field.text({
      label: 'Created By',
      required: false,
      readonly: true,
      maxLength: 255,
      group: 'System',
    }),
    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['object_name', 'created_at'] },
    { fields: ['status', 'created_at'] },
    { fields: ['created_by', 'created_at'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: the import worker owns the job-row lifecycle and
    // writes it system-elevated from the REST import route (never hand-edited
    // through the generic data API). Reads stay open for the Setup import grid.
    apiMethods: ['get', 'list'],
  },
});
