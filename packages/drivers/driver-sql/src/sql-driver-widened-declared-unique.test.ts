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
 * The arm was ablated once (its call removed, so the ledger case fell back to
 * the orphan arm; the first two pins and the upgrade-harness dogfood pins read
 * red, restored); the readings are in the PR body, not kept as test files.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';
import { diffManagedIndexes, legacyUniqueReplacements, type PhysicalIndex } from './schema-drift.js';

const LEDGER = 'sys_metadata_activation';
const OLD = 'uniq_sys_metadata_activation_metadata_type_name';
const NEW = 'uniq_sys_metadata_activation_metadata_type_package_id_name';
const ledgerColumns = new Set(['id', 'metadata_type', 'package_id', 'name', 'active']);
const ledgerIndexes = [{ fields: ['metadata_type', 'package_id', 'name'], unique: 'global' as const }];
const plain = (name: string, columns: string[], unique = true): PhysicalIndex => ({ name, columns, unique });

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
    const entries = diff([plain(OLD, ['metadata_type', 'name']), plain(NEW, ['metadata_type', 'package_id', 'name'])]);

    expect(entries.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(entries[0].op).toMatchObject({
      type: 'replace_unique_index',
      dropIndexNames: [OLD],
      createIndexName: NEW,
      createColumns: ['metadata_type', 'package_id', 'name'],
    });
    expect(entries[0].message).toContain('pure relaxation');
    expect(entries[0].message).toContain('package_id');
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
      physical: [plain(OLD, ['metadata_type', 'name'])],
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
    // …booted by this release's declaration.
    await driver.initObjects(ledger(ledgerIndexes) as any);

    const drift = (await driver.detectManagedDrift()).filter((e) => e.table === LEDGER);
    expect(drift.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);

    const { applied, skipped } = await driver.applyMigrationEntries(drift);
    expect(skipped).toEqual([]);
    expect(applied).toHaveLength(1);
    expect(await indexNames()).toEqual([NEW]);
    expect((await driver.detectManagedDrift()).filter((e) => e.table === LEDGER)).toEqual([]);

    const k = (driver as any).knex;
    await k(LEDGER).insert({ id: 'a', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: false });
    await k(LEDGER).insert({ id: 'b', metadata_type: 'flow', name: 'x', package_id: 'com.acme.beta', active: false });
    await expect(
      k(LEDGER).insert({ id: 'c', metadata_type: 'flow', name: 'x', package_id: 'com.acme.alpha', active: true }),
    ).rejects.toThrow(/UNIQUE/);
  });
});
