// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A declared global UNIQUE index whose key gained columns supersedes the
 * narrower index an earlier declaration built: `replace_unique_index`, `safe`,
 * create-before-drop — never an orphan `drop_index` (destructive, opt-in).
 *
 * The case that put this here is the activation ledger: ADR-0150 D4 widened
 * `sys_metadata_activation`'s `(metadata_type, name)` to
 * `(metadata_type, package_id, name)`. Every database an earlier release built
 * holds `uniq_sys_metadata_activation_metadata_type_name`, and left to the
 * orphan arm `os migrate plan` reported a destructive drop on every upgrade,
 * while an operator who applied only the safe half kept refusing exactly the
 * rows the new key admits.
 *
 * Widening a unique key is a pure relaxation: two rows colliding on the wider
 * key already collided on the narrower one, so the wider index cannot fail to
 * build and dropping the narrower one loses no row. The arm is deliberately
 * narrow, and the pins below hold each limit: a UNIQUE on other columns, and a
 * declared UNIQUE that is not a superset, keep reading as orphans exactly as
 * before; a live field-level unique is never read as superseded.
 *
 * When a gained column is nullable the arm also requires the partial UNIQUE
 * guard on the narrower key (`metadata-protocol`'s package-less index), because
 * without it the old index is the only rule keeping NULL rows to one.
 *
 * The arm and its guard rule were each ablated (readings in the PR body, not
 * kept as test files).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';
import {
  diffManagedIndexes,
  enforcedIndexKey,
  hashShadowColumnFor,
  legacyUniqueReplacements,
  parseHashShadowKeyParts,
  parseHashShadowRowScope,
  type PhysicalIndex,
} from './schema-drift.js';
import { MYSQL_CELL, declareDialectCell } from './live-dialect-matrix.testkit.js';

const LEDGER = 'sys_metadata_activation';
const OLD = 'uniq_sys_metadata_activation_metadata_type_name';
const NEW = 'uniq_sys_metadata_activation_metadata_type_package_id_name';
const ledgerColumns = new Set(['id', 'metadata_type', 'package_id', 'name', 'active']);
const ledgerIndexes = [{ fields: ['metadata_type', 'package_id', 'name'], unique: 'global' as const }];
const plain = (name: string, columns: string[], unique = true): PhysicalIndex => ({ name, columns, unique });
/** The package-less guard `metadata-protocol` builds at boot: a partial UNIQUE on the narrower key. */
const GUARD_NAME = 'uniq_sys_metadata_activation_packageless';
const guard: PhysicalIndex = { name: GUARD_NAME, columns: ['metadata_type', 'name'], unique: true, partial: true };

/** The differ's verdict over the ledger as this release declares it, composed as `detectTableIndexDrift` composes it. */
const diff = (physical: PhysicalIndex[]) =>
  diffManagedIndexes({
    table: LEDGER,
    expected: [{ name: NEW, columns: ['metadata_type', 'package_id', 'name'], unique: true }],
    legacy: legacyUniqueReplacements({
      table: LEDGER,
      fields: {},
      tenantField: null,
      physicalColumns: ledgerColumns,
      declaredIndexes: ledgerIndexes,
      physical,
    }),
    physical,
  });

describe('the widening arm — pure function', () => {
  it('reads the activation ledger\'s old two-part UNIQUE as superseded: one SAFE replace, no drop_index', () => {
    const entries = diff([plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name']), guard]);

    expect(entries.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(entries[0].op).toMatchObject({
      type: 'replace_unique_index',
      dropIndexNames: [OLD],
      createIndexName: NEW,
      createColumns: ['metadata_type', 'package_id', 'name'],
    });
    expect(entries[0].message).toContain('pure relaxation');
    expect(entries[0].message).toContain('package_id');
    // The gained column is nullable here, so the message says what the wider
    // key stops constraining: rows whose package_id is NULL.
    expect(entries[0].message).toContain('package_id is nullable');
    expect(entries[0].message).toContain('a row whose package_id is NULL is constrained by the new key no longer');
    expect(entries[0].message).toContain('The partial UNIQUE on (metadata_type, name) that stands beside it');
  });

  it('a nullable gained column with NO partial guard beside it is not a relaxation: the old index is KEPT — no replace, no orphan drop', () => {
    // Without the package-less index, dropping (metadata_type, name) would drop
    // the only rule keeping rows with a NULL package_id to one per name. So the
    // plan offers nothing for it — not the safe replace, and not the orphan
    // arm's destructive drop either — and a later plan, once the boot has built
    // the guard, offers the replace.
    expect(diff([plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name'])])).toEqual([]);
    // A plain (non-partial) unique on the narrower columns is not the guard.
    expect(legacyUniqueReplacements({
      table: LEDGER, fields: {}, tenantField: null, physicalColumns: ledgerColumns, declaredIndexes: ledgerIndexes,
      physical: [plain(OLD, ['metadata_type', 'name']), plain('uniq_other', ['metadata_type', 'name'])],
    })).toEqual([expect.objectContaining({ legacyNames: [OLD], kept: true })]);
  });

  it('a gained column the object declares required carries no NULL warning', () => {
    const physical = [plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name'])];
    const [entry] = diffManagedIndexes({
      table: LEDGER,
      expected: [{ name: NEW, columns: ['metadata_type', 'package_id', 'name'], unique: true }],
      legacy: legacyUniqueReplacements({
        table: LEDGER, fields: { package_id: { type: 'text', required: true } }, tenantField: null,
        physicalColumns: ledgerColumns, declaredIndexes: ledgerIndexes, physical,
      }),
      physical,
    });
    expect(entry.op.type).toBe('replace_unique_index');
    expect(entry.message).toContain('pure relaxation');
    expect(entry.message).not.toContain('nullable');
  });

  it('a generated UNIQUE on other columns still reads as an orphan: drop_index, destructive', () => {
    const other = 'uniq_sys_metadata_activation_name_active';
    const entries = diff([plain(other, ['name', 'active']), plain(NEW, ['metadata_type', 'package_id', 'name'])]);

    expect(entries.map((e) => [e.op.type, e.category, (e.op as { indexName?: string }).indexName]))
      .toEqual([['drop_index', 'destructive', other]]);
  });

  it('a declared UNIQUE that is not a superset leaves the old index orphaned, as before', () => {
    // The declaration moved to a key that does not contain the old one, so
    // dropping the old index is a removal, not a relaxation: the operator's call.
    const declared = [{ fields: ['metadata_type', 'package_id'], unique: 'global' as const }];
    const entries = diffManagedIndexes({
      table: LEDGER,
      expected: [{ name: 'uniq_sys_metadata_activation_metadata_type_package_id', columns: ['metadata_type', 'package_id'], unique: true }],
      legacy: legacyUniqueReplacements({
        table: LEDGER, fields: {}, tenantField: null, physicalColumns: ledgerColumns, declaredIndexes: declared,
        physical: [plain(OLD, ['metadata_type', 'name'])],
      }),
      physical: [plain(OLD, ['metadata_type', 'name'])],
    });

    expect(entries.filter((e) => e.op.type === 'replace_unique_index')).toEqual([]);
    expect(entries.find((e) => e.op.type === 'drop_index')).toMatchObject({ category: 'destructive', op: { indexName: OLD } });
  });

  it('runs on a table with NO tenant column — the tenant arms still return nothing there', () => {
    const out = legacyUniqueReplacements({
      table: LEDGER, fields: {}, tenantField: null, physicalColumns: ledgerColumns, declaredIndexes: ledgerIndexes,
      physical: [plain(OLD, ['metadata_type', 'name']), guard],
    });
    expect(out).toEqual([
      expect.objectContaining({ legacyNames: [OLD], legacyColumns: ['metadata_type', 'name'], widenedBy: ['package_id'] }),
    ]);
    // The tenant arms' own guard is unchanged: an organization respelling on
    // a tenant-less table claims nothing.
    expect(legacyUniqueReplacements({
      table: LEDGER, fields: {}, tenantField: null, physicalColumns: ledgerColumns,
      declaredIndexes: [{ fields: ['metadata_type', 'name'], unique: 'organization' }],
      physical: [plain(OLD, ['metadata_type', 'name'])],
    })).toEqual([]);
  });

  it('never reads an index metadata still asks for as superseded — a field-level unique included', () => {
    // `name` is field-level `unique: 'global'`, so `uniq_<table>_name` is a
    // live index the declaration's subsequence `[name]` happens to spell.
    const out = legacyUniqueReplacements({
      table: LEDGER,
      fields: { name: { type: 'text', unique: 'global' } },
      tenantField: null,
      physicalColumns: ledgerColumns,
      declaredIndexes: ledgerIndexes,
      physical: [plain('uniq_sys_metadata_activation_name', ['name'])],
    });
    expect(out).toEqual([]);
  });

  it('claims nothing without the physical index list, or for a named or organization declaration', () => {
    const base = { table: LEDGER, fields: {}, tenantField: null, physicalColumns: ledgerColumns };
    expect(legacyUniqueReplacements({ ...base, declaredIndexes: ledgerIndexes })).toEqual([]);
    expect(legacyUniqueReplacements({
      ...base, physical: [plain(OLD, ['metadata_type', 'name'])],
      declaredIndexes: [{ name: 'uniq_ledger_key', fields: ['metadata_type', 'package_id', 'name'], unique: 'global' }],
    })).toEqual([]);
  });
});

describe('the widening arm — a real SQLite database built with the old key', () => {
  let driver: SqlDriver | undefined;

  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
  });

  const ledger = (indexes: any[]) => [{
    name: LEDGER,
    systemFields: { tenant: false },
    fields: {
      id: { type: 'text' },
      metadata_type: { type: 'text' },
      name: { type: 'text' },
      package_id: { type: 'text' },
      active: { type: 'boolean' },
    },
    indexes,
  }];

  const indexNames = async () => {
    const rows: any = await (driver as any).knex.raw(`PRAGMA index_list(${LEDGER})`);
    return (Array.isArray(rows) ? rows : []).map((r: any) => r.name).filter((n: string) => n.startsWith('uniq_')).sort();
  };

  it('plans the replace as safe, applies it without allowDestructive, and the wider key admits a second package', async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The database an earlier release built…
    await driver.initObjects(ledger([{ fields: ['metadata_type', 'name'], unique: 'global' }]) as any);
    expect(await indexNames()).toEqual([OLD]);
    // …booted by this release's declaration, with the package-less guard the
    // metadata-protocol boot migration builds beside it.
    await driver.initObjects(ledger(ledgerIndexes) as any);
    await (driver as any).knex.raw(
      `CREATE UNIQUE INDEX ${GUARD_NAME} ON ${LEDGER} (metadata_type, name) WHERE package_id IS NULL`,
    );

    const drift = (await driver.detectManagedDrift()).filter((e) => e.table === LEDGER);
    expect(drift.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);

    const { applied, skipped } = await driver.applyMigrationEntries(drift);
    expect(skipped).toEqual([]);
    expect(applied).toHaveLength(1);
    expect(await indexNames()).toEqual([NEW, GUARD_NAME].sort());
    expect((await driver.detectManagedDrift()).filter((e) => e.table === LEDGER)).toEqual([]);

    const k = (driver as any).knex;
    await k(LEDGER).insert({ id: 'a', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: false });
    await k(LEDGER).insert({ id: 'b', metadata_type: 'flow', name: 'x', package_id: 'com.acme.beta', active: false });
    await expect(
      k(LEDGER).insert({ id: 'c', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: true }),
    ).rejects.toThrow(/UNIQUE/);
    // …and the guard still keeps rows with no package to one per name.
    await k(LEDGER).insert({ id: 'd', metadata_type: 'flow', name: 'x', active: false });
    await expect(k(LEDGER).insert({ id: 'e', metadata_type: 'flow', name: 'x', active: true })).rejects.toThrow(/UNIQUE/);
  });
});

// ---------------------------------------------------------------------------
// MariaDB's spelling of the package-less guard: a ROW-SCOPED hash shadow
// ---------------------------------------------------------------------------

/**
 * MariaDB has no partial index and no functional key part, so `metadata-protocol`
 * builds the guard as a UNIQUE key over an INVISIBLE generated column holding
 * `CASE WHEN package_id IS NULL THEN <digest of metadata_type, name> END`. The
 * expression below is the one MariaDB 11.8 stores (the separator literal is the
 * 0x1f byte, spelled here as its escape).
 */
const MARIADB_GUARD_EXPR =
  "case when `package_id` is null then unhex(sha2(concat(`metadata_type`,'\u001f',`name`),256)) end";
const GUARD_SHADOW = hashShadowColumnFor(GUARD_NAME);
/** The guard as `introspectIndexes` reads it on MariaDB after `resolveHashShadowKeys`. */
const mariaGuard: PhysicalIndex = {
  name: GUARD_NAME,
  columns: [GUARD_SHADOW],
  unique: true,
  partial: true,
  shadowKey: [
    { column: 'metadata_type', nullSafe: false },
    { column: 'name', nullSafe: false },
  ],
};

describe('a row-scoped hash shadow (MariaDB package-less guard) — pure functions', () => {
  it('names its scope column, and its key parts are the digest\'s alone — never the scope column', () => {
    expect(parseHashShadowRowScope(MARIADB_GUARD_EXPR)).toBe('package_id');
    expect(parseHashShadowKeyParts(MARIADB_GUARD_EXPR)).toEqual([
      { column: 'metadata_type', nullSafe: false },
      { column: 'name', nullSafe: false },
    ]);
    expect(enforcedIndexKey(mariaGuard).columns).toEqual(['metadata_type', 'name']);
  });

  it('an ordinary shadow has no scope, and its key parts read as before', () => {
    const plainShadow = "unhex(sha2(concat(coalesce(`organization_id`,_utf8mb4'__global__'),0x1f,`v`),256))";
    expect(parseHashShadowRowScope(plainShadow)).toBeNull();
    expect(parseHashShadowKeyParts(plainShadow)).toEqual([
      { column: 'organization_id', nullSafe: true },
      { column: 'v', nullSafe: false },
    ]);
  });

  it('counts as the widening arm\'s guard: the old two-part UNIQUE is one SAFE replace, and the guard draws no entry', () => {
    const entries = diff([plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name']), mariaGuard]);
    expect(entries.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(entries[0].op).toMatchObject({ dropIndexNames: [OLD], createIndexName: NEW });
  });

  it('a shadow carrier that is NOT row-scoped is no guard: the old index stays KEPT', () => {
    const unscoped: PhysicalIndex = { ...mariaGuard, partial: undefined };
    expect(diff([plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name']), unscoped])
      .some((e) => e.op.type === 'replace_unique_index')).toBe(false);
  });
});

declareDialectCell(MYSQL_CELL, 'activation ledger package-less guard on MariaDB (row-scoped shadow)', (cell) => {
  describe('an upgraded MariaDB database: the old key retires safely, and the guard never shows', () => {
    let driver: SqlDriver | undefined;
    afterEach(async () => {
      await driver?.disconnect();
      driver = undefined;
    });

    const ledger = (indexes: any[]) => [{
      name: LEDGER,
      systemFields: { tenant: false },
      fields: {
        metadata_type: { type: 'text', required: true, maxLength: 100 },
        name: { type: 'text', required: true, maxLength: 255 },
        package_id: { type: 'text', maxLength: 255 },
        active: { type: 'boolean' },
      },
      indexes,
    }];

    it('plan = one safe replace (no drop_index, no drop_column); apply; re-plan empty; reads never see the shadow', async (ctx) => {
      driver = new SqlDriver(cell.config());
      (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const k = (driver as any).knex;
      const [[version]] = await k.raw('SELECT VERSION() AS v');
      // MySQL keeps its functional key part (no shadow); this measurement is MariaDB's.
      if (!/mariadb/i.test(String(version?.v))) ctx.skip();
      await k.raw(`DROP TABLE IF EXISTS ${LEDGER}`);

      await driver.initObjects(ledger([{ fields: ['metadata_type', 'name'], unique: 'global' }]) as any);
      await driver.initObjects(ledger(ledgerIndexes) as any);
      // The statement `metadata-protocol` runs on MariaDB
      // (`buildActivationLedgerPackagelessMariaDbSql`), verbatim.
      await k.raw(
        `ALTER TABLE ${LEDGER} ADD COLUMN ${GUARD_SHADOW} VARBINARY(32) GENERATED ALWAYS AS (CASE WHEN package_id IS NULL ` +
          `THEN unhex(sha2(concat(metadata_type, 0x1f, name), 256)) END) VIRTUAL INVISIBLE, ` +
          `ADD UNIQUE KEY ${GUARD_NAME} (${GUARD_SHADOW})`,
      );

      const plan = (await driver.detectManagedDrift()).filter((e) => e.table === LEDGER);
      expect(plan.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
      expect(plan[0].op).toMatchObject({ dropIndexNames: [OLD], createIndexName: NEW });

      const { applied, skipped } = await driver.applyMigrationEntries(plan);
      expect([applied.length, skipped]).toEqual([1, []]);
      expect((await driver.detectManagedDrift()).filter((e) => e.table === LEDGER)).toEqual([]);

      const [stats] = await k.raw(
        'SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [LEDGER],
      );
      expect(stats.map((r: any) => r.n).sort()).toEqual(['PRIMARY', NEW, GUARD_NAME].sort());

      await driver.create(LEDGER, { id: 'a', metadata_type: 'flow', name: 'x', active: false });
      // A second row naming no package: refused by the guard.
      await expect(driver.create(LEDGER, { id: 'b', metadata_type: 'flow', name: 'x', active: true }))
        .rejects.toMatchObject({ code: 'ER_DUP_ENTRY', message: expect.stringContaining(GUARD_NAME) });
      await driver.create(LEDGER, { id: 'c', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: false });
      await driver.create(LEDGER, { id: 'd', metadata_type: 'flow', name: 'x', package_id: 'com.acme.beta', active: false });
      await expect(
        driver.create(LEDGER, { id: 'e', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: true }),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY', message: expect.stringContaining(NEW) });

      // The carrier column never reaches a read.
      const rows = await driver.find(LEDGER, {});
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(Object.keys(r)).not.toContain(GUARD_SHADOW);
      const [star] = await k.raw(`SELECT * FROM ${LEDGER}`);
      for (const r of star) expect(Object.keys(r)).not.toContain(GUARD_SHADOW);

      // A second boot of this release leaves everything as it is.
      await driver.initObjects(ledger(ledgerIndexes) as any);
      expect((await driver.detectManagedDrift()).filter((e) => e.table === LEDGER)).toEqual([]);
    });
  });
});
