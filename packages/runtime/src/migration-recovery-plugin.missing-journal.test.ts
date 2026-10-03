// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21529] The boot's migration journal scan reads a journal TABLE that does
 * not exist as "no runs", and says nothing.
 *
 * ## The measured defect
 *
 * `os migrate resume`, `recorded-by` and `value-shapes` boot read-only on a
 * project whose database does not exist yet: the SQL driver defers every
 * table's DDL, so `sys_migration_journal` is registered and absent. The scan
 * this plugin runs at `kernel:ready` read it anyway and logged "Migration
 * journal scan failed; interrupted migrations (if any) were NOT detected" on
 * every such run. A database with no journal table has no journalled run, so
 * that line was a false alarm on exactly the boot an operator runs first.
 *
 * ## What is pinned
 *
 * Every case drives the plugin's real `kernel:ready` scan over a real
 * `ObjectQL` engine on a real SQLite `SqlDriver`, with the platform's own
 * journal object registered:
 *
 *  1. DDL deferred, the journal table absent: no warning at all (the refusal
 *     the driver throws is the one the CLI boot meets).
 *  2. The control: the same engine with its DDL performed and one interrupted
 *     run journalled. The scan reads the table and reports the run, so the
 *     silence in 1 is not a scan that never ran.
 *  3. The predicate's other side: a missing-table refusal naming a relation
 *     that is not the journal, in the shape a driver gives when it declares
 *     no target (the dialect's own `no such table: <name>`), still warns
 *     "scan failed". The plugin names the journal to the predicate, so only
 *     the journal's own absence is "no runs"; asked without that name, the
 *     predicate would read this refusal as benign too.
 *
 * Any other refusal still warning is pinned in `migration-recovery-plugin.test.ts`
 * ("reports a scan FAILURE rather than reading it as nothing found").
 *
 * Every engine is built in a hook: a case only drives the scan.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMigrationJournal } from '@objectstack/platform-objects/system';
import { MigrationRecoveryPlugin } from './migration-recovery-plugin.js';

const JOURNAL = 'sys_migration_journal';
const SYSTEM = { context: { isSystem: true } };

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

interface Booted {
  driver: SqlDriver;
  engine: ObjectQL;
}

/** An engine over an in-memory SQLite database, the journal object registered. */
async function engineOver(opts: { deferDdl: boolean }): Promise<Booted> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as any);
  (driver as unknown as { logger: typeof quiet }).logger = quiet;
  // What the read-only CLI boot arms before schema sync.
  if (opts.deferDdl) driver.setDeferredDdl(true);
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(SysMigrationJournal as any);
  await engine.syncSchemas();
  return { driver, engine };
}

/** Run the plugin's `kernel:ready` scan over `engine`, and return what it warned. */
async function scanWarnings(engine: unknown): Promise<string[]> {
  const warns: string[] = [];
  const hooks: Array<() => Promise<void> | void> = [];
  const services = new Map<string, unknown>([['objectql', engine]]);
  const ctx: any = {
    logger: { ...quiet, warn: (m: unknown) => { warns.push(String(m)); } },
    registerService: (name: string, service: unknown) => services.set(name, service),
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name);
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
  };
  const plugin = new MigrationRecoveryPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  for (const fn of hooks) await fn();
  return warns;
}

let fresh: Booted;
let booted: Booted;
/** A dialect refusal for a relation that is not the journal, with no declared target. */
const otherTableRefusal = Object.assign(new Error('SQLITE_ERROR: no such table: os21529_other'), {
  code: 'SQLITE_ERROR',
});

let freshWarns: string[];
let bootedWarns: string[];
let otherTableWarns: string[];

beforeAll(async () => {
  fresh = await engineOver({ deferDdl: true });
  booted = await engineOver({ deferDdl: false });
  await booted.engine.insert(
    JOURNAL,
    { run_id: 'run_21529', seq: 0, kind: 'run_started', plan_hash: 'h', detail: JSON.stringify({ planId: 'plan_21529' }) },
    SYSTEM,
  );
  await booted.engine.insert(JOURNAL, { run_id: 'run_21529', seq: 1, kind: 'chunk_started', chunk_index: 0 }, SYSTEM);

  const refusing = {
    getObject: (name: string) => fresh.engine.getObject(name),
    find: async () => { throw otherTableRefusal; },
  };

  freshWarns = await scanWarnings(fresh.engine);
  bootedWarns = await scanWarnings(booted.engine);
  otherTableWarns = await scanWarnings(refusing);
}, 60_000);

afterAll(async () => {
  await fresh?.driver.disconnect();
  await booted?.driver.disconnect();
});

describe('[#21529] the boot journal scan on a database with no journal table', () => {
  it('the deferred journal table really is absent: the scan read it and was refused', async () => {
    // Non-vacuity: the same read the scan makes is refused on this engine.
    await expect(
      fresh.engine.find(JOURNAL, { where: { kind: 'run_started' } }, SYSTEM),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', status: 500 });
  });

  it('says nothing: no journal table is no journalled run', () => {
    expect(freshWarns).toEqual([]);
  });

  it('control: with the table there, the scan reads it and reports the interrupted run', () => {
    const all = bootedWarns.join('\n');
    expect(all).toContain("run 'run_21529'");
    expect(all).toContain("plan 'plan_21529'");
    expect(all).not.toContain('scan failed');
  });

  it('a missing table that is not the journal is still "I could not check"', () => {
    expect(otherTableWarns).toHaveLength(1);
    expect(otherTableWarns[0]).toContain('Migration journal scan failed');
    expect(otherTableWarns[0]).toContain('NOT detected');
  });
});
