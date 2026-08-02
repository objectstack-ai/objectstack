// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { MIGRATION_JOURNAL_KINDS } from '@objectstack/spec/system';

/**
 * sys_migration_journal — the durable trace of a migration RUN (ADR-0119 D2, #4617)
 *
 * Rows keyed `(run_id, seq)`. Many rows per run; one run per invocation of
 * `runMigrationJournal` (`@objectstack/core`).
 *
 * ## Why this exists next to `sys_migration`
 *
 * They answer different questions and must not be conflated. `sys_migration`
 * holds ONE row per named migration — the durable verdict ("did it complete
 * here, was it shown correct?") that consumers gate on. This object holds MANY
 * rows per run — the trace of what actually happened while it ran.
 *
 * A flag row is written once, at the end, by a run that finished. This journal
 * exists precisely because a run may NOT finish.
 *
 * ## Why a table and not a side-file
 *
 * ADR-0034 gave the platform real transactions, and ADR-0119 D1 made them
 * reachable through the contract — but a transaction cannot be the whole
 * answer for migration-class work. A million-row backfill cannot hold one
 * write-lock for its duration; `driver-memory`'s `beginTransaction` deep-clones
 * the entire database, so "just wrap it" is O(db) per begin; and a process
 * KILLED (as distinct from a thrown error) defeats in-process rollback
 * entirely. So a big migration commits in pieces, and something durable has to
 * record which pieces committed. That is this table.
 *
 * Keeping it in the database rather than a JSONL side-file (the ADR-0008
 * shape) is a decision, not an implementation detail: the journal is
 * data-plane state ABOUT the data plane, so it belongs inside the same
 * backup/restore and transaction boundary as the rows it describes. A
 * side-file desyncs from the database on restore — and a journal that
 * disagrees with the data is worse than none, because it will be believed.
 * ADR-0008 solved audit; recovery authority is a different problem.
 *
 * ## The one invariant a reader must not "clean up"
 *
 * `chunk_done(i)` is written INSIDE the chunk's own transaction, so
 * `done ⇔ committed` holds by construction. `chunk_started(i)` is written
 * autonomously BEFORE it. Making both writes autonomous (or both
 * transactional) would look tidier and would destroy recovery: the asymmetry
 * is what gives `started ∧ ¬done` its single precise meaning — *the outcome is
 * unknown* — which is the only state a crash can leave and the only state
 * recovery reasons about.
 *
 * Append-only by contract: the runner never updates or deletes a row, so the
 * trace of a failed run survives its compensation. Writes flow through the
 * runner in system context; the API surface is read-only diagnostics.
 *
 * Registered by `PlatformObjectsPlugin` (`./plugin.ts`) alongside
 * `sys_migration` — recovery must be discoverable with zero host wiring, so
 * the journal cannot be optional infrastructure that some kernels compose and
 * others do not (ADR-0078: a journal nobody re-reads is a journal that does
 * not exist). The row contract lives in `@objectstack/spec/system`
 * (`MigrationJournalEventSchema`) so `@objectstack/core`'s runner can write it
 * without depending on this package.
 *
 * @namespace sys
 */
export const SysMigrationJournal = ObjectSchema.create({
  name: 'sys_migration_journal',
  label: 'Migration Journal Entry',
  pluralLabel: 'Migration Journal',
  icon: 'clipboard-list',
  isSystem: true,
  managedBy: 'engine-owned',
  description:
    'Append-only trace of migration runs: which chunks committed, which were compensated, and where a killed run stopped.',
  nameField: 'run_id', // [ADR-0079] canonical primary-title pointer
  titleFormat: '{run_id} #{seq} {kind}',
  highlightFields: ['run_id', 'seq', 'kind', 'chunk_index', 'created_at'],
  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      columns: ['created_at', 'run_id', 'seq', 'kind', 'chunk_index', 'migration_id'],
      sort: [
        { field: 'created_at', order: 'desc' },
        { field: 'seq', order: 'desc' },
      ],
    },
  },

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
    }),

    run_id: Field.text({
      label: 'Run ID',
      required: true,
      readonly: true,
      maxLength: 64,
      description: 'Identifies one run of one plan. Rows are keyed (run_id, seq).',
    }),

    seq: Field.number({
      label: 'Sequence',
      required: true,
      readonly: true,
      description:
        'Monotonic per-run sequence, from 0. The ORDERING AUTHORITY — created_at can tie at ' +
        'coarse clock resolution and can skew, so recovery never orders by it.',
    }),

    kind: Field.select(
      MIGRATION_JOURNAL_KINDS.map((value) => ({ label: value, value })),
      {
        label: 'Kind',
        required: true,
        readonly: true,
        description: 'Event kind. See MIGRATION_JOURNAL_KINDS in @objectstack/spec/system.',
      },
    ),

    migration_id: Field.text({
      label: 'Migration ID',
      readonly: true,
      maxLength: 128,
      description: 'The named migration this run belongs to, when it has one — joins to sys_migration.id.',
    }),

    plan_hash: Field.text({
      label: 'Plan Hash',
      readonly: true,
      maxLength: 128,
      description:
        'On run_started: hash of the plan shape. A resume whose plan hash differs REFUSES — resuming a ' +
        'changed plan against an old journal would apply chunk boundaries the journal never described.',
    }),

    chunk_index: Field.number({
      label: 'Chunk Index',
      readonly: true,
      description: 'On chunk_started / chunk_done / compensated: the run-global chunk index.',
    }),

    attempt: Field.number({
      label: 'Attempt',
      readonly: true,
      description:
        'Which attempt produced this event. attempt > 1 means a prior outcome was unknown and the ' +
        'callback was asked to recheck by natural key before re-writing.',
    }),

    detail: Field.text({
      label: 'Detail (JSON)',
      readonly: true,
      description: 'JSON payload — the chunk plan on run_started, the error on run_failed or a failed compensation.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      readonly: true,
      description: 'Wall-clock stamp, for humans reading the trace. Never the ordering authority — that is seq.',
    }),
  },

  indexes: [
    // Unique, not merely fast: it makes a duplicate (run_id, seq) a write
    // ERROR rather than a silently double-recorded event. A resumed run that
    // miscomputed its next sequence must fail loudly — a journal that quietly
    // accepts two "chunk 7 done" rows cannot be trusted to say what committed.
    { fields: ['run_id', 'seq'], unique: true },
    // The recovery scan's access path: all events for a run, and the
    // open-run sweep that looks for run_started without run_done.
    { fields: ['run_id', 'kind'], unique: false },
    { fields: ['migration_id'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Diagnostic read surface only. Writes go through the runner in system
    // context — a journal a client could edit could not prove anything about
    // what committed, which is the single thing it exists to do.
    apiMethods: ['get', 'list'],
    clone: false,
  },
});
