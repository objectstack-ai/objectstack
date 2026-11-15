// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33724] A package upgrade that makes a field optional with `storage: {
 * notNull: false }` left the column NOT NULL: the install's schema sync is
 * additive (ADR-0104), the boot never applies a relax (ADR-0113 D5), and the
 * publish that would apply it is refused for a sealed package object
 * (`NOT_OVERRIDABLE`). Every create leaving the field empty was refused by the
 * database.
 *
 * `SqlDriver.relaxDeclaredNotNull` is the door the install now asks after its
 * sync, naming the columns the installing package's own declaration relaxes.
 * This file pins, on every dialect cell, what it applies (only the declared
 * relax, only on a named column) and what it leaves alone (an undeclared NOT
 * NULL; a declared-nullable column it was not asked about — another package's
 * or a customization's; every other drift kind), plus the drift message that
 * names the remedy per object kind.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { diffManagedTable, type ManagedDriftEntry } from './schema-drift.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'install declared NOT NULL relax (#33724)';

// ── The drift message: a remedy that is true for both object kinds ─────────

describe('the relax entry names the remedy per object kind (#33724)', () => {
  const [entry] = diffManagedTable({
    table: 'crm_product',
    fields: { list_price: { type: 'currency', required: false, storage: { notNull: false } } } as never,
    columns: [{ name: 'list_price', type: 'numeric', nullable: false }],
    dialect: 'postgres',
  });

  it('is still the `needs_confirm` relax (ADR-0113 D5)', () => {
    expect(entry).toMatchObject({ category: 'needs_confirm', op: { type: 'relax_not_null', column: 'list_price' } });
  });

  it('names publish for an environment-authored object, and the package install for a package object', () => {
    expect(entry!.message).toContain('For an object authored in this environment, publishing the object applies it');
    expect(entry!.message).toContain('for an object a package provides');
    expect(entry!.message).toContain('a managed install or upgrade of that package applies it ("os package install")');
    expect(entry!.message).toContain('relax it deliberately via "os migrate apply"');
  });
});

// ── The door, on a live table ───────────────────────────────────────────────

const TABLE = 'inst33724_product';

/** The version a database was built with. */
const V1 = {
  name: TABLE,
  fields: {
    list_price: { type: 'number', required: true, storage: { notNull: true } },
    // NOT NULL at creation, then its `storage` declaration REMOVED: undeclared.
    code: { type: 'text', storage: { notNull: true } },
    // Declared nullable by the upgrade, but not one of the columns the
    // installing package names (another package's, a customization's).
    other: { type: 'text', storage: { notNull: true } },
    start_date: { type: 'date' },
  },
};

/** The upgrade. */
const V2 = {
  name: TABLE,
  fields: {
    list_price: { type: 'number', required: false, storage: { notNull: false } },
    code: { type: 'text' },
    other: { type: 'text', storage: { notNull: false } },
    // A `safe` widening (off SQLite) the publish door applies and this one must NOT.
    start_date: { type: 'datetime' },
  },
};

const NAMED = ['list_price', 'code'];

const opsOf = (entries: readonly ManagedDriftEntry[]) => entries.map((e) => `${e.op.type}:${e.column}`).sort();

function declareInstallRelaxSuite(cell: DialectCell): void {
  describe(`the install's NOT NULL relax — ${cell.label} (#33724)`, () => {
    const logged: string[] = [];
    let driver: SqlDriver;
    let before: Record<string, { nullable: boolean }>;
    let report: { applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] };
    let after: Record<string, { nullable: boolean }>;

    const columns = async () => (await driver.getKnex()(TABLE).columnInfo()) as unknown as Record<string, { nullable: boolean }>;

    beforeAll(async () => {
      const sink = (m: unknown) => logged.push(String(m));
      driver = new SqlDriver(cell.config());
      (driver as unknown as { logger: unknown }).logger = { info: sink, warn: sink, error: sink, debug: () => {} };
      await driver.connect();
      await driver.getKnex().schema.dropTableIfExists(TABLE);
      await driver.syncSchema(TABLE, V1);
      await driver.create(TABLE, { list_price: 10, code: 'a', other: 'o', start_date: '2026-11-15' });
      // The install's additive sync of the upgrade …
      await driver.syncSchema(TABLE, V2);
      before = await columns();
      // … then the relax it now asks for.
      report = await driver.relaxDeclaredNotNull(V2, NAMED, { packageId: 'com.acme.crm' });
      after = await columns();
    });

    afterAll(async () => {
      await driver?.getKnex().schema.dropTableIfExists(TABLE).catch(() => {});
      await driver?.disconnect().catch(() => {});
    });

    it('the fixture is real: the additive sync alone left every NOT NULL in place', () => {
      expect(before.list_price!.nullable).toBe(false);
      expect(before.code!.nullable).toBe(false);
      expect(before.other!.nullable).toBe(false);
    });

    it('applies exactly the declared relax on the named column, logged with the package, and skips nothing', () => {
      expect(opsOf(report.applied)).toEqual(['relax_not_null:list_price']);
      expect(report.skipped).toEqual([]);
      expect(logged).toContain(`[schema-drift] the install of package 'com.acme.crm' applied relax_not_null on ${TABLE}.list_price`);
      expect(after.list_price!.nullable).toBe(true);
    });

    it('a create leaving the relaxed field empty now succeeds', async () => {
      const created: any = await driver.create(TABLE, { code: 'b', other: 'o' });
      const row: any = await driver.findOne(TABLE, { where: { id: created.id } });
      expect(row.list_price ?? null).toBeNull();
    });

    it('leaves the UNDECLARED NOT NULL alone, though it was named (ADR-0113 D5)', async () => {
      expect(after.code!.nullable).toBe(false);
      await expect(driver.create(TABLE, { list_price: 1, other: 'o' })).rejects.toThrow();
    });

    it('leaves a declared-nullable column it was not asked about alone', () => {
      expect(after.other!.nullable).toBe(false);
    });

    it('applies no other drift kind: the publish door would widen `start_date`, this one does not', async () => {
      const left = opsOf(await driver.detectManagedDrift([V2]));
      expect(left).toContain('relax_not_null:other');
      expect(left).toContain('relax_not_null:code');
      expect(left).not.toContain('relax_not_null:list_price');
      if (cell.id !== 'sqlite') expect(left).toContain('widen_date_to_datetime:start_date');
    });

    it('is idempotent, and a call naming no column does nothing', async () => {
      expect(await driver.relaxDeclaredNotNull(V2, NAMED)).toEqual({ applied: [], skipped: [] });
      expect(await driver.relaxDeclaredNotNull(V2, [])).toEqual({ applied: [], skipped: [] });
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareInstallRelaxSuite);
}
