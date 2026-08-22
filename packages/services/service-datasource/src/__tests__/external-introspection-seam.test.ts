// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pin the original suite could not be: this service driven off a REAL
 * `SqlDriver.introspectSchema()` result, not a hand-written fake.
 *
 * `external-datasource-service.test.ts` hand-writes its fixture with
 * `primaryKey: true` — the `packages/spec` contract spelling
 * (`contracts/schema-diff-service.ts`). The driver emits the OTHER spelling:
 * `SqlDriver.introspectSchema` sets `col.isPrimary` and fills
 * `table.primaryKeys` (the `packages/objectql/src/util.ts` shape). `plugin.ts`
 * hands the driver's result to this service unmodified, so the two contracts
 * meet — and disagree — exactly here. A fixture written in EITHER spelling is
 * blind to that; only a live introspection can see it, so every case below
 * introspects a real in-memory SQLite database rather than describing one.
 *
 * Both directions are pinned deliberately: an implementation that stamped the
 * key onto the first column would satisfy a positive-only suite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type DatasourceLike,
} from '../external-datasource-service.js';

const opened: SqlDriver[] = [];

afterEach(async () => {
  while (opened.length) {
    const d = opened.pop()!;
    try {
      await (d as unknown as { knex?: { destroy(): Promise<void> } }).knex?.destroy();
    } catch {
      /* the pool may never have opened */
    }
  }
});

/**
 * A live in-memory SQLite database, introspected by the real driver. Returns
 * the driver's own result, deliberately NOT reshaped — anything this service
 * needs, it must read from the bytes the driver actually produces.
 */
async function introspectReal(ddl: (knex: never) => Promise<void>): Promise<unknown> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  } as never);
  opened.push(driver);
  await ddl((driver as unknown as { knex: never }).knex);
  return driver.introspectSchema();
}

/** Wire the service to a fixed introspection result, exactly as `plugin.ts` does. */
function serviceOver(schema: unknown): ExternalDatasourceService {
  return new ExternalDatasourceService({
    introspect: async () => schema as IntrospectedSchema,
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async () => undefined,
    listObjects: async () => [],
  });
}

/** The catalog columns for one remote table, keyed by column name. */
async function catalogColumns(
  schema: unknown,
  remoteName: string,
): Promise<Record<string, { primaryKey: boolean; nullable: boolean; sqlType: string }>> {
  const catalog = await serviceOver(schema).refreshCatalog('showcase_external');
  const table = catalog.tables.find((t) => t.remoteName === remoteName);
  expect(table, `no '${remoteName}' in the refreshed catalog`).toBeDefined();
  return Object.fromEntries(table!.columns.map((c) => [c.name, c])) as never;
}

describe('the introspection seam, as a real SqlDriver actually spells it', () => {
  it('the driver speaks isPrimary/primaryKeys and never the spec spelling', async () => {
    const schema = (await introspectReal(async (knex: never) => {
      await (knex as { schema: { createTable(n: string, cb: (t: never) => void): Promise<void> } }).schema.createTable(
        'customers',
        (t: never) => {
          const b = t as unknown as { string(n: string): { primary(): void }; integer(n: string): void };
          b.string('id').primary();
          b.string('name');
          b.integer('age');
        },
      );
    })) as { tables: Record<string, { primaryKeys: string[]; columns: Record<string, unknown>[] }> };

    const table = schema.tables.customers;
    const id = table.columns.find((c) => c.name === 'id')!;

    // This is the whole defect, stated as an assertion on the producer's own
    // output. If it ever flips — the driver starting to emit the spec
    // spelling, or the two contracts being reconciled upstream — the union
    // read in `primaryKeyReader` stops being load-bearing and should be
    // re-derived rather than quietly relaxed.
    expect(table.primaryKeys).toEqual(['id']);
    expect(id.isPrimary).toBe(true);
    expect(id.primaryKey).toBeUndefined();
  });

  it('refreshCatalog carries the introspected key onto the right column only', async () => {
    const schema = await introspectReal(async (knex: never) => {
      await (knex as { schema: { createTable(n: string, cb: (t: never) => void): Promise<void> } }).schema.createTable(
        'customers',
        (t: never) => {
          const b = t as unknown as { string(n: string): { primary(): void }; integer(n: string): void };
          b.string('id').primary();
          b.string('name');
          b.integer('age');
        },
      );
    });

    const cols = await catalogColumns(schema, 'customers');
    expect(cols.id.primaryKey).toBe(true);
    // …and nothing else was promoted.
    expect(cols.name.primaryKey).toBe(false);
    expect(cols.age.primaryKey).toBe(false);
  });

  it('refreshCatalog invents no key for a table that declares none', async () => {
    const schema = await introspectReal(async (knex: never) => {
      await (knex as { schema: { createTable(n: string, cb: (t: never) => void): Promise<void> } }).schema.createTable(
        'events',
        (t: never) => {
          const b = t as unknown as { string(n: string): unknown };
          b.string('label');
          b.string('payload');
        },
      );
    });

    const cols = await catalogColumns(schema, 'events');
    // Still a usable catalog entry…
    expect(Object.keys(cols)).toEqual(['label', 'payload']);
    // …and no column was promoted, least of all the first one.
    expect(cols.label.primaryKey).toBe(false);
    expect(cols.payload.primaryKey).toBe(false);
  });
});

describe('the seam read, where the two spellings disagree', () => {
  /**
   * No in-tree driver produces a disagreement — `SqlDriver` derives
   * `isPrimary` FROM `primaryKeys`, so the two always agree. This case is
   * therefore hand-built ON PURPOSE, and it is the one place in this file
   * where that is the right instrument: it fixes the behaviour under a
   * disagreement no live database can currently stage, so a future producer
   * that fills only one of the two signals cannot silently lose half a
   * composite key. The spelling seam itself is pinned above, against a real
   * driver, where a fake would have been blind.
   */
  function serviceOverRaw(table: unknown): ExternalDatasourceService {
    return serviceOver({ tables: { order_lines: table } });
  }

  const cols = [
    { name: 'order_id', type: 'varchar', nullable: false },
    { name: 'line_no', type: 'varchar', nullable: false },
    { name: 'sku', type: 'varchar', nullable: true },
  ];

  it('takes the union when the table-level list is wider than the per-column flag', async () => {
    const catalog = await serviceOverRaw({
      name: 'order_lines',
      primaryKeys: ['order_id', 'line_no'],
      columns: cols.map((c) => ({ ...c, isPrimary: c.name === 'order_id' })),
    }).refreshCatalog('showcase_external');

    const byName = Object.fromEntries(catalog.tables[0].columns.map((c) => [c.name, c]));
    expect(byName.order_id.primaryKey).toBe(true);
    expect(byName.line_no.primaryKey).toBe(true);
    expect(byName.sku.primaryKey).toBe(false);
  });

  it('takes the union when the per-column flag is wider than the table-level list', async () => {
    const catalog = await serviceOverRaw({
      name: 'order_lines',
      primaryKeys: ['order_id'],
      columns: cols.map((c) => ({ ...c, isPrimary: c.name !== 'sku' })),
    }).refreshCatalog('showcase_external');

    const byName = Object.fromEntries(catalog.tables[0].columns.map((c) => [c.name, c]));
    expect(byName.order_id.primaryKey).toBe(true);
    expect(byName.line_no.primaryKey).toBe(true);
    expect(byName.sku.primaryKey).toBe(false);
  });

  it('still honours the spec spelling on its own — the pre-existing fixtures keep working', async () => {
    const catalog = await serviceOverRaw({
      name: 'order_lines',
      // No `primaryKeys`, no `isPrimary` — the hand-written shape the rest of
      // this package's suite feeds in.
      columns: cols.map((c) => ({ ...c, primaryKey: c.name === 'order_id' })),
    }).refreshCatalog('showcase_external');

    const byName = Object.fromEntries(catalog.tables[0].columns.map((c) => [c.name, c]));
    expect(byName.order_id.primaryKey).toBe(true);
    expect(byName.line_no.primaryKey).toBe(false);
  });
});
