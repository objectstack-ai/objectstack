// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13204 — the unmanaged-table sweep, in BOTH directions.
 *
 * The section this covers is informational, which is exactly why its negative
 * control is the load-bearing half. A section only ever observed when an orphan
 * exists has no evidence that it stays quiet when nothing is stranded, and a
 * section that cries wolf on every run gets trained into noise and then
 * ignored — at which point the real orphan it was built for scrolls past
 * unread. So every legitimate platform-prefixed table family measured in this
 * repo gets a test that asserts it is NOT reported:
 *
 *  - a managed table (in the planned driver's `managedObjectFields`);
 *  - a DECLARED-but-unexamined object's table — `composition.coverage`'s
 *    population, deliberately not this one;
 *  - the rotation shards of a declared rotation object (`sys_activity` ships
 *    with `strategy: 'rotation'`, 14 daily shards, and only the BASE name is
 *    ever a `managedObjectFields` key);
 *  - driver-internal tables (`_objectstack_sequences`, `__os_mig_*`);
 *  - an application table with no reserved prefix.
 *
 * And the third direction, which is neither: every way the sweep can fail to
 * OBTAIN an answer must report `unreadable`, never an empty `tables` list.
 * "Did not look" and "looked, found nothing" are byte-identical to a reader
 * otherwise, and they have opposite consequences.
 */

import { describe, it, expect } from 'vitest';
import {
  buildKnownTableNames,
  collectUnmanagedTables,
  describeUnmanagedTable,
  physicalTableListSql,
  readManagedTableNames,
  renderUnmanagedTables,
  resolvePlannedDriverExec,
  rotationBaseOf,
  selectUnmanagedTables,
  type UnmanagedTablesReport,
} from './unmanaged-tables.js';

/** `normalizeRows`' sqlite limb — a bare row array. Kept local so the unit tests hold no driver. */
const normalize = (result: unknown): Record<string, unknown>[] =>
  Array.isArray(result) ? (result as Record<string, unknown>[]) : [];

/**
 * A stand-in for the driver `os migrate plan` diffed: the same two members the
 * sweep reads off it — `managedObjectFields` (the map `detectManagedDrift`
 * iterates) and a raw-SQL `execute`.
 */
function fakeDriver(opts: {
  managed?: string[] | null;
  client?: string | null;
  answer?: unknown | (() => unknown);
}): unknown {
  const driver: Record<string, unknown> = {};
  if (opts.managed !== null) {
    driver.managedObjectFields = new Map((opts.managed ?? []).map((t) => [t, {}]));
  }
  if (opts.client !== null) driver.config = { client: opts.client ?? 'better-sqlite3' };
  if (opts.answer !== undefined) {
    driver.execute = async () =>
      typeof opts.answer === 'function' ? (opts.answer as () => unknown)() : opts.answer;
  }
  return driver;
}

/** Catalog rows in the sqlite shape the sweep's own SELECT produces. */
const rows = (...names: string[]) => names.map((name) => ({ table_name: name }));

/** A composition that mirrors the deployment — the premise the sweep requires. */
const MIRRORED = { hostConfigLoaded: true, hostConfigPath: '/app/objectstack.config.ts' };

async function sweep(opts: {
  managed?: string[] | null;
  declared?: Array<{ name: string }>;
  client?: string | null;
  answer?: unknown | (() => unknown);
  composition?: { hostConfigLoaded: boolean; hostConfigPath: string | null };
}): Promise<UnmanagedTablesReport> {
  return collectUnmanagedTables({
    driver: fakeDriver(opts),
    declaredObjects: opts.declared ?? [],
    composition: opts.composition ?? MIRRORED,
    normalize,
  });
}

describe('physicalTableListSql — one statement per dialect family, null for the rest', () => {
  it('enumerates BASE TABLES on each supported family and excludes views', () => {
    for (const client of ['sqlite3', 'sqlite', 'better-sqlite3']) {
      const sql = physicalTableListSql(client)!;
      expect(sql).toContain('sqlite_master');
      expect(sql).toContain("type = 'table'");
      expect(sql).toContain("name NOT LIKE 'sqlite_%'");
    }
    for (const client of ['postgres', 'pg', 'postgresql', 'pgnative']) {
      const sql = physicalTableListSql(client)!;
      expect(sql).toContain('information_schema.tables');
      expect(sql).toContain('current_schemas(false)');
      expect(sql).toContain("table_type = 'BASE TABLE'");
    }
    for (const client of ['mysql', 'mysql2']) {
      const sql = physicalTableListSql(client)!;
      expect(sql).toContain('information_schema.tables');
      expect(sql).toContain('DATABASE()');
      expect(sql).toContain("table_type = 'BASE TABLE'");
    }
  });

  it('is case-insensitive on the client spelling', () => {
    expect(physicalTableListSql('Better-SQLite3')).toBe(physicalTableListSql('better-sqlite3'));
  });

  it('returns null — never a guess — for a dialect it cannot enumerate', () => {
    // ⛔ Not "assume sqlite": a wrong catalog query either throws or answers for
    // the wrong population, and the second is silent.
    for (const client of ['mssql', 'oracledb', 'cockroachdb', 'redshift', '', undefined]) {
      expect(physicalTableListSql(client)).toBeNull();
    }
  });
});

describe('rotationBaseOf — SqlDriver.ensureRotation’s own shard grammar', () => {
  it('folds a shard onto its base', () => {
    expect(rotationBaseOf('sys_activity__r20260829')).toBe('sys_activity');
    expect(rotationBaseOf('sys_activity__r202608')).toBe('sys_activity');
  });

  it('leaves a name that merely looks similar alone', () => {
    expect(rotationBaseOf('sys_activity')).toBeNull();
    expect(rotationBaseOf('sys_activity__rollup')).toBeNull();
    expect(rotationBaseOf('sys_activity__r12345')).toBeNull(); // 5 digits — below the grammar
    expect(rotationBaseOf('__r20260829')).toBeNull(); // no base to fold onto
  });
});

describe('readManagedTableNames — an unreadable map is null, never an empty set', () => {
  it('reads the map keys', () => {
    expect([...readManagedTableNames(fakeDriver({ managed: ['sys_user', 'sys_secret'] }))!].sort())
      .toEqual(['sys_secret', 'sys_user']);
  });

  it('answers null when the member is missing or is not a Map', () => {
    // The field is `protected` on SqlDriver and reached structurally: a rename
    // hands this `undefined`, and reading that as "nothing is managed" would
    // report every platform table in the database as unmanaged.
    expect(readManagedTableNames(fakeDriver({ managed: null }))).toBeNull();
    expect(readManagedTableNames({ managedObjectFields: {} })).toBeNull();
    expect(readManagedTableNames(null)).toBeNull();
    expect(readManagedTableNames(undefined)).toBeNull();
  });
});

describe('buildKnownTableNames — the managed set UNION every declared object', () => {
  it('carries both, so a declared-but-unexamined object is accounted for', () => {
    const known = buildKnownTableNames(new Set(['sys_user']), [{ name: 'sys_secret' }]);
    expect(known.has('sys_user')).toBe(true);
    expect(known.has('sys_secret')).toBe(true);
  });

  it('adds a legacy double-underscore name under both spellings', () => {
    const known = buildKnownTableNames(new Set(), [{ name: 'crm__account' }]);
    expect(known.has('crm__account')).toBe(true);
    expect(known.has('account')).toBe(true);
  });

  it('ignores objects with no usable name', () => {
    const known = buildKnownTableNames(new Set(), [{}, { name: '' }, null, undefined] as never[]);
    expect(known.size).toBe(0);
  });
});

describe('selectUnmanagedTables — the predicate', () => {
  it('REPORTS a platform-prefixed table nothing declares', () => {
    // The card's measured case: `sys_scim_provider` retired, table still there.
    expect(selectUnmanagedTables(['sys_scim_provider'], new Set(['sys_user'])))
      .toEqual([{ table: 'sys_scim_provider' }]);
  });

  it('does NOT report a managed table (negative control)', () => {
    expect(selectUnmanagedTables(['sys_user'], new Set(['sys_user']))).toEqual([]);
  });

  it('does NOT report a DECLARED-but-unexamined object — that is composition.coverage', () => {
    // ~80 declared / 8 examined is the measured control-plane shape. Reporting
    // the other ~72 here would be false (they ARE declared) and would bury the
    // one real orphan.
    const declared = Array.from({ length: 72 }, (_, i) => ({ name: `sys_declared_${i}` }));
    const physical = [...declared.map((o) => o.name), 'sys_scim_provider'];
    const known = buildKnownTableNames(new Set(['sys_user']), declared);
    expect(selectUnmanagedTables(physical, known)).toEqual([{ table: 'sys_scim_provider' }]);
  });

  it('does NOT report the rotation shards of a declared rotation object', () => {
    // `sys_activity` ships `lifecycle.storage.strategy: 'rotation'` with 14
    // daily shards; `aliasShardBookkeeping` never adds a shard to
    // `managedObjectFields`, so only the base name is ever a key there.
    const shards = Array.from({ length: 14 }, (_, i) => `sys_activity__r202608${String(i + 10)}`);
    expect(selectUnmanagedTables(shards, new Set(['sys_activity']))).toEqual([]);
  });

  it('collapses the shards of an UNDECLARED rotation base into one row', () => {
    const shards = ['sys_activity__r20260810', 'sys_activity__r20260811'];
    expect(selectUnmanagedTables(shards, new Set())).toEqual([
      { table: 'sys_activity', rotationShards: shards },
    ]);
  });

  it('merges an undeclared base with its own orphaned shards into a single row', () => {
    expect(selectUnmanagedTables(['sys_activity', 'sys_activity__r20260810'], new Set())).toEqual([
      { table: 'sys_activity', rotationShards: ['sys_activity__r20260810'] },
    ]);
  });

  it('does NOT report driver-internal or application tables', () => {
    expect(
      selectUnmanagedTables(
        ['_objectstack_sequences', '__os_mig_sys_user', 'contacts', 'crm_account', 'knex_migrations'],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('covers every reserved platform prefix, not just sys_', () => {
    const found = selectUnmanagedTables(['sys_a', 'cloud_b', 'ai_c', 'app_d'], new Set())
      .map((f) => f.table);
    expect(found).toEqual(['ai_c', 'cloud_b', 'sys_a']);
  });

  it('is sorted and de-duplicated', () => {
    expect(selectUnmanagedTables(['sys_b', 'sys_a', 'sys_b'], new Set()).map((f) => f.table))
      .toEqual(['sys_a', 'sys_b']);
  });
});

describe('collectUnmanagedTables — every no-answer path is unreadable, not empty', () => {
  it('reads a clean database and says so with an empty list', async () => {
    const report = await sweep({
      managed: ['sys_user'],
      answer: rows('sys_user', '_objectstack_sequences', 'contacts'),
    });
    expect(report).toMatchObject({ status: 'read', physicalTables: 3, tables: [] });
  });

  it('reports the orphan and nothing else', async () => {
    const report = await sweep({
      managed: ['sys_user'],
      declared: [{ name: 'sys_secret' }],
      answer: rows('sys_user', 'sys_secret', 'sys_scim_provider', 'contacts'),
    });
    expect(report).toMatchObject({ status: 'read', tables: [{ table: 'sys_scim_provider' }] });
  });

  it('reads MySQL’s uppercase TABLE_NAME column', async () => {
    const report = await sweep({
      managed: [],
      client: 'mysql2',
      answer: [{ TABLE_NAME: 'sys_scim_provider' }],
    });
    expect(report).toMatchObject({ status: 'read', tables: [{ table: 'sys_scim_provider' }] });
  });

  it('is unreadable when no host config was loaded — the declaration set is knowingly partial', async () => {
    // Measured: with a compiled artifact and NO config, the composed set is the
    // artifact plus the platform FLOOR — ten objects, of which the `sys_*` half
    // is `sys_metadata` + its four siblings, `sys_migration`,
    // `sys_migration_journal`, `sys_metadata_activation`, `sys_secret`. A
    // database carrying the other ~40 platform tables would have every one of
    // them reported. That is the cry-wolf shape, and it is UNMEASURED, not
    // false.
    const noConfig = await sweep({
      managed: ['sys_metadata'],
      answer: rows('sys_user', 'sys_session', 'sys_account'),
      composition: { hostConfigLoaded: false, hostConfigPath: null },
    });
    expect(noConfig.status).toBe('unreadable');
    expect((noConfig as { detail: string }).detail).toContain('no host config');

    const brokenConfig = await sweep({
      managed: ['sys_metadata'],
      answer: rows('sys_user'),
      composition: { hostConfigLoaded: false, hostConfigPath: '/app/objectstack.config.ts' },
    });
    expect(brokenConfig.status).toBe('unreadable');
    expect((brokenConfig as { detail: string }).detail).toContain('/app/objectstack.config.ts');
  });

  it('is unreadable when the managed map cannot be read', async () => {
    const report = await sweep({ managed: null, answer: rows('sys_scim_provider') });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('managed-table map');
  });

  it('is unreadable when the planned driver exposes no raw SQL seam', async () => {
    const report = await sweep({ managed: [] });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('raw SQL seam');
  });

  it('is unreadable on a dialect it cannot enumerate', async () => {
    const report = await sweep({ managed: [], client: 'mssql', answer: rows('sys_x') });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('mssql');
  });

  it('is unreadable when the seam returns no result set (#10677’s shape)', async () => {
    // `InMemoryDriver.execute()` returns `null` — it neither throws nor is
    // absent, and `normalizeRows(null)` is `[]`, which is also what a real
    // driver returns for a catalog with nothing in it.
    const report = await sweep({ managed: [], answer: null });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('no result set');
  });

  it('is unreadable when the catalog read throws', async () => {
    const report = await sweep({
      managed: [],
      answer: () => { throw new Error('permission denied for schema information_schema'); },
    });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('permission denied');
  });

  it('is unreadable when rows carry no recognised table-name column', async () => {
    const report = await sweep({ managed: [], answer: [{ relname: 'sys_x' }] });
    expect(report.status).toBe('unreadable');
    expect((report as { detail: string }).detail).toContain('no recognised table-name column');
  });

  it('reads an EMPTY catalog as a real answer, not as unreadable', async () => {
    const report = await sweep({ managed: [], answer: [] });
    expect(report).toMatchObject({ status: 'read', physicalTables: 0, tables: [] });
  });
});

describe('resolvePlannedDriverExec — bound to the planned driver, never to some other one', () => {
  it('prefers execute, falls back to raw, and answers null for neither', async () => {
    const seen: string[] = [];
    const viaExecute = resolvePlannedDriverExec({
      execute: async (sql: string) => { seen.push(`execute:${sql}`); return []; },
      raw: async () => { seen.push('raw'); return []; },
    })!;
    await viaExecute('select 1');
    expect(seen).toEqual(['execute:select 1']);

    const viaRaw = resolvePlannedDriverExec({ raw: async (sql: string) => { seen.push(`raw:${sql}`); return []; } })!;
    await viaRaw('select 2');
    expect(seen).toEqual(['execute:select 1', 'raw:select 2']);

    expect(resolvePlannedDriverExec({})).toBeNull();
    expect(resolvePlannedDriverExec(null)).toBeNull();
  });
});

describe('rendering — informational, and silent when there is nothing to say', () => {
  it('prints nothing when the sweep ran and found nothing', () => {
    expect(renderUnmanagedTables({ status: 'read', prefixes: ['sys_'], physicalTables: 9, tables: [] }))
      .toEqual([]);
  });

  it('is LOUD when the sweep could not run', () => {
    const lines = renderUnmanagedTables({ status: 'unreadable', prefixes: ['sys_'], detail: 'no seam' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('did not run');
    expect(lines[0]).toContain('no seam');
  });

  it('names the tables and proposes NOTHING — no drop, no remedy', () => {
    const lines = renderUnmanagedTables({
      status: 'read',
      prefixes: ['sys_', 'cloud_', 'ai_'],
      physicalTables: 40,
      tables: [{ table: 'sys_scim_provider' }],
    });
    const text = lines.join('\n');
    expect(text).toContain('sys_scim_provider');
    expect(text).toContain('information only');
    // ⛔ The hard fence: this section never proposes a drop.
    expect(text.toLowerCase()).not.toContain('drop ');
    expect(text.toLowerCase()).not.toContain('--allow-destructive');
    expect(text.toLowerCase()).not.toContain('delete');
  });

  it('describes a collapsed rotation family by its shard count', () => {
    expect(describeUnmanagedTable({ table: 'sys_activity', rotationShards: ['sys_activity__r20260810'] }))
      .toBe('sys_activity (1 rotation shard(s): sys_activity__r20260810)');
    expect(describeUnmanagedTable({ table: 'sys_scim_provider' })).toBe('sys_scim_provider');
  });
});
