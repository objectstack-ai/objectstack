// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21243 — `sys_packages` is created in the dialect of the driver it lands on,
 * and a DDL refusal is reported, not swallowed.
 *
 * ## What was broken
 *
 * `ensureTable` sent one raw statement set to every driver and caught EVERY
 * failure at `debug` as "may already exist". On MySQL the statements fail four
 * independent ways (see `PACKAGE_TABLE_STATEMENTS`), so the table was never
 * created and nothing above `debug` said so; publish then answered
 * `500 DATABASE_ERROR`, and installs answered success over nothing.
 *
 * ## What this suite holds, and what it cannot
 *
 * It holds the WIRING: which statement set a driver's own dialect answer
 * selects, that the answer is asked of the driver `execute()` runs on, how the
 * MySQL index is created only after the catalog says it is absent, and that a
 * refusal leaves `start()` instead of being logged at `debug`. Whether the MySQL
 * statements RUN is a question for a MySQL server, not for this file: they were
 * measured against MySQL 8.0.46, with PostgreSQL 16.14 and SQLite beside them,
 * through the package doors of a booted app (see the PR that landed this).
 * The SQLite cell is also held here, on a real `node:sqlite` database.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PackageServicePlugin, type PackageService } from './index.js';
import {
  ensurePackageTable,
  PACKAGE_ROW_CREATED_AT_SQL,
  PACKAGE_TABLE_STATEMENTS,
  packageRowStamp,
  resolvePackageTableDialect,
} from './package-table.js';

/** An engine whose default driver names `dialectName`, recording every statement it is sent. */
function recordingEngine(opts: {
  dialectName?: unknown;
  answer?: (sql: string, seen: string[]) => unknown;
}) {
  const seen: string[] = [];
  const driver = { dialectName: opts.dialectName };
  const engine: any = {
    getDefaultDriverName: () => 'default',
    getDriverByName: (name: string) => (name === 'default' ? driver : undefined),
    async execute({ sql }: { sql: string }) {
      seen.push(sql);
      return opts.answer ? opts.answer(sql, seen) : [];
    },
  };
  return { engine, seen };
}

const isProbe = (sql: string) => sql === PACKAGE_TABLE_STATEMENTS.mysql.latestIndexProbe;
const isMysqlIndexDdl = (sql: string) => sql === PACKAGE_TABLE_STATEMENTS.mysql.createLatestIndex;

// ---------------------------------------------------------------------------
// 1. The statement set is the one the DRIVER's dialect names
// ---------------------------------------------------------------------------

describe('[#21243] the statement set follows the driver the statements run on', () => {
  it.each([
    ['mysql', 'mysql'],
    ['sqlite', 'standard'],
    ['postgres', 'standard'],
    ['unknown', 'standard'],
    [undefined, 'standard'],
  ] as const)('a default driver naming %s takes the %s set', (dialectName, expected) => {
    expect(resolvePackageTableDialect(recordingEngine({ dialectName }).engine)).toBe(expected);
  });

  it('asks the DEFAULT driver — the one `execute()` routes to — not the object router', () => {
    const { engine } = recordingEngine({ dialectName: 'mysql' });
    engine.getDriverForObject = () => ({ dialectName: 'postgres' });
    expect(resolvePackageTableDialect(engine)).toBe('mysql');
  });

  it('an engine with no driver registry (a test double, a remote engine) takes the standard set', () => {
    expect(resolvePackageTableDialect({ execute: async () => [] } as any)).toBe('standard');
  });
});

// ---------------------------------------------------------------------------
// 2. The MySQL index: created only when the dialect's catalog says it is absent
// ---------------------------------------------------------------------------

describe('[#21243] ensurePackageTable on a MySQL driver', () => {
  it('absent index → CREATE TABLE, probe, CREATE INDEX', async () => {
    const { engine, seen } = recordingEngine({ dialectName: 'mysql', answer: (sql) => (isProbe(sql) ? [[], []] : [[], []]) });
    await ensurePackageTable(engine);
    expect(seen).toEqual([
      PACKAGE_TABLE_STATEMENTS.mysql.createTable,
      PACKAGE_TABLE_STATEMENTS.mysql.latestIndexProbe,
      PACKAGE_TABLE_STATEMENTS.mysql.createLatestIndex,
    ]);
  });

  it('present index (mysql2 `[rows, fields]` with one row) → no CREATE INDEX at all', async () => {
    const { engine, seen } = recordingEngine({
      dialectName: 'mysql',
      answer: (sql) => (isProbe(sql) ? [[{ present: 1 }], []] : [[], []]),
    });
    await ensurePackageTable(engine);
    expect(seen.some(isMysqlIndexDdl)).toBe(false);
  });

  it('a CREATE INDEX refused because another process just created it → the catalog says so, and it stands', async () => {
    let created = false;
    const { engine } = recordingEngine({
      dialectName: 'mysql',
      answer: (sql) => {
        if (isProbe(sql)) return [created ? [{ present: 1 }] : [], []];
        if (isMysqlIndexDdl(sql)) {
          created = true; // the other process won the race
          throw Object.assign(new Error('refused'), { code: 'DATABASE_ERROR', status: 500 });
        }
        return [[], []];
      },
    });
    await expect(ensurePackageTable(engine)).resolves.toBe('mysql');
  });

  it('a CREATE INDEX refused with the index still absent → the refusal itself leaves', async () => {
    const refusal = Object.assign(new Error('refused'), { code: 'DATABASE_ERROR', status: 500 });
    const { engine } = recordingEngine({
      dialectName: 'mysql',
      answer: (sql) => {
        if (isMysqlIndexDdl(sql)) throw refusal;
        return [[], []];
      },
    });
    await expect(ensurePackageTable(engine)).rejects.toBe(refusal);
  });

  it('the standard set issues no catalog probe: its index DDL carries IF NOT EXISTS itself', async () => {
    const { engine, seen } = recordingEngine({ dialectName: 'postgres' });
    await ensurePackageTable(engine);
    expect(seen).toEqual([
      PACKAGE_TABLE_STATEMENTS.standard.createTable,
      PACKAGE_TABLE_STATEMENTS.standard.createLatestIndex,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. A DDL refusal is reported and fails the start — no `debug` swallow
// ---------------------------------------------------------------------------

function pluginContext(engine: unknown) {
  const logs: Array<{ level: string; msg: string; err?: unknown }> = [];
  let registered: PackageService | undefined;
  const ctx: any = {
    logger: {
      debug: (msg: string) => logs.push({ level: 'debug', msg }),
      info: (msg: string) => logs.push({ level: 'info', msg }),
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: (msg: string, err?: unknown) => logs.push({ level: 'error', msg, err }),
    },
    getService: (n: string) => (n === 'objectql' ? engine : undefined),
    // [#23022] `init()` registers `package.storage` too; this captures only
    // the `package` service `start()` registers.
    registerService: (n: string, s: PackageService) => {
      if (n === 'package') registered = s;
    },
  };
  return { ctx, logs, registered: () => registered };
}

describe('[#21243] a refused CREATE TABLE leaves start() — it is not "may already exist"', () => {
  it('the refusal is the rejection, it is logged at error, and no `package` service is registered', async () => {
    // The shape a live SQL driver throws for a refused raw statement (MySQL's
    // `ER_INVALID_DEFAULT` on the old DDL arrived exactly so).
    const refusal = Object.assign(new Error('The database refused to run a raw statement.'), {
      code: 'DATABASE_ERROR',
      status: 500,
    });
    const { engine } = recordingEngine({
      dialectName: 'mysql',
      answer: (sql) => {
        if (sql === PACKAGE_TABLE_STATEMENTS.mysql.createTable) throw refusal;
        return [[], []];
      },
    });
    const { ctx, logs, registered } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);

    await expect(plugin.start(ctx)).rejects.toBe(refusal);

    const errors = logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].err).toBe(refusal);
    expect(logs.some((l) => l.level === 'debug' && /may already exist/.test(l.msg))).toBe(false);
    expect(registered()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. The publish upsert follows the same dialect answer
// ---------------------------------------------------------------------------

describe('[#21243] publish writes with the driver dialect\'s upsert', () => {
  it.each([
    ['mysql', 'mysql'],
    ['sqlite', 'standard'],
  ] as const)('a %s default driver → the %s upsert', async (dialectName, set) => {
    const { engine, seen } = recordingEngine({ dialectName, answer: () => [[], []] });
    const { ctx, registered } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);

    const out = await registered()!.publish({ manifest: { id: 'com.acme.crm', version: '1.0.0' } as any, metadata: {} });

    expect(out).toEqual({ success: true, version: expect.any(String), createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) });
    expect(seen[seen.length - 1]).toBe(PACKAGE_TABLE_STATEMENTS[set].upsert);
  });
});

// ---------------------------------------------------------------------------
// 5. The SQLite cell, unchanged — a real database, the standard set end to end
// ---------------------------------------------------------------------------

describe('[#21243] CONTROL — the standard set on a real SQLite database', () => {
  it('creates the (id, version) table, upserts one version, keeps a second beside it, and reads the latest', async () => {
    const db = new DatabaseSync(':memory:');
    const engine: any = {
      getDefaultDriverName: () => 'default',
      getDriverByName: () => ({ dialectName: 'sqlite' }),
      async execute({ sql, args }: { sql: string; args?: unknown[] }) {
        const stmt = db.prepare(sql);
        return /^\s*select/i.test(sql) ? stmt.all(...((args ?? []) as any[])) : stmt.run(...((args ?? []) as any[]));
      },
    };
    const { ctx, registered } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const svc = registered()!;

    await svc.publish({ manifest: { id: 'com.acme.crm', version: '1.0.0', name: 'v1' } as any, metadata: {} });
    await svc.publish({ manifest: { id: 'com.acme.crm', version: '1.0.0', name: 'v1 again' } as any, metadata: {} });
    await svc.publish({ manifest: { id: 'com.acme.crm', version: '2.0.0', name: 'v2' } as any, metadata: {} });

    const rows = db.prepare('SELECT id, version FROM sys_packages ORDER BY version').all();
    expect(rows).toEqual([
      { id: 'com.acme.crm', version: '1.0.0' },
      { id: 'com.acme.crm', version: '2.0.0' },
    ]);
    expect((await svc.get('com.acme.crm', '1.0.0'))?.manifest).toMatchObject({ name: 'v1 again' });
    const pk = db.prepare("SELECT name FROM pragma_table_info('sys_packages') WHERE pk > 0 ORDER BY pk").all();
    expect(pk).toEqual([{ name: 'id' }, { name: 'version' }]);
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_packages_latest'").all();
    expect(index).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. [#31530] publish answers the row stamp it bound — what a later read answers
// ---------------------------------------------------------------------------

describe('[#31530] publish answers the row\'s version and created_at, from the write itself', () => {
  const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  it('SQLite: a new row\'s answer is what `get` then reads, by latest and by version; a re-publish keeps the row\'s created_at', async () => {
    const db = new DatabaseSync(':memory:');
    const engine: any = {
      getDefaultDriverName: () => 'default',
      getDriverByName: () => ({ dialectName: 'sqlite' }),
      async execute({ sql, args }: { sql: string; args?: unknown[] }) {
        const stmt = db.prepare(sql);
        return /^\s*select/i.test(sql) ? stmt.all(...((args ?? []) as any[])) : stmt.run(...((args ?? []) as any[]));
      },
    };
    const { ctx, registered } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const svc = registered()!;

    const first = await svc.publish({ manifest: { id: 'com.acme.crm-copy', version: '1.0.0', name: 'copy' } as any, metadata: {} });
    expect(first).toEqual({ success: true, version: '1.0.0', createdAt: expect.stringMatching(STAMP) });
    const latest = await svc.get('com.acme.crm-copy');
    expect({ version: latest?.version, createdAt: latest?.created_at }).toEqual({ version: first.version, createdAt: first.createdAt });
    const byVersion = await svc.get('com.acme.crm-copy', '1.0.0');
    expect(byVersion?.created_at).toBe(first.createdAt);
    // The stored column holds the bound text, in the form the database used to write.
    expect(db.prepare('SELECT created_at, updated_at FROM sys_packages').all()).toEqual([{ created_at: first.createdAt, updated_at: first.createdAt }]);

    // An update of the same (id, version) keeps the row's created_at, takes the new updated_at,
    // and ANSWERS the created_at the row keeps — never the stamp it bound for the update.
    db.prepare('UPDATE sys_packages SET created_at = ?, updated_at = ?').run('2026-01-01 00:00:00', '2026-01-01 00:00:00');
    const again = await svc.publish({ manifest: { id: 'com.acme.crm-copy', version: '1.0.0', name: 'copy again' } as any, metadata: {} });
    expect(again).toEqual({ success: true, version: '1.0.0', createdAt: '2026-01-01 00:00:00' });
    const [kept] = db.prepare('SELECT created_at, updated_at FROM sys_packages').all() as Array<{ created_at: string; updated_at: string }>;
    expect(kept!.created_at).toBe('2026-01-01 00:00:00');
    expect(kept!.updated_at).toMatch(STAMP);
    expect(kept!.updated_at).not.toBe('2026-01-01 00:00:00');
    expect((await svc.get('com.acme.crm-copy', '1.0.0'))?.created_at).toBe(again.createdAt);
  });

  it('a read before the write that cannot say whether the row exists leaves the answer without a created_at; the write still lands', async () => {
    for (const fault of ['throws', 'no result set'] as const) {
      const db = new DatabaseSync(':memory:');
      const engine: any = {
        getDefaultDriverName: () => 'default',
        getDriverByName: () => ({ dialectName: 'sqlite' }),
        async execute({ sql, args }: { sql: string; args?: unknown[] }) {
          if (sql === PACKAGE_ROW_CREATED_AT_SQL) {
            if (fault === 'throws') throw new Error('SQLITE_BUSY: database is locked');
            return undefined;
          }
          const stmt = db.prepare(sql);
          return /^\s*select/i.test(sql) ? stmt.all(...((args ?? []) as any[])) : stmt.run(...((args ?? []) as any[]));
        },
      };
      const { ctx, registered } = pluginContext(engine);
      const plugin = new PackageServicePlugin();
      await plugin.init(ctx);
      await plugin.start(ctx);
      const out = await registered()!.publish({ manifest: { id: 'com.acme.crm-copy', version: '1.0.0', name: 'copy' } as any, metadata: {} });
      expect(out, fault).toEqual({ success: true, version: '1.0.0' });
      expect(db.prepare('SELECT id, version FROM sys_packages').all(), fault).toEqual([{ id: 'com.acme.crm-copy', version: '1.0.0' }]);
    }
  });

  it.each(['mysql', 'sqlite'] as const)('%s: the created_at and updated_at bindings are the stamp the answer names', async (dialectName) => {
    const calls: Array<{ sql: string; args?: unknown[] }> = [];
    const engine: any = {
      getDefaultDriverName: () => 'default',
      getDriverByName: () => ({ dialectName }),
      async execute(q: { sql: string; args?: unknown[] }) { calls.push(q); return [[], []]; },
    };
    const { ctx, registered } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    const out = await registered()!.publish({ manifest: { id: 'com.acme.crm', version: '2.0.0' } as any, metadata: {} });
    // The read of the row's created_at runs first, for the same (id, version); no row, so the insert's stamp is answered.
    const read = calls[calls.length - 2]!;
    expect(read).toEqual({ sql: PACKAGE_ROW_CREATED_AT_SQL, args: ['com.acme.crm', '2.0.0'] });
    const upsert = calls[calls.length - 1]!;
    expect(upsert.sql).toBe(PACKAGE_TABLE_STATEMENTS[dialectName === 'mysql' ? 'mysql' : 'standard'].upsert);
    expect(upsert.args).toHaveLength(7);
    expect(upsert.args!.slice(1, 2)).toEqual(['2.0.0']);
    expect(upsert.args!.slice(5)).toEqual([out.createdAt, out.createdAt]);
    expect(out).toEqual({ success: true, version: '2.0.0', createdAt: expect.stringMatching(STAMP) });
  });

  it('packageRowStamp is UTC `YYYY-MM-DD HH:MM:SS`', () => {
    expect(packageRowStamp(new Date('2026-11-08T14:40:07.912Z'))).toBe('2026-11-08 14:40:07');
  });
});
