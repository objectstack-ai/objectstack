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
  columnNameOf,
  dialectOf,
  predicateSql,
  Sql,
  type AttributionSink,
  type OrganizationOwnershipPlan,
  type PlanReader,
  type TablePlan,
  type UnattributableRow,
} from './organization-ownership-plan.js';

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
 *  3. `rewrite` — the verified id→name rewrite (D4):
 *     `sys_user_permission_set.permission_set` is named from the set row its
 *     `permission_set_id` points at, then EVERY grant is verified to name a set
 *     the security catalog resolves. The id column stays (C7b drops it).
 *  4. `mirror-deletion` (fate 2) — gated on the rewrite's verification, which
 *     is read again immediately before the first delete. Only rows of a
 *     `mirror-deletion` object that match its mirror selector and none of its
 *     named categories are deleted.
 *  5. `column-drops` (fate 1) — `organization_id` leaves the D7 objects
 *     through the schema-drift ceremony ({@link ColumnDropPort}), never a hand
 *     `ALTER`.
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

export const CEREMONY_STEPS = ['attribution', 'authored-conversion', 'rewrite', 'mirror-deletion', 'column-drops'] as const;
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
  save(type: 'position' | 'permission', name: string, body: Record<string, unknown>): Promise<void>;
}

/** One table's column drop, as the schema-drift ceremony answered it. */
export interface ColumnDropOutcome {
  table: string;
  outcome: 'dropped' | 'not-proposed' | 'failed';
  detail?: string;
}

/** Drops `organization_id` on the named tables through the schema-drift ceremony (ADR-0120 D4). */
export interface ColumnDropPort {
  drop(tables: readonly string[]): Promise<ColumnDropOutcome[]>;
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
  columnDrops: ColumnDropPort;
  ledger: CeremonyLedgerPort;
  inventory?: readonly InventoryEntry[];
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
  /**
   * What the door accepted this run. The registry hydrates environment
   * metadata at boot, so a definition saved a moment ago is not in it until
   * the next one; the door's acceptance is what makes it resolve now.
   */
  saved: Map<string, Readonly<Record<string, unknown>>>;
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
const bodyKey = (body: Readonly<Record<string, unknown>>, keys: readonly string[]): string =>
  JSON.stringify(keys.map((k) => [k, body[k] ?? null]));

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
  const summary: Record<string, number> = { named: 0, grants: 0, verified: 0 };
  const notes: string[] = [];
  const cols = await columnsOf(run, GRANTS);
  if (cols?.has('permission_set') && cols.has('permission_set_id')) {
    const sets = new Map<string, { name: string | null; organization: string | null }>();
    if (await columnsOf(run, SETS)) {
      const setCols = (await columnsOf(run, SETS))!;
      for (const row of await readAll(run, SETS, ['name', ...(setCols.has(ORG) ? [ORG] : [])])) {
        sets.set(String(row.id), { name: text(row.name), organization: text(row[ORG]) });
      }
    }
    const t = run.sql.q(GRANTS, GRANTS);
    const nameCol = run.sql.q('permission_set', GRANTS);
    const unnamed = await readAll(run, GRANTS, ['permission_set_id', ...(cols.has(ORG) ? [ORG] : [])], {
      text: `${nameCol} IS NULL OR ${nameCol} = ''`,
      params: [],
    });
    const reasons = { noId: [] as string[], dangling: [] as string[], crossOrganization: [] as string[], unresolved: [] as string[] };
    for (const grant of unnamed) {
      const gid = String(grant.id);
      const setId = text(grant.permission_set_id);
      if (!setId) { reasons.noId.push(gid); continue; }
      const set = sets.get(setId);
      if (!set?.name) { reasons.dangling.push(gid); continue; }
      // A name carries no organization: an organization's set row may be named
      // only by that organization's grants (the grant rule the resolver applies).
      if (set.organization !== null && set.organization !== text(grant[ORG])) { reasons.crossOrganization.push(gid); continue; }
      if (!(await resolveName(run, 'permission', set.name))) { reasons.unresolved.push(gid); continue; }
      await execute(
        run,
        GRANTS,
        `UPDATE ${t} SET ${nameCol} = ? WHERE ${run.sql.q('id', GRANTS)} = ? AND (${nameCol} IS NULL OR ${nameCol} = '')`,
        [set.name, gid],
      );
      summary.named++;
    }
    const describe: Record<keyof typeof reasons, string> = {
      noId: 'carry neither a name nor a permission_set_id',
      dangling: 'point at a set row that does not exist',
      crossOrganization: 'point at another organization\'s set row — a name carries no organization, so it is never written',
      unresolved: 'point at a set row whose name the security catalog does not resolve',
    };
    for (const key of Object.keys(reasons) as (keyof typeof reasons)[]) {
      if (reasons[key].length) notes.push(`${reasons[key].length} unnamed grant(s) ${describe[key]}: ${reasons[key].slice(0, 20).join(', ')}.`);
    }
    if (summary.named) run.opts.onProgress?.(`rewrite: ${summary.named} grant(s) now name their permission set`);
  }
  const verification = await verifyReferences(run);
  summary.grants = verification.grants;
  summary.verified = verification.verified;
  return {
    step: 'rewrite',
    status: verification.blockers.length ? 'blocked' : 'done',
    summary,
    blockers: verification.blockers,
    notes: [...notes, ...verification.notes],
  };
}

// ── Step 4: mirror deletion (fate 2) ─────────────────────────────────────────

/** Provenance the seeders stamped: only such a row can be a copy of code. */
const SEEDED_BY = ['package', 'platform', 'system'];

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
    const kept = Math.max(0, table.rows!.total - (run.deleted.get(table.object) ?? 0));
    if (kept > 0) notes.push(`${table.object}: ${kept} row(s) are not mirrors (a named category or their non-seeded provenance claims them) and stay.`);
  }
  return { step: 'mirror-deletion', status: 'done', summary: { deleted: total }, blockers: [], notes };
}

// ── Step 5: column drops (fate 1) ────────────────────────────────────────────

async function runColumnDrops(run: Run): Promise<StepReport> {
  const plan = await planFor(run);
  const blockers: string[] = [];
  const due: string[] = [];
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
    due.push(...table.tables);
  }
  let dropped = 0;
  if (due.length) {
    for (const outcome of await run.opts.columnDrops.drop(due)) {
      if (outcome.outcome === 'dropped') {
        dropped++;
        continue;
      }
      blockers.push(
        outcome.outcome === 'not-proposed'
          ? `${outcome.table}.${ORG} was not proposed for dropping by the schema-drift ceremony: the object this ` +
            `runtime declares still carries the column${outcome.detail ? ` (${outcome.detail})` : ''}. Run the ceremony ` +
            'with the release whose declaration drops it.'
          : `Dropping ${outcome.table}.${ORG} failed: ${outcome.detail ?? 'no detail'}. Re-run once the cause is fixed.`,
      );
    }
  }
  return { step: 'column-drops', status: blockers.length ? 'blocked' : 'done', summary: { dropped, due: due.length }, blockers, notes: [] };
}

// ── The run ──────────────────────────────────────────────────────────────────

const RUNNERS: Record<CeremonyStep, (run: Run) => Promise<StepReport>> = {
  attribution: runAttribution,
  'authored-conversion': runAuthoredConversion,
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
        left += await countWhere(run, physical, deletableWhere(run, physical, (await columnsOf(run, physical))!, entry));
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
    saved: new Map(),
  };
  // Refuses (driver, catalog, an uninventoried table) before anything is written.
  run.plan = await planFor(run);
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
    tables.push({
      object,
      fate: ref.fate,
      before: b?.rows ? { total: b.rows.total, organizationNull: b.rows.organizationNull } : null,
      after: a?.rows ? { total: a.rows.total, organizationNull: a.rows.organizationNull } : null,
      attributed: run.attributed.get(object) ?? 0,
      deleted: run.deleted.get(object) ?? 0,
      columnDropped: b?.organizationColumn === 'present' && a?.organizationColumn === 'absent',
      unattributable: a?.unattributable ?? [],
      departures: (a?.departures ?? []).filter((d) => d.rows > 0).map((d) => ({ id: d.id, label: d.label, as: d.as, rows: d.rows })),
      remaining,
      notNull: a && departingRows(a) > 0
        ? { willReceive: false, reason: `${departingRows(a)} row(s) still wait for a step not yet run: ${a.departures.filter((d) => d.rows > 0).map((d) => d.label).join('; ')}` }
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
