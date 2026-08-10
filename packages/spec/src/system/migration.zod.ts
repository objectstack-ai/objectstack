// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Migration protocol — the two kinds of migration, kept apart on purpose.
 *
 * A **schema migration** (`ChangeSet` + its atomic operations) reshapes the
 * physical database to match metadata: add a field, change a type, create an
 * object, run SQL. It is derivable from the metadata and applied by
 * `os migrate plan` / `os migrate apply`.
 *
 * A **data migration** rewrites the rows themselves, and whether it is done is
 * a property of ONE DEPLOYMENT's database rather than of the installed code
 * version — so it cannot be expressed as a ChangeSet, and its completion cannot
 * be inferred from a release. `DataMigrationFlag` is the per-deployment record
 * that one ran here and its self-check passed; consumers that would act
 * irreversibly on migrated data gate on the flag instead of the version.
 */

import { z } from 'zod';
import { FieldSchema } from '../data/field.zod';
import { ObjectSchema } from '../data/object.zod';

// --- Atomic Operations ---

import { lazySchema } from '../shared/lazy-schema';
export const AddFieldOperation = z.object({
  type: z.literal('add_field'),
  objectName: z.string().describe('Target object name'),
  fieldName: z.string().describe('Name of the field to add'),
  field: FieldSchema.describe('Full field definition to add')
}).describe('Add a new field to an existing object');

export const ModifyFieldOperation = z.object({
  type: z.literal('modify_field'),
  objectName: z.string().describe('Target object name'),
  fieldName: z.string().describe('Name of the field to modify'),
  changes: z.record(z.string(), z.unknown()).describe('Partial field definition updates')
}).describe('Modify properties of an existing field');
export type ModifyFieldOperation = z.input<typeof ModifyFieldOperation>;

export const RemoveFieldOperation = z.object({
  type: z.literal('remove_field'),
  objectName: z.string().describe('Target object name'),
  fieldName: z.string().describe('Name of the field to remove')
}).describe('Remove a field from an existing object');
export type RemoveFieldOperation = z.input<typeof RemoveFieldOperation>;

export const CreateObjectOperation = z.object({
  type: z.literal('create_object'),
  object: ObjectSchema.describe('Full object definition to create')
}).describe('Create a new object');

export const RenameObjectOperation = z.object({
  type: z.literal('rename_object'),
  oldName: z.string().describe('Current object name'),
  newName: z.string().describe('New object name')
}).describe('Rename an existing object');
export type RenameObjectOperation = z.input<typeof RenameObjectOperation>;

export const DeleteObjectOperation = z.object({
  type: z.literal('delete_object'),
  objectName: z.string().describe('Name of the object to delete')
}).describe('Delete an existing object');
export type DeleteObjectOperation = z.input<typeof DeleteObjectOperation>;

export const ExecuteSqlOperation = z.object({
  type: z.literal('execute_sql'),
  sql: z.string().describe('Raw SQL statement to execute'),
  description: z.string().optional().describe('Human-readable description of the SQL')
}).describe('Execute a raw SQL statement');
export type ExecuteSqlOperation = z.input<typeof ExecuteSqlOperation>;

// Union of all possible operations
export const MigrationOperationSchema = lazySchema(() => z.discriminatedUnion('type', [
  AddFieldOperation,
  ModifyFieldOperation,
  RemoveFieldOperation,
  CreateObjectOperation,
  RenameObjectOperation,
  DeleteObjectOperation,
  ExecuteSqlOperation
]));

// --- Migration & ChangeSet ---

export const MigrationDependencySchema = lazySchema(() => z.object({
  migrationId: z.string().describe('ID of the migration this depends on'),
  package: z.string().optional().describe('Package that owns the dependency migration')
}).describe('Dependency reference to another migration that must run first'));
export type MigrationDependency = z.input<typeof MigrationDependencySchema>;

export const ChangeSetSchema = lazySchema(() => z.object({
  id: z.string().uuid().describe('Unique identifier for this change set'),
  name: z.string().describe('Human readable name for the migration'),
  description: z.string().optional().describe('Detailed description of what this migration does'),
  author: z.string().optional().describe('Author who created this migration'),
  createdAt: z.string().datetime().optional().describe('ISO 8601 timestamp when the migration was created'),
  
  // Dependencies ensure migrations run in order
  dependencies: z.array(MigrationDependencySchema).optional().describe('Migrations that must run before this one'),
  
  // The actual atomic operations
  operations: z.array(MigrationOperationSchema).describe('Ordered list of atomic migration operations'),
  
  // Rollback operations (AI should generate these too)
  rollback: z.array(MigrationOperationSchema).optional().describe('Operations to reverse this migration')
}).describe('A versioned set of atomic schema migration operations'));

export type ChangeSet = z.input<typeof ChangeSetSchema>;
/** Post-parse shape of {@link ChangeSet} — defaults applied, transforms run (ADR-0122). */
export type ChangeSetParsed = z.infer<typeof ChangeSetSchema>;
export type MigrationOperation = z.input<typeof MigrationOperationSchema>;
/** Post-parse shape of {@link MigrationOperation} — defaults applied, transforms run (ADR-0122). */
export type MigrationOperationParsed = z.infer<typeof MigrationOperationSchema>;

// --- Deployment-level data-migration flags (#3617) ---
//
// A ChangeSet above describes SCHEMA work (DDL). A data migration is different:
// it rewrites rows, and whether it has been completed — and shown correct — is
// a property of ONE DEPLOYMENT's database, not of the installed code version.
// ObjectStack is a development platform: third-party deployments upgrade on
// their own schedule and their data is not observable by anyone else, so no
// release-side observation window can vouch for them. The evidence has to be
// produced by each deployment itself.
//
// The flag row below is that evidence. `os migrate <migration>` runs the
// migration's backfill, runs its self-check, and only a passing self-check
// records `verified_at`. Consumers that would act irreversibly on migrated
// data (e.g. the sys_file reap for ADR-0104 D3, or a strict value-shape
// default) gate on the flag — NOT on the platform version — so upgrading the
// code never flips destructive behaviour on by itself. No flag / failed run →
// consumers stay in their safe legacy posture ("fail toward retention").

/**
 * Object (table) name under which deployment-level data-migration flags
 * persist. The object definition lives in
 * `@objectstack/platform-objects/system` (`SysMigration`).
 */
export const DATA_MIGRATION_FLAG_OBJECT = 'sys_migration';

/**
 * Well-known migration id: ADR-0104 D3 wave 2 file-as-reference — legacy
 * file-field values backfilled to `sys_file` ids and the ownership ledger
 * reconciled (`verifyFileReferences` reports zero blocking discrepancies).
 * Gates BOTH ADR-0104 follow-ups on this deployment: enabling released-file
 * collection (#3459 PR-5b) and strict media value-shape enforcement (#3438).
 */
export const FILE_REFERENCES_MIGRATION_ID = 'adr-0104-file-references';

/**
 * Well-known migration id: ADR-0104 D1 non-media value shapes — every stored
 * reference (`lookup` / `master_detail` / `user` / `tree`) and structured-JSON
 * (`location` / `address` / `composite` / `repeater` / `record` / `vector`)
 * value scanned against `valueSchemaFor(field, 'stored')` with zero
 * violations. Gates strict enforcement of those classes on this deployment
 * (#3438).
 *
 * Deliberately SEPARATE from {@link FILE_REFERENCES_MIGRATION_ID}, which
 * asserts a different fact. That flag says this deployment's file-field values
 * were migrated and their ownership reconciled; it says nothing about whether a
 * `lookup` id or a `location` payload is well formed. Gating these classes on
 * it would be borrowing evidence for a fact it does not cover — the same error
 * one layer down as an authority answering a question nobody asked (see the
 * ADR's 2026-07-27 amendment).
 *
 * Unlike the file migration this one has no backfill: a malformed `location` is
 * an application-data fix only its author can make, so the run reports and
 * prescribes, and `--apply`'s only write is the flag row itself.
 */
export const VALUE_SHAPES_MIGRATION_ID = 'adr-0104-value-shapes';

/**
 * The migrations a datastore attests at CREATION rather than by scanning.
 *
 * Both facts these ids stand for — no legacy file value here, no malformed
 * stored value here — are true by construction of an empty store, and true
 * *observably*: the creator watched it come into being with no rows at all.
 * That is the same observed-transition discipline the gates run on, not
 * version-gating in disguise; a store that merely *looks* empty when found
 * earns nothing, because "found empty" is an inference and "created empty" is
 * an observation.
 *
 * Without this, every deployment born on a version that already ships the
 * migrations would start lax and stay lax until someone ran a command that is,
 * for them, a no-op — so the warn regime would never die out.
 */
export const CREATION_ATTESTED_MIGRATION_IDS = [
  FILE_REFERENCES_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
] as const;

export const DataMigrationFlagSchema = lazySchema(() => z.object({
  id: z.string().describe('Migration id (e.g. adr-0104-file-references) — one row per data migration'),
  last_run_at: z.string().datetime().describe('When this migration last completed a gated (apply-mode) run on this deployment'),
  verified_at: z.string().datetime().nullable().optional()
    .describe('When the self-check last PASSED. Null/absent until it does — and cleared again by a later failing run, so a regression closes the gate'),
  applied_at: z.string().datetime().nullable().optional()
    .describe('When the backfill last ran in apply mode (writes enabled)'),
  blocking: z.number().int().min(0)
    .describe('Blocking discrepancies reported by the last self-check. The gate requires 0'),
  advisory: z.number().int().min(0).optional()
    .describe('Advisory findings from the last run (external URLs, stale owners, …) — cost storage or need a modelling decision, never block the gate'),
  details: z.string().optional()
    .describe('JSON-encoded counts from the last run, for diagnostics'),
  deviation_observed_at: z.string().datetime().nullable().optional()
    .describe('When this deployment last ADMITTED a value the verified contract rejects, via an OS_ALLOW_LAX_* escape hatch. Does not clear verified_at — it withdraws the irreversible half of what the certificate authorises (#4797)'),
  deviation_detail: z.string().nullable().optional()
    .describe('JSON-encoded first counterexample behind deviation_observed_at (object, field, type, parse issue), for diagnostics'),
}).describe('Deployment-level record that a data migration ran here and its self-check passed — the evidence gate consumers read instead of the platform version'));
export type DataMigrationFlag = z.input<typeof DataMigrationFlagSchema>;

/**
 * Does a flag row authorise its consumers? The ONE arbiter for both current
 * consumers (reap gating #3459, strict flip #3438) — a hand-copied predicate
 * drifting by one clause would let one consumer act on evidence the other
 * rejects. Pure derivation (Prime Directive #2): reading the row from the
 * engine lives in `@objectstack/platform-objects/system`.
 */
export function isDataMigrationFlagVerified(flag: DataMigrationFlag | null | undefined): boolean {
  if (!flag) return false;
  return flag.verified_at != null && flag.verified_at !== '' && flag.blocking === 0;
}

/**
 * Has this deployment admitted a value its own verified contract rejects,
 * since that contract was last verified (#4797)?
 *
 * The counterexample arrives through an operator escape hatch —
 * `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES` — which exist
 * precisely to relax a deployment that has ALREADY verified. So the window is
 * real: the value is admitted and persisted, the ledger still reads
 * `verified_at` non-null with `blocking: 0`, and the moment the switch goes
 * off (or another process runs without it) strict returns and the same data
 * starts being rejected. The certificate was true when it was written and is
 * false now, and nothing in the ledger said so.
 *
 * Recorded on its own column rather than by clearing `verified_at`, because a
 * single admitted write is not the same evidence as a failed full scan.
 * Overturning a scan of the whole store on one observation is the wrong order
 * of magnitude, and it would turn an explicitly temporary switch into a
 * one-way door: one use of the escape hatch would force a full re-migration.
 */
export function hasObservedDeviation(flag: DataMigrationFlag | null | undefined): boolean {
  if (!flag) return false;
  return flag.deviation_observed_at != null && flag.deviation_observed_at !== '';
}

/**
 * Does a flag row authorise an IRREVERSIBLE action — deleting bytes that
 * cannot be brought back (#4797)?
 *
 * A certificate is not a boolean; it is authority over a *set of behaviours*,
 * and the two halves of that set are withdrawn on different evidence. So there
 * are two arbiters, not one:
 *
 *  - {@link isDataMigrationFlagVerified} authorises the RECOVERABLE half —
 *    strict value-shape enforcement (#3438), tombstoning a released file into
 *    its grace window (#3459). Every one of those is undoable: a rejected
 *    write is retried, a tombstone is lifted on re-attach.
 *  - this one authorises the UNRECOVERABLE half — the reap guard's byte
 *    delete. It requires everything the first requires AND that no deviation
 *    has been observed since the certificate was earned.
 *
 * The asymmetry is the whole design. An admitted counterexample is enough to
 * stop deleting data forever; it is NOT enough to overturn a full-store scan,
 * so the recoverable behaviours keep running and the operator's escape hatch
 * keeps being an escape hatch rather than a one-way door. A real
 * `os migrate … --apply` re-run — a fresh scan of everything, which is
 * evidence of the same order as the certificate — clears the marker and
 * restores the irreversible half.
 *
 * A marker with no consumer would be worse than nothing: the ledger would
 * declare a fact ("this deployment deviated") that no code acts on, while the
 * bytes get deleted exactly as before. This function is that consumer.
 */
export function authorisesIrreversibleAction(flag: DataMigrationFlag | null | undefined): boolean {
  return isDataMigrationFlagVerified(flag) && !hasObservedDeviation(flag);
}

// --- Migration journal (ADR-0119 D2, #4617) ---
//
// The flag above and the journal below answer DIFFERENT questions, and
// conflating them is the mistake this comment exists to prevent:
//
//   `sys_migration`         — "has migration X completed here, and was it
//                             shown correct?" One row per named migration,
//                             the durable verdict a consumer gates on.
//   `sys_migration_journal` — "what happened during run R, and where did it
//                             stop?" Many rows per RUN, the crash-recovery
//                             trace nobody reads unless a run died.
//
// A flag row is written once, at the end, by a run that finished. A journal
// exists precisely because a run may NOT finish: it is the only thing that can
// tell a restarted process whether chunk 7 committed. ADR-0034 transactions
// cannot answer that alone — a migration too big for one transaction commits
// in pieces, and a process killed between pieces leaves no in-memory state to
// consult. So the unit of atomicity is the chunk, and durability ACROSS chunks
// is this journal.

/**
 * Object (table) name under which migration-run journal events persist. The
 * object definition lives in `@objectstack/platform-objects/system`
 * (`SysMigrationJournal`); the runner that writes it is
 * `@objectstack/core`'s `runMigrationJournal`.
 */
export const MIGRATION_JOURNAL_OBJECT = 'sys_migration_journal';

/**
 * The event kinds a run emits, in the order a healthy run emits them.
 *
 * The pairing of `chunk_started` and `chunk_done` carries the whole recovery
 * design, so it is worth stating exactly: `chunk_started(i)` is written
 * AUTONOMOUSLY (its own write, outside the chunk's transaction) BEFORE the
 * chunk runs, while `chunk_done(i)` is written INSIDE the chunk's transaction.
 * That asymmetry is deliberate — it makes `done ⇔ committed` a fact rather
 * than a race, and it gives `started ∧ ¬done` exactly one meaning: **the
 * outcome is unknown**, which is the state a crash leaves behind and the only
 * state recovery has to reason about.
 */
export const MIGRATION_JOURNAL_KINDS = [
  'run_started',
  'chunk_started',
  'chunk_done',
  'compensated',
  'run_done',
  'run_failed',
] as const;

export type MigrationJournalKind = (typeof MIGRATION_JOURNAL_KINDS)[number];

export const MigrationJournalEventSchema = lazySchema(() => z.object({
  run_id: z.string().describe('Identifies one run. Rows are keyed (run_id, seq)'),
  seq: z.number().int().min(0)
    .describe('Monotonic per-run sequence. Ordering authority — wall-clock timestamps can tie or skew'),
  kind: z.enum(MIGRATION_JOURNAL_KINDS).describe('Event kind'),
  migration_id: z.string().optional()
    .describe('The named migration this run belongs to, when it has one — joins to sys_migration.id'),
  plan_hash: z.string().optional()
    .describe('On run_started: hash of the plan shape. A resume whose plan hash differs REFUSES rather than resuming a changed plan against an old journal'),
  chunk_index: z.number().int().min(0).optional()
    .describe('On chunk_started / chunk_done / compensated: the run-global chunk index'),
  attempt: z.number().int().min(1).optional()
    .describe('Which attempt produced this event. attempt > 1 means a prior outcome was unknown and the callback was asked to recheck by natural key'),
  detail: z.string().optional()
    .describe('JSON-encoded payload — the chunk plan on run_started, the error on run_failed / a failed compensation'),
  created_at: z.string().datetime().optional().describe('Wall-clock stamp, for humans. Never the ordering authority — that is seq'),
}).describe('One event in a migration run journal — the durable trace that lets a killed run be resumed forward or compensated back, with rows proving which'));
export type MigrationJournalEvent = z.input<typeof MigrationJournalEventSchema>;

/**
 * What a crashed run should do when it is rediscovered.
 *
 * `resume` suits an idempotent forward migration (a backfill that can recheck
 * by natural key and continue); `compensate` suits work whose partial state is
 * worse than no state. Per-plan because only the plan's author knows which of
 * those two its steps are — there is no safe global default, and guessing
 * would either strand data or undo work that was fine.
 */
export type MigrationOnCrashPolicy = 'resume' | 'compensate';
