// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31715] The boot's schema sync — `ObjectQLPlugin.start()` Phases 1 to 3, the
 * sync every server boot runs, an `OS_MIGRATE_AND_EXIT=1` job included — takes
 * the schema-migration lock `os migrate apply` takes, and lets go of it once
 * Phase 3 is done.
 *
 * ## What it inverts, measured on live Postgres before the lock
 *
 * Three `OS_MIGRATE_AND_EXIT=1` boots whose first database round trips were
 * held together: one table (`sys_migration`) created twice, a `pg_type`
 * unique-key collision, and the losing boot logged `Schema sync FAILED` for
 * that object — while all three exited 0.
 *
 * ## How this file sees the lock
 *
 * Through the statements it sends: the default driver here is a stub whose
 * `getKnex()` answers a recording Postgres-dialect knex, and whose `syncSchema`
 * writes into the same log. So the order of the lock, the DDL and the unlock
 * is read off one sequence. The live half (concurrent boots on a real
 * database) is `packages/cli/src/utils/schema-migration-lock.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { SCHEMA_MIGRATION_PG_LOCK_KEY } from './schema-migration-lock.js';

const OBJECT = 'lock_case';

interface StubOptions {
  /** `false` ⇒ `pg_try_advisory_lock` answers false: another migrator holds it. */
  uncontended?: boolean;
  /** The driver's `schemaDdlDeferred` reading. */
  deferred?: boolean;
  /** `undefined` ⇒ no `getKnex` at all (a memory / non-SQL driver). */
  dialect?: string;
}

/** A default driver whose knex and DDL write into one ordered log. */
function makeStub(opts: StubOptions = {}) {
  const log: string[] = [];
  const knex = {
    client: {
      dialect: opts.dialect,
      async acquireRawConnection() { log.push('connection:open'); return {}; },
      async destroyRawConnection() { log.push('connection:close'); },
    },
    raw(sql: string, bindings: readonly unknown[] = []) {
      return {
        async connection() {
          log.push(sql);
          if (bindings.length && sql.includes('advisory')) expect(bindings[0]).toBe(SCHEMA_MIGRATION_PG_LOCK_KEY);
          if (sql.startsWith('select pg_try_advisory_lock')) return { rows: [{ locked: opts.uncontended !== false }] };
          return { rows: [{}] };
        },
      };
    },
  };
  const driver: Record<string, unknown> = {
    name: 'default', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema(table: string) { log.push(`syncSchema:${table}`); },
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
  };
  if (opts.dialect !== undefined) driver.getKnex = () => knex;
  if (opts.deferred !== undefined) driver.schemaDdlDeferred = opts.deferred;
  return { driver, log };
}

interface Booted {
  log: string[];
  warns: string[];
  error: unknown;
}

async function boot(opts: StubOptions & { skipSchemaSync?: boolean; failAfterPhase1?: boolean } = {}): Promise<Booted> {
  const { driver, log } = makeStub(opts);
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const warns: string[] = [];
  await kernel.use({
    name: 'lock-stub-driver', type: 'driver', version: '1.0.0',
    init: async (ctx: any) => { ctx.registerService('driver.default', driver); },
  } as any);
  const plugin = new ObjectQLPlugin({ skipSchemaSync: opts.skipSchemaSync === true });
  const start = plugin.start.bind(plugin);
  plugin.start = async (ctx: any) => {
    const warn = ctx.logger.warn.bind(ctx.logger);
    ctx.logger.warn = (message: unknown, ...rest: unknown[]) => { warns.push(String(message)); return warn(message, ...rest); };
    // An object the boot has to sync, registered as an app's would be.
    ctx.getService('objectql').registry.registerObject({
      name: OBJECT, label: 'Lock Case', fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    });
    if (opts.failAfterPhase1) {
      (plugin as any).restoreMetadataFromDb = async () => { log.push('phase2:throws'); throw new Error('hydration refused'); };
    }
    return start(ctx);
  };
  await kernel.use(plugin);
  let error: unknown;
  try {
    await kernel.bootstrap();
  } catch (e) {
    error = e;
  }
  try { await kernel.shutdown(); } catch { /* teardown is best-effort */ }
  return { log, warns, error };
}

const LOCK = 'select pg_try_advisory_lock(?::bigint) as locked';
const UNLOCK = 'select pg_advisory_unlock(?::bigint)';
const isLockStatement = (line: string) => line.includes('advisory');

describe('the boot schema sync takes the schema-migration lock (#31715)', () => {
  it('⭐ locks before the first DDL, unlocks after the last, and closes its own session', async () => {
    const { log, error } = await boot({ dialect: 'postgresql' });
    expect(error).toBeUndefined();
    const syncs = log.flatMap((line, i) => (line.startsWith('syncSchema:') ? [i] : []));
    expect(log.filter((line) => line === `syncSchema:${OBJECT}`).length).toBeGreaterThan(0);
    const lockAt = log.indexOf(LOCK);
    const unlockAt = log.indexOf(UNLOCK);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(syncs[0]);
    expect(unlockAt).toBeGreaterThan(syncs[syncs.length - 1]);
    expect(log.indexOf('connection:close')).toBeGreaterThan(unlockAt);
  });

  it('uncontended: ONE lock statement, and nothing logged about it (single-node output unchanged)', async () => {
    const { log, warns } = await boot({ dialect: 'postgresql' });
    expect(log.filter(isLockStatement)).toEqual([LOCK, UNLOCK]);
    expect(warns.filter((w) => /schema migration/i.test(w))).toEqual([]);
  });

  it('contended: says ONCE that it waits, then syncs only once it holds the lock', async () => {
    const { log, warns, error } = await boot({ dialect: 'postgresql', uncontended: false });
    expect(error).toBeUndefined();
    expect(warns.filter((w) => /Another schema migration is running on the default datasource's database/.test(w))).toHaveLength(1);
    const waitedAt = log.indexOf('select pg_advisory_lock(?::bigint)');
    expect(waitedAt).toBeGreaterThan(-1);
    expect(waitedAt).toBeLessThan(log.findIndex((line) => line.startsWith('syncSchema:')));
  });

  it('a boot that fails between the phases still lets go of the lock', async () => {
    const { log, error } = await boot({ dialect: 'postgresql', failAfterPhase1: true });
    expect(error).toBeDefined();
    expect(log.indexOf(UNLOCK)).toBeGreaterThan(log.indexOf('phase2:throws'));
    expect(log).toContain('connection:close');
  });

  it('no lock where this boot runs no DDL: skipSchemaSync, or a default driver holding its DDL back', async () => {
    const skipped = await boot({ dialect: 'postgresql', skipSchemaSync: true });
    expect(skipped.log.filter(isLockStatement)).toEqual([]);
    const deferred = await boot({ dialect: 'postgresql', deferred: true });
    expect(deferred.log.filter(isLockStatement)).toEqual([]);
    expect(deferred.log).not.toContain('connection:open');
  });

  it('control — a driver that is neither Postgres nor MySQL gets no statement, and the boot syncs as before', async () => {
    const sqlite = await boot({ dialect: 'sqlite3' });
    expect(sqlite.log).not.toContain('connection:open');
    expect(sqlite.log).toContain(`syncSchema:${OBJECT}`);
    const memory = await boot({});
    expect(memory.log).toContain(`syncSchema:${OBJECT}`);
  });
});
