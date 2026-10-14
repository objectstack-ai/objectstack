// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  convertPositionBindingRows,
  permissionSetDefinitionFromRow,
  positionDefinitionFromRow,
} from '@objectstack/core';
import {
  inventoryEntryFor,
  type InventoryEntry,
  type RowPredicate,
} from './organization-ownership-inventory.js';
import {
  buildOrganizationOwnershipPlan,
  columnListSql,
  definitionKey,
  groupTemplateRows,
  templatePromotionSql,
  SEEDED_BY,
  TEMPLATE_OBJECT,
  columnNameOf,
  dialectOf,
  predicateSql,
  Sql,
  type AttributionSink,
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
 *     the parent's owner in the next.
 *  2. `authored-conversion` — the catalog rows an organization authored
 *     (the inventory's `authored` categories) become environment metadata
 *     through the metadata door, by core's row→definition mappers; the
 *     position bindings are carried into the position definitions
 *     (`convertPositionBindingRows`). Only under `single` (ADR-0131 D3: a
 *     Setup catalog write is an environment metadata write under `single` and
 *     refused under a wall); under a wall the rows are reported.
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
 *     pass verified are deleted, by id.
 *  5. `column-drops` (fate 1) — `organization_id` leaves the D7 objects
 *     through the schema-drift ceremony ({@link ColumnDropPort}), never a hand
 *     `ALTER`; so does the retired `sys_user_permission_set.permission_set_id`
 *     (C7b), once the rewrite has read it and no two grants hold one set for
 *     one user in one organization (the unique index that replaces the old
 *     one would refuse them; they are reported, never deleted).
 *
 * Then the post-check re-runs the plan and reports, per table, what remains.
 *
 * ## Idempotent and resumable
 *
 * Every write is conditioned on the state it changes — an owner is written
 * only where `organization_id IS NULL`, a name only where `permission_set` is
 * empty, a delete selects only mirrors — so a second run writes nothing the
 * first one wrote. On top of that, each step that finishes is recorded in the
 * ceremony's checkpoint ({@link CeremonyLedgerPort}) and is not run again: a
 * run interrupted inside step N resumes at step N. A step that stops on a
 * blocker stops the ceremony there — fate order is the contract — and the
 * report names the blocker and its remedy.
 *
 * ## What it never does
 *
 * ⛔ Delete a row outside fate 2. ⛔ Give an unattributable row an owner:
 * owners come only from the plan's anchors and, under `single`, the Default
 * Organization. ⛔ Run at boot: the command is the only caller.
 */

/** The `sys_migration` row the ceremony checkpoints into and completes. */
export const ORGANIZATION_OWNERSHIP_MIGRATION_ID = 'adr-0131-organization-ownership';

export const CEREMONY_STEPS = [
  'attribution',
  'authored-conversion',
  'template-promotion',
  'settings-move',
  'rewrite',
  'mirror-deletion',
  'column-drops',
] as const;
export type CeremonyStep = (typeof CEREMONY_STEPS)[number];

/** The raw-SQL seam: the plan's reader plus the one write verb. */
export interface ApplyExecutor extends PlanReader {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}

/** The security catalog read (core's `SecurityCatalogReader` satisfies it). */
export interface CatalogPort {
  resolve(type: 'position' | 'permission', name: string): Promise<{ definition: Readonly<Record<string, unknown>> } | undefined>;
}

/** The metadata door: an environment metadata save. Throws when the door refuses. */
export interface MetadataDoorPort {
  save(type: 'position' | 'permission' | 'email_template', name: string, body: Record<string, unknown>): Promise<void>;
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
  completed: Partial<Record<CeremonyStep, { at: string; summary: Record<string, number> }>>;
}

/** Where the checkpoint lives (the command: the `sys_migration` row). */
export interface CeremonyLedgerPort {
  read(): Promise<CeremonyCheckpoint | null>;
  write(checkpoint: CeremonyCheckpoint, verdict: { complete: boolean; blocking: number; advisory: number }): Promise<void>;
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
   * Rows that leave this table by a step this ceremony has not yet performed
   * (a move, or a mirror its own stage removes): each counts as remaining
   * until it is gone, and its label is the remedy.
   */
  departures: Array<{ id: string; label: string; as: 'mirror-deletion' | 'moved'; rows: number }>;
  /** Templates: each `(name, locale)` whose rows still differ, with every candidate row and its organization. */
  templateConflicts?: TemplateConflict[];
  /** Post-check: what is left for this table's fate, `0` when the fate is done. */
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
  /** Steps an earlier run finished, read from the checkpoint. */
  resumedFrom: CeremonyStep[];
  steps: StepReport[];
  tables: TableOutcome[];
  /** Every step finished. */
  complete: boolean;
  /** Blockers (an unfinished ceremony) or post-check discrepancies (a finished one). Zero is the verdict. */
  blocking: number;
  /** Rows reported, never guessed: unattributable rows and rows held for another stage. */
  advisory: number;
}

export interface ApplyOptions {
  executor: ApplyExecutor;
  posture: string;
  database: string;
  catalog: CatalogPort;
  door: MetadataDoorPort;
  templates: TemplatePort;
  columnDrops: ColumnDropPort;
  ledger: CeremonyLedgerPort;
  inventory?: readonly InventoryEntry[];
  /**
   * The operator's choice for each template conflict: one candidate row id per
   * `(name, locale)` whose customized or authored rows differ. Validated before
   * anything is written ({@link TemplateChoiceRefusal}).
   */
  templateChoices?: readonly string[];
  now?: () => Date;
  /** One line per milestone, for the command's human face. */
  onProgress?: (message: string) => void;
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
  sql: Sql;
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

async function columnsOf(run: Run, table: string): Promise<Set<string> | null> {
  if (run.columns.has(table)) return run.columns.get(table)!;
  const present = run.plan.tables.some((t) => t.tables.includes(table));
  let cols: Set<string> | null = null;
  if (present) {
    const rows = await run.sql.read(table, columnListSql(run.sql.dialect), [table]);
    cols = new Set(rows.map(columnNameOf).filter((c): c is string => c !== null));
  }
  run.columns.set(table, cols);
  return cols;
}

/** Every row of `table` matching `where`, keyset-paged by id. */
async function readAll(run: Run, table: string, select: readonly string[], where: { text: string; params: unknown[] } = { text: '1 = 1', params: [] }): Promise<Record<string, unknown>[]> {
  const { sql } = run;
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
    await run.opts.executor.execute(statement, params);
  } catch (error) {
    throw new Error(`The write to ${table} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

const planFor = (run: Run, extra: { onAttribution?: AttributionSink } = {}): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({
    reader: run.opts.executor,
    posture: run.opts.posture,
    database: run.opts.database,
    ...(run.opts.inventory ? { inventory: run.opts.inventory } : {}),
    ...(run.opts.now ? { now: run.opts.now() } : {}),
    ...extra,
  });

const nullsUnderAttribution = (plan: OrganizationOwnershipPlan): number =>
  plan.tables.filter((t) => t.fate === 'attribution').reduce((n, t) => n + (t.rows?.organizationNull ?? 0), 0);

// ── Step 1: attribution ──────────────────────────────────────────────────────

async function runAttribution(run: Run): Promise<StepReport> {
  let passes = 0;
  let total = 0;
  let lastNulls = Number.POSITIVE_INFINITY;
  for (;;) {
    passes++;
    let wrote = 0;
    const plan = await planFor(run, {
      onAttribution: async ({ object, assignments }) => {
        const groups = new Map<string, string[]>();
        for (const a of assignments) {
          const key = `${a.table}\u0000${a.organizationId}`;
          const ids = groups.get(key) ?? [];
          ids.push(a.id);
          groups.set(key, ids);
        }
        for (const [key, ids] of groups) {
          const [table, organizationId] = key.split('\u0000') as [string, string];
          const t = run.sql.q(table, table);
          for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const chunk = ids.slice(i, i + IN_CHUNK);
            await execute(
              run,
              table,
              `UPDATE ${t} SET ${run.sql.q(ORG, table)} = ? WHERE ${run.sql.q(ORG, table)} IS NULL AND ${run.sql.q('id', table)} IN (${chunk.map(() => '?').join(', ')})`,
              [organizationId, ...chunk],
            );
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
          'that name to carry them. Declare the position (or remove the bindings), then re-run.',
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
    if (unnamed.length) {
      out.blockers.push(
        `${unnamed.length} grant(s) still name no permission set (${unnamed.slice(0, 20).join(', ')}${unnamed.length > 20 ? ', …' : ''}). ` +
          'The rewrite could not derive their name (see its notes); name or remove each, then re-run.',
      );
    }
    for (const [name, ids] of unresolved) {
      out.blockers.push(
        `${ids.length} grant(s) name the permission set ${name}, which the security catalog does not resolve ` +
          `(${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}). Declare or author the set, or remove the grants, then re-run.`,
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
            'deleting them would lose a grant. The authored-conversion step carries them; resolve its blocker, then re-run.',
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
  return { step: 'mirror-deletion', status: 'done', summary: { deleted: total }, blockers: [], notes };
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

// ── The run ──────────────────────────────────────────────────────────────────

const RUNNERS: Record<CeremonyStep, (run: Run) => Promise<StepReport>> = {
  attribution: runAttribution,
  'authored-conversion': runAuthoredConversion,
  'template-promotion': runTemplatePromotion,
  'settings-move': runSettingsMove,
  rewrite: runRewrite,
  'mirror-deletion': runMirrorDeletion,
  'column-drops': runColumnDrops,
};

/** NULL rows a departure still has to carry out of the table. */
const departingRows = (table: TablePlan): number => table.departures.reduce((n, d) => n + d.rows, 0);

/** What a table still owes its fate, read from the post-check plan. */
async function remainingFor(run: Run, table: TablePlan, complete: boolean): Promise<number> {
  if (table.physical !== 'present' || !table.rows) return 0;
  switch (table.fate) {
    case 'attribution':
      return Number(table.fateCounts.rowsToAttribute ?? 0) + departingRows(table);
    case 'report':
      return departingRows(table);
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
 * Run the ceremony's apply: the fates in order, resuming from the checkpoint,
 * then the post-check. Throws only for a failure mid-write (the checkpoint
 * holds every step finished before it) or a plan refusal; every blocker is in
 * the report.
 */
export async function applyOrganizationOwnership(opts: ApplyOptions): Promise<OrganizationOwnershipApplyReport> {
  const dialect = dialectOf(opts.executor.client);
  const now = opts.now ?? (() => new Date());
  const run: Run = {
    opts,
    sql: new Sql(opts.executor, dialect ?? 'sqlite'),
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
  validateTemplateChoices(run);
  const before = run.plan;

  const stored = await opts.ledger.read();
  const checkpoint: CeremonyCheckpoint =
    stored && stored.ceremony === 'ADR-0131 D10' && stored.inventoryDigest === before.inventoryDigest
      ? { ceremony: 'ADR-0131 D10', inventoryDigest: before.inventoryDigest, completed: { ...stored.completed } }
      : { ceremony: 'ADR-0131 D10', inventoryDigest: before.inventoryDigest, completed: {} };
  const resumedFrom = CEREMONY_STEPS.filter((s) => checkpoint.completed[s]);
  const steps: StepReport[] = [];
  if (stored && resumedFrom.length === 0 && Object.keys(stored.completed ?? {}).length > 0) {
    opts.onProgress?.('the inventory changed since the recorded checkpoint, so every step runs again (each is idempotent)');
  }

  let stopped = false;
  for (const step of CEREMONY_STEPS) {
    if (stopped) {
      steps.push({ step, status: 'not-reached', summary: {}, blockers: [], notes: [] });
      continue;
    }
    const done = checkpoint.completed[step];
    if (done) {
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
    const departures = (a?.departures ?? []).filter((d) => d.rows > 0).map((d) => ({ id: d.id, label: d.label, as: d.as, rows: d.rows }));
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
    const waiting = departures.reduce((n, d) => n + d.rows, 0);
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
      departures,
      ...(a?.templateConflicts?.length ? { templateConflicts: a.templateConflicts } : {}),
      remaining,
      notNull: waiting > 0
        ? { willReceive: false, reason: `${waiting} row(s) still wait for a step not yet run: ${departures.map((d) => d.label).join('; ')}` }
        : ref.notNull,
    });
  }
  const advisory = after.summary.unattributableRows;
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
    resumedFrom,
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
  return { ceremony: cp.ceremony, inventoryDigest: cp.inventoryDigest, completed: { ...cp.completed } };
}
