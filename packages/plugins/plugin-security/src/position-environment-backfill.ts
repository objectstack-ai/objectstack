// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-time backfill of row-only positions into the environment ledger
 * under `single` (ADR-0131 D3, C2 stage S7).
 *
 * ## What it does
 *
 * Before the position write-through (`position-write-through.ts`), a position
 * created in Setup was a `sys_position` row and nothing else: no definition in
 * the environment ledger, so the security catalog read
 * (`createSecurityCatalogReader`, `@objectstack/core`) did not resolve it. The
 * write-through gives every new Setup position its definition; this pass gives
 * one to every position written before it — a ROW-ONLY position, one whose
 * name the catalog read does not resolve — so the planned read switch finds
 * every position a `single` deployment holds.
 *
 * For each name some `sys_position` row carries:
 *
 * 1. **The catalog read decides "row-only".** A name the environment ledger, a
 *    package or a built-in already declares resolves, and is left alone —
 *    its definition already has a home, and its rows are the seeders'.
 * 2. **A name the metadata door does not accept is a final class.** The door
 *    refuses a name outside its item-name grammar or `PositionSchema.name`, so
 *    such a position can never have a definition; it is reported, by count and
 *    name, and never written (seat re-rule on the C2 card, Q1 = A). It stays a
 *    row the read switch will report.
 * 3. **The rows of one name must agree.** The definition is read from the row
 *    (`{ name, label, description, delegatable }`); where two rows of one name
 *    (two organizations of one `single` deployment) disagree on it, nothing is
 *    written for that name and it is reported: which row's text the definition
 *    should carry is not this pass's to guess.
 * 4. **Written through the metadata door at environment scope**
 *    (`saveMetaItem`, actor `system`), then verified through the catalog read.
 *
 * ## Once, and remembered
 *
 * The verdict is recorded in the deployment ledger `sys_migration` (row id
 * {@link POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID}; `verified_at: null` and
 * `blocking: 0`, the shape of the grant-name backfill beside it) only when the
 * pass decided every name: each row-only name was given its definition, or is
 * in the final refused-name class. A write that did not land, a definition the
 * catalog read does not resolve afterwards, a name whose rows disagree, or a
 * read that did not happen leaves the verdict unrecorded, and the next boot
 * runs the pass again. A rerun writes nothing a previous run wrote: a name
 * that has its definition resolves, and is left alone.
 *
 * ## When it runs
 *
 * At `kernel:bootstrapped`, from `SecurityPlugin.start`, beside the grant-name
 * backfill: every `kernel:ready` handler has settled (the declared-position and
 * built-in seeders among them) and every plugin has registered its
 * declarations, so the catalog read sees every holder a name can have. The
 * order is load-bearing: an environment definition minted under a name a
 * package registers later is refused at the registry's item seam
 * (`NAMESPACE_CONFLICT`), so a pass run ahead of the declarations would turn
 * a package's registration into a refusal. Under a walled posture the pass
 * does not run: an organization's row has no environment home (ADR-0131 D3).
 */

import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import type { SecurityCatalogReader } from '@objectstack/core';
import {
  POSITION_METADATA_TYPE,
  POSITION_OBJECT,
  metadataDoorAcceptsPositionName,
  positionBodyFromRow,
  type PositionMetadataDoor,
} from './position-write-through.js';

/** Ledger row id of the one-time position backfill. */
export const POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID = 'adr-0131-position-environment-backfill';

/** Rows per page of the position scan. */
const SCAN_PAGE_SIZE = 500;

/** Names printed per category; the count is always complete. */
const LOGGED_NAME_LIMIT = 50;

const SYSTEM_CTX = { isSystem: true } as const;

/** The engine surface the backfill uses — ObjectQL satisfies it as it stands. */
export interface PositionBackfillEngine {
  getObject(name: string): unknown;
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** The kernel logger, as this module uses it. */
export interface PositionBackfillLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  /** The kernel logger's shape: message, cause, meta. */
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

/** Why a pass stopped before it reached a verdict. */
export type PositionBackfillStop =
  /** No `sys_position` object in this composition. */
  | 'objects-absent'
  /** No metadata door that can save. */
  | 'door-absent'
  /** The position scan could not be read in full. */
  | 'scan-unreadable'
  /** The security catalog read did not happen. */
  | 'catalog-unreadable';

/** What one pass did. Every list holds position names. */
export interface PositionBackfillResult {
  /** Distinct names the scan found. */
  names: number;
  /** Names the catalog read did not resolve before this pass. */
  rowOnly: string[];
  /** Names this pass gave a definition, verified through the catalog read. */
  backfilled: string[];
  /** Names the metadata door does not accept — never written, final. */
  refusedName: string[];
  /** Names whose rows disagree on the definition — not written. */
  conflicting: string[];
  /** Names whose definition write did not land, or does not resolve after it. */
  failed: string[];
  /** Set when the pass stopped before it judged every name. */
  stopped?: PositionBackfillStop;
}

export interface PositionBackfillDeps {
  /** The tenancy posture in force; the pass runs under `single` only. */
  posture: TenancyPosture;
  /** S1's security catalog read: "row-only" is a name it does not resolve. */
  catalog: SecurityCatalogReader;
  /** The metadata door the definitions are written through. */
  door: unknown;
  logger?: PositionBackfillLogger;
}

/** Thrown inside the pass to stop it; never escapes the module. */
class BackfillStop extends Error {
  constructor(readonly stop: PositionBackfillStop, readonly reason: unknown) {
    super(stop);
  }
}

const STOPPED_READING: Record<PositionBackfillStop, string> = {
  'objects-absent': 'this composition',
  'door-absent': 'the metadata door',
  'scan-unreadable': POSITION_OBJECT,
  'catalog-unreadable': 'the security catalog',
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function logError(logger: PositionBackfillLogger | undefined, message: string, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, undefined, meta);
  else logger?.warn(message, meta);
}

/** At most {@link LOGGED_NAME_LIMIT} names, and how many more there are. */
function listed(names: readonly string[]): { names: string[]; more?: number } {
  return names.length > LOGGED_NAME_LIMIT
    ? { names: names.slice(0, LOGGED_NAME_LIMIT), more: names.length - LOGGED_NAME_LIMIT }
    : { names: [...names] };
}

function canSave(door: unknown): door is Pick<PositionMetadataDoor, 'saveMetaItem'> {
  return !!door && typeof (door as { saveMetaItem?: unknown }).saveMetaItem === 'function';
}

/** Every `sys_position` row, grouped by name, read in full before anything is written. */
async function scanRowsByName(engine: PositionBackfillEngine): Promise<Map<string, Record<string, unknown>[]>> {
  const byName = new Map<string, Record<string, unknown>[]>();
  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    let page: unknown;
    try {
      page = await engine.find(POSITION_OBJECT, {
        where: {},
        fields: ['id', 'name', 'label', 'description', 'delegatable'],
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: SCAN_PAGE_SIZE,
        offset,
        context: SYSTEM_CTX,
      });
    } catch (e) {
      throw new BackfillStop('scan-unreadable', e);
    }
    const rows = Array.isArray(page) ? (page as Record<string, unknown>[]) : [];
    for (const row of rows) {
      const name = row?.name;
      if (typeof name !== 'string' || name === '') continue;
      const list = byName.get(name);
      if (list) list.push(row);
      else byName.set(name, [row]);
    }
    if (rows.length < SCAN_PAGE_SIZE) break;
  }
  return byName;
}

async function catalogResolves(catalog: SecurityCatalogReader, name: string): Promise<boolean> {
  try {
    const entry = await catalog.resolve(POSITION_METADATA_TYPE, name);
    return entry !== undefined && entry.name === name;
  } catch (e) {
    throw new BackfillStop('catalog-unreadable', e);
  }
}

/** Report what one pass did and could not do — once per category, never once per name. */
function reportPass(result: PositionBackfillResult, logger?: PositionBackfillLogger): void {
  if (result.backfilled.length > 0) {
    logger?.info?.(
      `[security] ${result.backfilled.length} row-only position(s) now have an environment definition (ADR-0131 D3): ` +
        `each was read from its ${POSITION_OBJECT} row, saved through the metadata door at environment scope and ` +
        'resolved through the security catalog read',
      { backfilled: listed(result.backfilled) },
    );
  }
  if (result.refusedName.length > 0) {
    logger?.warn(
      `[security] ${result.refusedName.length} position(s) keep no environment definition: their names are not ` +
        'position names the metadata door accepts (lowercase snake_case, starting with a letter, at least two ' +
        'characters), so no definition can carry them. Each still grants from its row today, and the catalog read ' +
        'will not find it. Fix: rename each position in Setup to a lowercase snake_case name — the rename gives it ' +
        'its definition — and re-point the assignments that name it.',
      { count: result.refusedName.length, positions: listed(result.refusedName) },
    );
  }
  if (result.conflicting.length > 0) {
    logError(
      logger,
      `[security] ${result.conflicting.length} row-only position name(s) were NOT given an environment definition: ` +
        `the ${POSITION_OBJECT} rows carrying each name disagree on its label, description or delegatable, and ` +
        'one environment definition cannot carry both. They still grant from their rows today, and would not be ' +
        'found by the catalog read. Fix: make the rows agree (or rename one) in Setup — an edit gives the name its ' +
        'definition; the backfill runs again on the next boot.',
      { count: result.conflicting.length, positions: listed(result.conflicting) },
    );
  }
  if (result.failed.length > 0) {
    logError(
      logger,
      `[security] ${result.failed.length} row-only position(s) were NOT given an environment definition: the ` +
        'metadata door refused or lost the write, or the catalog read did not resolve it afterwards, while every ' +
        'other line of this backfill reads clean. They still grant from their rows today. The backfill runs again ' +
        'on the next boot; if it fails again, check that the metadata store (sys_metadata) is writable.',
      { count: result.failed.length, positions: listed(result.failed) },
    );
  }
}

/**
 * One pass: give every row-only position its environment definition, report
 * the rest. A read that did not happen stops the pass; the stop is returned in
 * `stopped` and reported, never thrown.
 */
export async function backfillRowOnlyPositions(
  engine: PositionBackfillEngine,
  deps: Pick<PositionBackfillDeps, 'catalog' | 'door' | 'logger'>,
): Promise<PositionBackfillResult> {
  const result: PositionBackfillResult = {
    names: 0, rowOnly: [], backfilled: [], refusedName: [], conflicting: [], failed: [],
  };
  const { catalog, door, logger } = deps;
  if (!engine?.getObject?.(POSITION_OBJECT)) {
    result.stopped = 'objects-absent';
    return result;
  }
  if (!canSave(door)) {
    result.stopped = 'door-absent';
    logger?.warn(
      '[security] the row-only position backfill did not run: no metadata door that can save is registered, so ' +
        'positions created in Setup before the environment write-through keep no environment definition. It runs ' +
        'again on the next boot.',
    );
    return result;
  }

  try {
    const byName = await scanRowsByName(engine);
    result.names = byName.size;
    for (const [name, rows] of [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (await catalogResolves(catalog, name)) continue;
      result.rowOnly.push(name);
      if (!metadataDoorAcceptsPositionName(name)) {
        result.refusedName.push(name);
        continue;
      }
      const bodies = new Set(rows.map((row) => JSON.stringify(positionBodyFromRow(row))));
      if (bodies.size > 1) {
        result.conflicting.push(name);
        continue;
      }
      try {
        await door.saveMetaItem({
          type: POSITION_METADATA_TYPE,
          name,
          item: positionBodyFromRow(rows[0]),
          actor: 'system',
        });
      } catch (e) {
        result.failed.push(name);
        if (result.failed.length === 1) {
          logError(
            logger,
            `[security] the row-only position backfill could not save the environment definition of '${name}' ` +
              '(ADR-0131 D3): the position keeps granting from its row, and the catalog read does not find it. ' +
              'The count of every such position follows when the pass ends; it runs again on the next boot.',
            { name, error: errorText(e) },
          );
        }
        continue;
      }
      if (await catalogResolves(catalog, name)) result.backfilled.push(name);
      else result.failed.push(name);
    }
  } catch (e) {
    if (!(e instanceof BackfillStop)) throw e;
    result.stopped = e.stop;
    logger?.warn(
      `[security] the row-only position backfill stopped before it judged every position: ` +
        `${STOPPED_READING[e.stop]} could not be read, and an unread answer is never taken for "already declared". ` +
        'No definition was written past that point; the backfill runs again on the next boot.',
      { stop: e.stop, error: errorText(e.reason), backfilled: result.backfilled.length },
    );
  }
  reportPass(result, logger);
  return result;
}

/** A pass's verdict is final when nothing a later pass could decide differently remains. */
export function isRecordablePositionBackfillVerdict(result: PositionBackfillResult): boolean {
  return result.stopped === undefined && result.failed.length === 0 && result.conflicting.length === 0;
}

/** What the deployment ledger says about this backfill. */
export type PositionBackfillLedgerReading = 'recorded' | 'absent' | 'unavailable' | 'unreadable';

/** Read the ledger row by its id. Never throws. */
export async function readPositionBackfillLedger(engine: PositionBackfillEngine): Promise<PositionBackfillLedgerReading> {
  try {
    if (!engine?.getObject?.(DATA_MIGRATION_FLAG_OBJECT)) return 'unavailable';
    const row = await engine.findOne(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID },
      context: SYSTEM_CTX,
    });
    return row?.id === POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID ? 'recorded' : 'absent';
  } catch {
    return 'unreadable';
  }
}

/** The ledger row for a decided pass — pure. */
export function buildPositionBackfillRecord(result: PositionBackfillResult, now: string): DataMigrationFlag {
  return {
    id: POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    details: JSON.stringify({
      names: result.names,
      rowOnly: result.rowOnly.length,
      backfilled: result.backfilled.length,
      refusedName: result.refusedName.length,
    }),
  };
}

/**
 * Insert the ledger row. THROWS on failure — the caller decides what a lost
 * record means.
 */
async function persistPositionBackfillRecord(engine: PositionBackfillEngine, flag: DataMigrationFlag): Promise<void> {
  const now = flag.last_run_at;
  await engine.insert(DATA_MIGRATION_FLAG_OBJECT, { ...flag, created_at: now, updated_at: now }, { context: SYSTEM_CTX });
}

export type PositionBackfillStatus =
  /** A walled posture: the pass does not apply. */
  | 'not-applicable'
  /** The pass decided, and its record landed. */
  | 'ran'
  /** The pass decided, but its record did not land (or there is no ledger to land it in). */
  | 'ran-unrecorded'
  /** The pass left something a later pass may decide differently — retried on the next boot. */
  | 'undecided'
  /** The ledger already records the verdict — nothing was scanned or written. */
  | 'already-run';

export interface OneTimePositionBackfillResult {
  status: PositionBackfillStatus;
  ledger?: PositionBackfillLedgerReading;
  /** The pass's own summary, present whenever it ran. */
  backfill?: PositionBackfillResult;
}

/**
 * Run the row-only position backfill under `single` unless the deployment
 * ledger already records its verdict, and record the verdict when this pass
 * reaches one. A read the pass could not make is reported and returned, never
 * thrown; the boot hook that calls this still guards against anything
 * unforeseen.
 */
export async function runOneTimePositionEnvironmentBackfill(
  engine: PositionBackfillEngine,
  deps: PositionBackfillDeps,
): Promise<OneTimePositionBackfillResult> {
  if (postureEnforcesWall(deps.posture)) return { status: 'not-applicable' };
  const { logger } = deps;
  const ledger = await readPositionBackfillLedger(engine);
  if (ledger === 'recorded') return { status: 'already-run', ledger };

  const backfill = await backfillRowOnlyPositions(engine, deps);
  if (!isRecordablePositionBackfillVerdict(backfill)) return { status: 'undecided', ledger, backfill };

  if (ledger !== 'absent') {
    logger?.warn(
      `[security] the row-only position backfill reached its verdict but cannot record it: the deployment ledger ` +
        `${DATA_MIGRATION_FLAG_OBJECT} is ${ledger === 'unavailable' ? 'not available on this kernel' : 'unreadable'}, ` +
        'so every boot scans the positions again. Nothing is written twice. Compose PlatformObjectsPlugin (it ' +
        'provisions the ledger) to let the verdict be remembered.',
      { ledger },
    );
    return { status: 'ran-unrecorded', ledger, backfill };
  }

  const flag = buildPositionBackfillRecord(backfill, new Date().toISOString());
  try {
    await persistPositionBackfillRecord(engine, flag);
  } catch (e) {
    // A concurrent boot that landed the same id first has recorded it.
    if ((await readPositionBackfillLedger(engine)) === 'recorded') return { status: 'ran', ledger, backfill };
    // At `error`: the pass's writes stand and every line reads clean, while the
    // record that makes it one-time is absent.
    logError(
      logger,
      `[security] the row-only position backfill ran, but recording it in ${DATA_MIGRATION_FLAG_OBJECT} failed ` +
        `(${errorText(e)}). The next boot scans every position again and re-reports what it cannot give a ` +
        `definition. Fix: make ${DATA_MIGRATION_FLAG_OBJECT} writable on this deployment (it is provisioned by ` +
        `PlatformObjectsPlugin) and verify with SELECT * FROM ${DATA_MIGRATION_FLAG_OBJECT} WHERE id = ` +
        `'${POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID}'.`,
      { error: errorText(e) },
    );
    return { status: 'ran-unrecorded', ledger, backfill };
  }
  logger?.info?.(
    `[security] the row-only position backfill is recorded in ${DATA_MIGRATION_FLAG_OBJECT} ` +
      `(id '${POSITION_ENVIRONMENT_BACKFILL_MIGRATION_ID}') — later boots will not run it again`,
    { id: flag.id, details: flag.details },
  );
  return { status: 'ran', ledger, backfill };
}
