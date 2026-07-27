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

export const RemoveFieldOperation = z.object({
  type: z.literal('remove_field'),
  objectName: z.string().describe('Target object name'),
  fieldName: z.string().describe('Name of the field to remove')
}).describe('Remove a field from an existing object');

export const CreateObjectOperation = z.object({
  type: z.literal('create_object'),
  object: ObjectSchema.describe('Full object definition to create')
}).describe('Create a new object');

export const RenameObjectOperation = z.object({
  type: z.literal('rename_object'),
  oldName: z.string().describe('Current object name'),
  newName: z.string().describe('New object name')
}).describe('Rename an existing object');

export const DeleteObjectOperation = z.object({
  type: z.literal('delete_object'),
  objectName: z.string().describe('Name of the object to delete')
}).describe('Delete an existing object');

export const ExecuteSqlOperation = z.object({
  type: z.literal('execute_sql'),
  sql: z.string().describe('Raw SQL statement to execute'),
  description: z.string().optional().describe('Human-readable description of the SQL')
}).describe('Execute a raw SQL statement');

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

export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type MigrationOperation = z.infer<typeof MigrationOperationSchema>;

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
}).describe('Deployment-level record that a data migration ran here and its self-check passed — the evidence gate consumers read instead of the platform version'));
export type DataMigrationFlag = z.infer<typeof DataMigrationFlagSchema>;

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
