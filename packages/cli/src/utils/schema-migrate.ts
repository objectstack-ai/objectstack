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
import type { ManagedDriftEntry, DriftCategory } from '@objectstack/driver-sql';
import { describeDriverConnection } from './connection-display.js';

export interface SqlDriverLike {
  detectManagedDrift(): Promise<ManagedDriftEntry[]>;
  applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean },
  ): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }>;
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
  shutdown: () => Promise<void>;
}

const SQL_DRIVER_SERVICES = [
  'driver.com.objectstack.driver.sql',
  'driver.com.objectstack.driver.turso',
  'driver.sql',
];

function findSqlDriver(kernel: any): SqlDriverLike | null {
  for (const name of SQL_DRIVER_SERVICES) {
    let d: any;
    try { d = kernel?.getService?.(name); } catch { /* not registered */ }
    if (d && typeof d.detectManagedDrift === 'function' && typeof d.applyMigrationEntries === 'function') {
      return d as SqlDriverLike;
    }
  }
  return null;
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
  } = {},
): Promise<SchemaStack> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');

  const stack = await createStandaloneStack({
    projectRoot: process.cwd(),
    ...(opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : {}),
  });

  // No HTTP, no cluster — this is a one-shot schema operation.
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) {
    await kernel.use(plugin);
  }
  for (const plugin of opts.extraPlugins ?? []) {
    await kernel.use(plugin as any);
  }
  await runtime.start();

  const driver = findSqlDriver(kernel);
  const managedTableCount = driver ? (driver as any).managedObjectFields?.size ?? 0 : 0;

  return {
    driver,
    dbLabel: describeDb(driver),
    managedTableCount,
    kernel,
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
