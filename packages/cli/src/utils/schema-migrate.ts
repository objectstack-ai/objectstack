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
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { describeDriverConnection } from './connection-display.js';
import { reserveStdoutForJson } from './json-stdout.js';

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
   * Every object the booted stack knows about — the set the plan is computed
   * against, including objects that arrived from installed packages rather than
   * this project's `objectstack.config.ts`. Read by the ADR-0120 D5e
   * unique-scope advisory; best-effort (`[]` when no ObjectQL service composed).
   */
  allObjects: () => unknown[];
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
    /**
     * `true` when this run's stdout belongs to a machine-readable payload
     * (`--json`) — the boot then sends everything the kernel and its plugins
     * write to **stderr** so `JSON.parse(stdout)` succeeds on the whole
     * stream, with no heuristic extraction (#6217).
     *
     * REQUIRED, and required on purpose. Every command in this family declares
     * a `--json` flag, and each of them re-introduced the same defect
     * independently: `os migrate plan` / `apply` / `resume` / `recorded-by` /
     * `summary-nulls` / `value-shapes` / `files-to-references`, `os migrate
     * meta --stored` and `os meta resync` all emitted ~60 INFO lines around
     * their payload. Booting the stack is what makes a command a member of
     * this family, so this is the one place a new member cannot avoid — and
     * with no default, a new member has to *decide* rather than inherit the
     * bug. Pass `false` from anything that owns stdout itself (every
     * human-mode run, and every test).
     *
     * The reservation is NOT lifted when the boot fails: a half-started kernel
     * can still log, and the command's next act on that path is to emit its
     * error payload. Lifting it would put those two on the same stream, which
     * is the defect. `shutdown()` lifts it on the success path, once the kernel
     * is down and nothing is left to write. See `./json-stdout.ts`.
     */
    jsonOutput: boolean;
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
    /**
     * Boot WITHOUT BRINGING A DATABASE INTO EXISTENCE (#6743).
     *
     * `deferSchemaDdl` stopped the boot from writing DDL and seed rows, but the
     * sqlite driver still opened its target in SQLite's default create-if-absent
     * mode — so `os migrate plan` on a never-started project left a 0-table
     * `.objectstack/data/objectstack.db` (plus its `-wal`/`-shm` on an unclean
     * exit) behind: a write side effect from a command that calls itself a dry
     * run, and one that makes "this project has no database yet" unobservable
     * to the next command.
     *
     * With this set, a missing sqlite file is opened as an empty `:memory:`
     * database instead. A database with zero tables is exactly what a freshly
     * created empty file is, so the plan is byte-for-byte the one printed
     * before — the report was never the defect and must not pay for the fix.
     *
     * ⚠️ NOT implied by `deferSchemaDdl`, and it must not become so:
     * `os migrate apply` also boots deferred, then FLUSHES the deferred DDL
     * once the operator confirms. Writes into the `:memory:` stand-in would be
     * discarded at disconnect, so `apply` keeps the default.
     */
    readOnlyProbe?: boolean;
    /**
     * Project root the booted stack scopes its on-disk state to — the default
     * sqlite database and the metadata FileSystemRepository
     * (`<projectRoot>/.objectstack/…`). Defaults to `process.cwd()`, which is
     * correct for every real `os migrate` invocation: the CLI runs from the
     * project directory.
     *
     * Tests that assemble a fixture project in a tempdir must pass it, or the
     * boot scopes its database to the tempdir while writing metadata into
     * whatever directory the test runner happens to be standing in (#4065).
     */
    projectRoot?: string;
  },
): Promise<SchemaStack> {
  // Taken BEFORE the first line the boot can print. `createStandaloneStack`
  // announces a missing compiled artifact on `console.log` before any plugin
  // is constructed, so a reservation installed one statement later already
  // arrives too late to keep stdout a single JSON document (#6217).
  const releaseStdout = opts.jsonOutput ? reserveStdoutForJson() : () => { /* stdout is the caller's */ };

  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const defer = opts.deferSchemaDdl === true;

  const stack = await createStandaloneStack({
    projectRoot: opts.projectRoot ?? process.cwd(),
    ...(opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}),
    ...(defer ? { skipSeedData: true } : {}),
    ...(opts.readOnlyProbe ? { sqliteAbsentFile: 'empty-in-memory' as const } : {}),
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
    /**
     * Every object this booted stack knows about — the same set the plan is
     * computed against.
     *
     * Exposed for the ADR-0120 D5e advisory in `os migrate plan`: the advisory
     * must describe the objects the migration is actually planning for, not a
     * re-read of `objectstack.config.ts`, which on a runtime serving installed
     * marketplace packages is a strict subset. Best-effort — a stack with no
     * ObjectQL service reports none, and the advisory then simply says nothing.
     */
    allObjects: (): unknown[] => {
      try {
        // The `objectql` slot's contract is `IObjectQLEngine` (#4251) — read it
        // through that rather than erasing the lookup to `any`, so a rename of
        // `registry` / `getAllObjects` breaks this at compile time instead of
        // silently reporting zero objects and turning the D5e advisory mute.
        const getService = (kernel as { getService?: (name: string) => unknown })?.getService;
        const ql = getService?.call(kernel, 'objectql') as IObjectQLEngine | undefined;
        return ql?.registry?.getAllObjects?.() ?? [];
      } catch {
        return [];
      }
    },
    flushSchemaDdl: async () => (defer && driver?.flushDeferredSchemaDdl
      ? await driver.flushDeferredSchemaDdl()
      : []),
    /**
     * Tear the one-shot stack down through the kernel's own teardown — the
     * same `kernel.shutdown()` `os serve` runs on SIGTERM, so a one-shot
     * command and a server take ONE path out (#4747).
     *
     * It used to call `(runtime as any).stop?.()`. `Runtime` has no `stop` —
     * the optional-call swallowed that fact, so every `os migrate` subcommand
     * closed its driver while leaving the kernel fully "running": no plugin
     * ever got `destroy()`, and the ADR-0057 lifecycle sweep stayed armed. 60s
     * later it woke inside the still-alive process and read through the pool
     * this line had already closed, which is why a successful command ended in
     * `ERROR Find operation failed` and a #4551 report naming `sys_metadata` /
     * `sys_view_definition` as unreadable. A cast plus `?.` is how a missing
     * teardown looks exactly like a performed one; there is no version of that
     * call that could ever have worked.
     *
     * The explicit `disconnect()` stays as the backstop for a driver this
     * kernel did not register through `DefaultDatasourcePlugin` (whose own
     * `destroy()` closes the ones it owns); a second disconnect is a no-op.
     */
    shutdown: async () => {
      try { await kernel.shutdown(); } catch { /* teardown is best-effort */ }
      try { await driver?.disconnect?.(); } catch { /* ignore */ }
      // Only now — `kernel.shutdown()` is itself two INFO lines ("Graceful
      // shutdown started" / "complete"), and under `--json` those printed
      // BELOW the payload, which is half of what made stdout unparseable
      // (#6217). Released after the kernel is down, when nothing is left to
      // write; a failed boot never reaches here on purpose.
      releaseStdout();
    },
  };
}

// ── Rendering ───────────────────────────────────────────────────────

/**
 * Load the driver's additive/in-place classifier at the moment it is used,
 * rather than when this module is loaded (#5726).
 *
 * `isInPlaceSchemaWork` is the ONLY thing this module needs from
 * `@objectstack/driver-sql` at runtime — everything else it takes from that
 * package is `import type`, which erases. A *static* value import for it was
 * not a local cost, because this file is not loaded only when someone migrates:
 * oclif's `findCommand` `import()`s every command module on **every** CLI
 * invocation, and nine commands reach this file (`meta:resync`, `migrate`, and
 * seven `migrate:*`). So an unbuilt `packages/drivers/driver-sql/dist` did not
 * merely break those nine — running *any* command, `os dev` included, printed
 * one `MODULE_NOT_FOUND` block per command in front of the output you asked for
 * (and `os dev` forks a child, so you saw each one twice), while the nine
 * dropped out of the command table entirely: `os migrate plan` answered
 * `Command migrate:plan not found.` None of that noise named the real cause
 * (`pnpm build`) and the one actionable line it ended on pointed elsewhere.
 *
 * Deliberately a lazy import of the driver's own predicate rather than a copy
 * of it here. The additive/in-place split is a fact about
 * `PendingSchemaWorkKind`, declared next to that union in the driver; a second
 * copy in the CLI would be free to disagree the day a kind is added — and the
 * way it would disagree is by listing a row rewrite under a heading that
 * promises the work is never data-losing (#3954). One definition, loaded later.
 *
 * By the time either renderer runs, the caller is holding a live SQL driver
 * (the entries it renders came from `previewDeferredSchemaWork()`), so the
 * module is already in the loader cache and this costs nothing. It is
 * deliberately not wrapped in a `try`: if it ever did fail, rendering must fail
 * loudly rather than fall back to a guess about which work rewrites data.
 */
async function loadIsInPlaceSchemaWork(): Promise<(kind: PendingSchemaWork['kind']) => boolean> {
  const { isInPlaceSchemaWork } = await import('@objectstack/driver-sql');
  return isInPlaceSchemaWork;
}

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
export async function renderPendingSchemaWork(pending: PendingSchemaWork[]): Promise<void> {
  if (pending.length === 0) return;

  const isInPlaceSchemaWork = await loadIsInPlaceSchemaWork();
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
      // A MySQL widen is `ALTER … MODIFY`, i.e. a full table rebuild holding a
      // metadata lock — worth saying outright, not just implying via the count.
      const cost = p.kind === 'widen_datetime_columns' || p.kind === 'widen_time_columns'
        ? `${formatRows(p.rows)} row table rebuild`
        : `${formatRows(p.rows)} row update(s)`;
      console.log(
        `    ${chalk.yellow('~')} ${chalk.yellow(p.table)} ` +
        `${chalk.dim(`[${p.kind}: ${p.columns.join(', ')} — ${cost}]`)}`,
      );
    }
    console.log('');
  }
}

/** `rows` is optional on the type; an unmeasured count reads as unknown, not zero. */
function formatRows(rows: number | undefined): string {
  return rows === undefined ? '?' : rows.toLocaleString('en-US');
}

export async function summarizePendingSchemaWork(pending: PendingSchemaWork[]): Promise<string> {
  const creates = pending.filter((p) => p.kind === 'create_table').length;
  const columns = pending
    .filter((p) => p.kind === 'add_columns')
    .reduce((n, p) => n + p.columns.length, 0);
  const parts = [`${creates} table(s) to create`, `${columns} column(s) to add`];

  // Only mentioned when there is some, so the common in-sync summary is
  // unchanged — but never omitted when there is, which is the #3954 point.
  const isInPlaceSchemaWork = await loadIsInPlaceSchemaWork();
  const inPlace = pending.filter((p) => isInPlaceSchemaWork(p.kind));
  if (inPlace.length > 0) {
    const cols = inPlace.reduce((n, p) => n + p.columns.length, 0);
    const rows = inPlace.reduce((n, p) => n + (p.rows ?? 0), 0);
    parts.push(`${cols} temporal column(s) to converge in place (~${formatRows(rows)} rows)`);
  }
  return parts.join(', ');
}
