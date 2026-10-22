// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID, ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import {
  convertPositionBindingRows,
  permissionSetDefinitionFromRow,
  positionDefinitionFromRow,
} from '@objectstack/core';
import { anonymousFormIntakeCandidates, anonymousFormIntakeWithdrawnIn, hashSpec } from '@objectstack/metadata-core';
import {
  inventoryEntryFor,
  LEGACY_SHIPPED_SET_SEEDS,
  type InventoryEntry,
  type RowPredicate,
} from './organization-ownership-inventory.js';
import {
  buildOrganizationOwnershipPlan,
  columnListSql,
  definitionKey,
  groupTemplateRows,
  groupMetadataKeyRows,
  readMetadataKeyRows,
  METADATA_OBJECT,
  templatePromotionSql,
  SEEDED_BY,
  TEMPLATE_OBJECT,
  columnNameOf,
  predicateSql,
  PRIMARY_DATABASE,
  requireColumn,
  Sql,
  underivableDepartureOf,
  type AttributionSink,
  type MetadataConflict,
  type MetadataKeyRow,
  type TemplateConflict,
  type OrganizationOwnershipPlan,
  type PlanReader,
  type TablePlan,
  type UnattributableRow,
} from './organization-ownership-plan.js';
import {
  grantCollisionBlocker,
  planGrantRewrite,
  type LegacySetRow,
  type UnnamedReason,
} from './organization-ownership-grants.js';
import { describeSecurityPluginComposition, type SchemaMigrationComposition } from './schema-migration-plugins.js';
import type { DeclaredSharingRuleSkip } from '@objectstack/plugin-sharing';

/**
 * The ADR-0131 D10 ceremony's apply step — ceremony items 2 to 4: the backup
 * precondition is the command's, and this module performs the fates, in fate
 * order, then the post-check.
 *
 *  1. `attribution` (fate 3) — every NULL row the plan derives an owner for
 *     takes it. The owners come from the plan's own walk
 *     ({@link AttributionSink}): the apply writes exactly what the plan
 *     reported, derived once, never a second derivation. Repeated to a fixed
 *     point, so a child whose parent was itself NULL in the first pass takes
 *     the parent's owner in the next. Under `single` on a database that holds
 *     no organization at all, the Default Organization is created first
 *     ({@link DefaultOrganizationPort}; ADR-0131 D3: it exists before the
 *     first write that needs an owner), so the rows no anchor names take it —
 *     never left NULL and certified. The plan says so in its warnings.
 *  2. `authored-conversion` — the catalog rows an organization authored
 *     (the inventory's `authored` categories) become environment metadata
 *     through the metadata door, by core's row→definition mappers; the
 *     position bindings are carried into the position definitions
 *     (`convertPositionBindingRows`). Only under `single` (ADR-0131 D3: a
 *     Setup catalog write is an environment metadata write under `single` and
 *     refused under a wall); under a wall the rows are reported.
 *  2a. `metadata-promotion` — rulings A on #22011 and #22008 (records
 *     6020163868, 6020151485): first every public-form withdrawal an
 *     organization saved is carried onto the environment, fail-closed (any
 *     organization's withdrawal wins), by writing it onto each active
 *     environment `view` of that name that still serves the form open,
 *     through the metadata door; the same predicate the anonymous doors
 *     judge by (`anonymousFormIntakeWithdrawnIn`) decides. Then, under
 *     `single`, each organization-scoped `sys_metadata` row of the five
 *     presentational types whose overlay key no other row holds becomes an
 *     environment row in place, its history with it (its `organization_id`
 *     cleared). A key held by more than one row is a conflict: listed, kept,
 *     and blocking under `single` until the operator chooses one row with
 *     `--metadata-choice ROW_ID`. The key then ends with exactly ONE
 *     environment row defining the chosen body (the key's environment row
 *     takes it through the door, in place; with none, the chosen row is
 *     promoted in place), with every withdrawal another row holds kept; it is
 *     read back, and only then are the key's organization rows deleted, in
 *     one statement, by id (ruling B on #23413 Q1). Under a wall nothing is
 *     promoted unless the operator names the row, and nothing is deleted
 *     (ruling A on #23413 Q6, ruling 6163114098): the rest are reported and
 *     hold the column.
 *  2b. `template-promotion` — ruling C on ADR-0131 §6 Q1: every
 *     `sys_email_template` row an organization customized or authored becomes
 *     an environment `email_template` item through the metadata door (core's
 *     `emailTemplateDefinitionFromRow`), so the deletion that follows loses no
 *     customer edit, under every posture. One `(name, locale)` held by rows
 *     that differ is a conflict: listed, kept, and blocking until the operator
 *     chooses one row with `--template-choice ROW_ID`; a nameless row blocks.
 *  2c. `settings-move` — the inventory's `global-rung-move` departure,
 *     executed (#15207's ruling: "C7's ceremony moving the existing rows"):
 *     each `sys_setting` row of `scope = 'global'` with no organization is
 *     copied, by the database itself, into `sys_platform_setting`, read back,
 *     and only then removed from `sys_setting`.
 *     A key the new table already holds with a different value is a blocker.
 *  2d. `sibling-moves` (18.x step 5b) — the deployment-level rows an 18.0
 *     database keeps in a tenant table move, id for id, into the sibling this
 *     release writes them to: the settings audit trail's global rung and
 *     identity mail, selected by shape, the mail's queued jobs and the rows'
 *     activity timeline pointed at the sibling first ({@link runSiblingMoves}).
 *  2e. `declared-webhooks` (18.x step 5a) — each `sys_webhook` copy a seeder
 *     wrote under a declared name is settled: a pristine one deleted once its
 *     deliveries name the declaration, a switch-only edit kept as the
 *     declaration's activation row, any other edit kept as a clone under a new
 *     name with the declaration switched off ({@link runDeclaredWebhooks}).
 *  2f. `declared-rule-copies` (18.x step 5c, C3 stage 9c) — each stored
 *     sharing rule under a declared rule's name becomes a clone under a new
 *     name, the declaration switched off ({@link runDeclaredRuleCopies}).
 *  3. `rewrite` — the verified id→name rewrite (D4):
 *     `sys_user_permission_set.permission_set` is named from the set row its
 *     `permission_set_id` points at, then EVERY grant is verified to name a set
 *     the security catalog resolves. The id column is read here, by raw SQL,
 *     and dropped by column-drops.
 *  4. `mirror-deletion` (fate 2) — gated on the rewrite's verification, which
 *     is read again immediately before the first delete. Only rows of a
 *     `mirror-deletion` object that match its mirror selector and none of its
 *     named categories are deleted. Templates: the promotion runs again first,
 *     and beyond the seeded mirrors only the rows whose environment copy that
 *     pass verified are deleted, by id. Then the `declared-rule-mirrors`
 *     departure on the fate-3 `sys_sharing_rule`, made executable (ADR-0131
 *     C3 stage 9): every grant naming a mirror row is renamed to the rule's
 *     NAME, which the registry must resolve, and only then is the mirror
 *     deleted ({@link runDeclaredRuleMirrorDeletion}). It runs again on a
 *     checkpointed run while a mirror stands. Before them, a fate-3 table's
 *     `underivableDeparture` (`sys_activity`, ruling record 6257510973 item
 *     3): the NULL rows no anchor attributes once attribution is done are
 *     deleted — never under `single`, where the Default Organization takes
 *     them ({@link runUnderivableDeletion}).
 *  4h. `history-renumber` — seat answer Q2 A: `sys_metadata_history`'s
 *     `event_seq` and every `(type, name, version)` unique environment-wide
 *     before the column goes. Every lineage still tagged to an organization
 *     is laid out above the environment's (each organization's event range by
 *     ONE offset, its commit ranges with it; each item's version lineage, the
 *     organization's rows with it); under `single` that history then becomes
 *     the environment's. It runs on every apply, even when checkpointed, so an
 *     environment save made since is covered. Numbers only, no delete.
 *  5. `column-drops` (fate 1) — `organization_id` leaves the D7 objects
 *     through the schema-drift ceremony ({@link ColumnDropPort}), never a hand
 *     `ALTER`; so does the retired `sys_user_permission_set.permission_set_id`
 *     (C7b), once the rewrite has read it and no two grants hold one set for
 *     one user in one organization (the unique index that replaces the old
 *     one would refuse them; they are reported, never deleted).
 *  6. `not-null` (18.x step 5d, 8e) — every table the plan now clears
 *     receives NOT NULL on `organization_id`, through the schema door
 *     ({@link NotNullPort}); the ceremony owns that nullability and the
 *     differ reads it as no drift (ruling record 6269955919, ② A).
 *
 * Then the post-check re-runs the plan and reports, per table, what remains.
 * A departure no step of a release can perform — the declared sharing-rule
 * mirrors while a release's own boot still seeded them
 * (`DECLARED_SHARING_RULE_SEEDER_RUNS`, the inventory; `false` since the
 * seeder retired) — is reported as advisory: named and counted, its rows still
 * NULL, never deleted, and not a discrepancy. Every other remaining row is one,
 * and so is every unattributable row (ruling C on the C8 decision: fate 4's
 * reported rows, and a fate-3 row no anchor names under a wall): named per
 * table with its count and the remedy — assign it an organization, or delete
 * it by hand — and held against certification until it is gone, so a verified
 * marker means zero NULL rows on every table. ⛔ The ceremony neither guesses
 * its owner nor deletes it (D10 fate 4). The one exception is a fate-4 table
 * whose column is not the tenancy anchor (`InventoryEntry.notNullExempt`): its
 * organization-less rows are legitimate, reported, and advisory.
 *
 * ## Idempotent and resumable
 *
 * Every write is conditioned on the state it changes — an owner is written
 * only where `organization_id IS NULL`, a name only where `permission_set` is
 * empty, a delete selects only mirrors — so a second run writes nothing the
 * first one wrote. On top of that, each step that finishes is recorded in the
 * ceremony's checkpoint ({@link CeremonyLedgerPort}) and is not run again: a
 * run interrupted inside step N resumes at step N. Two steps run again when
 * checkpointed: `history-renumber` (below), and `attribution` whenever the
 * plan derives an owner for rows still NULL — a row the operator made
 * attributable since, or one an earlier run found no Default Organization
 * for. A step that stops on a
 * blocker stops the ceremony there — fate order is the contract — and the
 * report names the blocker and its remedy.
 *
 * ## Only the plan the operator reviewed
 *
 * The apply executes the fates of the plan it computes now, and that plan's
 * inputs can move between the review and the run: a host fate supplement
 * swapped for another, a release whose inventory moved. So the apply takes
 * the kept plan file ({@link ReviewedPlan}) and refuses, before anything is
 * written, when the inventory digest it computes is not the one that file
 * recorded, the posture it runs under is not the one the plan was computed
 * under (the posture decides what attribution and the authored conversion
 * write), or the file names another database ({@link ReviewedPlanRefusal}).
 * A choice deletes the other rows of its conflict, so the reviewed plan also
 * binds what a `--metadata-choice` or `--template-choice` may delete: the
 * chosen conflict must hold exactly the rows the file listed for it
 * ({@link ReviewedConflict}), or the apply refuses (`plan-conflict-mismatch`).
 * The remedy is always the same: plan again, review it, hand the new file in.
 * A checkpoint recorded under another digest is therefore one the reviewed
 * plan supersedes: the run starts over (each step is idempotent), and the
 * report names the discarded checkpoint ({@link OrganizationOwnershipApplyReport.restartedFrom}).
 *
 * ## What it never does
 *
 * ⛔ Delete a row outside fate 2, a declared `underivableDeparture`, a moved
 * row once its copy reads back, a declared webhook's copy, and the grants of a
 * declaration it switched off. ⛔ Give an unattributable row an owner:
 * owners come only from the plan's anchors and, under `single`, the Default
 * Organization. ⛔ Create any organization but the Default Organization, and
 * that one only under `single` on a database that holds none. ⛔ Run at boot:
 * the command is the only caller.
 */

/** The `sys_migration` row the ceremony checkpoints into and completes; the v18 boot guard reads it. */
export { ORGANIZATION_OWNERSHIP_MIGRATION_ID };

export const CEREMONY_STEPS = [
  'attribution',
  'authored-conversion',
  'metadata-promotion',
  'template-promotion',
  'settings-move',
  'sibling-moves',
  'declared-webhooks',
  'declared-rule-copies',
  'rewrite',
  'mirror-deletion',
  'history-renumber',
  'column-drops',
  'not-null',
] as const;
export type CeremonyStep = (typeof CEREMONY_STEPS)[number];

/** The raw-SQL seam: the plan's reader plus the one write verb. */
export interface ApplyExecutor extends PlanReader {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}

/**
 * A database beside the primary the deployment keeps objects in — the
 * `telemetry` sibling (`PlanSibling`): its tables are planned, attributed and
 * have their columns dropped where they live, through its own executor.
 */
export interface ApplySibling {
  name: string;
  database: string;
  executor: ApplyExecutor;
}

/** The security catalog read (core's `SecurityCatalogReader` satisfies it). */
export interface CatalogPort {
  resolve(type: 'position' | 'permission', name: string): Promise<{ definition: Readonly<Record<string, unknown>> } | undefined>;
}

/** The metadata door: an environment metadata save. Throws when the door refuses. */
export interface MetadataDoorPort {
  save(
    type: 'position' | 'permission' | 'email_template' | 'view' | 'dashboard' | 'report' | 'translation',
    name: string,
    body: Record<string, unknown>,
    target?: { packageId: string | null },
  ): Promise<void>;
}

/** The env-wide `view` list the anonymous form doors read (every package's item of a name). */
export interface ServedViewsPort {
  list(): Promise<ReadonlyArray<Readonly<Record<string, unknown>>>>;
}

/**
 * The metadata door's own verdict on a write to an item (ADR-0010 §3.3): the
 * item read's `editable`, which reports the save door's lock gate. A write the
 * ceremony makes in place, not through the door, asks it first.
 */
export interface MetadataLockPort {
  verdict(type: string, name: string, packageId: string | null): Promise<{ editable: boolean; lock?: string; lockReason?: string }>;
}

/**
 * [ADR-0131 C3 stage 9] The sharing rules the deployment's packages DECLARE,
 * by name — the registry the plugin's enforcement reads them from (the
 * command: the booted engine's registry) — each with whether that enforcement
 * SERVES it: `refused` is `null` when plugin-sharing's own translation
 * (`translateDeclaredSharingRule`) accepts the declaration, else its reason in
 * the operator's terms. A declared-rule mirror's grants are renamed only onto a
 * served name: a grant naming a refused one would be revoked by the next
 * boot's orphan sweep, so such a mirror blocks instead, naming the rule and the
 * reason.
 */
export interface DeclaredSharingRulesPort {
  /** `packageId`: the declaring package, for the switch row a settled copy writes (`declared-rule-copies`). */
  rules(): Promise<ReadonlyArray<{ name: string; refused: string | null; packageId?: string | null }>>;
}

/**
 * Judge each declared `sharing_rule` item as plugin-sharing's enforcement does
 * — through its own `translateDeclaredSharingRule`, never a copy of it — for
 * {@link DeclaredSharingRulesPort}: a nameless item is no rule to rename onto
 * and is left out.
 */
export async function judgeDeclaredSharingRules(
  items: readonly unknown[],
): Promise<Array<{ name: string; refused: string | null; packageId: string | null }>> {
  const { translateDeclaredSharingRule } = await import('@objectstack/plugin-sharing');
  const out: Array<{ name: string; refused: string | null; packageId: string | null }> = [];
  for (const item of items) {
    const name = (item as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || name === '') continue;
    const { skip } = translateDeclaredSharingRule(item);
    const packageId = (item as { _packageId?: unknown })._packageId;
    out.push({ name, refused: skip ? describeDeclaredRuleSkip(skip) : null, packageId: typeof packageId === 'string' && packageId ? packageId : null });
  }
  return out;
}

/** Why plugin-sharing does not serve a declared rule, in the operator's terms: the translation's own refusal. */
function describeDeclaredRuleSkip(skip: DeclaredSharingRuleSkip): string {
  switch (skip.kind) {
    case 'unnamed':
      return 'the declaration names no object';
    case 'unmappable-recipient':
      return `its recipient (sharedWith type ${JSON.stringify(skip.sharedWith ?? null)}) maps to no recipient the runtime grants to`;
    case 'owner-rule':
      return 'it is an owner-based rule, a retired authoring shape (use a criteria rule)';
    case 'condition':
      return `its condition does not translate (${skip.cause.reason}: ${skip.cause.detail})`;
  }
}

/** The `email_template` item the registry serves for one `(name, locale)` bundle member. */
export interface TemplatePort {
  find(name: string, locale: string): Promise<{ definition: Readonly<Record<string, unknown>>; environment: boolean } | undefined>;
}

/** An index a retired column keyed, named by its declaration (the driver derives the physical name). */
export interface RetiredIndex {
  columns: readonly string[];
  unique: boolean;
}

/** One column drop: `organization_id` of a fate-1 table, or a retired column the ceremony owns. */
export interface ColumnDrop {
  table: string;
  column: string;
  /** Indexes the column keyed, dropped before it: the port drops them in an earlier, separate apply. */
  retiredIndexes?: readonly RetiredIndex[];
}

/**
 * One column drop, as the schema-drift ceremony answered it.
 *
 * `not-declared`: the composition this run booted declares no object for the
 * table, so the ceremony has no declaration to drop the column against. That
 * is a fact about the composition the ceremony was run in, never about the
 * release. `not-proposed` is only for a table it DOES declare.
 */
export interface ColumnDropOutcome extends ColumnDrop {
  outcome: 'dropped' | 'not-proposed' | 'not-declared' | 'failed';
  detail?: string;
}

/** Drops the named columns through the schema-drift ceremony (ADR-0120 D4). */
export interface ColumnDropPort {
  drop(columns: readonly ColumnDrop[]): Promise<ColumnDropOutcome[]>;
}

/** What the ceremony records after each finished step. */
export interface CeremonyCheckpoint {
  ceremony: 'ADR-0131 D10';
  inventoryDigest: string;
  /**
   * The organization-ownership shape generation this ceremony's step set
   * reaches ({@link ORGANIZATION_OWNERSHIP_SHAPE_GENERATION}): what the boot
   * guard decides on once the marker is verified. A checkpoint an older
   * ceremony wrote carries none and reads as generation 0.
   */
  shapeGeneration?: number;
  completed: Partial<Record<CeremonyStep, { at: string; summary: Record<string, number> }>>;
  /**
   * The `--metadata-choice` rows whose conflict this ceremony resolved, recorded
   * before the conflict's organization rows are deleted: a rerun after a crash
   * between the two accepts the same choice and finishes.
   */
  metadataChoicesApplied?: string[];
}

/**
 * The Default Organization's producer (the command: plugin-auth's boot
 * invariant, `ensureDefaultOrganizationExists`): find it or create it, and
 * answer its id. Throws when it cannot.
 */
export interface DefaultOrganizationPort {
  create(): Promise<{ id: string }>;
}

/** Where the checkpoint lives (the command: the `sys_migration` row). */
export interface CeremonyLedgerPort {
  read(): Promise<CeremonyCheckpoint | null>;
  write(checkpoint: CeremonyCheckpoint, verdict: { complete: boolean; blocking: number; advisory: number }): Promise<void>;
}

/**
 * What the apply reads from the kept `--plan` file: the plan the operator
 * reviewed. Only these fields are compared or reported.
 */
export interface ReviewedPlan {
  /** The plan file's path, for the refusal and the report. */
  file: string;
  generatedAt: string;
  database: string;
  inventoryDigest: string;
  /** The tenancy posture the plan was computed under. */
  posture: string;
  /**
   * The conflict groups the plan listed, by key: the only rows a
   * `--metadata-choice` or `--template-choice` may delete. Absent means the
   * file listed none.
   */
  conflicts?: ReviewedConflict[];
}

/** One conflict group a plan lists: the rows a choice there resolves. */
export interface ReviewedConflict {
  kind: 'metadata' | 'template';
  /** The group's key as the operator reads it: `view deal_list (package p)`, `crm.note (en-US)`. */
  key: string;
  /** Its rows, by id, sorted. */
  candidates: string[];
}

/**
 * The conflict groups of a plan, from the plan the apply computes or from the
 * kept file (both carry `tables[].metadataConflicts` and
 * `tables[].templateConflicts`), normalized so the two compare.
 */
export function reviewedConflictsOf(plan: unknown): ReviewedConflict[] {
  const tables = (plan as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(tables)) return [];
  const ids = (candidates: unknown): string[] =>
    Array.isArray(candidates) ? candidates.map((c) => String((c as { id?: unknown })?.id)).sort() : [];
  const out: ReviewedConflict[] = [];
  for (const table of tables as Array<Record<string, unknown>>) {
    for (const c of Array.isArray(table?.metadataConflicts) ? (table.metadataConflicts as Array<Record<string, unknown>>) : []) {
      out.push({
        kind: 'metadata',
        key: `${String(c.type)} ${String(c.name)}${c.packageId ? ` (package ${String(c.packageId)})` : ''}` +
          `${c.bundleMember ? ` [${String(c.bundleMember)}]` : ''}`,
        candidates: ids(c.candidates),
      });
    }
    for (const c of Array.isArray(table?.templateConflicts) ? (table.templateConflicts as Array<Record<string, unknown>>) : []) {
      out.push({ kind: 'template', key: `${String(c.name)} (${String(c.locale)})`, candidates: ids(c.candidates) });
    }
  }
  return out;
}

/**
 * The apply would execute fates other than the reviewed plan's, or against
 * another database. Thrown before anything is written; the remedy is a new
 * plan, reviewed and handed in.
 */
export class ReviewedPlanRefusal extends Error {
  constructor(
    readonly reason:
      | 'plan-file-unusable'
      | 'plan-digest-mismatch'
      | 'plan-posture-mismatch'
      | 'plan-database-mismatch'
      | 'plan-conflict-mismatch',
    message: string,
    readonly detail: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ReviewedPlanRefusal';
  }
}

/**
 * Parse the kept plan file into a {@link ReviewedPlan}, or refuse naming the
 * file: not JSON, not an organization-ownership plan, or missing the digest or
 * the database it was computed for.
 */
export function reviewedPlanFromFile(file: string, text: string): ReviewedPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ReviewedPlanRefusal(
      'plan-file-unusable',
      `The plan file ${file} is not JSON (${error instanceof Error ? error.message : String(error)}). Hand in the file ` +
        'the plan run wrote.',
      { file },
    );
  }
  const p = parsed as Partial<Record<string, unknown>> | null;
  if (
    !p ||
    typeof p !== 'object' ||
    p.kind !== 'organization-ownership-plan' ||
    p.ceremony !== 'ADR-0131 D10' ||
    typeof p.inventoryDigest !== 'string' ||
    !p.inventoryDigest ||
    typeof p.database !== 'string' ||
    typeof p.generatedAt !== 'string' ||
    typeof p.posture !== 'string' ||
    !p.posture
  ) {
    throw new ReviewedPlanRefusal(
      'plan-file-unusable',
      `The file ${file} is not an organization-ownership plan (it needs kind, ceremony, inventoryDigest, posture, ` +
        'database and generatedAt). Hand in the file the plan run wrote.',
      { file },
    );
  }
  return {
    file,
    generatedAt: p.generatedAt,
    database: p.database,
    inventoryDigest: p.inventoryDigest,
    posture: p.posture,
    conflicts: reviewedConflictsOf(p),
  };
}

export interface StepReport {
  step: CeremonyStep;
  /** `checkpointed`: finished by an earlier run; `not-reached`: an earlier step stopped the run. */
  status: 'done' | 'checkpointed' | 'blocked' | 'not-reached';
  summary: Record<string, number>;
  /** Each blocker, with its remedy, in the operator's terms. */
  blockers: string[];
  /** Reported, never blocking. */
  notes: string[];
}

export interface TableOutcome {
  object: string;
  fate: TablePlan['fate'];
  before: { total: number; organizationNull: number } | null;
  after: { total: number; organizationNull: number } | null;
  attributed: number;
  deleted: number;
  /** Rows a `moved` departure carried out of this table, and into it. */
  movedOut: number;
  movedIn: number;
  /** Fate 1: the column is gone after this run. */
  columnDropped: boolean;
  /** Rows still NULL and listed by id — reported, never guessed. */
  unattributable: UnattributableRow[];
  /**
   * Present when the {@link unattributable} rows hold certification (every
   * table but a `notNullExempt` one): their count, which `remaining` includes,
   * and the remedy in the operator's terms ({@link UNATTRIBUTABLE_REMEDY}).
   */
  held?: { rows: number; remedy: string };
  /**
   * Rows that leave this table by a step this ceremony has not yet performed
   * (a move, or a mirror its own stage removes): each counts as remaining
   * until it is gone, and its label is the remedy. One that carries `advisory`
   * is a departure no step of this release can perform, because its own boot
   * re-creates the rows (`PlannedDeparture.advisory`): its rows are named and
   * counted here and in the run's `advisory`, never in `remaining`.
   */
  departures: Array<{ id: string; label: string; as: 'mirror-deletion' | 'moved'; rows: number; advisory?: string }>;
  /** Templates: each `(name, locale)` whose rows still differ, with every candidate row and its organization. */
  templateConflicts?: TemplateConflict[];
  /**
   * Post-check: what is left for this table's fate, `0` when the fate is done —
   * its {@link held} unattributable rows included; advisory departures are not in it.
   */
  remaining: number;
  notNull: TablePlan['notNull'];
}

export interface OrganizationOwnershipApplyReport {
  kind: 'organization-ownership-apply';
  ceremony: 'ADR-0131 D10';
  migrationId: typeof ORGANIZATION_OWNERSHIP_MIGRATION_ID;
  generatedAt: string;
  database: string;
  posture: string;
  inventoryDigest: string;
  /** The plan file this run executed: its digest equals {@link inventoryDigest}. */
  reviewedPlan: { file: string; generatedAt: string };
  /**
   * A checkpoint recorded under another inventory digest, which the reviewed
   * plan superseded: its steps were run again from the start.
   */
  restartedFrom?: { inventoryDigest: string; steps: CeremonyStep[] };
  /** Steps an earlier run finished, read from the checkpoint. */
  resumedFrom: CeremonyStep[];
  /** The plan's warnings as this run read them before its first write (`OrganizationOwnershipPlan.warnings`). */
  warnings: string[];
  steps: StepReport[];
  tables: TableOutcome[];
  /** Every step finished. */
  complete: boolean;
  /**
   * Blockers (an unfinished ceremony) or post-check discrepancies (a finished
   * one), unattributable rows among them (`TableOutcome.held`). Zero is the verdict.
   */
  blocking: number;
  /**
   * Rows reported, never guessed and never held against the verdict: the rows
   * of an advisory departure, held for the release that can remove them
   * (`TableOutcome.departures`), and the unattributable rows of a table whose
   * column is not the tenancy anchor (`InventoryEntry.notNullExempt`).
   */
  advisory: number;
}

export interface ApplyOptions {
  executor: ApplyExecutor;
  posture: string;
  database: string;
  /** The databases beside the primary (the `telemetry` sibling), each with its own executor. */
  siblings?: readonly ApplySibling[];
  /** The database the deployment keeps `object` in (the booted engine's routing); see the plan's `homeOf`. */
  homeOf?: (object: string) => string | undefined;
  catalog: CatalogPort;
  door: MetadataDoorPort;
  templates: TemplatePort;
  /**
   * [ADR-0131 C3 stage 9] The declared sharing rules, by name. Absent, a run
   * that finds a declared-rule mirror standing blocks instead of deleting it.
   */
  declaredSharingRules?: DeclaredSharingRulesPort;
  /**
   * [18.x step 5a] The declared webhooks, by name. Absent, a run that finds a
   * seeded `sys_webhook` row blocks instead of settling it.
   */
  declaredWebhooks?: DeclaredWebhooksPort;
  /** [18.x step 5d] The schema door the NOT NULL step applies through. Absent, it applies nothing and says so. */
  notNull?: NotNullPort;
  /** The served views, for carrying form withdrawals. */
  views: ServedViewsPort;
  /** The door's lock verdict, for the one write the ceremony makes in place. */
  lock: MetadataLockPort;
  columnDrops: ColumnDropPort;
  ledger: CeremonyLedgerPort;
  /**
   * Creates the Default Organization when the plan says `--apply` does (`single`,
   * no organization at all, and rows that fall to it —
   * `OrganizationOwnershipPlan.defaultOrganizationCreatedByApply`).
   * Absent, such a run blocks at attribution instead of attributing nothing.
   */
  defaultOrganization?: DefaultOrganizationPort;
  /** The kept plan file the operator reviewed; the run refuses unless it matches (see the module doc). */
  reviewedPlan: ReviewedPlan;
  inventory?: readonly InventoryEntry[];
  /**
   * [#23359] What the boot's auth gate answered for the security plugin
   * (`bootSchemaStack`'s `composition.securityPlugin`). The plugin declares the
   * platform's shipped permission sets and the built-in positions, so when the
   * boot did not compose it, a grant or binding naming one of them does not
   * resolve for that reason alone: the step's blocker says so in the
   * composition's own sentence and never prescribes removing it
   * ({@link uncomposedSecurityRemedy}). Absent, every unresolved name keeps its
   * remedy. It resolves nothing: the step still refuses.
   */
  securityPlugin?: SchemaMigrationComposition['securityPlugin'];
  /**
   * The operator's choice for each template conflict: one candidate row id per
   * `(name, locale)` whose customized or authored rows differ. Validated before
   * anything is written ({@link TemplateChoiceRefusal}).
   */
  templateChoices?: readonly string[];
  /**
   * The operator's choice per `sys_metadata` conflict (the row the environment
   * keeps; the others are deleted once it is promoted and read back), and under
   * a wall the organization rows promoted knowingly. Validated before anything
   * is written ({@link MetadataChoiceRefusal}).
   */
  metadataChoices?: readonly string[];
  now?: () => Date;
  /** One line per milestone, for the command's human face. */
  onProgress?: (message: string) => void;
  /** Each of the plan's warnings, before the first write: what the ceremony decides on the operator's behalf. */
  onWarning?: (message: string) => void;
}

const ORG = 'organization_id';
const IN_CHUNK = 200;
const PAGE = 500;
const MAX_ATTRIBUTION_PASSES = 8;

const GRANTS = 'sys_user_permission_set';
const SETS = 'sys_permission_set';
const POSITIONS = 'sys_position';
const BINDINGS = 'sys_position_permission_set';
const CAPABILITIES = 'sys_capability';
const TEMPLATES = TEMPLATE_OBJECT;
const SETTINGS = 'sys_setting';
const PLATFORM_SETTINGS = 'sys_platform_setting';

/** The `moved` departures the ceremony executes, by departure id. */
const MOVES: Readonly<Record<string, { from: string; to: string; key: readonly string[]; compare: readonly string[] }>> = {
  'global-rung-move': {
    from: SETTINGS,
    to: PLATFORM_SETTINGS,
    key: ['namespace', 'key'],
    compare: ['value', 'value_enc', 'encrypted', 'locked', 'locked_reason'],
  },
};

const text = (value: unknown): string | null =>
  value === null || value === undefined || String(value) === '' ? null : String(value);

/** Shared state of one run. */
interface Run {
  opts: ApplyOptions;
  /** The primary database's SQL seam. */
  sql: Sql;
  /** Each database's SQL seam and executor, by name (the primary is `PRIMARY_DATABASE`). */
  databases: Map<string, { sql: Sql; executor: ApplyExecutor }>;
  /** The database each planned physical table lives in, as the latest plan read it. */
  databaseOf: Map<string, string>;
  plan: OrganizationOwnershipPlan;
  columns: Map<string, Set<string> | null>;
  attributed: Map<string, number>;
  deleted: Map<string, number>;
  movedOut: Map<string, number>;
  movedIn: Map<string, number>;
  /**
   * What the door accepted this run. The registry hydrates environment
   * metadata at boot, so a definition saved a moment ago is not in it until
   * the next one; the door's acceptance is what makes it resolve now.
   */
  saved: Map<string, Readonly<Record<string, unknown>>>;
  /**
   * Template rows whose environment copy this run verified (promoted, or found
   * equal): only these, and seeded mirrors, may be deleted. Rebuilt by the
   * promotion pass mirror deletion re-runs, so a resumed run verifies afresh.
   */
  verifiedTemplateIds: Set<string>;
  /** The checkpoint this run writes into (set once the ledger is read). */
  checkpoint?: CeremonyCheckpoint;
  /** This apply's `history-renumber` verified `event_seq` and version uniqueness environment-wide. */
  historyVerified?: boolean;
}

/** A `--metadata-choice` that names no row awaiting a choice, or two of one conflict. Nothing is written. */
export class MetadataChoiceRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataChoiceRefusal';
  }
}

/** A `--template-choice` that names no candidate of a listed conflict, or two of one. Nothing is written. */
export class TemplateChoiceRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateChoiceRefusal';
  }
}

/** The catalog read, then what the door accepted this run. */
async function resolveName(run: Run, type: 'position' | 'permission', name: string): Promise<{ definition: Readonly<Record<string, unknown>> } | undefined> {
  const found = await run.opts.catalog.resolve(type, name);
  if (found) return found;
  const saved = run.saved.get(`${type}|${name}`);
  return saved ? { definition: saved } : undefined;
}

async function saveDefinition(run: Run, type: 'position' | 'permission', name: string, body: Record<string, unknown>): Promise<void> {
  await run.opts.door.save(type, name, body);
  run.saved.set(`${type}|${name}`, body);
}

/** The database `table` lives in: its SQL seam and executor (the primary for a table no plan placed). */
function databaseFor(run: Run, table: string): { sql: Sql; executor: ApplyExecutor } {
  return run.databases.get(run.databaseOf.get(table) ?? PRIMARY_DATABASE) ?? run.databases.get(PRIMARY_DATABASE)!;
}

async function columnsOf(run: Run, table: string): Promise<Set<string> | null> {
  if (run.columns.has(table)) return run.columns.get(table)!;
  const present = run.plan.tables.some((t) => t.tables.includes(table));
  let cols: Set<string> | null = null;
  if (present) {
    const { sql } = databaseFor(run, table);
    const rows = await sql.read(table, columnListSql(sql.dialect), [table]);
    cols = new Set(rows.map(columnNameOf).filter((c): c is string => c !== null));
  }
  run.columns.set(table, cols);
  return cols;
}

/** Every row of `table` matching `where`, keyset-paged by id. */
async function readAll(run: Run, table: string, select: readonly string[], where: { text: string; params: unknown[] } = { text: '1 = 1', params: [] }): Promise<Record<string, unknown>[]> {
  const { sql } = databaseFor(run, table);
  const t = sql.q(table, table);
  const id = sql.q('id', table);
  const cols = [...new Set(['id', ...select])].map((c) => `${sql.q(c, table)} AS ${sql.q(c, table)}`).join(', ');
  const out: Record<string, unknown>[] = [];
  let after: unknown;
  for (;;) {
    const rows = await sql.read(
      table,
      `SELECT ${cols} FROM ${t} WHERE (${where.text})${after === undefined ? '' : ` AND ${id} > ?`} ORDER BY ${id} LIMIT ${PAGE}`,
      after === undefined ? where.params : [...where.params, after],
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1]!.id;
  }
}

async function execute(run: Run, table: string, statement: string, params: readonly unknown[]): Promise<void> {
  try {
    await databaseFor(run, table).executor.execute(statement, params);
  } catch (error) {
    throw new Error(`The write to ${table} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function planFor(run: Run, extra: { onAttribution?: AttributionSink } = {}): Promise<OrganizationOwnershipPlan> {
  const plan = await buildOrganizationOwnershipPlan({
    reader: run.opts.executor,
    posture: run.opts.posture,
    database: run.opts.database,
    ...(run.opts.siblings?.length
      ? { siblings: run.opts.siblings.map((d) => ({ name: d.name, database: d.database, reader: d.executor })) }
      : {}),
    ...(run.opts.homeOf ? { homeOf: run.opts.homeOf } : {}),
    ...(run.opts.inventory ? { inventory: run.opts.inventory } : {}),
    ...(run.opts.now ? { now: run.opts.now() } : {}),
    ...extra,
  });
  for (const table of plan.tables) {
    for (const physical of table.tables) run.databaseOf.set(physical, table.database ?? PRIMARY_DATABASE);
  }
  return plan;
}

const nullsUnderAttribution = (plan: OrganizationOwnershipPlan): number =>
  plan.tables.filter((t) => t.fate === 'attribution').reduce((n, t) => n + (t.rows?.organizationNull ?? 0), 0);

/** The rows the plan derives an owner for and has not yet written: what an attribution pass would write. */
const rowsToAttribute = (plan: OrganizationOwnershipPlan): number =>
  plan.tables.filter((t) => t.fate === 'attribution').reduce((n, t) => n + Number(t.fateCounts.rowsToAttribute ?? 0), 0);

// ── Step 1: attribution ──────────────────────────────────────────────────────

/**
 * [ADR-0131 D3, D10 fate 3] Under `single`, on a database that holds no
 * organization at all and rows no anchor names, create the Default
 * Organization before the first attribution write: it owns those rows, and it
 * exists before the first write that needs an owner. The plan the operator reviewed said so
 * (`defaultOrganizationCreatedByApply`, and its warning). `null` when it now
 * exists; the blocker, in the operator's terms, when it could not be created.
 */
async function ensureDefaultOrganization(run: Run): Promise<string | null> {
  if (!run.plan.defaultOrganizationCreatedByApply) return null;
  const port = run.opts.defaultOrganization;
  if (!port) {
    return (
      'This single-posture database holds no organization, and this run has no way to create the Default ' +
      'Organization that owns its organization-less rows (ADR-0131 D3). Nothing was attributed. Run the ceremony ' +
      'through `os migrate organization-ownership --apply`, which creates it.'
    );
  }
  try {
    const { id } = await port.create();
    run.opts.onProgress?.(`created the Default Organization ${id} (single posture): the owner of the rows no anchor names`);
    return null;
  } catch (error) {
    return (
      `The Default Organization could not be created (${error instanceof Error ? error.message : String(error)}), so ` +
      'the organization-less rows no anchor names have no owner to take (ADR-0131 D3). Nothing was attributed. Make ' +
      'the sys_organization insert land — the database\'s write permission, a legacy unique index on its slug — then ' +
      're-run --apply.'
    );
  }
}

async function runAttribution(run: Run): Promise<StepReport> {
  const unowned = await ensureDefaultOrganization(run);
  if (unowned) {
    return { step: 'attribution', status: 'blocked', summary: { rowsAttributed: 0, passes: 0 }, blockers: [unowned], notes: [] };
  }
  let passes = 0;
  let total = 0;
  let lastNulls = Number.POSITIVE_INFINITY;
  for (;;) {
    passes++;
    let wrote = 0;
    const plan = await planFor(run, {
      onAttribution: async ({ object, assignments }) => {
        // Each row is written in the database the plan read it from (the
        // assignment says, before any plan of this pass has placed the table).
        const groups = new Map<string, string[]>();
        for (const a of assignments) {
          const key = `${a.database ?? PRIMARY_DATABASE}\u0000${a.table}\u0000${a.organizationId}`;
          const ids = groups.get(key) ?? [];
          ids.push(a.id);
          groups.set(key, ids);
        }
        for (const [key, ids] of groups) {
          const [database, table, organizationId] = key.split('\u0000') as [string, string, string];
          const { sql, executor } = run.databases.get(database)!;
          const t = sql.q(table, table);
          for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const chunk = ids.slice(i, i + IN_CHUNK);
            const statement =
              `UPDATE ${t} SET ${sql.q(ORG, table)} = ? WHERE ${sql.q(ORG, table)} IS NULL AND ${sql.q('id', table)} IN (${chunk.map(() => '?').join(', ')})`;
            try {
              await executor.execute(statement, [organizationId, ...chunk]);
            } catch (error) {
              throw new Error(`The write to ${table} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
          }
        }
        wrote += assignments.length;
        run.attributed.set(object, (run.attributed.get(object) ?? 0) + assignments.length);
      },
    });
    const nulls = nullsUnderAttribution(plan);
    if (wrote === 0) break;
    if (nulls >= lastNulls || passes >= MAX_ATTRIBUTION_PASSES) {
      return {
        step: 'attribution',
        status: 'blocked',
        summary: { rowsAttributed: total, passes },
        blockers: [
          `Attribution did not reach a fixed point: pass ${passes} still derived ${wrote} owner(s) while the NULL rows did ` +
            `not decrease (${nulls}). The writes are not landing — check that the database accepts the UPDATE, then re-run.`,
        ],
        notes: [],
      };
    }
    total += wrote;
    lastNulls = nulls;
    run.opts.onProgress?.(`attribution pass ${passes}: ${wrote} row(s) took their organization`);
  }
  return { step: 'attribution', status: 'done', summary: { rowsAttributed: total, passes }, blockers: [], notes: [] };
}

// ── Step 2: authored catalog rows → environment metadata ────────────────────

/** The inventory's `authored` selector for a catalog object. */
function authoredWhere(object: string, inventory: readonly InventoryEntry[] | undefined): RowPredicate | null {
  const entry = inventory ? inventory.find((e) => e.object === object) : inventoryEntryFor(object);
  return entry?.categories?.find((c) => c.id === 'authored')?.where ?? null;
}

const rowIsOff = (value: unknown): boolean => value === false || value === 0 || value === '0' || value === 'false';

/** The JSON of a definition's own keys, for comparing two bodies. */
const bodyKey = definitionKey;

interface CatalogRows {
  positions: Record<string, unknown>[];
  sets: Record<string, unknown>[];
  bindings: Record<string, unknown>[];
}

async function readCatalogRows(run: Run): Promise<CatalogRows> {
  const read = async (table: string, select: string[]): Promise<Record<string, unknown>[]> => {
    const cols = await columnsOf(run, table);
    if (!cols) return [];
    return readAll(run, table, select.filter((c) => cols.has(c)));
  };
  return {
    positions: await read(POSITIONS, ['name', ORG]),
    sets: await read(SETS, ['name', ORG]),
    bindings: await read(BINDINGS, ['position_id', 'permission_set_id']),
  };
}

/** The `permissionSets` each catalog position definition names today, by name. */
async function declaredPositionSets(run: Run, names: Iterable<string>): Promise<Map<string, string[]>> {
  const declared = new Map<string, string[]>();
  for (const name of new Set(names)) {
    const entry = await resolveName(run, 'position', name);
    const sets = entry?.definition.permissionSets;
    if (Array.isArray(sets)) declared.set(name, sets.map(String));
  }
  return declared;
}

/**
 * [#23359] The remedy for a permission set or position the catalog does not
 * resolve because the boot did not compose the security plugin — or
 * `undefined`, and the caller keeps its own remedy, when the boot composed it
 * (or did not say), or when the name is not one the plugin declares.
 *
 * The composition is the boot's answer ({@link ApplyOptions.securityPlugin}),
 * never inferred from the missing name. The names are read from their owners:
 * the plugin's shipped sets (`securityDefaultPermissionSets`), and the built-in
 * positions its `init()` declares — the spec's identity names and audience
 * anchors, the two lists its declarations are built from. The sentence is the
 * composition's own (`describeSecurityPluginComposition`), followed by the one
 * instruction that holds whatever the gate's reason: keep the rows, and re-run
 * where the plugin is composed. ⛔ Never "remove" for such a name: removing a
 * shipped grant strips the standing the platform seeded. Nothing is resolved
 * here; the step still refuses.
 */
async function uncomposedSecurityRemedy(run: Run, type: 'permission' | 'position', name: string): Promise<string | undefined> {
  const status = run.opts.securityPlugin;
  if (!status || status.composed) return undefined;
  const declared: readonly string[] = type === 'permission'
    ? (await import('@objectstack/plugin-security')).securityDefaultPermissionSets.map((set) => set.name)
    : await import('@objectstack/spec').then((spec) => [...spec.BUILTIN_IDENTITY_NAMES, ...spec.AUDIENCE_ANCHOR_POSITIONS]);
  if (!declared.includes(name)) return undefined;
  const kept = type === 'permission' ? 'permission sets it ships: keep the grants' : 'built-in positions it declares: keep the bindings';
  return `${describeSecurityPluginComposition(status)} ${name} is one of the ${kept}, and re-run where the security plugin is composed.`;
}

async function runAuthoredConversion(run: Run): Promise<StepReport> {
  const blockers: string[] = [];
  const notes: string[] = [];
  const summary: Record<string, number> = { converted: 0, alreadyConverted: 0, reported: 0 };
  const authoredRows = async (table: string): Promise<Record<string, unknown>[]> => {
    const cols = await columnsOf(run, table);
    const where = authoredWhere(table, run.opts.inventory);
    if (!cols || !where) return [];
    return readAll(run, table, [...cols], predicateSql(run.sql, table, cols, where));
  };
  // The shipped sets an install seeded as `admin` rows (LEGACY_SHIPPED_SET_SEEDS)
  // are the platform's seeds, not Setup-authored sets: re-owned `platform`
  // here, under every posture, so the authored read below leaves them out and
  // mirror deletion takes them once the rewrite has named every grant.
  // Idempotent: a re-run finds none. The plan warned, naming each row.
  const setColumns = await columnsOf(run, SETS);
  if (setColumns?.has('managed_by') && setColumns.has('name')) {
    const legacy = predicateSql(run.sql, SETS, setColumns, LEGACY_SHIPPED_SET_SEEDS);
    const adopted = await readAll(run, SETS, ['name'], legacy);
    if (adopted.length > 0) {
      await execute(
        run,
        SETS,
        `UPDATE ${run.sql.q(SETS, SETS)} SET ${run.sql.q('managed_by', SETS)} = ? WHERE ${legacy.text}`,
        ['platform', ...legacy.params],
      );
      summary.legacySeedsAdopted = adopted.length;
      notes.push(
        `Adopted ${adopted.length} shipped permission set row(s) stored as managed_by 'admin' ` +
          `(${[...new Set(adopted.map((r) => String(r.name)))].sort().join(', ')}) as platform seeds: the shipped ` +
          'definitions stand, and mirror deletion removes these rows once every grant names its set.',
      );
      run.opts.onProgress?.(`adopted ${adopted.length} legacy shipped permission set row(s) as platform seeds`);
    }
  }
  const sets = await authoredRows(SETS);
  const positions = await authoredRows(POSITIONS);
  const capabilities = await authoredRows(CAPABILITIES);

  if (capabilities.length > 0) {
    summary.reported += capabilities.length;
    notes.push(
      `${capabilities.length} authored ${CAPABILITIES} row(s) are reported, not converted: no runtime reader honours a ` +
        'capability row, so nothing is converted for them (fate 4).',
    );
  }
  if (sets.length + positions.length === 0 && (await columnsOf(run, BINDINGS)) === null) {
    return { step: 'authored-conversion', status: 'done', summary, blockers, notes };
  }
  if (run.opts.posture !== 'single') {
    summary.reported += sets.length + positions.length;
    if (sets.length + positions.length > 0) {
      notes.push(
        `${sets.length + positions.length} organization-authored catalog row(s) are reported, not converted: under the ` +
          `${run.opts.posture} posture a catalog definition is not an environment write (ADR-0131 D3). A grant that ` +
          'names one of them does not resolve, and the rewrite step reports it.',
      );
    }
    return { step: 'authored-conversion', status: 'done', summary, blockers, notes };
  }

  // Bindings first: an authored position's definition carries the sets its rows bind.
  const catalogRows = await readCatalogRows(run);
  const conversion = convertPositionBindingRows({
    positions: catalogRows.positions,
    permissionSets: catalogRows.sets,
    bindings: catalogRows.bindings,
    declared: await declaredPositionSets(run, catalogRows.positions.map((r) => String(r.name))),
  });
  const boundSets = new Map<string, readonly string[]>();
  for (const position of conversion.positions) {
    if (position.fate === 'conflicting') {
      blockers.push(
        `Position ${position.name}: organizations bind different permission sets to it ` +
          `(${JSON.stringify(position.byOrganization)}). Merging them would grant one organization's members another's ` +
          `sets, so it is never guessed: make the ${BINDINGS} rows agree (or remove the extra ones), then re-run.`,
      );
    } else if (position.fate === 'converted') {
      boundSets.set(position.name, position.permissionSets);
    }
  }

  const convert = async (
    type: 'permission' | 'position',
    rows: Record<string, unknown>[],
    toBody: (row: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Set<string>> => {
    const handled = new Set<string>();
    const byName = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const name = text(row.name);
      if (!name) {
        summary.reported++;
        notes.push(`An authored ${type} row (${String(row.id)}) carries no name and is reported, never converted.`);
        continue;
      }
      byName.set(name, [...(byName.get(name) ?? []), row]);
    }
    for (const [name, group] of byName) {
      handled.add(name);
      if (group.some((r) => 'active' in r && rowIsOff(r.active))) {
        summary.reported += group.length;
        notes.push(
          `The authored ${type} ${name} is deactivated and is not converted: converting it would make it grant. A grant ` +
            'that names it does not resolve, and the rewrite step reports it.',
        );
        continue;
      }
      const bodies = group.map((row) => {
        const body = toBody(row);
        const extra = type === 'position' ? boundSets.get(name) : undefined;
        return extra ? { ...body, permissionSets: [...extra] } : body;
      });
      const keys = Object.keys(bodies[0]!);
      if (new Set(bodies.map((b) => bodyKey(b, [...new Set(bodies.flatMap(Object.keys))]))).size > 1) {
        blockers.push(
          `The authored ${type} ${name} is held by ${group.length} rows (${group.map((r) => String(r.id)).join(', ')}) ` +
            'that define it differently. Which one the environment keeps is never guessed: make them agree, or ' +
            'rename all but one, then re-run.',
        );
        continue;
      }
      const body = bodies[0]!;
      const existing = await resolveName(run, type, name);
      if (existing) {
        if (bodyKey(existing.definition, keys) === bodyKey(body, keys)) {
          summary.alreadyConverted++;
          continue;
        }
        blockers.push(
          `The authored ${type} ${name} differs from the definition the catalog already holds under that name. The ` +
            'catalog\'s definition stays; rename the authored row (and the grants that name it), then re-run.',
        );
        continue;
      }
      try {
        await saveDefinition(run, type, name, body);
        summary.converted++;
        run.opts.onProgress?.(`converted the authored ${type} ${name} to environment metadata`);
      } catch (error) {
        blockers.push(
          `The metadata door refused the authored ${type} ${name}: ${error instanceof Error ? error.message : String(error)}. ` +
            'Correct the row so the definition validates, then re-run.',
        );
      }
    }
    return handled;
  };

  await convert('permission', sets, (row) => permissionSetDefinitionFromRow(row));
  const authoredPositions = await convert('position', positions, (row) => positionDefinitionFromRow(row));

  // A declared position whose binding rows add sets its definition lacks.
  for (const [name, permissionSets] of boundSets) {
    if (authoredPositions.has(name)) continue;
    const existing = await resolveName(run, 'position', name);
    if (!existing) {
      blockers.push(
        `Binding rows give position ${name} the sets ${permissionSets.join(', ')}, and the catalog holds no position of ` +
          `that name to carry them. ${(await uncomposedSecurityRemedy(run, 'position', name)) ?? 'Declare the position (or remove the bindings), then re-run.'}`,
      );
      continue;
    }
    try {
      await saveDefinition(run, 'position', name, { ...existing.definition, permissionSets: [...permissionSets] });
      summary.converted++;
    } catch (error) {
      blockers.push(
        `Binding rows give the declared position ${name} the sets ${permissionSets.join(', ')}, which its definition ` +
          `does not name, and the metadata door refused the change: ${error instanceof Error ? error.message : String(error)}. ` +
          `Declare those sets on the position (permissionSets), or remove the ${BINDINGS} rows, then re-run.`,
      );
    }
  }
  if (conversion.dangling.length > 0) {
    notes.push(
      `${conversion.dangling.length} ${BINDINGS} row(s) name a position or set row that does not exist; they bind nothing ` +
        'and are deleted with the other binding mirrors.',
    );
  }
  return { step: 'authored-conversion', status: blockers.length ? 'blocked' : 'done', summary, blockers, notes };
}

// ── History numbering (seat answer Q2 A) ────────────────────────────────────
//
// The metadata door numbers a save from history in its OWN scope: `event_seq`
// and an item's `version` are each `MAX + 1` over the rows whose
// `organization_id` is the writer's. While the column stands, the environment
// and each organization therefore count independently, and once it goes,
// `event_seq` and every `(type, name, version)` must be unique. Two rules make
// them so:
//
// - **A promoted row takes its history with it** ({@link foldLineage}). Before
//   a row leaves its organization, that organization's lineage of the item is
//   moved above the environment's numbers and becomes environment history. The
//   door then counts it, so every later environment save of the item, the
//   ceremony's or the runtime's, numbers above it, and the row's own version
//   still names its own snapshot.
// - **Every other organization lineage is laid out above the environment's
//   just before the column goes** ({@link runHistoryRenumber}, on every apply).
//   Those lineages belong to rows that stay organization rows (reported under
//   a wall) or are gone (unchosen rows), so no environment row's version points
//   into them; the step moves each organization row's version with its own.

const HISTORY = 'sys_metadata_history';
const COMMITS = 'sys_metadata_commit';
const OVERLAYS = 'sys_metadata';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One range of numbers, moved above `base` without a transaction and safely
 * re-runnable. The offset puts the new range wholly ABOVE both `base` and the
 * old range, so a row's own number says whether it moved: the dependents
 * (commit ranges, overlay rows' versions) move first, each only where it still
 * lies inside the old range, and the history rows last, in ONE statement. A
 * re-run finds the history above `base` and moves nothing. Returns the new
 * top of the range.
 */
async function shiftRange(
  range: { min: number; max: number },
  base: number,
  dependents: (offset: number, oldMax: number) => Promise<void>,
  history: (offset: number) => Promise<void>,
): Promise<{ top: number; moved: boolean }> {
  if (range.min > base) return { top: Math.max(base, range.max), moved: false };
  const offset = Math.max(base, range.max) - range.min + 1;
  await dependents(offset, range.max);
  await history(offset);
  return { top: range.max + offset, moved: true };
}

/** The history columns the numbering reads, or `null` when the table carries no organization column. */
async function historyShape(run: Run): Promise<{ version: boolean; seq: boolean } | null> {
  const hcols = await columnsOf(run, HISTORY);
  if (!hcols?.has(ORG)) return null;
  return { version: hcols.has('version'), seq: hcols.has('event_seq') };
}

/**
 * Make one organization's lineage of `(type, name)` environment history, so the
 * row about to be promoted keeps it: its versions and its events each moved, by
 * one offset that keeps their order, above BOTH the environment's numbers and
 * every other number the same organization holds, then the rows re-tagged. The
 * organization's whole history is the base because 17.x numbered `event_seq`
 * per organization across all its items and holds it under a unique
 * `(organization_id, event_seq)` index, checked row by row: an offset measured
 * on the item alone lands on the organization's own other events. Versions take
 * the same base, as ruled. The base excludes the lineage being moved, so once
 * moved it sits above the base, and a rerun after a crash anywhere in this moves
 * nothing twice. Commit ranges are not moved (no reader resolves history
 * through them).
 */
async function foldLineage(run: Run, organizationId: string, type: string, name: string): Promise<void> {
  const shape = await historyShape(run);
  if (!shape) return;
  const sql = run.sql;
  const h = sql.q(HISTORY, HISTORY);
  const o = sql.q(ORG, HISTORY);
  const ty = sql.q('type', HISTORY);
  const nm = sql.q('name', HISTORY);
  const mine = `${o} = ? AND ${ty} = ? AND ${nm} = ?`;
  const args = [organizationId, type, name];
  if (shape.version) {
    const v = sql.q('version', HISTORY);
    const [own] = await sql.read(HISTORY, `SELECT MIN(${v}) AS lo, MAX(${v}) AS hi, COUNT(*) AS n FROM ${h} WHERE ${mine}`, args);
    if (num(own?.n) > 0) {
      const [env] = await sql.read(HISTORY, `SELECT MAX(${v}) AS m FROM ${h} WHERE ${o} IS NULL AND ${ty} = ? AND ${nm} = ?`, [type, name]);
      const [others] = await sql.read(
        HISTORY,
        `SELECT MAX(${v}) AS m FROM ${h} WHERE ${o} = ? AND NOT (${ty} = ? AND ${nm} = ?)`,
        args,
      );
      const mcols = await columnsOf(run, OVERLAYS);
      await shiftRange(
        { min: num(own!.lo), max: num(own!.hi) },
        Math.max(num(env?.m), num(others?.m)),
        async (offset, oldMax) => {
          if (!mcols?.has(ORG) || !mcols.has('version')) return;
          const m = sql.q(OVERLAYS, OVERLAYS);
          const mv = sql.q('version', OVERLAYS);
          await execute(
            run,
            OVERLAYS,
            `UPDATE ${m} SET ${mv} = ${mv} + ? WHERE ${sql.q(ORG, OVERLAYS)} = ? AND ${sql.q('type', OVERLAYS)} = ? ` +
              `AND ${sql.q('name', OVERLAYS)} = ? AND ${mv} <= ?`,
            [offset, ...args, oldMax],
          );
        },
        async (offset) => {
          await execute(run, HISTORY, `UPDATE ${h} SET ${v} = ${v} + ? WHERE ${mine}`, [offset, ...args]);
        },
      );
    }
  }
  if (shape.seq) {
    const seq = sql.q('event_seq', HISTORY);
    const [own] = await sql.read(HISTORY, `SELECT MIN(${seq}) AS lo, MAX(${seq}) AS hi, COUNT(*) AS n FROM ${h} WHERE ${mine}`, args);
    const [env] = await sql.read(HISTORY, `SELECT MAX(${seq}) AS m FROM ${h} WHERE ${o} IS NULL`);
    const [others] = await sql.read(
      HISTORY,
      `SELECT MAX(${seq}) AS m FROM ${h} WHERE ${o} = ? AND NOT (${ty} = ? AND ${nm} = ?)`,
      args,
    );
    const base = Math.max(num(env?.m), num(others?.m));
    if (num(own?.n) > 0 && num(own!.lo) <= base) {
      // Wholly above the base and the old range: no row may land on the
      // environment's numbers, the organization's other events, or a sibling's.
      const offset = Math.max(base, num(own!.hi)) - num(own!.lo) + 1;
      await execute(run, HISTORY, `UPDATE ${h} SET ${seq} = ${seq} + ? WHERE ${mine}`, [offset, ...args]);
    }
  }
  await execute(run, HISTORY, `UPDATE ${h} SET ${o} = NULL WHERE ${mine}`, args);
}

/**
 * `event_seq` and every `(type, name, version)` unique environment-wide over
 * the history still tagged to an organization: each organization's event range
 * moved above the environment's (and the organizations' before it) by ONE
 * offset, its commit ranges with it; each organization lineage of an item laid
 * out above the environment's lineage of it (and the ones before it), the
 * organization's overlay rows of the item with it. Order within an
 * organization, and the snapshot each row's version names, are unchanged.
 */
async function runHistoryRenumber(run: Run): Promise<StepReport> {
  run.historyVerified = false;
  const report = await renumberHistory(run);
  const blockers = await historyDuplicates(run);
  if (blockers.length) return { ...report, status: 'blocked', blockers };
  run.historyVerified = true;
  return report;
}

/**
 * `event_seq` and `(type, name, version)` duplicated anywhere in history, as
 * blockers: `column-drops` runs only once this reads none (the seat's ruling on
 * uniqueness under a wall). The layout above leaves none between scopes; a
 * duplicate within one scope is a database's own, and is named, never guessed.
 */
async function historyDuplicates(run: Run): Promise<string[]> {
  const hcols = await columnsOf(run, HISTORY);
  if (!hcols) return [];
  const sql = run.sql;
  const h = sql.q(HISTORY, HISTORY);
  const out: string[] = [];
  if (hcols.has('event_seq')) {
    const seq = sql.q('event_seq', HISTORY);
    const dup = await sql.read(HISTORY, `SELECT ${seq} AS s FROM ${h} GROUP BY ${seq} HAVING COUNT(*) > 1 ORDER BY ${seq}`);
    if (dup.length) {
      const shown = dup.slice(0, 10).map((d) => d.s);
      const [ty, nm] = ['type', 'name'].map((c) => sql.q(c, HISTORY));
      const holders = await sql.read(
        HISTORY,
        `SELECT ${seq} AS s, ${sql.q('id', HISTORY)} AS id, ${ty} AS t, ${nm} AS n FROM ${h} ` +
          `WHERE ${seq} IN (${shown.map(() => '?').join(', ')}) ORDER BY ${seq}, ${sql.q('id', HISTORY)}`,
        shown,
      );
      const byNumber = shown.map(
        (n) => `event_seq ${String(n)}: ${holders.filter((r) => String(r.s) === String(n)).map((r) => `${String(r.t)} ${String(r.n)} (row ${String(r.id)})`).join(', ')}`,
      );
      out.push(
        `${HISTORY}: event_seq is not unique environment-wide — ${byNumber.join('; ')}` +
          `${dup.length > 10 ? `; and ${dup.length - 10} more number(s)` : ''}. The ceremony never renumbers history ` +
          'a database numbered twice: the organization_id column is not dropped until every event has its own number. ' +
          'Remedy: give each of these rows a number no other row holds (or remove the duplicate), then re-run --apply.',
      );
    }
  }
  if (hcols.has('version')) {
    const [ty, nm, v] = ['type', 'name', 'version'].map((c) => sql.q(c, HISTORY));
    const dup = await sql.read(
      HISTORY,
      `SELECT ${ty} AS t, ${nm} AS n, ${v} AS v, COUNT(*) AS c FROM ${h} GROUP BY ${ty}, ${nm}, ${v} HAVING COUNT(*) > 1 ORDER BY ${ty}, ${nm}, ${v}`,
    );
    if (dup.length) {
      out.push(
        `${HISTORY}: a version of an item is held more than once — ` +
          `${dup.slice(0, 10).map((d) => `${String(d.t)} ${String(d.n)} version ${String(d.v)} (${String(d.c)} rows)`).join('; ')}` +
          `${dup.length > 10 ? `; and ${dup.length - 10} more` : ''}. The ceremony never renumbers history a database ` +
          'numbered twice: the organization_id column is not dropped until every version names one snapshot. Remedy: give ' +
          'each of these rows a version no other row of the item holds (or remove the duplicate), then re-run --apply.',
      );
    }
  }
  return out;
}

async function renumberHistory(run: Run): Promise<StepReport> {
  const summary: Record<string, number> = { organizationsShifted: 0, lineagesShifted: 0 };
  const shape = await historyShape(run);
  if (!shape) return { step: 'history-renumber', status: 'done', summary, blockers: [], notes: [] };
  const sql = run.sql;
  const h = sql.q(HISTORY, HISTORY);
  const o = sql.q(ORG, HISTORY);

  if (shape.version) {
    const v = sql.q('version', HISTORY);
    const ty = sql.q('type', HISTORY);
    const nm = sql.q('name', HISTORY);
    const mcols = await columnsOf(run, OVERLAYS);
    const overlaysCarry = !!mcols?.has(ORG) && mcols.has('version');
    const lineages = await sql.read(
      HISTORY,
      `SELECT ${ty} AS t, ${nm} AS n, ${o} AS org, MIN(${v}) AS lo, MAX(${v}) AS hi FROM ${h} ` +
        `GROUP BY ${ty}, ${nm}, ${o} ORDER BY ${ty}, ${nm}, ${o}`,
    );
    const isEnv = (l: Record<string, unknown>): boolean => l.org === null || l.org === undefined || l.org === '';
    const byItem = new Map<string, Array<Record<string, unknown>>>();
    for (const l of lineages) {
      const key = `${String(l.t)}\u0000${String(l.n)}`;
      byItem.set(key, [...(byItem.get(key) ?? []), l]);
    }
    for (const group of byItem.values()) {
      const env = group.find(isEnv);
      const orgs = group.filter((l) => !isEnv(l));
      if (orgs.length === 0 || (!env && orgs.length === 1)) continue;
      // Above the environment's lineage; with none, the first organization keeps its numbers.
      let vbase = env ? num(env.hi) : num(orgs[0]!.hi);
      for (const l of env ? orgs : orgs.slice(1)) {
        const org = String(l.org);
        const shifted = await shiftRange(
          { min: num(l.lo), max: num(l.hi) },
          vbase,
          async (offset, oldMax) => {
            if (!overlaysCarry) return;
            const m = sql.q(OVERLAYS, OVERLAYS);
            const mv = sql.q('version', OVERLAYS);
            await execute(
              run,
              OVERLAYS,
              `UPDATE ${m} SET ${mv} = ${mv} + ? WHERE ${sql.q(ORG, OVERLAYS)} = ? AND ${sql.q('type', OVERLAYS)} = ? ` +
                `AND ${sql.q('name', OVERLAYS)} = ? AND ${mv} <= ?`,
              [offset, org, l.t, l.n, oldMax],
            );
          },
          async (offset) => {
            await execute(run, HISTORY, `UPDATE ${h} SET ${v} = ${v} + ? WHERE ${o} = ? AND ${ty} = ? AND ${nm} = ?`, [
              offset,
              org,
              l.t,
              l.n,
            ]);
          },
        );
        vbase = shifted.top;
        if (shifted.moved) summary.lineagesShifted++;
      }
    }
  }

  if (shape.seq) {
    const seq = sql.q('event_seq', HISTORY);
    const ccols = await columnsOf(run, COMMITS);
    const commitsCarry = !!ccols?.has(ORG) && ccols.has('event_seq_start') && ccols.has('event_seq_end');
    const envTop = num((await sql.read(HISTORY, `SELECT MAX(${seq}) AS m FROM ${h} WHERE ${o} IS NULL`))[0]?.m);
    const ranges = await sql.read(
      HISTORY,
      `SELECT ${o} AS org, MIN(${seq}) AS lo, MAX(${seq}) AS hi FROM ${h} WHERE ${o} IS NOT NULL GROUP BY ${o} ORDER BY ${o}`,
    );
    let base = envTop;
    for (const r of ranges) {
      const org = String(r.org);
      const shifted = await shiftRange(
        { min: num(r.lo), max: num(r.hi) },
        base,
        async (offset, oldMax) => {
          if (!commitsCarry) return;
          const c = sql.q(COMMITS, COMMITS);
          const s0 = sql.q('event_seq_start', COMMITS);
          const s1 = sql.q('event_seq_end', COMMITS);
          await execute(
            run,
            COMMITS,
            `UPDATE ${c} SET ${s0} = ${s0} + ?, ${s1} = ${s1} + ? WHERE ${sql.q(ORG, COMMITS)} = ? AND ${s0} <= ?`,
            [offset, offset, org, oldMax],
          );
        },
        async (offset) => {
          await execute(run, HISTORY, `UPDATE ${h} SET ${seq} = ${seq} + ? WHERE ${o} = ?`, [offset, org]);
        },
      );
      base = shifted.top;
      if (shifted.moved) summary.organizationsShifted++;
    }
  }
  // Under `single` the environment is the one tenant: what history is left
  // tagged to an organization (rows reported or deleted) becomes the
  // environment's too, so the door counts it and no later save collides.
  // Under a wall it stays its organization's, renumbered here on every apply.
  if (run.opts.posture === 'single') {
    const [left] = await sql.read(HISTORY, `SELECT COUNT(*) AS n FROM ${h} WHERE ${o} IS NOT NULL`);
    if (num(left?.n) > 0) {
      await execute(run, HISTORY, `UPDATE ${h} SET ${o} = NULL WHERE ${o} IS NOT NULL`, []);
      summary.folded = num(left?.n);
    }
    const ccols = await columnsOf(run, COMMITS);
    if (ccols?.has(ORG)) {
      const c = sql.q(COMMITS, COMMITS);
      await execute(run, COMMITS, `UPDATE ${c} SET ${sql.q(ORG, COMMITS)} = NULL WHERE ${sql.q(ORG, COMMITS)} IS NOT NULL`, []);
    }
  }
  if (summary.organizationsShifted || summary.lineagesShifted) {
    run.opts.onProgress?.(
      `history renumbered: ${summary.organizationsShifted} organization event range(s), ${summary.lineagesShifted} version lineage(s)`,
    );
  }
  return { step: 'history-renumber', status: 'done', summary, blockers: [], notes: [] };
}

// ── Step 2a: organization customizations and form withdrawals (rulings A) ──

const parseBody = (row: Record<string, unknown>): Record<string, unknown> | null => {
  const raw = row.metadata;
  try {
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    // A stored body names its item; the doors judge withdrawals by that name.
    return { ...(body as Record<string, unknown>), name: (body as Record<string, unknown>).name ?? row.name };
  } catch {
    return null;
  }
};

/** The served item's own package (`_packageId`), or `null` for a package-less item. */
const servedPackageOf = (item: Readonly<Record<string, unknown>>): string | null => {
  const pkg = item._packageId;
  return typeof pkg === 'string' && pkg !== '' && pkg !== METADATA_OBJECT ? pkg : null;
};

/** A served item as a body the door accepts: its runtime annotations (`_`-prefixed keys) dropped. */
const authoredBodyOf = (item: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_'))))) as Record<string, unknown>;

/**
 * Carry every organization-layer withdrawal onto the environment, fail-closed:
 * each view the environment serves (stored or from code, in every package)
 * whose name a withdrawing organization row shares, and which still serves the
 * withdrawn form open, takes the withdrawal (`sharing.enabled: false` on that
 * form), saved through the metadata door into its own package. The judgement
 * is the anonymous doors' own (`anonymousFormIntakeWithdrawnIn`), with the
 * organization rows as the layer: a 17.x organization row replaced the served
 * body whole, so its stored body is exactly what the doors judged.
 *
 * Under `single` a view whose own key an organization row holds is skipped:
 * that row is promoted in place (its withdrawal travels with it) or is a
 * conflict the operator resolves, and a door save there would make a conflict
 * of a promotion.
 */
async function carryFormWithdrawals(run: Run, rows: readonly MetadataKeyRow[], summary: Record<string, number>, blockers: string[]): Promise<void> {
  const t = METADATA_OBJECT;
  const sql = run.sql;
  const orgViews = rows.filter((r) => r.type === 'view' && r.organizationId !== null && (r.state ?? 'active') === 'active');
  if (orgViews.length === 0) return;
  const layerOf = new Map<string, Record<string, unknown>[]>();
  const ids = orgViews.map((r) => r.id);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const found = await sql.read(
      t,
      `SELECT ${['id', 'name', 'metadata'].map((c) => `${sql.q(c, t)} AS ${sql.q(c, t)}`).join(', ')} ` +
        `FROM ${sql.q(t, t)} WHERE ${sql.q('id', t)} IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    );
    for (const row of found) {
      const body = parseBody(row);
      if (body) layerOf.set(String(row.name), [...(layerOf.get(String(row.name)) ?? []), body]);
    }
  }
  if (layerOf.size === 0) return;
  const heldByOrganization = new Set(orgViews.map((r) => `${r.name}\u0000${r.packageId ?? ''}`));
  for (const served of await run.opts.views.list()) {
    const name = typeof served.name === 'string' ? served.name : undefined;
    const layer = name === undefined ? undefined : layerOf.get(name);
    if (!name || !layer) continue;
    const packageId = servedPackageOf(served);
    if (run.opts.posture === 'single' && heldByOrganization.has(`${name}\u0000${packageId ?? ''}`)) continue;
    const body = authoredBodyOf(served);
    const closing = anonymousFormIntakeCandidates(body).filter((c) => anonymousFormIntakeWithdrawnIn(layer, body, c));
    if (closing.length === 0) continue;
    for (const candidate of closing) {
      candidate.form.sharing = { ...(candidate.form.sharing as Record<string, unknown>), enabled: false };
    }
    try {
      await run.opts.door.save('view', name, body, { packageId });
      summary.withdrawalsCarried += closing.length;
      run.opts.onProgress?.(`carried ${closing.length} public-form withdrawal(s) onto the environment view ${name}`);
    } catch (error) {
      blockers.push(
        `An organization withdrew the public form(s) ${closing.map((c) => c.slug).join(', ')} of the view ${name}` +
          `${packageId ? ` (package ${packageId})` : ''}, and the metadata door refused to carry that withdrawal onto ` +
          `the environment: ${error instanceof Error ? error.message : String(error)}. Withdraw the form there ` +
          '(sharing.enabled false), then re-run. An upgrade never reopens a withdrawn form (ruling record 6020151485).',
      );
    }
  }
}

/** One conflict the operator chose a row for. */
interface MetadataResolution {
  conflict: MetadataConflict;
  chosen: MetadataConflict['candidates'][number];
}

/** The `metadata` bodies of the given `sys_metadata` rows, by id. */
async function metadataBodies(run: Run, ids: readonly string[]): Promise<Map<string, Record<string, unknown> | null>> {
  const t = METADATA_OBJECT;
  const sql = run.sql;
  const out = new Map<string, Record<string, unknown> | null>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const found = await sql.read(
      t,
      `SELECT ${['id', 'name', 'metadata'].map((c) => `${sql.q(c, t)} AS ${sql.q(c, t)}`).join(', ')} ` +
        `FROM ${sql.q(t, t)} WHERE ${sql.q('id', t)} IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    );
    for (const row of found) out.set(String(row.id), parseBody(row));
  }
  return out;
}

/**
 * Promote one organization's rows in place: each row's lineage becomes
 * environment history first ({@link foldLineage}), then its `organization_id`
 * is cleared. Conditioned on the owner, so a rerun promotes nothing twice.
 */
async function promoteRows(run: Run, organizationId: string, rows: ReadonlyArray<{ id: string; type: string; name: string }>): Promise<void> {
  const seen = new Set<string>();
  for (const row of rows) {
    const item = `${row.type}\u0000${row.name}`;
    if (seen.has(item)) continue;
    seen.add(item);
    await foldLineage(run, organizationId, row.type, row.name);
  }
  const t = run.sql.q(METADATA_OBJECT, METADATA_OBJECT);
  const org = run.sql.q(ORG, METADATA_OBJECT);
  const id = run.sql.q('id', METADATA_OBJECT);
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    await execute(
      run,
      METADATA_OBJECT,
      `UPDATE ${t} SET ${org} = NULL WHERE ${org} = ? AND ${id} IN (${chunk.map(() => '?').join(', ')})`,
      [organizationId, ...chunk],
    );
  }
}

/** The environment row of one overlay key, read by key (the doors' view of it). */
async function environmentRowOf(run: Run, conflict: MetadataConflict): Promise<Array<{ id: string; body: Record<string, unknown> | null }>> {
  const sql = run.sql;
  const t = METADATA_OBJECT;
  const cols = (await columnsOf(run, t)) ?? new Set<string>();
  const where = [`${sql.q(ORG, t)} IS NULL`, `${sql.q('type', t)} = ?`, `${sql.q('name', t)} = ?`];
  const params: unknown[] = [conflict.type, conflict.name];
  for (const [column, value] of [['package_id', conflict.packageId], ['bundle_member', conflict.bundleMember]] as const) {
    if (!cols.has(column)) continue;
    if (value === null) where.push(`(${sql.q(column, t)} IS NULL OR ${sql.q(column, t)} = '')`);
    else {
      where.push(`${sql.q(column, t)} = ?`);
      params.push(value);
    }
  }
  if (cols.has('state')) where.push(`${sql.q('state', t)} = 'active'`);
  const found = await sql.read(
    t,
    `SELECT ${['id', 'name', 'metadata'].map((c) => `${sql.q(c, t)} AS ${sql.q(c, t)}`).join(', ')} FROM ${sql.q(t, t)} ` +
      `WHERE ${where.join(' AND ')}`,
    params,
  );
  return found.map((row) => ({ id: String(row.id), body: parseBody(row) }));
}

/**
 * One `sys_metadata` row takes a body in place, by ONE statement, doing to the
 * row what the metadata door does on a save (its caller has asked the door's
 * lock gate first, before any write of the resolution); the row's
 * stored `_lock` family kept (the door never sets, changes or removes it,
 * ADR-0010 §3.5), whatever the body carries; and `checksum` restamped from the
 * written body (`hashSpec`, the door's own), which the repository serves as
 * the row's version and etag and the view save's no-op check compares. The
 * version moves too, when given and stored. Returns the body written.
 */
async function writeBody(
  run: Run,
  row: { id: string; stored: Readonly<Record<string, unknown>> | null | undefined },
  body: Record<string, unknown>,
  address: { type: string; name: string; packageId: string | null },
  version?: number,
): Promise<Record<string, unknown>> {
  const written: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('_lock')));
  for (const [k, v] of Object.entries(row.stored ?? {})) if (k.startsWith('_lock')) written[k] = v;
  const sql = run.sql;
  const t = METADATA_OBJECT;
  const cols = (await columnsOf(run, t)) ?? new Set<string>();
  const sets = [`${sql.q('metadata', t)} = ?`];
  const params: unknown[] = [JSON.stringify(written)];
  if (cols.has('checksum')) {
    sets.push(`${sql.q('checksum', t)} = ?`);
    params.push(hashSpec(written, address.type));
  }
  if (version !== undefined && cols.has('version')) {
    sets.push(`${sql.q('version', t)} = ?`);
    params.push(version);
  }
  await execute(run, t, `UPDATE ${sql.q(t, t)} SET ${sets.join(', ')} WHERE ${sql.q('id', t)} = ?`, [...params, row.id]);
  return written;
}

/** A `sys_metadata` row's stored version, when the table stores one. */
async function versionOf(run: Run, rowId: string): Promise<number | undefined> {
  const cols = (await columnsOf(run, METADATA_OBJECT)) ?? new Set<string>();
  if (!cols.has('version')) return undefined;
  const [row] = await run.sql.read(
    METADATA_OBJECT,
    `SELECT ${run.sql.q('version', METADATA_OBJECT)} AS v FROM ${run.sql.q(METADATA_OBJECT, METADATA_OBJECT)} WHERE ${run.sql.q('id', METADATA_OBJECT)} = ?`,
    [rowId],
  );
  const v = Number(row?.v);
  return Number.isFinite(v) ? v : undefined;
}

/** Two bodies define the same item (key order aside). */
const sameBody = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return definitionKey(a, keys) === definitionKey(b, keys);
};

/**
 * Resolve one chosen conflict so that the key holds exactly ONE environment
 * row at every point, and a rerun after a crash anywhere in it finishes it:
 *
 * 1. The body the environment keeps: the chosen row's, with every public-form
 *    withdrawal an unchosen row holds applied (fail-closed: a choice never
 *    reopens a form).
 * 2. Where the key has an environment row, that row takes the body in place,
 *    by one UPDATE, even when an organization's row was chosen: the chosen
 *    row's lineage becomes environment history first ({@link foldLineage}) and
 *    the environment row takes the chosen row's version, which names that
 *    body's snapshot. Where the key has none, the chosen organization row is
 *    promoted in place, its history with it. Not through the door: for an item
 *    a package ships, the door writes the environment's customization into that
 *    package's slot, never onto a package-less row of the key. A withdrawal the
 *    body keeps is then saved through the door as well, which records it in
 *    history and, for a packaged item, closes the form in the package's slot.
 * 3. The environment row is read back and must define that body.
 * 4. The choice is recorded in the checkpoint.
 * 5. Under `single`, the conflict's organization rows that remain are deleted,
 *    in ONE statement, by id (ruling B on #23413 Q1). Under a wall nothing is
 *    deleted: they stay organization rows, reported, and hold the column
 *    (ruling A on #23413 Q6).
 *
 * Returns a blocker, or `null` once resolved.
 */
async function resolveMetadataConflict(run: Run, r: MetadataResolution, notes: string[]): Promise<string | null> {
  const { conflict, chosen } = r;
  const sql = run.sql;
  const t = sql.q(METADATA_OBJECT, METADATA_OBJECT);
  const id = sql.q('id', METADATA_OBJECT);
  const what = `the ${conflict.type} ${conflict.name}${conflict.packageId ? ` (package ${conflict.packageId})` : ''}`;
  const others = conflict.candidates.filter((c) => c.id !== chosen.id);
  const bodies = await metadataBodies(run, conflict.candidates.map((c) => c.id));
  const chosenBody = bodies.get(chosen.id);
  if (!chosenBody) {
    return `The row ${chosen.id} chosen for ${what} has no readable body, so the environment cannot keep it. Choose another row, or repair it, then re-run.`;
  }
  const body = JSON.parse(JSON.stringify(chosenBody)) as Record<string, unknown>;
  let closing: string[] = [];
  if (conflict.type === 'view') {
    const layer = others.map((o) => bodies.get(o.id)).filter((b): b is Record<string, unknown> => !!b);
    const forms = anonymousFormIntakeCandidates(body).filter((c) => anonymousFormIntakeWithdrawnIn(layer, body, c));
    for (const candidate of forms) {
      candidate.form.sharing = { ...(candidate.form.sharing as Record<string, unknown>), enabled: false };
    }
    closing = forms.map((c) => c.slug);
  }

  const environment = await environmentRowOf(run, conflict);
  if (environment.length > 1) {
    return (
      `${what} has ${environment.length} active environment rows (${environment.map((e) => e.id).join(', ')}), so no ` +
      'single row can take the chosen body. Delete all but one, then re-run.'
    );
  }
  const env = environment[0];
  const address = { type: conflict.type, name: conflict.name, packageId: conflict.packageId };
  // The door's lock gate, asked ONCE and before any write of this resolution
  // (the history fold, the promotion, the in-place write): a locked item stays
  // locked, and a refusal leaves nothing written.
  const writes = env ? !(env.body && sameBody(env.body, body)) : chosen.organizationId !== null;
  if (writes) {
    const verdict = await run.opts.lock.verdict(address.type, address.name, address.packageId);
    if (!verdict.editable) {
      return (
        `${what} could not take the body of the chosen row ${chosen.id}: the item is locked (_lock=${verdict.lock ?? 'unknown'}` +
        `${verdict.lockReason ? `: ${verdict.lockReason}` : ''}), so the metadata door would refuse the write, and the ` +
        'ceremony does not make it. Nothing was written or deleted; unlock the item, or choose the row the environment ' +
        'already holds, then re-run.'
      );
    }
  }
  // The body the key's environment row must read back with: the chosen body, as written.
  let expected: Record<string, unknown> = env?.body && sameBody(env.body, body) ? env.body : body;
  try {
    if (!env) {
      if (chosen.organizationId !== null) {
        await promoteRows(run, chosen.organizationId, [{ id: chosen.id, type: conflict.type, name: conflict.name }]);
        if (closing.length) {
          expected = await writeBody(run, { id: chosen.id, stored: chosenBody }, body, address);
        }
      }
    } else if (!(env.body && sameBody(env.body, body))) {
      let version: number | undefined;
      if (chosen.organizationId !== null) {
        await foldLineage(run, chosen.organizationId, conflict.type, conflict.name);
        version = await versionOf(run, chosen.id);
      }
      expected = await writeBody(run, { id: env.id, stored: env.body }, body, address, version);
    }
    // The row as written (its stored lock family kept), so a rerun's door save meets the same body.
    if (closing.length) await run.opts.door.save(conflict.type as never, conflict.name, expected, { packageId: conflict.packageId });
  } catch (error) {
    return (
      `${what} could not take the body of the chosen row ${chosen.id}` +
      `${closing.length ? ` (with the public form(s) ${closing.join(', ')} an unchosen row withdraws, withdrawn)` : ''}: ` +
      `${error instanceof Error ? error.message : String(error)}. Nothing was deleted; fix the cause, then re-run.`
    );
  }
  const after = await environmentRowOf(run, conflict);
  if (after.length !== 1 || !after[0]!.body || !sameBody(after[0]!.body, expected)) {
    throw new Error(
      `${what} did not read back as one environment row defining the chosen row ${chosen.id}'s body; none of the ` +
        `rows ${others.map((o) => o.id).join(', ')} was deleted.`,
    );
  }
  if (run.checkpoint) {
    run.checkpoint.metadataChoicesApplied = [...new Set([...(run.checkpoint.metadataChoicesApplied ?? []), chosen.id])];
    await run.opts.ledger.write(run.checkpoint, { complete: false, blocking: 0, advisory: 0 });
  }

  const keeper = after[0]!.id;
  const leaving = conflict.candidates.filter((c) => c.organizationId !== null && c.id !== keeper).map((c) => c.id);
  if (run.opts.posture !== 'single') {
    for (const remaining of conflict.candidates.filter((c) => c.organizationId !== null && c.id !== keeper)) {
      notes.push(
        `Remaining: ${METADATA_OBJECT} row ${remaining.id} (organization ${remaining.organizationId}` +
          `${remaining.id === chosen.id ? `, the chosen row, whose body the environment row ${keeper} now holds` : ''}) ` +
          `of ${what} blocks column-drops on ${METADATA_OBJECT}: under the ${run.opts.posture} posture the ceremony ` +
          'never deletes it. Remedy: check the environment row, then delete this row yourself, or keep it and the ' +
          'column stays; re-run --apply.',
      );
    }
    run.opts.onProgress?.(`promotion: ${what} is defined by row ${chosen.id}'s body; nothing deleted under a wall`);
    return null;
  }
  if (leaving.length) {
    const where = `${id} IN (${leaving.map(() => '?').join(', ')})`;
    await execute(run, METADATA_OBJECT, `DELETE FROM ${t} WHERE ${where}`, leaving);
    if ((await sql.count(METADATA_OBJECT, `SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`, leaving)) !== 0) {
      throw new Error(`The delete of the organization rows of ${what} left rows behind.`);
    }
    run.deleted.set(METADATA_OBJECT, (run.deleted.get(METADATA_OBJECT) ?? 0) + leaving.length);
  }
  run.opts.onProgress?.(`promotion: ${what} is defined by row ${chosen.id}'s body; ${leaving.length} organization row(s) deleted`);
  return null;
}

async function runMetadataPromotion(run: Run): Promise<StepReport> {
  const summary: Record<string, number> = { withdrawalsCarried: 0, promoted: 0, conflicts: 0, chosen: 0, organizationRowsDeleted: 0, reported: 0 };
  const blockers: string[] = [];
  const notes: string[] = [];
  const cols = await columnsOf(run, METADATA_OBJECT);
  if (!cols?.has(ORG)) return { step: 'metadata-promotion', status: 'done', summary, blockers, notes };
  const rows = await readMetadataKeyRows(run.sql, METADATA_OBJECT, cols);
  const orgRows = rows.filter((r) => r.organizationId !== null);
  if (orgRows.length === 0) return { step: 'metadata-promotion', status: 'done', summary, blockers, notes };

  // Withdrawals first, under every posture: closing a form is never a leak.
  await carryFormWithdrawals(run, rows, summary, blockers);

  // Under a wall nothing is promoted unless the operator names the row
  // (--metadata-choice): one organization's customization is not the
  // environment's, and only a knowing choice makes it so (ruling A on #23413 Q6).
  const walled = run.opts.posture !== 'single';
  const choices = new Set(run.opts.metadataChoices ?? []);
  const { promotable, conflicts } = groupMetadataKeyRows(rows);

  const resolutions: MetadataResolution[] = [];
  let heldInConflicts = 0;
  for (const conflict of conflicts) {
    const chosen = conflict.candidates.find((c) => choices.has(c.id));
    if (chosen) {
      resolutions.push({ conflict, chosen });
      continue;
    }
    summary.conflicts++;
    const listing =
      `The ${conflict.type} ${conflict.name}` +
      `${conflict.packageId ? ` (package ${conflict.packageId})` : ''}${conflict.bundleMember ? ` [${conflict.bundleMember}]` : ''} ` +
      `is held by ${conflict.candidates.length} rows once the organization leaves its key: ` +
      conflict.candidates.map((c) => `${c.id} (${c.organizationId ? `organization ${c.organizationId}` : 'environment'}, ${c.state ?? 'no state'})`).join(', ');
    if (walled) {
      // Under a wall the organization rows stay where they are, reported;
      // they hold the column, and a choice promotes one knowingly.
      heldInConflicts += conflict.candidates.filter((c) => c.organizationId !== null).length;
      notes.push(`${listing}. Under the ${run.opts.posture} posture they stay organization rows; choose one with --metadata-choice ROW_ID to make it the environment's.`);
      continue;
    }
    blockers.push(
      `${listing}. Which one the environment keeps is never guessed: choose one with --metadata-choice ROW_ID, then re-run. ` +
        'The organization rows are deleted only once the environment row defines the chosen body and reads back' +
        (conflict.type === 'view' ? ', and a public form any of them withdraws stays withdrawn there.' : '.'),
    );
  }

  const lone = promotable.filter((row) => !walled || choices.has(row.id));
  const byOrganization = new Map<string, MetadataKeyRow[]>();
  for (const row of lone) byOrganization.set(row.organizationId!, [...(byOrganization.get(row.organizationId!) ?? []), row]);
  for (const [organizationId, own] of byOrganization) {
    await promoteRows(run, organizationId, own);
    summary.promoted += own.length;
  }
  for (const resolution of resolutions) {
    const deletedBefore = run.deleted.get(METADATA_OBJECT) ?? 0;
    const blocker = await resolveMetadataConflict(run, resolution, notes);
    if (blocker) {
      blockers.push(blocker);
      continue;
    }
    summary.chosen++;
    summary.organizationRowsDeleted += (run.deleted.get(METADATA_OBJECT) ?? 0) - deletedBefore;
  }

  if (walled) {
    const held = promotable.length - lone.length;
    summary.reported = held + heldInConflicts;
    if (held > 0) {
      notes.push(
        `${held} organization-scoped presentational ${METADATA_OBJECT} row(s) are reported, not promoted: under the ` +
          `${run.opts.posture} posture one organization's customization is not the environment's. Promote one ` +
          `knowingly with --metadata-choice ROW_ID; until then they keep the ${METADATA_OBJECT} column from being dropped.`,
      );
    }
  }
  if (summary.promoted) run.opts.onProgress?.(`promotion: ${summary.promoted} organization customization(s) are environment rows now`);
  return { step: 'metadata-promotion', status: blockers.length ? 'blocked' : 'done', summary, blockers, notes };
}

/**
 * Refuse, before anything is written, a `--metadata-choice` that names no row
 * awaiting a choice, or two candidates of one conflict. A row awaits a choice
 * when it is a candidate of a listed conflict or an organization's row its key
 * alone holds. So that a rerun after a crash finishes with the same flags, a
 * choice this ceremony already applied is accepted too: its row is now the
 * key's only environment row, or it is gone and the checkpoint records it.
 */
async function validateMetadataChoices(run: Run, applied: ReadonlySet<string>): Promise<void> {
  const choices = run.opts.metadataChoices ?? [];
  if (choices.length === 0) return;
  const cols = await columnsOf(run, METADATA_OBJECT);
  const rows = cols?.has(ORG) ? await readMetadataKeyRows(run.sql, METADATA_OBJECT, cols) : [];
  const { promotable, conflicts } = groupMetadataKeyRows(rows);
  const keyOf = (c: MetadataConflict): string =>
    `${c.type} ${c.name}${c.packageId ? ` (package ${c.packageId})` : ''}${c.bundleMember ? ` [${c.bundleMember}]` : ''}`;
  const groupOf = new Map<string, string>();
  for (const c of conflicts) for (const cand of c.candidates) groupOf.set(cand.id, keyOf(c));
  for (const row of promotable) groupOf.set(row.id, `the ${row.type} ${row.name} (row ${row.id})`);
  const present = new Set(rows.map((r) => r.id));
  const listed = conflicts.length
    ? conflicts.map((c) => `${keyOf(c)}: ${c.candidates.map((cand) => cand.id).join(', ')}`).join('; ')
    : 'none';
  const seen = new Map<string, string>();
  for (const id of choices) {
    const group = groupOf.get(id);
    if (!group) {
      const resolved = rows.some((r) => r.id === id && r.organizationId === null) || (applied.has(id) && !present.has(id));
      if (resolved) continue;
      throw new MetadataChoiceRefusal(
        `--metadata-choice ${id} names no row awaiting a choice. The conflicts are: ${listed}; or any organization ` +
          'row of a presentational type its key alone holds.',
      );
    }
    const other = seen.get(group);
    if (other !== undefined && other !== id) {
      throw new MetadataChoiceRefusal(`--metadata-choice ${other} and ${id} both choose for ${group}; choose exactly one row per conflict.`);
    }
    seen.set(group, id);
  }
}

// ── Step 2b: template promotion (ruling C) ──────────────────────────────────

async function runTemplatePromotion(run: Run): Promise<StepReport> {
  const summary: Record<string, number> = { promoted: 0, alreadyPromoted: 0, conflicts: 0 };
  const blockers: string[] = [];
  const notes: string[] = [];
  run.verifiedTemplateIds.clear();
  const cols = await columnsOf(run, TEMPLATES);
  if (!cols) return { step: 'template-promotion', status: 'done', summary, blockers, notes };
  const rows = await readAll(run, TEMPLATES, [...cols], templatePromotionSql(run.sql, cols));
  const { groups, nameless } = groupTemplateRows(rows);
  if (nameless.length) {
    blockers.push(
      `${nameless.length} customized or authored ${TEMPLATES} row(s) carry no name (${nameless.join(', ')}), so no ` +
        'environment template can hold them, and they are never deleted unpromoted. Name each row, or delete it, then re-run.',
    );
  }
  const choices = new Set(run.opts.templateChoices ?? []);
  for (const group of groups) {
    const { name, locale } = group;
    let body = group.bodies[0]!;
    if (group.conflict) {
      summary.conflicts++;
      const chosen = group.rows.findIndex((r) => choices.has(String(r.id)));
      if (chosen < 0) {
        blockers.push(
          `The template ${name} (${locale}) is held by ${group.rows.length} customized or authored rows that differ: ` +
            group.rows.map((r) => `${String(r.id)} (organization ${text(r.organization_id) ?? 'none'})`).join(', ') +
            '. Which one the environment keeps is never guessed: choose one with --template-choice ROW_ID, then re-run.',
        );
        continue;
      }
      body = group.bodies[chosen]!;
    }
    const existing = await run.opts.templates.find(name, locale);
    const saved = run.saved.get(`email_template|${name}|${locale}`);
    const current = saved ?? existing?.definition;
    if (current && bodyKey(current, Object.keys(body)) === bodyKey(body, Object.keys(body))) {
      summary.alreadyPromoted++;
      for (const r of group.rows) run.verifiedTemplateIds.add(String(r.id));
      continue;
    }
    if (existing?.environment && !saved) {
      blockers.push(
        `The environment already holds its own template ${name} (${locale}), and it differs from the customized row(s) ` +
          `${group.rows.map((r) => String(r.id)).join(', ')}. The environment's edit is never overwritten: carry the ` +
          'row\'s change into it in Studio (or delete the row), then re-run.',
      );
      continue;
    }
    try {
      await run.opts.door.save('email_template', name, body);
      run.saved.set(`email_template|${name}|${locale}`, body);
      for (const r of group.rows) run.verifiedTemplateIds.add(String(r.id));
      summary.promoted++;
      run.opts.onProgress?.(`promoted the template ${name} (${locale}) to environment metadata`);
    } catch (error) {
      blockers.push(
        `The metadata door refused the template ${name} (${locale}): ${error instanceof Error ? error.message : String(error)}. ` +
          'Correct the row so the definition validates, then re-run.',
      );
    }
  }
  return { step: 'template-promotion', status: blockers.length ? 'blocked' : 'done', summary, blockers, notes };
}

/**
 * Refuse, before anything is written, a `--template-choice` that names no
 * candidate row of a listed conflict, or two candidates of one conflict.
 */
function validateTemplateChoices(run: Run): void {
  const choices = run.opts.templateChoices ?? [];
  if (choices.length === 0) return;
  const conflicts = run.plan.tables.find((t) => t.object === TEMPLATES)?.templateConflicts ?? [];
  const groupOf = new Map<string, string>();
  for (const c of conflicts) for (const cand of c.candidates) groupOf.set(cand.id, `${c.name} (${c.locale})`);
  const listed = conflicts.length
    ? conflicts.map((c) => `${c.name} (${c.locale}): ${c.candidates.map((cand) => cand.id).join(', ')}`).join('; ')
    : 'none';
  const seen = new Map<string, string>();
  for (const id of choices) {
    const group = groupOf.get(id);
    if (!group) {
      throw new TemplateChoiceRefusal(
        `--template-choice ${id} names no candidate row of a listed template conflict. The conflicts are: ${listed}.`,
      );
    }
    const other = seen.get(group);
    if (other !== undefined && other !== id) {
      throw new TemplateChoiceRefusal(
        `--template-choice ${other} and ${id} both choose for the template ${group}; choose exactly one row per conflict.`,
      );
    }
    seen.set(group, id);
  }
}

// ── Step 2c: the settings global rung moves (D7) ────────────────────────────

async function runSettingsMove(run: Run): Promise<StepReport> {
  const summary: Record<string, number> = { moved: 0, alreadyMoved: 0 };
  const blockers: string[] = [];
  for (const entry of run.opts.inventory ?? [inventoryEntryFor(SETTINGS)!]) {
    for (const departure of entry?.departures ?? []) {
      const move = MOVES[departure.id];
      if (departure.as !== 'moved' || !move || entry.object !== move.from) continue;
      const fromCols = await columnsOf(run, move.from);
      if (!fromCols) continue;
      const selector = predicateSql(run.sql, move.from, fromCols, departure.where);
      // Only the environment's own rung moves: an organization's row is not global.
      const where = fromCols.has('organization_id')
        ? { text: `(${selector.text}) AND ${run.sql.q('organization_id', move.from)} IS NULL`, params: selector.params }
        : selector;
      const rows = await readAll(run, move.from, [...move.key, ...move.compare].filter((c) => fromCols.has(c)), where);
      if (rows.length === 0) continue;
      const toCols = await columnsOf(run, move.to);
      if (!toCols) {
        blockers.push(
          `${rows.length} ${move.from} row(s) move to ${move.to}, which this database does not have. Boot this release ` +
            'against it once (its schema sync creates the table), then re-run.',
        );
        continue;
      }
      const same = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
        move.compare.every((c) => JSON.stringify(a[c] ?? null) === JSON.stringify(b[c] ?? null));
      const keyOf = (r: Record<string, unknown>): string => move.key.map((k) => String(r[k])).join('.');
      const byKey = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) byKey.set(keyOf(row), [...(byKey.get(keyOf(row)) ?? []), row]);
      const shared = [...fromCols].filter((c) => toCols.has(c));
      const sql = run.sql;
      for (const [key, group] of byKey) {
        if (group.some((r) => !same(r, group[0]!))) {
          blockers.push(
            `${move.from} holds ${group.length} differing ${departure.id} rows for ${key} (${group.map((r) => String(r.id)).join(', ')}). ` +
              'Which value the deployment keeps is never guessed: delete all but one, then re-run.',
          );
          continue;
        }
        const readTarget = () =>
          readAll(run, move.to, move.compare.filter((c) => toCols.has(c)), {
            text: move.key.map((k) => `${sql.q(k, move.to)} = ?`).join(' AND '),
            params: move.key.map((k) => group[0]![k]),
          });
        const target = await readTarget();
        if (target.length > 0 && !same(target[0]!, group[0]!)) {
          blockers.push(
            `${move.to} already holds ${key} with a different value — the one the runtime serves — and the ${move.from} ` +
              `row(s) ${group.map((r) => String(r.id)).join(', ')} hold another. Delete the stale ${move.from} row(s) or ` +
              'align them, then re-run.',
          );
          continue;
        }
        if (target.length === 0) {
          const list = shared.map((c) => sql.q(c, move.to)).join(', ');
          await execute(
            run,
            move.to,
            `INSERT INTO ${sql.q(move.to, move.to)} (${list}) SELECT ${shared.map((c) => sql.q(c, move.from)).join(', ')} ` +
              `FROM ${sql.q(move.from, move.from)} WHERE ${sql.q('id', move.from)} = ?`,
            [group[0]!.id],
          );
          // The source leaves only once its destination row reads back equal.
          const landed = await readTarget();
          if (landed.length !== 1 || !same(landed[0]!, group[0]!)) {
            throw new Error(
              `The move of ${key} into ${move.to} did not read back equal; the ${move.from} row(s) ` +
                `${group.map((r) => String(r.id)).join(', ')} were kept.`,
            );
          }
          summary.moved++;
          run.movedIn.set(move.to, (run.movedIn.get(move.to) ?? 0) + 1);
        } else {
          summary.alreadyMoved++;
        }
        const ids = group.map((r) => r.id);
        await execute(
          run,
          move.from,
          `DELETE FROM ${sql.q(move.from, move.from)} WHERE (${where.text}) AND ${sql.q('id', move.from)} IN (${ids.map(() => '?').join(', ')})`,
          [...where.params, ...ids],
        );
        run.movedOut.set(move.from, (run.movedOut.get(move.from) ?? 0) + ids.length);
      }
      if (summary.moved) run.opts.onProgress?.(`settings move: ${summary.moved} ${departure.id} key(s) now in ${move.to}`);
    }
  }
  return { step: 'settings-move', status: blockers.length ? 'blocked' : 'done', summary, blockers, notes: [] };
}

// ── Step 3: the verified id→name rewrite (D4) ───────────────────────────────

interface Verification {
  /** Blockers: a reference that does not resolve by name, each with its remedy. */
  blockers: string[];
  notes: string[];
  grants: number;
  verified: number;
}

/**
 * [#23359] Of the grants still unnamed (`ids`), those the rewrite leaves
 * unnamed for one reason alone — their set row names a permission set the
 * security plugin ships, which the catalog does not resolve because the boot
 * did not compose that plugin — by that set's name, each with
 * {@link uncomposedSecurityRemedy}'s sentence. Which grants those are is the
 * rewrite's own decision (`planGrantRewrite`'s `unresolved` reason, over the
 * same set rows and catalog), so a grant unnamed for any other reason (no id, a
 * missing row, another organization's row) keeps the general blocker.
 */
async function unnamedForComposition(run: Run, ids: readonly string[]): Promise<Map<string, { ids: string[]; remedy: string }>> {
  const out = new Map<string, { ids: string[]; remedy: string }>();
  const grantCols = await columnsOf(run, GRANTS);
  const setCols = await columnsOf(run, SETS);
  if (!ids.length || run.opts.securityPlugin?.composed !== false || !setCols || !grantCols?.has('permission_set_id')) return out;
  const sets = new Map<string, LegacySetRow>();
  for (const row of await readAll(run, SETS, ['name', ...(setCols.has(ORG) ? [ORG] : [])])) {
    sets.set(String(row.id), { name: text(row.name), organizationId: text(row[ORG]) });
  }
  const unnamed = new Set(ids);
  const legacy = (await readAll(run, GRANTS, ['permission_set_id', 'user_id', ...(grantCols.has(ORG) ? [ORG] : [])]))
    .filter((g) => unnamed.has(String(g.id)))
    .map((g) => ({ id: String(g.id), userId: text(g.user_id), organizationId: text(g[ORG]), setId: text(g.permission_set_id) }));
  const resolvable = new Map<string, boolean>();
  for (const grant of legacy) {
    const name = grant.setId ? sets.get(grant.setId)?.name : null;
    if (name && !resolvable.has(name)) resolvable.set(name, (await resolveName(run, 'permission', name)) !== undefined);
  }
  const setNameOf = new Map(legacy.map((g) => [g.id, g.setId ? sets.get(g.setId)?.name : null]));
  for (const id of planGrantRewrite(legacy, [], sets, (name) => resolvable.get(name) === true).reasons.unresolved) {
    const name = setNameOf.get(id);
    const remedy = name ? await uncomposedSecurityRemedy(run, 'permission', name) : undefined;
    if (!name || remedy === undefined) continue;
    out.set(name, { ids: [...(out.get(name)?.ids ?? []), id], remedy });
  }
  return out;
}

/**
 * [#23542] The remedy for a `converted` binding — rows that bind position
 * `name` to sets its catalog definition does not name; `sets` is the
 * conversion's answer, the definition's sets followed by the ones the rows add
 * — when the gate refuses it under a wall. There no step carries binding rows:
 * `authored-conversion` reports and returns before it reads one (ADR-0131 D3,
 * the module doc), so pointing at that step points at nothing.
 *
 * The one act that clears the gate is a definition naming every bound set,
 * which the operator makes, through the door the position's definition lives
 * behind:
 *
 *  - undeclared: declare it with `sets`, in the deployment's code or through
 *    the metadata door as the platform administrator — one of the two only, as
 *    a cold boot refuses a name a package declares and the environment catalog
 *    also holds;
 *  - declared, and the metadata door reports it editable: add the missing sets
 *    to its `permissionSets` through that door;
 *  - declared, and not editable (ADR-0131 D6: a definition a package ships is
 *    sealed; or an ADR-0010 lock), or its state unreadable: the fact — the
 *    package that ships it, when the definition's provenance names one — and
 *    no act, because no door adds the sets.
 *
 * Whether it is editable is the metadata door's own answer
 * ({@link MetadataLockPort}), never inferred from the body; the body only
 * names the shipping package. The gate still refuses; nothing here writes.
 */
async function walledBindingRemedy(run: Run, name: string, sets: readonly string[]): Promise<string> {
  const why = `Under the ${run.opts.posture} posture no ceremony step carries binding rows (ADR-0131 D3).`;
  const door = `the metadata door as the platform administrator (PUT /api/v1/meta/position/${name})`;
  const entry = await resolveName(run, 'position', name);
  if (!entry) {
    return (
      `${why} Declare the position ${name} with permissionSets naming ${sets.join(', ')}, ` +
      `through one door only: the deployment's code (compiled into the artifact this ceremony boots), or ${door}. A ` +
      'cold boot refuses a position name a package declares and the environment catalog also holds. Then re-run.'
    );
  }
  let verdict: Awaited<ReturnType<MetadataLockPort['verdict']>>;
  try {
    verdict = await run.opts.lock.verdict('position', name, null);
  } catch (error) {
    return (
      `${why} Whether the metadata door can edit the definition of ${name} could not be read ` +
      `(${error instanceof Error ? error.message : String(error)}), so no act is named here.`
    );
  }
  if (!verdict.editable) {
    const lock = `lock ${verdict.lock ?? 'unknown'}${verdict.lockReason ? `: ${verdict.lockReason}` : ''}`;
    const { isCodeArtifactBody } = await import('@objectstack/metadata-core');
    const shipped = isCodeArtifactBody(entry.definition) ? String(entry.definition._packageId) : undefined;
    return shipped
      ? `${why} Package ${shipped} ships the definition of ${name}, which is sealed (ADR-0131 D6: the metadata door ` +
          `reports it not editable, ${lock}), so no door on this database adds those sets.`
      : `${why} The metadata door reports the definition of ${name} not editable (${lock}), so no door on this ` +
          'database adds those sets.';
  }
  const declared = Array.isArray(entry.definition.permissionSets) ? entry.definition.permissionSets.map(String) : [];
  const missing = sets.filter((set) => !declared.includes(set));
  return `${why} Add ${missing.join(', ')} to the permissionSets of the position ${name} through ${door}, then re-run.`;
}

/** Read-only: does every reference resolve by name? The gate of fate 2. */
async function verifyReferences(run: Run): Promise<Verification> {
  const out: Verification = { blockers: [], notes: [], grants: 0, verified: 0 };
  const cols = await columnsOf(run, GRANTS);
  if (cols) {
    if (!cols.has('permission_set')) {
      out.blockers.push(
        `${GRANTS} has no permission_set column, so no grant can name its set. Boot this release once against the ` +
          'database (its schema sync adds the column), then re-run.',
      );
      return out;
    }
    const setCols = await columnsOf(run, SETS);
    const setNames = new Map<string, string | null>();
    if (setCols) for (const row of await readAll(run, SETS, ['name'])) setNames.set(String(row.id), text(row.name));
    const grants = await readAll(run, GRANTS, ['permission_set', ...(cols.has('permission_set_id') ? ['permission_set_id'] : [])]);
    const resolved = new Map<string, boolean>();
    const unnamed: string[] = [];
    const unresolved = new Map<string, string[]>();
    const disagree: string[] = [];
    for (const grant of grants) {
      out.grants++;
      const name = text(grant.permission_set);
      if (!name) {
        unnamed.push(String(grant.id));
        continue;
      }
      if (!resolved.has(name)) resolved.set(name, (await resolveName(run, 'permission', name)) !== undefined);
      if (!resolved.get(name)) {
        unresolved.set(name, [...(unresolved.get(name) ?? []), String(grant.id)]);
        continue;
      }
      const id = text(grant.permission_set_id);
      if (id && setNames.has(id) && setNames.get(id) !== name) {
        disagree.push(String(grant.id));
        continue;
      }
      out.verified++;
    }
    const forComposition = await unnamedForComposition(run, unnamed);
    const held = new Set([...forComposition.values()].flatMap((g) => g.ids));
    const rest = unnamed.filter((id) => !held.has(id));
    if (rest.length) {
      out.blockers.push(
        `${rest.length} grant(s) still name no permission set (${rest.slice(0, 20).join(', ')}${rest.length > 20 ? ', …' : ''}). ` +
          'The rewrite could not derive their name (see its notes); name or remove each, then re-run.',
      );
    }
    for (const [name, { ids, remedy }] of forComposition) {
      out.blockers.push(
        `${ids.length} grant(s) still name no permission set (${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}): ` +
          `their set row is ${name}, which the security catalog does not resolve. ${remedy}`,
      );
    }
    for (const [name, ids] of unresolved) {
      out.blockers.push(
        `${ids.length} grant(s) name the permission set ${name}, which the security catalog does not resolve ` +
          `(${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}). ` +
          ((await uncomposedSecurityRemedy(run, 'permission', name)) ?? 'Declare or author the set, or remove the grants, then re-run.'),
      );
    }
    if (disagree.length) {
      out.blockers.push(
        `${disagree.length} grant(s) name a set other than the one their permission_set_id points at (${disagree.slice(0, 20).join(', ')}). ` +
          'Correct the name, then re-run.',
      );
    }
  }
  if (await columnsOf(run, BINDINGS)) {
    const rows = await readCatalogRows(run);
    const conversion = convertPositionBindingRows({
      positions: rows.positions,
      permissionSets: rows.sets,
      bindings: rows.bindings,
      declared: await declaredPositionSets(run, rows.positions.map((r) => String(r.name))),
    });
    for (const position of conversion.positions) {
      if (position.fate === 'declared') continue;
      out.blockers.push(
        position.fate === 'conflicting'
          ? `Position ${position.name}: organizations bind different permission sets to it; the bindings cannot be carried into one definition.`
          : `Binding rows give position ${position.name} sets its catalog definition does not name (${position.permissionSets.join(', ')}); ` +
            `deleting them would lose a grant. ${(await uncomposedSecurityRemedy(run, 'position', position.name)) ??
              (run.opts.posture === 'single'
                ? 'The authored-conversion step carries them; resolve its blocker, then re-run.'
                : await walledBindingRemedy(run, position.name, position.permissionSets))}`,
      );
    }
  }
  return out;
}

async function runRewrite(run: Run): Promise<StepReport> {
  const summary: Record<string, number> = { named: 0, grants: 0, verified: 0, collisions: 0 };
  const notes: string[] = [];
  const blockers: string[] = [];
  const cols = await columnsOf(run, GRANTS);
  if (cols?.has('permission_set') && cols.has('permission_set_id')) {
    const sets = new Map<string, LegacySetRow>();
    if (await columnsOf(run, SETS)) {
      const setCols = (await columnsOf(run, SETS))!;
      for (const row of await readAll(run, SETS, ['name', ...(setCols.has(ORG) ? [ORG] : [])])) {
        sets.set(String(row.id), { name: text(row.name), organizationId: text(row[ORG]) });
      }
    }
    const t = run.sql.q(GRANTS, GRANTS);
    const nameCol = run.sql.q('permission_set', GRANTS);
    const keyCols = ['user_id', ...(cols.has(ORG) ? [ORG] : [])];
    const unnamedWhere = { text: `${nameCol} IS NULL OR ${nameCol} = ''`, params: [] };
    const legacy = (await readAll(run, GRANTS, ['permission_set_id', ...keyCols], unnamedWhere)).map((g) => ({
      id: String(g.id),
      userId: text(g.user_id),
      organizationId: text(g[ORG]),
      setId: text(g.permission_set_id),
    }));
    const named = (await readAll(run, GRANTS, ['permission_set', ...keyCols], {
      text: `${nameCol} IS NOT NULL AND ${nameCol} <> ''`,
      params: [],
    })).map((g) => ({ id: String(g.id), userId: text(g.user_id), organizationId: text(g[ORG]), name: String(g.permission_set) }));
    const resolvable = new Map<string, boolean>();
    for (const legacyGrant of legacy) {
      const name = legacyGrant.setId ? sets.get(legacyGrant.setId)?.name : null;
      if (name && !resolvable.has(name)) resolvable.set(name, (await resolveName(run, 'permission', name)) !== undefined);
    }
    // A legacy grant whose name the user already holds in its organization is
    // never named: the unique index would refuse it (organization-ownership-grants.ts).
    const decided = planGrantRewrite(legacy, named, sets, (name) => resolvable.get(name) === true);
    for (const { id, name } of decided.name) {
      await execute(
        run,
        GRANTS,
        `UPDATE ${t} SET ${nameCol} = ? WHERE ${run.sql.q('id', GRANTS)} = ? AND (${nameCol} IS NULL OR ${nameCol} = '')`,
        [name, id],
      );
      summary.named++;
    }
    summary.collisions = decided.collisions.length;
    if (decided.collisions.length) blockers.push(grantCollisionBlocker(GRANTS, decided.collisions));
    const describe: Record<UnnamedReason, string> = {
      noId: 'carry neither a name nor a permission_set_id',
      dangling: 'point at a set row that does not exist',
      crossOrganization: 'point at another organization\'s set row — a name carries no organization, so it is never written',
      unresolved: 'point at a set row whose name the security catalog does not resolve',
    };
    for (const key of Object.keys(decided.reasons) as UnnamedReason[]) {
      const ids = decided.reasons[key];
      if (ids.length) notes.push(`${ids.length} unnamed grant(s) ${describe[key]}: ${ids.slice(0, 20).join(', ')}.`);
    }
    if (summary.named) run.opts.onProgress?.(`rewrite: ${summary.named} grant(s) now name their permission set`);
  }
  const verification = await verifyReferences(run);
  summary.grants = verification.grants;
  summary.verified = verification.verified;
  blockers.push(...verification.blockers);
  return {
    step: 'rewrite',
    status: blockers.length ? 'blocked' : 'done',
    summary,
    blockers,
    notes: [...notes, ...verification.notes],
  };
}

// ── Step 4: mirror deletion (fate 2) ─────────────────────────────────────────

/**
 * The rows of a fate-2 object that are deleted: its mirror selector (every
 * row when it names none), minus every row a claim keeps —
 *
 *  - each named category of the object (authored catalog rows, customized or
 *    organization-stamped templates awaiting promotion);
 *  - on a table that records provenance, every row no seeder wrote
 *    (`managed_by` NULL or not package / platform / system): an admin-authored
 *    row is never a copy of code, whatever the object's inventory row selects.
 *    It stays and is reported for the step that carries it.
 *
 * A claim that evaluates neither true nor false on a row (NULL) claims it:
 * an unknown is kept, never deleted.
 */
function deletableWhere(run: Run, table: string, cols: ReadonlySet<string>, entry: InventoryEntry): { text: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (entry.mirror) {
    const mirror = predicateSql(run.sql, table, cols, entry.mirror);
    parts.push(`(${mirror.text})`);
    params.push(...mirror.params);
  }
  const keep = (claimed: { text: string; params: unknown[] }): void => {
    parts.push(`(CASE WHEN ${claimed.text} THEN 1 WHEN NOT (${claimed.text}) THEN 0 ELSE 1 END) = 0`);
    params.push(...claimed.params, ...claimed.params);
  };
  // Templates: a mirror is a seeded, uncustomized copy (with an organization
  // or without); every promotion row is kept here, and is deleted only by id
  // once this run has verified its environment copy (`runMirrorDeletion`).
  if (entry.object === TEMPLATES) {
    keep(templatePromotionSql(run.sql, cols));
    return { text: parts.join(' AND '), params };
  }
  for (const category of entry.categories ?? []) {
    if (!category.where || category.conflictBy) continue;
    keep(predicateSql(run.sql, table, cols, category.where));
  }
  if (cols.has('managed_by')) {
    keep(predicateSql(run.sql, table, cols, [{ column: 'managed_by', notIn: SEEDED_BY }]));
  }
  return { text: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

const mirrorEntry = (run: Run, object: string): InventoryEntry | undefined =>
  (run.opts.inventory ? run.opts.inventory.find((e) => e.object === object) : inventoryEntryFor(object));

async function countWhere(run: Run, table: string, where: { text: string; params: unknown[] }): Promise<number> {
  return run.sql.count(table, `SELECT COUNT(*) AS n FROM ${run.sql.q(table, table)} WHERE ${where.text}`, where.params);
}

async function runMirrorDeletion(run: Run): Promise<StepReport> {
  // The gate, read again now: a grant written since the rewrite ran is a reference too.
  const gate = await verifyReferences(run);
  if (gate.blockers.length) {
    return {
      step: 'mirror-deletion',
      status: 'blocked',
      summary: { deleted: 0 },
      blockers: [`Mirror deletion is gated on every reference resolving by name, and it no longer does:`, ...gate.blockers],
      notes: [],
    };
  }
  // The promotion, run again now: on a resumed run its checkpoint says nothing
  // about a row customized or authored since, and only a row whose copy this
  // pass verifies may be deleted. It is idempotent: an equal copy is found.
  if (await columnsOf(run, TEMPLATES)) {
    const pass = await runTemplatePromotion(run);
    if (pass.status !== 'done') {
      return {
        step: 'mirror-deletion',
        status: 'blocked',
        summary: { deleted: 0 },
        blockers: ['Mirror deletion re-runs the template promotion first, and it no longer completes:', ...pass.blockers],
        notes: [],
      };
    }
  }
  const notes: string[] = [];
  let total = 0;
  for (const table of run.plan.tables) {
    if (table.fate !== 'mirror-deletion' || table.physical !== 'present') continue;
    const entry = mirrorEntry(run, table.object);
    if (!entry) continue;
    for (const physical of table.tables) {
      const cols = (await columnsOf(run, physical))!;
      const where = deletableWhere(run, physical, cols, entry);
      const before = await countWhere(run, physical, where);
      if (before === 0) continue;

      await execute(run, physical, `DELETE FROM ${run.sql.q(physical, physical)} WHERE ${where.text}`, where.params);
      const left = await countWhere(run, physical, where);
      if (left !== 0) {
        throw new Error(`The mirror delete on ${physical} left ${left} mirror row(s) behind; nothing past this table was deleted.`);
      }
      run.deleted.set(table.object, (run.deleted.get(table.object) ?? 0) + before);
      total += before;
      run.opts.onProgress?.(`mirror deletion: ${before} row(s) of ${physical}`);
    }
    if (table.object === TEMPLATES) total += await deletePromotedTemplates(run, table.tables);
    const kept = Math.max(0, table.rows!.total - (run.deleted.get(table.object) ?? 0));
    if (kept > 0) notes.push(`${table.object}: ${kept} row(s) are not mirrors (a named category or their non-seeded provenance claims them) and stay.`);
  }
  const underivable = await runUnderivableDeletion(run);
  total += underivable.deleted;
  if (underivable.blockers.length) {
    return { step: 'mirror-deletion', status: 'blocked', summary: { deleted: total }, blockers: underivable.blockers, notes };
  }
  const declared = await runDeclaredRuleMirrorDeletion(run);
  if (declared.status !== 'done') return { ...declared, summary: { ...declared.summary, deleted: total }, notes: [...notes, ...declared.notes] };
  return {
    step: 'mirror-deletion',
    status: 'done',
    summary: { ...declared.summary, deleted: total + (declared.summary.deleted ?? 0) },
    blockers: [],
    notes: [...notes, ...declared.notes],
  };
}

// ── Step 4, continued: the rows no anchor attributes (ruling record 6257510973 item 3) ─

/**
 * The NULL rows of a fate-3 table that declares an `underivableDeparture`
 * (`sys_activity`: activity is never a NULL row, and the existing ones are
 * deleted): once attribution has written every owner it derives, every row
 * still NULL is one of them. Read from a fresh plan, so the delete takes
 * exactly what that plan classifies: a table on which it still derives an
 * owner, or reports a row, blocks with nothing deleted. Never under `single`
 * ({@link underivableDepartureOf}).
 */
/** Whether the plan this run started from counts a row an `underivableDeparture` deletes. */
function underivableRowsDue(run: Run): boolean {
  return run.plan.tables.some((t) => {
    const entry = mirrorEntry(run, t.object);
    const id = entry ? underivableDepartureOf(entry, run.opts.posture)?.id : undefined;
    return id !== undefined && t.departures.some((d) => d.id === id && d.rows > 0);
  });
}

async function runUnderivableDeletion(run: Run): Promise<{ deleted: number; blockers: string[] }> {
  const declares = (object: string): string | undefined => {
    const entry = mirrorEntry(run, object);
    return entry ? underivableDepartureOf(entry, run.opts.posture)?.id : undefined;
  };
  if (!run.plan.tables.some((t) => t.physical === 'present' && declares(t.object))) return { deleted: 0, blockers: [] };
  const plan = await planFor(run);
  let deleted = 0;
  const blockers: string[] = [];
  for (const table of plan.tables) {
    const id = declares(table.object);
    const leaving = id ? table.departures.find((d) => d.id === id) : undefined;
    if (!leaving || leaving.rows === 0 || table.physical !== 'present') continue;
    const deriving = Number(table.fateCounts.rowsToAttribute ?? 0);
    if (deriving > 0 || table.unattributable.length > 0 || leaving.rows !== table.rows!.organizationNull) {
      blockers.push(
        `${table.object}: ${leaving.rows} row(s) no anchor attributes are due for deletion, but the table still holds ` +
          `${table.rows!.organizationNull} NULL row(s) (${deriving} an anchor attributes, ${table.unattributable.length} ` +
          'reported), so nothing was deleted. Re-run --apply: the attribution step runs again first.',
      );
      continue;
    }
    for (const physical of table.tables) {
      const { sql } = databaseFor(run, physical);
      const where = `${sql.q(ORG, physical)} IS NULL`;
      const count = (): Promise<number> => sql.count(physical, `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${where}`);
      const before = await count();
      if (before === 0) continue;
      await execute(run, physical, `DELETE FROM ${sql.q(physical, physical)} WHERE ${where}`, []);
      const left = await count();
      if (left !== 0) throw new Error(`The delete on ${physical} left ${left} organization-less row(s) behind; nothing past this table was deleted.`);
      run.deleted.set(table.object, (run.deleted.get(table.object) ?? 0) + before);
      deleted += before;
      run.opts.onProgress?.(`mirror deletion: ${before} organization-less row(s) of ${physical} no anchor attributes`);
    }
  }
  return { deleted, blockers };
}

// ── Step 4, continued: the declared sharing-rule mirrors (ADR-0131 C3 stage 9) ─

const SHARING_RULES = 'sys_sharing_rule';
const RECORD_SHARES = 'sys_record_share';
/** The inventory departure on `sys_sharing_rule` whose selector names the mirrors. */
const DECLARED_RULE_MIRRORS = 'declared-rule-mirrors';

/** One declared-rule mirror row, where it lives. */
interface DeclaredRuleMirror {
  id: string;
  name: string;
  table: string;
}

/**
 * Every `sys_sharing_rule` row the `declared-rule-mirrors` departure's selector
 * names (`managed_by` package or platform, not customized) — the copies of code
 * the retired seeder wrote: organization-less under `single` (the departure's
 * NULL rows), one per organization under a wall (#10103). Both are copies of
 * the same declaration, which the registry now serves in every scope, so both
 * go. A customized copy and an organization's own rule are not selected.
 */
async function readDeclaredRuleMirrors(run: Run): Promise<DeclaredRuleMirror[]> {
  const where = mirrorEntry(run, SHARING_RULES)?.departures?.find((d) => d.id === DECLARED_RULE_MIRRORS)?.where;
  const table = run.plan.tables.find((t) => t.object === SHARING_RULES);
  if (!where || !table || table.physical !== 'present') return [];
  const out: DeclaredRuleMirror[] = [];
  for (const physical of table.tables) {
    const cols = await columnsOf(run, physical);
    if (!cols?.has('name')) continue;
    const selector = predicateSql(databaseFor(run, physical).sql, physical, cols, where);
    for (const row of await readAll(run, physical, ['name'], selector)) {
      out.push({ id: String(row.id), name: typeof row.name === 'string' ? row.name : '', table: physical });
    }
  }
  return out;
}

/** Whether a declared-rule mirror stands that this release deletes (not while the departure is advisory). */
async function declaredRuleMirrorsDue(run: Run): Promise<boolean> {
  const departure = run.plan.tables.find((t) => t.object === SHARING_RULES)?.departures.find((d) => d.id === DECLARED_RULE_MIRRORS);
  return !departure?.advisory && (await readDeclaredRuleMirrors(run)).length > 0;
}

/** The grants (`source = 'rule'`) whose `source_id` is `sourceId`, on each physical grant table. */
async function countRuleGrants(run: Run, tables: readonly string[], sourceId: string): Promise<number> {
  let n = 0;
  for (const physical of tables) {
    const { sql } = databaseFor(run, physical);
    n += await sql.count(
      physical,
      `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${sql.q('source', physical)} = ? AND ${sql.q('source_id', physical)} = ?`,
      ['rule', sourceId],
    );
  }
  return n;
}

/**
 * [ADR-0131 C3 stage 9; ruling β on the C3 epic] Delete the declared-rule
 * mirrors — once enforcement reads declared rules from the registry, they are
 * copies nothing needs. In the ruled order:
 *
 *  1. Every grant naming a mirror must be able to name its rule instead: the
 *     mirror's name must resolve to a rule a package declares and the plugin
 *     serves (the registry through the plugin's own translation,
 *     {@link DeclaredSharingRulesPort}). A mirror whose rule no package
 *     declares any more, or whose declaration the plugin refuses to serve, and
 *     that grants still name, blocks — named, with the refusal's reason and the
 *     remedy, nothing written: deleting it would withdraw that access on the
 *     operator's behalf, and renaming its grants onto a refused rule would have
 *     the next boot's sweep withdraw it. One no grant names is a copy of
 *     nothing that grants nothing, and goes like every fate-2 mirror.
 *  2. Item 5 (c): every grant naming a mirror row by id
 *     (`sys_record_share.source_id`, `source = 'rule'`) is renamed to the
 *     rule's NAME — the id a declared rule's grants carry — BEFORE any mirror
 *     is deleted, so no standing access is orphaned. Then it is verified: no
 *     grant names a mirror row any more.
 *  3. The mirrors are deleted by id, the selector re-asserted, and counted to
 *     zero.
 *
 * Idempotent: a second run finds no mirror and writes nothing.
 */
async function runDeclaredRuleMirrorDeletion(run: Run): Promise<StepReport> {
  // While a release's boot still seeds them the departure is advisory and no
  // step removes them: the next boot would write them again.
  const departure = run.plan.tables.find((t) => t.object === SHARING_RULES)?.departures.find((d) => d.id === DECLARED_RULE_MIRRORS);
  const mirrors = departure?.advisory ? [] : await readDeclaredRuleMirrors(run);
  if (mirrors.length === 0) return { step: 'mirror-deletion', status: 'done', summary: {}, blockers: [], notes: [] };
  const blocked = (blockers: string[]): StepReport => ({ step: 'mirror-deletion', status: 'blocked', summary: { deleted: 0 }, blockers, notes: [] });

  if (!run.opts.declaredSharingRules) {
    return blocked([
      `${SHARING_RULES} holds ${mirrors.length} declared-rule mirror(s), deleted only once each name resolves to a ` +
        'rule a package declares, and this run has no registry to read the declared sharing rules from. Run the ' +
        'command against the deployment\'s own composition, then re-run.',
    ]);
  }
  const declaredRules = await run.opts.declaredSharingRules.rules();
  const served = new Set(declaredRules.filter((r) => r.refused === null).map((r) => r.name));
  const refusedFor = new Map<string, string>();
  for (const rule of declaredRules) {
    if (rule.refused !== null && !served.has(rule.name) && !refusedFor.has(rule.name)) refusedFor.set(rule.name, rule.refused);
  }

  const shares = run.plan.tables.find((t) => t.object === RECORD_SHARES);
  const grantTables: string[] = [];
  for (const physical of shares?.physical === 'present' ? shares.tables : []) {
    const cols = await columnsOf(run, physical);
    if (cols?.has('source') && cols.has('source_id')) grantTables.push(physical);
  }
  const grantsOf = new Map<string, number>();
  for (const mirror of mirrors) grantsOf.set(mirror.id, await countRuleGrants(run, grantTables, mirror.id));
  const unnameable = mirrors.filter((m) => !served.has(m.name) && grantsOf.get(m.id)! > 0);
  if (unnameable.length > 0) {
    const rowsOf = (list: readonly DeclaredRuleMirror[]): string => list.map((m) => m.id).sort().join(', ');
    const undeclared = unnameable.filter((m) => !refusedFor.has(m.name));
    const refused = unnameable.filter((m) => refusedFor.has(m.name));
    const blockers: string[] = [];
    if (undeclared.length > 0) {
      const names = [...new Set(undeclared.map((m) => m.name || '(no name)'))].sort();
      blockers.push(
        `${undeclared.length} declared-rule mirror(s) on ${SHARING_RULES} name a sharing rule no installed package ` +
          `declares (${names.join(', ')}; rows ${rowsOf(undeclared)}), and ${RECORD_SHARES} ` +
          'grants still name them. Their grants cannot be renamed to a rule the registry serves, and deleting the ' +
          'mirrors would withdraw that access, so they stay and nothing was written. Declare the rule in its package ' +
          `again, or delete each row and the ${RECORD_SHARES} rows whose source_id names it, then re-run.`,
      );
    }
    for (const name of [...new Set(refused.map((m) => m.name))].sort()) {
      const of = refused.filter((m) => m.name === name);
      blockers.push(
        `${of.length} declared-rule mirror(s) on ${SHARING_RULES} name the sharing rule ${name} (rows ${rowsOf(of)}), ` +
          `which its package declares but plugin-sharing does not serve: ${refusedFor.get(name)}. ${RECORD_SHARES} ` +
          'grants still name them; renamed onto the rule, the next boot\'s sweep would withdraw them as grants of a ' +
          'rule nobody serves, and deleting the mirrors would withdraw them now, so they stay and nothing was ' +
          `written. Correct the rule's declaration in its package so it is served, or delete each row and the ` +
          `${RECORD_SHARES} rows whose source_id names it, then re-run.`,
      );
    }
    return blocked(blockers);
  }

  // (c) — the grants first.
  let renamed = 0;
  for (const mirror of mirrors) {
    if (grantsOf.get(mirror.id) === 0) continue;
    for (const physical of grantTables) {
      const { sql } = databaseFor(run, physical);
      const n = await countRuleGrants(run, [physical], mirror.id);
      if (n === 0) continue;
      await execute(
        run,
        physical,
        `UPDATE ${sql.q(physical, physical)} SET ${sql.q('source_id', physical)} = ? ` +
          `WHERE ${sql.q('source', physical)} = ? AND ${sql.q('source_id', physical)} = ?`,
        [mirror.name, 'rule', mirror.id],
      );
      renamed += n;
    }
  }
  for (const mirror of mirrors) {
    const left = await countRuleGrants(run, grantTables, mirror.id);
    if (left !== 0) {
      throw new Error(
        `${left} grant(s) still name the declared-rule mirror ${mirror.id} (${mirror.name}) after the rename; no mirror was deleted.`,
      );
    }
  }
  if (renamed > 0) run.opts.onProgress?.(`declared-rule mirrors: ${renamed} grant(s) now name their rule`);

  // The mirrors, by id, the selector re-asserted.
  const where = mirrorEntry(run, SHARING_RULES)!.departures!.find((d) => d.id === DECLARED_RULE_MIRRORS)!.where;
  let deleted = 0;
  for (const physical of [...new Set(mirrors.map((m) => m.table))]) {
    const { sql } = databaseFor(run, physical);
    const cols = (await columnsOf(run, physical))!;
    const selector = predicateSql(sql, physical, cols, where);
    const ids = mirrors.filter((m) => m.table === physical).map((m) => m.id);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const byId = `${sql.q('id', physical)} IN (${chunk.map(() => '?').join(', ')})`;
      await execute(run, physical, `DELETE FROM ${sql.q(physical, physical)} WHERE ${byId} AND (${selector.text})`, [...chunk, ...selector.params]);
      const left = await sql.count(physical, `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${byId}`, chunk);
      if (left !== 0) throw new Error(`The declared-rule mirror delete on ${physical} left ${left} row(s) behind; nothing past it was deleted.`);
      deleted += chunk.length;
    }
  }
  run.deleted.set(SHARING_RULES, (run.deleted.get(SHARING_RULES) ?? 0) + deleted);
  run.opts.onProgress?.(`declared-rule mirrors: ${deleted} row(s) of ${SHARING_RULES} deleted`);
  return {
    step: 'mirror-deletion',
    status: 'done',
    summary: { deleted, grantsRenamed: renamed },
    blockers: [],
    notes: [`${SHARING_RULES}: ${deleted} declared-rule mirror(s) deleted; the registry serves those rules (ADR-0131 D2).`],
  };
}

/** Delete, by id, the promotion rows whose environment copy this run verified; nothing else. */
async function deletePromotedTemplates(run: Run, tables: readonly string[]): Promise<number> {
  const ids = [...run.verifiedTemplateIds];
  let deleted = 0;
  for (const physical of tables) {
    const id = run.sql.q('id', physical);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const where = { text: `${id} IN (${chunk.map(() => '?').join(', ')})`, params: chunk as unknown[] };
      const before = await countWhere(run, physical, where);
      if (before === 0) continue;
      await execute(run, physical, `DELETE FROM ${run.sql.q(physical, physical)} WHERE ${where.text}`, where.params);
      if ((await countWhere(run, physical, where)) !== 0) {
        throw new Error(`The delete of promoted template rows on ${physical} left rows behind; nothing past this table was deleted.`);
      }
      deleted += before;
    }
  }
  run.deleted.set(TEMPLATES, (run.deleted.get(TEMPLATES) ?? 0) + deleted);
  if (deleted) run.opts.onProgress?.(`mirror deletion: ${deleted} promoted template row(s), each with its environment copy`);
  return deleted;
}

// ── Step 5: column drops (fate 1) ────────────────────────────────────────────

/** The retired id column of a grant (ADR-0131 D4, C7b), which the rewrite reads before column-drops drops it. */
const GRANT_SET_ID_COLUMN = 'permission_set_id';
/**
 * The two indexes the retired column keyed (C7b). Schema sync is additive, so
 * they outlive their declaration, and they go BEFORE the column: MySQL refuses
 * to drop a column a key still uses, or keeps the key minus that column — a
 * unique (user_id, organization_id) that would refuse any second grant.
 */
const GRANT_SET_ID_INDEXES: readonly RetiredIndex[] = [
  { columns: ['user_id', 'permission_set_id', 'organization_id'], unique: true },
  { columns: ['permission_set_id'], unique: false },
];

async function runColumnDrops(run: Run): Promise<StepReport> {
  if (!run.historyVerified) {
    return {
      step: 'column-drops',
      status: 'blocked',
      summary: { dropped: 0, due: 0 },
      blockers: [
        'column-drops runs only after this apply\'s history-renumber verified sys_metadata_history\'s event_seq and ' +
          'versions unique environment-wide, and it did not. Re-run --apply.',
      ],
      notes: [],
    };
  }
  const plan = await planFor(run);
  const blockers: string[] = [];
  const due: ColumnDrop[] = [];
  for (const table of plan.tables) {
    if (table.fate !== 'column-drop' || table.physical !== 'present' || table.organizationColumn !== 'present') continue;
    const held = table.categories.filter((c) => c.rows > 0);
    if (held.length) {
      blockers.push(
        `${table.object}.${ORG} is not dropped: ${held.map((c) => `${c.rows} row(s) of "${c.label}"`).join('; ')}. ` +
          'Those rows need their own step before the column can go; resolve them, then re-run.',
      );
      continue;
    }
    due.push(...table.tables.map((t) => ({ table: t, column: ORG })));
  }
  // [C7b] The grant's retired id column: the rewrite (step 3) has read it and
  // verified every grant by name. It goes once no two grants hold one set for
  // one user in one organization — the unique index that replaces the old one
  // refuses them, and which to keep is the operator's call, never the ceremony's.
  if ((await columnsOf(run, GRANTS))?.has(GRANT_SET_ID_COLUMN)) {
    const duplicates = plan.tables.find((t) => t.object === GRANTS)?.grants?.duplicates;
    if (duplicates && duplicates.rows > 0) {
      blockers.push(
        `${GRANTS}.${GRANT_SET_ID_COLUMN} is not dropped: ${duplicates.rows} grant(s) in ${duplicates.groups} group(s) ` +
          'hold one permission set for one user in one organization, which the unique index on (user_id, ' +
          'permission_set, organization_id) refuses, and a revoke of one of them would leave the other in force. ' +
          'Which grant stays is never guessed and none is deleted here: remove all but one grant per group, then re-run.',
      );
    } else {
      due.push({ table: GRANTS, column: GRANT_SET_ID_COLUMN, retiredIndexes: GRANT_SET_ID_INDEXES });
    }
  }
  let dropped = 0;
  let notDeclared = 0;
  if (due.length) {
    for (const outcome of await run.opts.columnDrops.drop(due)) {
      if (outcome.outcome === 'dropped') {
        dropped++;
        continue;
      }
      if (outcome.outcome === 'not-declared') {
        notDeclared++;
        blockers.push(
          `${outcome.table}.${outcome.column} was not dropped: the composition this run booted declares no object for ` +
            `${outcome.table}, so the schema-drift ceremony has no declaration to drop it against, and no release ` +
            'changes that. Re-run the ceremony where the deployment\'s composition is declared: its project directory ' +
            'and environment (the requires capability whose provider declares this object; OS_AUTH_SECRET for the ' +
            'objects the auth family declares).',
        );
        continue;
      }
      blockers.push(
        outcome.outcome === 'not-proposed'
          ? `${outcome.table}.${outcome.column} was not proposed for dropping by the schema-drift ceremony: the object ` +
            `this runtime declares still carries the column${outcome.detail ? ` (${outcome.detail})` : ''}. Run the ` +
            'ceremony with the release whose declaration drops it.'
          : `Dropping ${outcome.table}.${outcome.column} failed: ${outcome.detail ?? 'no detail'}. Re-run once the cause is fixed.`,
      );
    }
  }
  return {
    step: 'column-drops',
    status: blockers.length ? 'blocked' : 'done',
    summary: { dropped, due: due.length, notDeclared },
    blockers,
    notes: [],
  };
}

// ── 18.x, shape generation 1: what an 18.0 database owes too ────────────────
//
// The four steps below select their rows BY SHAPE, never by `organization_id
// IS NULL`: an 18.0 single-posture database stamped every one of them with the
// Default Organization (line fact F3 of the 18.x plan), so a NULL selector
// would find nothing there and certify a database that still owes the step.

const WEBHOOKS = 'sys_webhook';
const DELIVERIES = 'sys_http_delivery';
const SECRETS = 'sys_secret';
const ACTIVATIONS = 'sys_metadata_activation';
const JOB_QUEUE = 'sys_job_queue';
const ACTIVITY = 'sys_activity';
/** The provenance a seeded copy of a declaration carries (`managed_by`). */
const SEEDED_PROVENANCE = ['package', 'platform'] as const;
/**
 * How a delivery names a declared webhook: plugin-webhooks'
 * `declaredWebhookRefId` (`declared:NAME`). Spelled here because the CLI does
 * not load the plugin to re-source rows; `organization-ownership-apply.declared-webhooks.test.ts`
 * holds the two equal.
 */
export const DECLARED_WEBHOOK_REF_PREFIX = 'declared:';
/** The `name` column's length on `sys_webhook` and `sys_sharing_rule`. */
const NAME_MAX = 100;
/** The stored form of an encrypted field's value: `secret:<sys_secret.id>` (objectql's `SECRET_REF_PREFIX`). */
const SECRET_REF_PREFIX = 'secret:';

const truthy = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true' || value === 't';

/** The physical tables of `object` the plan this run started from found present. */
function presentTables(run: Run, object: string): string[] {
  const table = run.plan.tables.find((t) => t.object === object);
  return table?.physical === 'present' ? table.tables : [];
}

const blockedStep = (step: CeremonyStep, summary: Record<string, number>, blockers: string[], notes: string[] = []): StepReport =>
  ({ step, status: 'blocked', summary, blockers, notes });

/**
 * Set the deployment's switch for a declared item — the `sys_metadata_activation`
 * row (ADR-0131 D14) keyed `(metadata_type, name)` — to `active`, read back.
 * `false` when the row already said so (nothing written).
 */
async function setActivation(run: Run, type: string, name: string, packageId: string | null, active: boolean): Promise<boolean> {
  const [table] = presentTables(run, ACTIVATIONS);
  if (!table) {
    throw new Error(
      `${ACTIVATIONS} does not exist on this database, so the switch of the declared ${type} ${name} cannot be written. ` +
        'Boot this release against it once (its schema sync creates the table), then re-run --apply.',
    );
  }
  const cols = (await columnsOf(run, table))!;
  const { sql } = databaseFor(run, table);
  const q = (c: string): string => sql.q(c, table);
  const read = (): Promise<Record<string, unknown>[]> =>
    sql.read(
      table,
      `SELECT ${q('id')} AS ${q('id')}, ${q('active')} AS ${q('active')} FROM ${q(table)} WHERE ${q('metadata_type')} = ? AND ${q('name')} = ?`,
      [type, name],
    );
  const [row] = await read();
  if (row && truthy(row.active) === active) return false;
  const at = (run.opts.now ?? (() => new Date()))().toISOString();
  if (row) {
    await execute(
      run,
      table,
      `UPDATE ${q(table)} SET ${q('active')} = ?${cols.has('updated_at') ? `, ${q('updated_at')} = ?` : ''} WHERE ${q('id')} = ?`,
      [sql.bind(active), ...(cols.has('updated_at') ? [at] : []), row.id],
    );
  } else {
    const values: Record<string, unknown> = {
      id: `act_${randomUUID()}`,
      metadata_type: type,
      name,
      package_id: packageId,
      active: sql.bind(active),
      created_at: at,
      updated_at: at,
    };
    const keys = Object.keys(values).filter((c) => cols.has(c));
    await execute(
      run,
      table,
      `INSERT INTO ${q(table)} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => values[k]),
    );
  }
  const [after] = await read();
  if (!after || truthy(after.active) !== active) {
    throw new Error(`The switch of the declared ${type} ${name} did not read back ${active ? 'on' : 'off'} in ${ACTIVATIONS}.`);
  }
  return true;
}

/**
 * A name for a clone: `<name>_custom`, then `_custom_2`, … — one no row of
 * `table` holds and no package declares (`taken`), within {@link NAME_MAX}.
 */
async function freeName(run: Run, table: string, base: string, taken: Set<string>): Promise<string> {
  const { sql } = databaseFor(run, table);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '_custom' : `_custom_${n}`;
    const name = `${base.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (taken.has(name)) continue;
    const held = await sql.count(table, `SELECT COUNT(*) AS n FROM ${sql.q(table, table)} WHERE ${sql.q('name', table)} = ?`, [name]);
    if (held === 0) {
      taken.add(name);
      return name;
    }
  }
}

// ── Step 2e: declared webhooks (18.x step 5a; ADR-0131 D2, D10 fate 2) ──────

/**
 * [ADR-0131 D2] The webhooks the deployment's packages DECLARE, by name, with
 * the package that declares each — what plugin-webhooks serves from the
 * registry (the command: the booted engine's registry, else the metadata
 * service).
 */
export interface DeclaredWebhooksPort {
  list(): Promise<ReadonlyArray<{ name: string; packageId: string | null }>>;
}

/** A `sys_webhook` row's `definition_json`, parsed, or `null`. */
function webhookDefinition(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = row.definition_json;
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const triggerList = (value: unknown): string => {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = [value];
    }
  }
  return JSON.stringify(Array.isArray(list) ? list.map(String).sort() : []);
};

/**
 * Whether a customized seeded webhook differs from the copy the 18.0 seeder
 * last wrote ONLY in its switch. `definition_json` is that copy: the seeder
 * rewrote it on every boot while the row was pristine, and the first edit
 * stopped it. Every column the seeder mapped from the envelope must still
 * read as the envelope says. A row holding a credential is never read as
 * switch-only: a stored secret cannot be compared without decrypting it, so it
 * is settled as a clone, which keeps it — the conservative reading.
 */
function isSwitchOnlyEdit(row: Record<string, unknown>): boolean {
  const def = webhookDefinition(row);
  if (!def) return false;
  if (text(row.headers_secret) !== null || text(row.signing_secret) !== null) return false;
  const same = (a: unknown, b: unknown): boolean => text(a) === text(b);
  return (
    same(row.label, def.label ?? def.name) &&
    same(row.object_name, def.object ?? null) &&
    triggerList(row.triggers) === triggerList(def.triggers) &&
    same(row.url, def.url) &&
    same(String(row.method ?? 'post').toLowerCase(), String(def.method ?? 'POST').toLowerCase()) &&
    same(row.description, def.description ?? null)
  );
}

const secretIdsOf = (row: Record<string, unknown>): string[] =>
  [row.headers_secret, row.signing_secret]
    .map((v) => (typeof v === 'string' && v.startsWith(SECRET_REF_PREFIX) ? v.slice(SECRET_REF_PREFIX.length) : ''))
    .filter((id) => id !== '');

/**
 * [18.x step 5a; ADR-0131 D2, D10 fate 2] Settle every `sys_webhook` row a
 * package's seeder wrote (`managed_by` `package` or `platform`) under a name a
 * package still declares — plugin-webhooks serves that declaration from the
 * registry, so the row is a copy:
 *
 *  - a PRISTINE copy (not `customized`) is deleted, after every delivery that
 *    names it (`sys_http_delivery.ref_id` = its row id) is re-sourced to the
 *    declaration (`declared:NAME`), so history and redelivery follow the
 *    declaration;
 *  - a copy customized only in its switch ({@link isSwitchOnlyEdit}) becomes
 *    the declaration's activation row with that switch (regime C, ruling Q2 A
 *    on the declared-webhook card: an activation row for an `active` change),
 *    its deliveries are re-sourced, and it is deleted;
 *  - a copy customized in anything else becomes a CLONE under a new name —
 *    renamed in place, `managed_by 'admin'`, so its id, its credentials and
 *    every delivery naming it stay its own (the deliveries' tail already names
 *    the clone's row id) — and the declaration is switched off.
 *
 * The `sys_secret` rows a deleted copy's credential columns referenced are
 * deleted with it, once no other webhook row references them. A seeded row
 * whose name no package declares any more is an ordinary webhook — it
 * dispatches as itself, as it did in 18.0 — and stays, reported.
 *
 * Under a wall the declaration's switch is deployment-wide (there is no
 * per-organization switch-off), so a customized copy is not settled on the
 * operator's behalf: it blocks, named, with the remedy. Idempotent: a second
 * run finds no seeded row under a declared name.
 */
async function runDeclaredWebhooks(run: Run): Promise<StepReport> {
  const step: CeremonyStep = 'declared-webhooks';
  const summary: Record<string, number> = { mirrorsDeleted: 0, activationRows: 0, clones: 0, deliveriesResourced: 0, secretsDeleted: 0, undeclaredKept: 0 };
  const notes: string[] = [];
  const [table] = presentTables(run, WEBHOOKS);
  const cols = table ? await columnsOf(run, table) : null;
  if (!table || !cols?.has('managed_by') || !cols.has('name')) return { step, status: 'done', summary, blockers: [], notes };
  const { sql } = databaseFor(run, table);
  const q = (c: string): string => sql.q(c, table);
  const seeded = predicateSql(sql, table, cols, [{ column: 'managed_by', in: SEEDED_PROVENANCE }]);
  const select = ['name', 'managed_by', 'customized', 'active', 'label', 'object_name', 'triggers', 'url', 'method', 'description', 'definition_json', 'headers_secret', 'signing_secret'];
  const rows = await readAll(run, table, select.filter((c) => cols.has(c)), seeded);
  if (rows.length === 0) return { step, status: 'done', summary, blockers: [], notes };

  if (!run.opts.declaredWebhooks) {
    return blockedStep(step, summary, [
      `${table} holds ${rows.length} row(s) a package's seeder wrote, settled only against the webhooks the ` +
        'deployment declares, and this run has no registry to read them from. Run the command against the ' +
        "deployment's own composition, then re-run.",
    ]);
  }
  const declared = new Map((await run.opts.declaredWebhooks.list()).map((d) => [d.name, d.packageId] as const));
  const held = rows.filter((r) => declared.has(String(r.name)));
  summary.undeclaredKept = rows.length - held.length;
  if (summary.undeclaredKept > 0) {
    notes.push(
      `${table}: ${summary.undeclaredKept} seeded row(s) name a webhook no installed package declares any more ` +
        `(${rows.filter((r) => !declared.has(String(r.name))).map((r) => String(r.id)).sort().join(', ')}). Each is an ` +
        'ordinary webhook — it dispatches as itself, as it did in 18.0 — and stays.',
    );
  }
  const customized = held.filter((r) => truthy(r.customized));
  if (customized.length > 0 && run.opts.posture !== 'single') {
    return blockedStep(step, summary, [
      `${table} holds ${customized.length} customized copy(ies) of a declared webhook ` +
        `(${customized.map((r) => `${String(r.id)} ${String(r.name)}`).sort().join(', ')}). Under the ${run.opts.posture} ` +
        'posture the declaration\'s switch is deployment-wide — there is no per-organization switch-off — so which ' +
        'organizations keep the declared webhook is not decided on the operator\'s behalf, and nothing was written. ' +
        'Rename each copy to a name no package declares (it becomes that organization\'s own webhook), or delete it; ' +
        'switch the declared webhook on or off through the activation door as the deployment wants; then re-run.',
    ], notes);
  }

  const deliveryTables: string[] = [];
  for (const physical of presentTables(run, DELIVERIES)) {
    const dcols = await columnsOf(run, physical);
    if (dcols?.has('source') && dcols.has('ref_id')) deliveryTables.push(physical);
  }
  const resource = async (from: string, to: string): Promise<number> => {
    let n = 0;
    for (const physical of deliveryTables) {
      const { sql: dsql } = databaseFor(run, physical);
      const where = `${dsql.q('source', physical)} = ? AND ${dsql.q('ref_id', physical)} = ?`;
      const count = (): Promise<number> => dsql.count(physical, `SELECT COUNT(*) AS n FROM ${dsql.q(physical, physical)} WHERE ${where}`, ['webhook', from]);
      const before = await count();
      if (before === 0) continue;
      await execute(run, physical, `UPDATE ${dsql.q(physical, physical)} SET ${dsql.q('ref_id', physical)} = ? WHERE ${where}`, [to, 'webhook', from]);
      const left = await count();
      if (left !== 0) throw new Error(`${left} delivery(ies) on ${physical} still name the webhook row ${from} after the re-source; nothing was deleted.`);
      n += before;
    }
    return n;
  };
  const deleteCopy = async (row: Record<string, unknown>): Promise<void> => {
    const where = `${q('id')} = ? AND (${seeded.text})`;
    await execute(run, table, `DELETE FROM ${q(table)} WHERE ${where}`, [row.id, ...seeded.params]);
    if ((await sql.count(table, `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q('id')} = ?`, [row.id])) !== 0) {
      throw new Error(`The declared-webhook copy ${String(row.id)} on ${table} was not deleted; nothing past it was.`);
    }
  };

  const orphaned: string[] = [];
  const taken = new Set(declared.keys());
  for (const row of held) {
    const name = String(row.name);
    const id = String(row.id);
    const def = webhookDefinition(row);
    const packageId = (typeof def?._packageId === 'string' && def._packageId ? def._packageId : null) ?? declared.get(name) ?? null;
    if (!truthy(row.customized) || isSwitchOnlyEdit(row)) {
      if (truthy(row.customized) && (await setActivation(run, 'webhook', name, packageId, truthy(row.active)))) summary.activationRows++;
      summary.deliveriesResourced += await resource(id, `${DECLARED_WEBHOOK_REF_PREFIX}${name}`);
      await deleteCopy(row);
      orphaned.push(...secretIdsOf(row));
      summary.mirrorsDeleted++;
      continue;
    }
    const clone = await freeName(run, table, name, taken);
    const { _provenance: _p, _packageId: _k, _packageVersion: _v, ...own } = def ?? {};
    const sets: Array<[string, unknown]> = [
      ['name', clone],
      ['managed_by', 'admin'],
      ...(cols.has('customized') ? [['customized', sql.bind(false)] as [string, unknown]] : []),
      ...(def && cols.has('definition_json') ? [['definition_json', JSON.stringify({ ...own, name: clone })] as [string, unknown]] : []),
    ];
    await execute(
      run,
      table,
      `UPDATE ${q(table)} SET ${sets.map(([c]) => `${q(c)} = ?`).join(', ')} WHERE ${q('id')} = ? AND (${seeded.text})`,
      [...sets.map(([, v]) => v), row.id, ...seeded.params],
    );
    const [landed] = await sql.read(table, `SELECT ${q('name')} AS ${q('name')} FROM ${q(table)} WHERE ${q('id')} = ?`, [row.id]);
    if (text(landed?.name) !== clone) throw new Error(`The clone of the declared webhook ${name} (${id}) did not read back as ${clone}.`);
    if (await setActivation(run, 'webhook', name, packageId, false)) summary.activationRows++;
    summary.clones++;
    notes.push(
      `${table} ${id}: customized beyond its switch, so it is now the administrator's own webhook ${clone} (its ` +
        `credentials and deliveries with it), and the declared ${name} is switched off.`,
    );
  }

  // The ciphers the deleted copies referenced, once nothing else does.
  const [secrets] = presentTables(run, SECRETS);
  if (secrets && orphaned.length > 0) {
    const { sql: ssql } = databaseFor(run, secrets);
    for (const secretId of [...new Set(orphaned)].sort()) {
      const ref = `${SECRET_REF_PREFIX}${secretId}`;
      const credentialCols = ['headers_secret', 'signing_secret'].filter((c) => cols.has(c));
      const still = credentialCols.length === 0
        ? 0
        : await sql.count(table, `SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${credentialCols.map((c) => `${q(c)} = ?`).join(' OR ')}`, credentialCols.map(() => ref));
      if (still > 0) continue;
      const where = `${ssql.q('id', secrets)} = ?`;
      const before = await ssql.count(secrets, `SELECT COUNT(*) AS n FROM ${ssql.q(secrets, secrets)} WHERE ${where}`, [secretId]);
      if (before === 0) continue;
      await execute(run, secrets, `DELETE FROM ${ssql.q(secrets, secrets)} WHERE ${where}`, [secretId]);
      summary.secretsDeleted += before;
    }
  }

  // Verified: no seeded row holds a declared name any more.
  const names = [...declared.keys()];
  for (let i = 0; i < names.length; i += IN_CHUNK) {
    const chunk = names.slice(i, i + IN_CHUNK);
    const left = await sql.count(
      table,
      `SELECT COUNT(*) AS n FROM ${q(table)} WHERE (${seeded.text}) AND ${q('name')} IN (${chunk.map(() => '?').join(', ')})`,
      [...seeded.params, ...chunk],
    );
    if (left !== 0) throw new Error(`${left} seeded ${table} row(s) still hold a declared webhook's name after the settlement.`);
  }
  run.deleted.set(WEBHOOKS, (run.deleted.get(WEBHOOKS) ?? 0) + summary.mirrorsDeleted);
  if (summary.deliveriesResourced > 0) {
    notes.push(
      `${DELIVERIES}: ${summary.deliveriesResourced} delivery(ies) now name their declared webhook (declared:NAME). A ` +
        'pending one keeps the partition it was enqueued under: it is still claimed and sent, by that partition\'s worker.',
    );
  }
  run.opts.onProgress?.(
    `declared webhooks: ${summary.mirrorsDeleted} copy(ies) deleted, ${summary.clones} cloned, ` +
      `${summary.deliveriesResourced} delivery(ies) re-sourced`,
  );
  return { step, status: 'done', summary, blockers: [], notes };
}

// ── Step 2d: the sibling moves (18.x step 5b; ADR-0131 D7) ──────────────────

/** One id-preserving move of deployment-level rows into the sibling that holds them now. */
interface SiblingMove {
  /** The inventory departure on `from` that names these rows. */
  id: string;
  from: string;
  to: string;
  /** The rows that move, by SHAPE — never by a NULL organization (F3). */
  where(sql: Sql, table: string, cols: ReadonlySet<string>): { text: string; params: unknown[] };
}

/**
 * The body of a magic-link mail: the sign-in URL better-auth's magic-link
 * plugin builds (`/magic-link/verify?token=`). An 18.0 magic-link row carries
 * no related record and no template column, so its link is the one structural
 * trace of what it is; every rendering of `auth.magic_link`, customized or
 * not, carries it, because the mail exists to deliver it.
 */
const MAGIC_LINK_BODY = '%/magic-link/verify?token=%';

export const SIBLING_MOVES: readonly SiblingMove[] = [
  {
    id: 'global-audit-move',
    from: 'sys_setting_audit',
    to: 'sys_platform_setting_audit',
    where: (sql, table, cols) => predicateSql(sql, table, cols, [{ column: 'scope', equals: 'global' }]),
  },
  {
    // Identity mail: mail ABOUT a person (reset, verification, account
    // invitation, change-email notice — `related_object = 'sys_user'`, the
    // four plugin-auth sites that name one) and the magic link, which names no
    // record. The organization invitation (`related_object = 'sys_invitation'`)
    // is tenant mail and stays.
    id: 'identity-mail-move',
    from: 'sys_email',
    to: 'sys_identity_email',
    where: (sql, table, cols) => {
      requireColumn(table, cols, 'related_object');
      const c = (name: string): string => sql.q(name, table);
      const bodies = ['body_text', 'body_html'].filter((b) => cols.has(b));
      const magic = bodies.length && cols.has('related_id')
        ? ` OR (${c('related_object')} IS NULL AND ${c('related_id')} IS NULL AND (${bodies.map((b) => `${c(b)} LIKE ?`).join(' OR ')}))`
        : '';
      return { text: `(${c('related_object')} = ?${magic})`, params: ['sys_user', ...(magic ? bodies.map(() => MAGIC_LINK_BODY) : [])] };
    },
  },
];

/** The mail queues whose 18.0 jobs name a `sys_email` row by id alone (plugin-email). */
const MAIL_JOB_QUEUES = ['email.send.async', 'email.attachment.reclaim'] as const;

/**
 * Before identity mail leaves `sys_email`: point every pending or running mail
 * job that names a moving row at the sibling. An 18.0 job carries `{ rowId }`
 * with no `object`, which its consumer reads as `sys_email` — a send would find
 * no row and never deliver, and an attachment reclaim would take the row-gone
 * branch and delete the mail's attachment content. The job gains
 * `object: 'sys_identity_email'`, in its payload and metadata, and its
 * idempotency key the sibling's spelling (`<object>:<id>`, `<object>_attachments:<id>`).
 */
async function rewriteMailJobs(run: Run, from: string, to: string, ids: ReadonlySet<string>): Promise<number> {
  let rewritten = 0;
  for (const physical of presentTables(run, JOB_QUEUE)) {
    const cols = await columnsOf(run, physical);
    if (!cols?.has('queue') || !cols.has('payload_json')) continue;
    const { sql } = databaseFor(run, physical);
    const q = (c: string): string => sql.q(c, physical);
    const statusClause = cols.has('status') ? ` AND ${q('status')} IN (?, ?)` : '';
    const jobs = await readAll(
      run,
      physical,
      ['payload_json', ...['metadata_json', 'idempotency_key'].filter((c) => cols.has(c))],
      {
        text: `${q('queue')} IN (${MAIL_JOB_QUEUES.map(() => '?').join(', ')})${statusClause}`,
        params: [...MAIL_JOB_QUEUES, ...(statusClause ? ['pending', 'running'] : [])],
      },
    );
    for (const job of jobs) {
      const payload = parseJsonObject(job.payload_json);
      const rowId = payload?.rowId;
      if (!payload || typeof rowId !== 'string' || !ids.has(rowId) || (payload.object !== undefined && payload.object !== from)) continue;
      const sets: Array<[string, unknown]> = [['payload_json', JSON.stringify({ ...payload, object: to })]];
      const metadata = parseJsonObject(job.metadata_json);
      if (metadata) sets.push(['metadata_json', JSON.stringify({ ...metadata, object: to })]);
      const key = text(job.idempotency_key);
      if (key?.startsWith(`${from}:`)) sets.push(['idempotency_key', `${to}:${key.slice(from.length + 1)}`]);
      else if (key?.startsWith(`${from}_attachments:`)) sets.push(['idempotency_key', `${to}_attachments:${key.slice(from.length + 13)}`]);
      await execute(run, physical, `UPDATE ${q(physical)} SET ${sets.map(([c]) => `${q(c)} = ?`).join(', ')} WHERE ${q('id')} = ?`, [...sets.map(([, v]) => v), job.id]);
      rewritten++;
    }
  }
  return rewritten;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

/**
 * [18.x step 5b; ADR-0131 D7] Move the deployment-level rows an 18.0 database
 * still keeps in a tenant table into the sibling this release writes them to
 * ({@link SIBLING_MOVES}): the settings audit trail's global rung
 * (`sys_setting_audit WHERE scope = 'global'` → `sys_platform_setting_audit`)
 * and identity mail (`sys_email` → `sys_identity_email`). Each row keeps its
 * id: it is copied (the columns both tables carry — never `organization_id`,
 * which the sibling does not have), read back, and only then deleted from its
 * old table, by id with its selector re-asserted. A row already in the sibling
 * (a run stopped between copy and delete) is not copied twice.
 *
 * Before identity mail moves, the mail jobs naming it are pointed at the
 * sibling ({@link rewriteMailJobs}). After each move, the activity timeline
 * rows about a moved row (`sys_activity.object_name`, every rotation shard)
 * name its new object, so the record's history follows it; the audit ledger
 * (`sys_audit_log`) is a ledger and is not rewritten.
 */
async function runSiblingMoves(run: Run): Promise<StepReport> {
  const step: CeremonyStep = 'sibling-moves';
  const summary: Record<string, number> = { moved: 0, alreadyMoved: 0, jobsRewritten: 0, activityRepointed: 0 };
  const blockers: string[] = [];
  for (const move of SIBLING_MOVES) {
    const [from] = presentTables(run, move.from);
    const fromCols = from ? await columnsOf(run, from) : null;
    if (!from || !fromCols) continue;
    const { sql } = databaseFor(run, from);
    const where = move.where(sql, from, fromCols);
    const ids = (await readAll(run, from, [], where)).map((r) => String(r.id));
    if (ids.length === 0) continue;
    const [to] = presentTables(run, move.to);
    const toCols = to ? await columnsOf(run, to) : null;
    if (!to || !toCols) {
      blockers.push(
        `${ids.length} ${move.from} row(s) move to ${move.to}, which this database does not have. Boot this release ` +
          'against it once (its schema sync creates the table), then re-run.',
      );
      continue;
    }
    const { sql: tsql } = databaseFor(run, to);
    const shared = [...fromCols].filter((c) => toCols.has(c) && c !== ORG);
    if (move.from === 'sys_email') summary.jobsRewritten += await rewriteMailJobs(run, move.from, move.to, new Set(ids));
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const inChunk = (s: Sql, table: string): string => `${s.q('id', table)} IN (${chunk.map(() => '?').join(', ')})`;
      const there = new Set(
        (await tsql.read(to, `SELECT ${tsql.q('id', to)} AS ${tsql.q('id', to)} FROM ${tsql.q(to, to)} WHERE ${inChunk(tsql, to)}`, chunk))
          .map((r) => String(r.id)),
      );
      const missing = chunk.filter((id) => !there.has(id));
      summary.alreadyMoved += chunk.length - missing.length;
      if (missing.length > 0) {
        const source = await sql.read(
          from,
          `SELECT ${shared.map((c) => `${sql.q(c, from)} AS ${sql.q(c, from)}`).join(', ')} FROM ${sql.q(from, from)} ` +
            `WHERE ${sql.q('id', from)} IN (${missing.map(() => '?').join(', ')})`,
          missing,
        );
        for (const row of source) {
          await execute(
            run,
            to,
            `INSERT INTO ${tsql.q(to, to)} (${shared.map((c) => tsql.q(c, to)).join(', ')}) VALUES (${shared.map(() => '?').join(', ')})`,
            shared.map((c) => row[c] ?? null),
          );
        }
      }
      // The source leaves only once every row reads back in the sibling.
      const landed = await tsql.count(to, `SELECT COUNT(*) AS n FROM ${tsql.q(to, to)} WHERE ${inChunk(tsql, to)}`, chunk);
      if (landed !== chunk.length) {
        throw new Error(`${chunk.length - landed} ${move.from} row(s) did not read back in ${move.to}; they were kept in ${move.from}.`);
      }
      summary.activityRepointed += await repointActivity(run, move.from, move.to, chunk);
      await execute(run, from, `DELETE FROM ${sql.q(from, from)} WHERE (${where.text}) AND ${inChunk(sql, from)}`, [...where.params, ...chunk]);
      const left = await sql.count(from, `SELECT COUNT(*) AS n FROM ${sql.q(from, from)} WHERE ${inChunk(sql, from)}`, chunk);
      if (left !== 0) throw new Error(`${left} moved ${move.from} row(s) were not removed after they read back in ${move.to}.`);
      summary.moved += missing.length;
      run.movedOut.set(move.from, (run.movedOut.get(move.from) ?? 0) + chunk.length);
      run.movedIn.set(move.to, (run.movedIn.get(move.to) ?? 0) + missing.length);
    }
    run.opts.onProgress?.(`sibling move: ${ids.length} ${move.from} row(s) now in ${move.to}`);
  }
  return { step, status: blockers.length ? 'blocked' : 'done', summary, blockers, notes: [] };
}

/** Point the activity rows about `ids` of `from` at `to` (every rotation shard); the count re-pointed. */
async function repointActivity(run: Run, from: string, to: string, ids: readonly string[]): Promise<number> {
  let n = 0;
  for (const physical of presentTables(run, ACTIVITY)) {
    const cols = await columnsOf(run, physical);
    if (!cols?.has('object_name') || !cols.has('record_id')) continue;
    const { sql } = databaseFor(run, physical);
    const where = `${sql.q('object_name', physical)} = ? AND ${sql.q('record_id', physical)} IN (${ids.map(() => '?').join(', ')})`;
    const count = (object: string): Promise<number> =>
      sql.count(physical, `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${where}`, [object, ...ids]);
    const before = await count(from);
    if (before === 0) continue;
    await execute(run, physical, `UPDATE ${sql.q(physical, physical)} SET ${sql.q('object_name', physical)} = ? WHERE ${where}`, [to, from, ...ids]);
    if ((await count(from)) !== 0) throw new Error(`Activity rows on ${physical} still name ${from} for a moved row after the re-point.`);
    n += before;
  }
  return n;
}

// ── Step 2f: the declared sharing rules' stored copies (18.x step 5c, 9c) ───

/**
 * [ADR-0131 C3 stage 9c; ruling A on the sharing-rule regime card, item 3]
 * Every `sys_sharing_rule` row that holds the name of a rule a package
 * declares — a CUSTOMIZED copy the retired seeder wrote, or an administrator's
 * rule a later package declaration collided with — answers for that name
 * today, while plugin-sharing withholds the declaration and reports it at
 * load. The regime is a clone under a new name plus the base switched off, so
 * each becomes exactly that, with what it grants unchanged:
 *
 *  - the row is renamed in place to a free name (`<name>_custom`, …) and owned
 *    by the administrator (`managed_by 'admin'`, not `customized`) — its id is
 *    unchanged, so every grant naming it (`sys_record_share.source_id`, a row
 *    id) stays its own;
 *  - the declaration is switched off: its `sys_metadata_activation` row
 *    (`sharing_rule`, NAME) says `active: false`, so it does not start granting
 *    beside its clone — the withholding the row caused, now recorded;
 *  - grants still naming the declaration itself (`source_id` = NAME) are
 *    removed, as the switch's own reconcile would remove them.
 *
 * The UNCUSTOMIZED copies are not touched here: they are mirrors, deleted by
 * the mirror-deletion step once their grants name the rule. Under a wall the
 * switch is deployment-wide (ruling A item 1: no per-organization switch-off),
 * so the copies block, named, instead of switching a rule off for every
 * organization on the operator's behalf. Idempotent: a second run finds no
 * row under a declared name.
 */
async function runDeclaredRuleCopies(run: Run): Promise<StepReport> {
  const step: CeremonyStep = 'declared-rule-copies';
  const summary: Record<string, number> = { clones: 0, activationRows: 0, grantsRemoved: 0 };
  const notes: string[] = [];
  const tables: Array<{ physical: string; cols: ReadonlySet<string> }> = [];
  for (const physical of presentTables(run, SHARING_RULES)) {
    const cols = await columnsOf(run, physical);
    if (cols?.has('name')) tables.push({ physical, cols });
  }
  if (tables.length === 0) return { step, status: 'done', summary, blockers: [], notes };

  // A copy is a row that is not a pristine mirror.
  const copyWhere = (physical: string, cols: ReadonlySet<string>): { text: string; params: unknown[] } => {
    const { sql } = databaseFor(run, physical);
    if (!cols.has('managed_by')) return { text: '1 = 1', params: [] };
    const mirror = predicateSql(sql, physical, cols, cols.has('customized')
      ? [{ column: 'managed_by', in: SEEDED_PROVENANCE }, { column: 'customized', notTrue: true }]
      : [{ column: 'managed_by', in: SEEDED_PROVENANCE }]);
    return { text: `(CASE WHEN ${mirror.text} THEN 1 WHEN NOT (${mirror.text}) THEN 0 ELSE 1 END) = 0`, params: [...mirror.params, ...mirror.params] };
  };
  if (!run.opts.declaredSharingRules) {
    let customized = 0;
    for (const { physical, cols } of tables) {
      if (!cols.has('customized') || !cols.has('managed_by')) continue;
      const { sql } = databaseFor(run, physical);
      const where = predicateSql(sql, physical, cols, [{ column: 'managed_by', in: SEEDED_PROVENANCE }, { column: 'customized', equals: true }]);
      customized += await sql.count(physical, `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${where.text}`, where.params);
    }
    if (customized === 0) return { step, status: 'done', summary, blockers: [], notes };
    return blockedStep(step, summary, [
      `${SHARING_RULES} holds ${customized} customized copy(ies) of a declared sharing rule, settled only against the ` +
        'rules the deployment declares, and this run has no registry to read them from. Run the command against the ' +
        "deployment's own composition, then re-run.",
    ]);
  }
  const declared = await run.opts.declaredSharingRules.rules();
  const packageOf = new Map(declared.map((r) => [r.name, r.packageId ?? null] as const));
  const names = [...packageOf.keys()];
  if (names.length === 0) return { step, status: 'done', summary, blockers: [], notes };

  const copies: Array<{ physical: string; cols: ReadonlySet<string>; id: string; name: string }> = [];
  for (const { physical, cols } of tables) {
    const { sql } = databaseFor(run, physical);
    const copy = copyWhere(physical, cols);
    for (let i = 0; i < names.length; i += IN_CHUNK) {
      const chunk = names.slice(i, i + IN_CHUNK);
      const rows = await readAll(run, physical, ['name'], {
        text: `(${copy.text}) AND ${sql.q('name', physical)} IN (${chunk.map(() => '?').join(', ')})`,
        params: [...copy.params, ...chunk],
      });
      for (const row of rows) copies.push({ physical, cols, id: String(row.id), name: String(row.name) });
    }
  }
  if (copies.length === 0) return { step, status: 'done', summary, blockers: [], notes };
  if (run.opts.posture !== 'single') {
    return blockedStep(step, summary, [
      `${SHARING_RULES} holds ${copies.length} stored rule(s) under the name of a rule a package declares ` +
        `(${copies.map((c) => `${c.id} ${c.name}`).sort().join(', ')}). Under the ${run.opts.posture} posture the ` +
        'declaration\'s switch is deployment-wide — there is no per-organization switch-off — so it is not switched ' +
        'off for every organization on the operator\'s behalf, and nothing was written. Rename each row to a name no ' +
        'package declares (it stays that organization\'s own rule), switch the declared rule on or off through the ' +
        'activation door as the deployment wants, then re-run.',
    ]);
  }

  const shares: string[] = [];
  for (const physical of presentTables(run, RECORD_SHARES)) {
    const cols = await columnsOf(run, physical);
    if (cols?.has('source') && cols.has('source_id')) shares.push(physical);
  }
  const taken = new Set(names);
  for (const copy of copies) {
    const { sql } = databaseFor(run, copy.physical);
    const q = (c: string): string => sql.q(c, copy.physical);
    const clone = await freeName(run, copy.physical, copy.name, taken);
    const sets: Array<[string, unknown]> = [
      ['name', clone],
      ...(copy.cols.has('managed_by') ? [['managed_by', 'admin'] as [string, unknown]] : []),
      ...(copy.cols.has('customized') ? [['customized', sql.bind(false)] as [string, unknown]] : []),
    ];
    await execute(
      run,
      copy.physical,
      `UPDATE ${q(copy.physical)} SET ${sets.map(([c]) => `${q(c)} = ?`).join(', ')} WHERE ${q('id')} = ? AND ${q('name')} = ?`,
      [...sets.map(([, v]) => v), copy.id, copy.name],
    );
    const [landed] = await sql.read(copy.physical, `SELECT ${q('name')} AS ${q('name')} FROM ${q(copy.physical)} WHERE ${q('id')} = ?`, [copy.id]);
    if (text(landed?.name) !== clone) throw new Error(`The clone of the declared sharing rule ${copy.name} (${copy.id}) did not read back as ${clone}.`);
    summary.clones++;
    notes.push(`${SHARING_RULES} ${copy.id}: now the rule ${clone}, its grants with it; the declared ${copy.name} is switched off.`);
  }
  for (const name of [...new Set(copies.map((c) => c.name))].sort()) {
    if (await setActivation(run, 'sharing_rule', name, packageOf.get(name) ?? null, false)) summary.activationRows++;
    for (const physical of shares) {
      const { sql } = databaseFor(run, physical);
      const where = `${sql.q('source', physical)} = ? AND ${sql.q('source_id', physical)} = ?`;
      const count = (): Promise<number> => sql.count(physical, `SELECT COUNT(*) AS n FROM ${sql.q(physical, physical)} WHERE ${where}`, ['rule', name]);
      const before = await count();
      if (before === 0) continue;
      await execute(run, physical, `DELETE FROM ${sql.q(physical, physical)} WHERE ${where}`, ['rule', name]);
      if ((await count()) !== 0) throw new Error(`Grants of the switched-off declared rule ${name} were left on ${physical}.`);
      summary.grantsRemoved += before;
    }
  }
  run.opts.onProgress?.(`declared sharing rules: ${summary.clones} stored copy(ies) now clones, their declarations switched off`);
  return { step, status: 'done', summary, blockers: [], notes };
}

// ── Step 6: organization_id NOT NULL (18.x step 5d, 8e) ─────────────────────

/** One NOT NULL the ceremony applies: the tenant column of a table it cleared. */
export interface NotNullColumn {
  table: string;
  column: string;
  /** The database beside the primary that holds the table (`ApplySibling.name`); absent for the primary. */
  database?: string;
}

/** One NOT NULL, as the schema door answered it. */
export interface NotNullOutcome extends NotNullColumn {
  /**
   * `applied`; `already-not-null` — the column is NOT NULL already (a
   * rotation shard the driver created so), nothing to do; `not-declared` — the
   * composition this run booted declares no object for the table, so nothing
   * rebuilds it against a declaration; `unsupported` — the datasource's
   * transport cannot apply it (the Turso remote face cannot rebuild a table),
   * or the table is a rotation shard created nullable; `failed`.
   */
  outcome: 'applied' | 'already-not-null' | 'not-declared' | 'unsupported' | 'failed';
  detail?: string;
}

/**
 * Applies NOT NULL to a tenant column through the schema-drift ceremony's own
 * apply (ADR-0120 D4), never a hand `ALTER`: on SQLite the table rebuild, on
 * PostgreSQL / MySQL `ALTER COLUMN … SET NOT NULL`. The differ owns no
 * proposal for it — the column's nullability is the ceremony's (ruling record
 * 6269955919 on the v18 epic, ② A), and the differ reads it as no drift.
 */
export interface NotNullPort {
  apply(columns: readonly NotNullColumn[]): Promise<NotNullOutcome[]>;
}

/**
 * [18.x step 5d; ADR-0131 8e; ruling ② A] After the column drops, every table
 * whose fate keeps `organization_id` and whose post-step plan reads it ready
 * for NOT NULL (`TablePlan.notNull.willReceive`, zero NULL rows) receives it,
 * on every physical table (rotation shards included). The ceremony owns that
 * nullability; no metadata says it.
 *
 * A table the plan does not clear — rows still NULL and reported, a fate-4
 * table whose column is not the tenancy anchor — is not touched and its reason
 * is reported. A run with no schema door (`notNull` absent) applies nothing
 * and says so; the command always passes one. A transport that cannot apply
 * it is reported, never certified as applied; any other failure blocks.
 */
async function runNotNull(run: Run): Promise<StepReport> {
  const step: CeremonyStep = 'not-null';
  const summary: Record<string, number> = { applied: 0, alreadyNotNull: 0, due: 0, notDeclared: 0, unsupported: 0 };
  const blockers: string[] = [];
  const notes: string[] = [];
  const plan = await planFor(run);
  const due: NotNullColumn[] = [];
  for (const table of plan.tables) {
    if (table.fate !== 'attribution' && table.fate !== 'report') continue;
    if (table.physical !== 'present' || table.organizationColumn !== 'present' || !table.rows) continue;
    if (!table.notNull.willReceive || table.rows.organizationNull !== 0) continue;
    due.push(...table.tables.map((t) => ({ table: t, column: ORG, ...(table.database ? { database: table.database } : {}) })));
  }
  summary.due = due.length;
  if (due.length === 0) return { step, status: 'done', summary, blockers, notes };
  if (!run.opts.notNull) {
    notes.push(`${due.length} table(s) are ready for NOT NULL on ${ORG}, and this run has no schema door to apply it: nothing was applied.`);
    return { step, status: 'done', summary, blockers, notes };
  }
  for (const outcome of await run.opts.notNull.apply(due)) {
    if (outcome.outcome === 'applied') summary.applied++;
    else if (outcome.outcome === 'already-not-null') summary.alreadyNotNull++;
    else if (outcome.outcome === 'not-declared') {
      summary.notDeclared++;
      notes.push(
        `${outcome.table}.${outcome.column} stays nullable: the composition this run booted declares no object for ` +
          `${outcome.table}. Its rows hold no NULL; re-run the ceremony where the deployment's composition is declared to apply it.`,
      );
    } else if (outcome.outcome === 'unsupported') {
      summary.unsupported++;
      notes.push(`${outcome.table}.${outcome.column} stays nullable: ${outcome.detail ?? 'this transport cannot apply NOT NULL'}.`);
    } else {
      blockers.push(`NOT NULL on ${outcome.table}.${outcome.column} failed: ${outcome.detail ?? 'no detail'}. Re-run once the cause is fixed.`);
    }
  }
  if (summary.applied) run.opts.onProgress?.(`not null: ${summary.applied} table(s) now hold ${ORG} NOT NULL`);
  return { step, status: blockers.length ? 'blocked' : 'done', summary, blockers, notes };
}

// ── The run ──────────────────────────────────────────────────────────────────

const RUNNERS: Record<CeremonyStep, (run: Run) => Promise<StepReport>> = {
  attribution: runAttribution,
  'authored-conversion': runAuthoredConversion,
  'metadata-promotion': runMetadataPromotion,
  'template-promotion': runTemplatePromotion,
  'settings-move': runSettingsMove,
  'sibling-moves': runSiblingMoves,
  'declared-webhooks': runDeclaredWebhooks,
  'declared-rule-copies': runDeclaredRuleCopies,
  rewrite: runRewrite,
  'mirror-deletion': runMirrorDeletion,
  'history-renumber': runHistoryRenumber,
  'column-drops': runColumnDrops,
  'not-null': runNotNull,
};

/**
 * NULL rows a departure still has to carry out of the table. An advisory
 * departure's rows are not among them: no step of this release removes them
 * (`PlannedDeparture.advisory`), so they are counted as advisory instead.
 */
const departingRows = (table: TablePlan): number => table.departures.reduce((n, d) => n + (d.advisory ? 0 : d.rows), 0);

/** NULL rows of the table's advisory departures: reported, never held against the verdict. */
const advisoryRows = (table: TablePlan): number => table.departures.reduce((n, d) => n + (d.advisory ? d.rows : 0), 0);

/**
 * What the operator does about a row whose owner cannot be derived (ADR-0131
 * D10 fate 4; ruling C on the C8 decision). The ceremony does neither itself.
 */
export const UNATTRIBUTABLE_REMEDY =
  'assign each row its organization (write its organization_id, or repair the anchor its reason names), or delete ' +
  'it by hand, then re-run --apply; the ceremony never guesses an owner and never deletes such a row, and the ' +
  'database does not certify while one stays NULL';

/**
 * Unattributable rows the post-check holds against certification: every one,
 * but on a fate-4 table whose column is not the tenancy anchor
 * (`InventoryEntry.notNullExempt`), where an organization-less row is a
 * legitimate one and is reported only.
 */
const heldUnattributable = (run: Run, table: TablePlan): number =>
  mirrorEntry(run, table.object)?.notNullExempt ? 0 : table.unattributable.length;

/** What a table still owes its fate, read from the post-check plan. */
async function remainingFor(run: Run, table: TablePlan, complete: boolean): Promise<number> {
  if (table.physical !== 'present' || !table.rows) return 0;
  switch (table.fate) {
    case 'attribution':
      return Number(table.fateCounts.rowsToAttribute ?? 0) + departingRows(table) + heldUnattributable(run, table);
    case 'report':
      return departingRows(table) + heldUnattributable(run, table);
    case 'mirror-deletion': {
      const entry = mirrorEntry(run, table.object);
      if (!entry) return 0;
      let left = 0;
      for (const physical of table.tables) {
        const cols = (await columnsOf(run, physical))!;
        left += await countWhere(run, physical, deletableWhere(run, physical, cols, entry));
        // A promotion row leaves only once its environment copy is verified:
        // until then it remains, under every posture.
        if (table.object === TEMPLATES) {
          left += await countWhere(run, physical, templatePromotionSql(run.sql, cols));
        }
      }
      return left;
    }
    case 'column-drop':
      return complete && table.organizationColumn === 'present' && table.categories.every((c) => c.rows === 0) ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Refuse, before anything is written, an apply whose plan is not the reviewed
 * one: another inventory digest (another supplement, another release's
 * inventory), another tenancy posture, or another database.
 */
function refuseUnreviewedPlan(plan: OrganizationOwnershipPlan, reviewed: ReviewedPlan): void {
  if (reviewed.inventoryDigest !== plan.inventoryDigest) {
    throw new ReviewedPlanRefusal(
      'plan-digest-mismatch',
      `The plan file ${reviewed.file} was computed from inventory ${reviewed.inventoryDigest}, and this run computes ` +
        `inventory ${plan.inventoryDigest}: the fates it would execute are not the ones that plan showed (a different ` +
        '--fate-supplement, or another release). Nothing was written. Run the plan again with the same flags, review ' +
        'it, and pass the new file with --plan-file.',
      { file: reviewed.file, reviewed: reviewed.inventoryDigest, current: plan.inventoryDigest },
    );
  }
  if (reviewed.posture !== plan.posture) {
    throw new ReviewedPlanRefusal(
      'plan-posture-mismatch',
      `The plan file ${reviewed.file} was computed under the ${reviewed.posture} tenancy posture, and this run resolves ` +
        `${plan.posture} (OS_TENANCY_POSTURE / OS_MULTI_ORG_ENABLED): the posture decides which rows attribution gives ` +
        'an owner and which it reports, and whether authored sets and positions are converted, so the fates it would ' +
        'execute are not the ones that plan showed. Nothing was written. Run the apply under the posture the plan was ' +
        'computed under, or plan again under this one, review it, and pass the new file with --plan-file.',
      { file: reviewed.file, reviewed: reviewed.posture, current: plan.posture },
    );
  }
  if (reviewed.database !== plan.database) {
    throw new ReviewedPlanRefusal(
      'plan-database-mismatch',
      `The plan file ${reviewed.file} was computed for the database ${reviewed.database}, and this run opened ` +
        `${plan.database}. Nothing was written. Plan this database, review it, and pass that file with --plan-file.`,
      { file: reviewed.file, reviewed: reviewed.database, current: plan.database },
    );
  }
}

/**
 * Refuse, before anything is written, a choice whose conflict group is not the
 * one the reviewed plan listed. A `--metadata-choice` or `--template-choice`
 * deletes the other rows of its group, so the apply deletes only within a group
 * the operator reviewed, and only while it holds exactly the reviewed rows: a
 * row that joined the group since, or one gone from it, refuses the apply with
 * the group, the rows added and the rows gone. A choice in no group (a lone
 * row, or a conflict an earlier run resolved) deletes nothing and is not judged.
 */
function refuseUnreviewedChoices(plan: OrganizationOwnershipPlan, opts: ApplyOptions): void {
  const current = reviewedConflictsOf(plan);
  const reviewed = opts.reviewedPlan.conflicts ?? [];
  const flagOf = { metadata: '--metadata-choice', template: '--template-choice' } as const;
  for (const [kind, choices] of [['metadata', opts.metadataChoices ?? []], ['template', opts.templateChoices ?? []]] as const) {
    for (const choice of choices) {
      const group = current.find((g) => g.kind === kind && g.candidates.includes(choice));
      if (!group) continue;
      const listed = reviewed.find((g) => g.kind === kind && g.key === group.key);
      const was = new Set(listed?.candidates ?? []);
      const added = group.candidates.filter((id) => !was.has(id));
      const gone = [...was].filter((id) => !group.candidates.includes(id));
      if (listed && added.length === 0 && gone.length === 0) continue;
      throw new ReviewedPlanRefusal(
        'plan-conflict-mismatch',
        `${flagOf[kind]} ${choice} resolves the ${kind === 'metadata' ? 'customization' : 'template'} conflict ` +
          `${group.key}, which now holds ${group.candidates.join(', ')}` +
          (listed
            ? `, while the plan file ${opts.reviewedPlan.file} reviewed ${listed.candidates.join(', ')}` +
              `${added.length ? ` (added since: ${added.join(', ')})` : ''}${gone.length ? ` (gone since: ${gone.join(', ')})` : ''}`
            : `, and the plan file ${opts.reviewedPlan.file} lists no such conflict`) +
          '. A choice deletes the other rows of its conflict, so it deletes only rows the reviewed plan listed. ' +
          'Nothing was written. Run the plan again, review the conflict, and pass the new file with --plan-file.',
        {
          file: opts.reviewedPlan.file,
          flag: flagOf[kind],
          choice,
          conflict: group.key,
          reviewed: listed ? listed.candidates.join(',') : '',
          current: group.candidates.join(','),
        },
      );
    }
  }
}

/**
 * Run the ceremony's apply: the fates in order, resuming from the checkpoint,
 * then the post-check. Throws only for a failure mid-write (the checkpoint
 * holds every step finished before it) or a plan refusal; every blocker is in
 * the report.
 */
export async function applyOrganizationOwnership(opts: ApplyOptions): Promise<OrganizationOwnershipApplyReport> {
  const now = opts.now ?? (() => new Date());
  const run: Run = {
    opts,
    // The executor's dialect was resolved from the driver before this call
    // (`ceremonyDialectOf`, which refuses an unresolved one): never a default.
    sql: new Sql(opts.executor, opts.executor.dialect),
    databases: new Map([
      [PRIMARY_DATABASE, { sql: new Sql(opts.executor, opts.executor.dialect), executor: opts.executor }],
      ...(opts.siblings ?? []).map((d) => [d.name, { sql: new Sql(d.executor, d.executor.dialect), executor: d.executor }] as const),
    ]),
    databaseOf: new Map(),
    plan: undefined as unknown as OrganizationOwnershipPlan,
    columns: new Map(),
    attributed: new Map(),
    deleted: new Map(),
    movedOut: new Map(),
    movedIn: new Map(),
    saved: new Map(),
    verifiedTemplateIds: new Set(),
  };
  // Refuses (driver, catalog, an uninventoried table) before anything is written.
  run.plan = await planFor(run);
  refuseUnreviewedPlan(run.plan, opts.reviewedPlan);
  validateTemplateChoices(run);
  const before = run.plan;
  for (const warning of before.warnings) opts.onWarning?.(warning);

  const stored = await opts.ledger.read();
  // The applied choices outlive a new digest: their rows are already resolved.
  const applied = stored?.metadataChoicesApplied?.length ? { metadataChoicesApplied: [...stored.metadataChoicesApplied] } : {};
  const checkpoint: CeremonyCheckpoint =
    stored && stored.ceremony === 'ADR-0131 D10' && stored.inventoryDigest === before.inventoryDigest
      ? { ceremony: 'ADR-0131 D10', inventoryDigest: before.inventoryDigest, shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION, completed: { ...stored.completed }, ...applied }
      : { ceremony: 'ADR-0131 D10', inventoryDigest: before.inventoryDigest, shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION, completed: {}, ...applied };
  await validateMetadataChoices(run, new Set(checkpoint.metadataChoicesApplied ?? []));
  refuseUnreviewedChoices(run.plan, opts);
  run.checkpoint = checkpoint;
  const resumedFrom = CEREMONY_STEPS.filter((s) => checkpoint.completed[s]);
  const steps: StepReport[] = [];
  const superseded = stored && stored.inventoryDigest !== before.inventoryDigest
    ? CEREMONY_STEPS.filter((s) => stored.completed?.[s])
    : [];
  if (stored && superseded.length > 0) {
    opts.onProgress?.(
      `the recorded checkpoint (inventory ${stored.inventoryDigest}) is superseded by the reviewed plan ` +
        `(inventory ${before.inventoryDigest}), so every step runs again (each is idempotent)`,
    );
  }

  let stopped = false;
  for (const step of CEREMONY_STEPS) {
    if (stopped) {
      steps.push({ step, status: 'not-reached', summary: {}, blockers: [], notes: [] });
      continue;
    }
    const done = checkpoint.completed[step];
    // `attribution` runs again even when checkpointed, when the plan derives
    // an owner for rows still NULL: it writes only where `organization_id IS
    // NULL`, so it never re-derives an owner already written (D10 item 3), and
    // a row that became attributable since the earlier run — its anchor fixed
    // by the operator (D10 item 4: "resolves them and re-runs"), or the
    // Default Organization now existing where an earlier run found none — is
    // attributed instead of standing as a post-check discrepancy no re-run
    // could clear.
    if (done && step === 'attribution' && rowsToAttribute(before) > 0) {
      const again = await RUNNERS[step](run);
      steps.push(again);
      if (again.status !== 'done') {
        stopped = true;
        continue;
      }
      checkpoint.completed[step] = { at: now().toISOString(), summary: again.summary };
      await opts.ledger.write(checkpoint, { complete: false, blocking: 0, advisory: 0 });
      run.columns.clear();
      continue;
    }
    // [ADR-0131 C3 stage 9] The declared-rule mirrors are deleted again on a
    // checkpointed run while one stands: a database whose ceremony completed on
    // a release whose boot still seeded them carries them (advisory then), and
    // the step that deletes them is this release's.
    // So are the rows no anchor attributes, while one stands: a row written
    // NULL since the run that finished the step is one too.
    if (done && step === 'mirror-deletion' && underivableRowsDue(run)) {
      const again = await runUnderivableDeletion(run);
      const report: StepReport = again.blockers.length
        ? { step, status: 'blocked', summary: { deleted: again.deleted }, blockers: again.blockers, notes: [] }
        : { step, status: 'done', summary: { deleted: again.deleted }, blockers: [], notes: [] };
      steps.push(report);
      if (report.status !== 'done') {
        stopped = true;
        continue;
      }
      checkpoint.completed[step] = { at: now().toISOString(), summary: report.summary };
      await opts.ledger.write(checkpoint, { complete: false, blocking: 0, advisory: 0 });
      run.columns.clear();
      if (!(await declaredRuleMirrorsDue(run))) continue;
    }
    if (done && step === 'mirror-deletion' && (await declaredRuleMirrorsDue(run))) {
      const again = await runDeclaredRuleMirrorDeletion(run);
      steps.push(again);
      if (again.status !== 'done') {
        stopped = true;
        continue;
      }
      checkpoint.completed[step] = { at: now().toISOString(), summary: again.summary };
      await opts.ledger.write(checkpoint, { complete: false, blocking: 0, advisory: 0 });
      run.columns.clear();
      continue;
    }
    if (done) {
      // `history-renumber` runs again even when checkpointed: it is
      // idempotent, and an environment write made since the earlier run must
      // not keep a number that run handed an organization.
      if (step === 'history-renumber') {
        const again = await RUNNERS[step](run);
        if (again.status !== 'done') {
          steps.push(again);
          stopped = true;
          continue;
        }
        if (Object.values(again.summary).some((n) => n > 0)) {
          steps.push(again);
          checkpoint.completed[step] = { at: now().toISOString(), summary: again.summary };
          await opts.ledger.write(checkpoint, { complete: false, blocking: 0, advisory: 0 });
          run.columns.clear();
          continue;
        }
      }
      steps.push({ step, status: 'checkpointed', summary: done.summary, blockers: [], notes: [] });
      continue;
    }
    opts.onProgress?.(`step ${step}…`);
    const report = await RUNNERS[step](run);
    steps.push(report);
    if (report.status !== 'done') {
      stopped = true;
      continue;
    }
    checkpoint.completed[step] = { at: now().toISOString(), summary: report.summary };
    await opts.ledger.write(checkpoint, { complete: false, blocking: 0, advisory: 0 });
    // Later steps read the tables as this one left them.
    run.columns.clear();
  }

  // Post-check: the plan again, read-only.
  run.columns.clear();
  const after = await planFor(run);
  const complete = CEREMONY_STEPS.every((s) => checkpoint.completed[s]);
  const tables: TableOutcome[] = [];
  const objects = new Set([...before.tables, ...after.tables].map((t) => t.object));
  let discrepancies = 0;
  for (const object of [...objects].sort()) {
    const b = before.tables.find((t) => t.object === object);
    const a = after.tables.find((t) => t.object === object);
    const ref = a ?? b!;
    const remaining = a ? await remainingFor(run, a, complete) : 0;
    if (complete) discrepancies += remaining;
    const departures: TableOutcome['departures'] = (a?.departures ?? [])
      .filter((d) => d.rows > 0)
      .map((d) => ({ id: d.id, label: d.label, as: d.as, rows: d.rows, ...(d.advisory ? { advisory: d.advisory } : {}) }));
    if (a?.physical === 'present' && object === TEMPLATES) {
      let unpromoted = 0;
      for (const physical of a.tables) {
        unpromoted += await countWhere(run, physical, templatePromotionSql(run.sql, (await columnsOf(run, physical))!));
      }
      if (unpromoted > 0) {
        departures.push({
          id: 'template-promotion',
          label: 'customized or admin-authored templates not yet promoted (a conflict, a nameless row or a blocker names each)',
          as: 'moved',
          rows: unpromoted,
        });
      }
    }
    // Advisory rows stay NULL too, and the plan's own NOT NULL reading
    // (`ref.notNull`) already says so; only a step not yet run overrides it.
    const pending = departures.filter((d) => !d.advisory);
    const waiting = pending.reduce((n, d) => n + d.rows, 0);
    const held = a ? heldUnattributable(run, a) : 0;
    tables.push({
      object,
      fate: ref.fate,
      before: b?.rows ? { total: b.rows.total, organizationNull: b.rows.organizationNull } : null,
      after: a?.rows ? { total: a.rows.total, organizationNull: a.rows.organizationNull } : null,
      attributed: run.attributed.get(object) ?? 0,
      deleted: run.deleted.get(object) ?? 0,
      movedOut: run.movedOut.get(object) ?? 0,
      movedIn: run.movedIn.get(object) ?? 0,
      columnDropped: b?.organizationColumn === 'present' && a?.organizationColumn === 'absent',
      unattributable: a?.unattributable ?? [],
      ...(held > 0 ? { held: { rows: held, remedy: UNATTRIBUTABLE_REMEDY } } : {}),
      departures,
      ...(a?.templateConflicts?.length ? { templateConflicts: a.templateConflicts } : {}),
      remaining,
      notNull: waiting > 0
        ? { willReceive: false, reason: `${waiting} row(s) still wait for a step not yet run: ${pending.map((d) => d.label).join('; ')}` }
        : ref.notNull,
    });
  }
  const advisory = after.tables.reduce((n, t) => n + advisoryRows(t) + t.unattributable.length - heldUnattributable(run, t), 0);
  const blocking = complete ? discrepancies : steps.reduce((n, s) => n + s.blockers.length, 0) || 1;
  await opts.ledger.write(checkpoint, { complete, blocking, advisory });
  return {
    kind: 'organization-ownership-apply',
    ceremony: 'ADR-0131 D10',
    migrationId: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
    generatedAt: now().toISOString(),
    database: opts.database,
    posture: opts.posture,
    inventoryDigest: before.inventoryDigest,
    reviewedPlan: { file: opts.reviewedPlan.file, generatedAt: opts.reviewedPlan.generatedAt },
    ...(stored && superseded.length > 0 ? { restartedFrom: { inventoryDigest: stored.inventoryDigest, steps: superseded } } : {}),
    resumedFrom,
    warnings: [...before.warnings],
    steps,
    tables,
    complete,
    blocking,
    advisory,
  };
}

/** Parse a checkpoint from the ledger row's `details`, or `null` when it holds none. */
export function checkpointFromDetails(details: unknown): CeremonyCheckpoint | null {
  let parsed: unknown = details;
  if (typeof details === 'string') {
    try {
      parsed = JSON.parse(details);
    } catch {
      return null;
    }
  }
  const cp = (parsed as { checkpoint?: unknown } | null)?.checkpoint as CeremonyCheckpoint | undefined;
  if (!cp || cp.ceremony !== 'ADR-0131 D10' || typeof cp.inventoryDigest !== 'string' || typeof cp.completed !== 'object') return null;
  const applied = Array.isArray(cp.metadataChoicesApplied) ? cp.metadataChoicesApplied.filter((x): x is string => typeof x === 'string') : [];
  return {
    ceremony: cp.ceremony,
    inventoryDigest: cp.inventoryDigest,
    ...(typeof cp.shapeGeneration === 'number' ? { shapeGeneration: cp.shapeGeneration } : {}),
    completed: { ...cp.completed },
    ...(applied.length ? { metadataChoicesApplied: applied } : {}),
  };
}
