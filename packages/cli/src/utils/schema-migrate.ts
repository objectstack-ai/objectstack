// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared boot + rendering for `os migrate` (issue #2186).
 *
 * Boots the data stack (driver + ObjectQL + the compiled artifact's objects)
 * via the supported `createStandaloneStack` programmatic entry, runs schema
 * sync, and hands back the live SQL driver so the command can call
 * `detectManagedDrift()` / `applyMigrationEntries()`.
 *
 * Migration only sees the objects present in the loaded metadata (compiled
 * artifact). Run `os build` first so your objects are visible; tables/columns
 * not in the loaded metadata are never examined or altered.
 */
import chalk from 'chalk';
import type { ManagedDriftEntry, DriftCategory, PendingSchemaWork } from '@objectstack/driver-sql';
import { isInPlaceSchemaWork } from '@objectstack/driver-sql';
import { describeDriverConnection } from './connection-display.js';

export type { PendingSchemaWork };

export interface SqlDriverLike {
  detectManagedDrift(): Promise<ManagedDriftEntry[]>;
  applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean },
  ): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }>;
  /** Deferred-DDL surface (#3917) — optional, so a driver without it still boots. */
  setDeferredDdl?: (deferred: boolean) => void;
  previewDeferredSchemaWork?: () => Promise<PendingSchemaWork[]>;
  flushDeferredSchemaDdl?: () => Promise<PendingSchemaWork[]>;
  config?: any;
  disconnect?: () => Promise<void>;
}

export interface SchemaStack {
  driver: SqlDriverLike | null;
  dbLabel: string;
  managedTableCount: number;
  /** The booted kernel — `getService('objectql')` etc. for one-shot commands
   *  beyond schema migration (e.g. `os meta resync`, #2705). */
  kernel: any;
  /**
   * Create-table / add-column work the boot sync was held back from running
   * (#3917). Always `[]` unless the stack was booted with `deferSchemaDdl`.
   */
  pendingSchemaWork: PendingSchemaWork[];
  /**
   * Perform the deferred sync — call only once the operator has confirmed the
   * plan. Returns the work it actually ran (`[]` when nothing was deferred).
   */
  flushSchemaDdl: () => Promise<PendingSchemaWork[]>;
  shutdown: () => Promise<void>;
}

const SQL_DRIVER_SERVICES = [
  'driver.com.objectstack.driver.sql',
  'driver.com.objectstack.driver.turso',
  'driver.sql',
];

/** Locate the SQL driver behind any `getService`-shaped lookup (kernel or plugin ctx). */
function findSqlDriverVia(getService: (name: string) => any): SqlDriverLike | null {
  for (const name of SQL_DRIVER_SERVICES) {
    let d: any;
    try { d = getService(name); } catch { /* not registered */ }
    if (d && typeof d.detectManagedDrift === 'function' && typeof d.applyMigrationEntries === 'function') {
      return d as SqlDriverLike;
    }
  }
  return null;
}

function findSqlDriver(kernel: any): SqlDriverLike | null {
  return findSqlDriverVia((name) => kernel?.getService?.(name));
}

/**
 * Arms the SQL driver's deferred-DDL mode before boot schema-sync can run
 * (#3917).
 *
 * Timing is the whole point, and it is why this is a plugin rather than a call
 * in `bootSchemaStack`. The kernel runs **every** plugin's `init()` (Phase 1)
 * before **any** `start()` (Phase 2). `DefaultDatasourcePlugin` connects the
 * driver and registers it as `driver.*` in its `init()`; `ObjectQLPlugin` runs
 * `syncRegisteredSchemas` — the create-table/add-column DDL this issue is about
 * — in its `start()`. An `init()` that depends on the datasource plugin
 * therefore lands in the one window where the driver exists and no DDL has run.
 */
class DeferSchemaDdlPlugin {
  name = 'com.objectstack.cli.defer-schema-ddl';
  version = '1.0.0';
  /** Ordering, not optionality: our init must follow the one that registers `driver.*`. */
  dependencies = ['com.objectstack.runtime.default-datasource'];

  driver: SqlDriverLike | null = null;

  init = async (ctx: any) => {
    this.driver = findSqlDriverVia((name) => ctx.getService(name));
    if (!this.driver) {
      // No SQL driver (memory/mongo) — nothing issues DDL, nothing to defer.
      ctx.logger?.debug?.('[defer-schema-ddl] no SQL driver — deferral not armed');
      return;
    }
    if (typeof this.driver.setDeferredDdl !== 'function') {
      // Fail loudly rather than silently boot-syncing: the caller asked for a
      // dry run and this driver cannot give one.
      throw new Error(
        'The active SQL driver does not support deferred schema DDL, so this command cannot ' +
        'guarantee a dry run. Upgrade @objectstack/driver-sql.',
      );
    }
    this.driver.setDeferredDdl(true);
  };
}

/**
 * Name the database the migrate/resync commands are about to write to.
 *
 * Shares the startup banner's renderer (#3793): the same
 * `{ connectionString }` shape that made the banner print `(unknown)` used to
 * fall through here to a bare `pg` — and this string is what the
 * `Apply N change(s) to …?` confirm shows, so it has to name the real target.
 * Falls back to the client name only when the config carries no address at all.
 */
function describeDb(driver: SqlDriverLike | null): string {
  const cfg: any = driver?.config;
  if (!cfg) return 'unknown';
  return describeDriverConnection(cfg) ?? String(cfg.client ?? 'unknown');
}

/** Boot the schema stack. Caller MUST call `shutdown()` when done. */
export async function bootSchemaStack(
  opts: {
    databaseUrl?: string;
    /**
     * Service plugins to register after the data stack (driver/metadata/
     * objectql/app) and before start — e.g. `os migrate files-to-references`
     * adds settings + storage so `sys_file` and the deployment's real storage
     * adapter are present. Plain schema commands pass nothing.
     */
    extraPlugins?: unknown[];
    /**
     * Boot WITHOUT touching the target database (#3917).
     *
     * Boot schema-sync issues create-table / add-column DDL, and the artifact's
     * inline seed writes rows — both used to happen before `os migrate plan`
     * rendered its "dry run" and before `os migrate apply` asked `[y/N]`. With
     * this set, the driver registers metadata but records the physical work
     * instead of performing it ({@link SchemaStack.pendingSchemaWork}), and the
     * seed is suppressed, so the boot is read-only and the plan describes the
     * database as it actually is. Call {@link SchemaStack.flushSchemaDdl} after
     * confirmation to perform the work.
     *
     * Commands that boot in order to READ AND WRITE DATA (`os meta resync`,
     * `os migrate files-to-references`) must leave this off — they need the
     * tables to exist.
     */
    deferSchemaDdl?: boolean;
  } = {},
): Promise<SchemaStack> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const defer = opts.deferSchemaDdl === true;

  const stack = await createStandaloneStack({
    projectRoot: process.cwd(),
    ...(opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}),
    ...(defer ? { skipSeedData: true } : {}),
  });

  // No HTTP, no cluster — this is a one-shot schema operation.
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) {
    await kernel.use(plugin);
  }
  if (defer) {
    await kernel.use(new DeferSchemaDdlPlugin() as any);
  }
  for (const plugin of opts.extraPlugins ?? []) {
    await kernel.use(plugin as any);
  }
  await runtime.start();

  const driver = findSqlDriver(kernel);
  const managedTableCount = driver ? (driver as any).managedObjectFields?.size ?? 0 : 0;
  const pendingSchemaWork = defer && driver?.previewDeferredSchemaWork
    ? await driver.previewDeferredSchemaWork()
    : [];

  return {
    driver,
    dbLabel: describeDb(driver),
    managedTableCount,
    kernel,
    pendingSchemaWork,
    flushSchemaDdl: async () => (defer && driver?.flushDeferredSchemaDdl
      ? await driver.flushDeferredSchemaDdl()
      : []),
    shutdown: async () => {
      try { await (runtime as any).stop?.(); } catch { /* ignore */ }
      try { await driver?.disconnect?.(); } catch { /* ignore */ }
    },
  };
}

// ── Rendering ───────────────────────────────────────────────────────

const CATEGORY_ORDER: DriftCategory[] = ['safe', 'needs_confirm', 'destructive'];

const CATEGORY_META: Record<DriftCategory, { label: string; color: (s: string) => string; icon: string }> = {
  safe: { label: 'Safe (loosening — applied without --allow-destructive)', color: chalk.green, icon: '✓' },
  needs_confirm: { label: 'Needs confirmation', color: chalk.yellow, icon: '~' },
  destructive: { label: 'Destructive (requires --allow-destructive)', color: chalk.red, icon: '✗' },
};

export function groupByCategory(drift: ManagedDriftEntry[]): Record<DriftCategory, ManagedDriftEntry[]> {
  const out: Record<DriftCategory, ManagedDriftEntry[]> = { safe: [], needs_confirm: [], destructive: [] };
  for (const d of drift) out[d.category].push(d);
  return out;
}

/**
 * What a drift entry acts on. Column ops read `table.column`; index ops (#3728)
 * name the index instead — a composite unique spans several columns, so the
 * leading column alone would misrepresent what is about to change.
 */
export function driftTarget(d: ManagedDriftEntry): string {
  const op = d.op as { indexName?: string; createIndexName?: string };
  const indexName = op.indexName ?? op.createIndexName;
  return indexName ? `${d.table} [${indexName}]` : `${d.table}.${d.column ?? ''}`;
}

export function renderPlan(drift: ManagedDriftEntry[]): void {
  const grouped = groupByCategory(drift);
  for (const cat of CATEGORY_ORDER) {
    const items = grouped[cat];
    if (items.length === 0) continue;
    const meta = CATEGORY_META[cat];
    console.log(`  ${chalk.bold(meta.label)}`);
    for (const d of items) {
      console.log(`    ${meta.color(meta.icon)} ${meta.color(driftTarget(d))} ${chalk.dim(`[${d.op.type}]`)}`);
      console.log(`        ${chalk.dim(d.message)}`);
    }
    console.log('');
  }
}

export function summarize(drift: ManagedDriftEntry[]): string {
  const g = groupByCategory(drift);
  return `${drift.length} change(s): ${g.safe.length} safe, ${g.needs_confirm.length} needs-confirm, ${g.destructive.length} destructive`;
}

/**
 * Render the work the boot sync was held back from doing (#3917), in two
 * sections split by whether it touches existing data (#3954).
 *
 * Deliberately its own block rather than a `DriftCategory`: this is not
 * divergence between metadata and an existing column — it is what used to
 * happen silently at boot, now shown before it runs.
 *
 * The split matters. The additive section tells the operator the work is never
 * data-losing, and that promise must not quietly come to cover the datetime
 * convergence, which rewrites rows (SQLite) or rebuilds a column (MySQL). Those
 * get their own heading, and their row counts, because "how long will this hold
 * the table" is the question they raise and the additive kinds do not.
 */
export function renderPendingSchemaWork(pending: PendingSchemaWork[]): void {
  if (pending.length === 0) return;

  const additive = pending.filter((p) => !isInPlaceSchemaWork(p.kind));
  const inPlace = pending.filter((p) => isInPlaceSchemaWork(p.kind));

  if (additive.length > 0) {
    console.log(`  ${chalk.bold('New (additive — created when you apply)')}`);
    for (const p of additive) {
      const detail = p.kind === 'create_table'
        ? `[create_table, ${p.columns.length} column(s)]`
        : `[add_columns: ${p.columns.join(', ')}]`;
      console.log(`    ${chalk.cyan('+')} ${chalk.cyan(p.table)} ${chalk.dim(detail)}`);
    }
    console.log('');
  }

  if (inPlace.length > 0) {
    console.log(`  ${chalk.bold('In place (existing rows converged when you apply)')}`);
    for (const p of inPlace) {
      const label = p.kind === 'normalize_datetime_storage'
        ? 'normalize_datetime_storage'
        : 'widen_datetime_columns';
      // A MySQL widen is `ALTER … MODIFY`, i.e. a full table rebuild holding a
      // metadata lock — worth saying outright, not just implying via the count.
      const cost = p.kind === 'widen_datetime_columns'
        ? `${formatRows(p.rows)} row table rebuild`
        : `${formatRows(p.rows)} row update(s)`;
      console.log(
        `    ${chalk.yellow('~')} ${chalk.yellow(p.table)} ` +
        `${chalk.dim(`[${label}: ${p.columns.join(', ')} — ${cost}]`)}`,
      );
    }
    console.log('');
  }
}

/** `rows` is optional on the type; an unmeasured count reads as unknown, not zero. */
function formatRows(rows: number | undefined): string {
  return rows === undefined ? '?' : rows.toLocaleString('en-US');
}

export function summarizePendingSchemaWork(pending: PendingSchemaWork[]): string {
  const creates = pending.filter((p) => p.kind === 'create_table').length;
  const columns = pending
    .filter((p) => p.kind === 'add_columns')
    .reduce((n, p) => n + p.columns.length, 0);
  const parts = [`${creates} table(s) to create`, `${columns} column(s) to add`];

  // Only mentioned when there is some, so the common in-sync summary is
  // unchanged — but never omitted when there is, which is the #3954 point.
  const inPlace = pending.filter((p) => isInPlaceSchemaWork(p.kind));
  if (inPlace.length > 0) {
    const cols = inPlace.reduce((n, p) => n + p.columns.length, 0);
    const rows = inPlace.reduce((n, p) => n + (p.rows ?? 0), 0);
    parts.push(`${cols} datetime column(s) to converge in place (~${formatRows(rows)} rows)`);
  }
  return parts.join(', ');
}
