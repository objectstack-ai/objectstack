// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pin the original suite could not be: this service driven off a REAL
 * `SqlDriver.introspectSchema()` result, not a hand-written fake.
 *
 * `external-datasource-service.test.ts` hand-writes its fixture with
 * `primaryKey: true` — the `packages/spec` contract spelling
 * (`contracts/schema-diff-service.ts`). The driver USED TO emit the other
 * spelling: `SqlDriver.introspectSchema` set `col.isPrimary` and filled
 * `table.primaryKeys` (the `packages/objectql/src/util.ts` shape), `plugin.ts`
 * handed that result to this service unmodified, and the two contracts met —
 * and disagreed — exactly here. Since the driver was aligned to the spec
 * contract (maintainer ruling 2026-08-22, 「同意所有」 item 9; #10676/#10998)
 * the producer spells it `primaryKey`, and the first case below pins that
 * rather than the collision. A fixture written in EITHER spelling is blind to
 * this seam; only a live introspection can see it, so every case below
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
  it('the driver speaks the spec spelling: primaryKey/primaryKeys', async () => {
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

    // The producer's own output, stated as an assertion. This case was written
    // asserting the OPPOSITE — `isPrimary: true`, `primaryKey: undefined` —
    // so that it would redden the moment the driver was aligned. That flip has
    // now happened (#10676/#10998), and it is pinned here in its new
    // direction: the driver emits the spec spelling and no longer emits the
    // retired one. The union read in `primaryKeyReader` therefore has no
    // in-tree producer left for its `isPrimary` arm — and that arm stays
    // anyway. The services lane made that call in #11123: the seam's producer
    // population is open by design (a host builds the driver, and the handle
    // types introspection as `Promise<unknown>`), so the compiler channel the
    // retirement relies on cannot reach a host-built driver still emitting the
    // old spelling. Dropping the arm is a narrowing of accepted input, not a
    // dead-code deletion. `primaryKeyReader`'s docblock carries the full
    // measurement; this file keeps all the arms pinned.
    expect(table.primaryKeys).toEqual(['id']);
    expect(id.primaryKey).toBe(true);
    expect(id.isPrimary).toBeUndefined();
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
   * `primaryKey` FROM `primaryKeys`, so its two signals always agree, and
   * since #10676/#10998 it does not emit `isPrimary` at all. These two cases
   * are therefore hand-built ON PURPOSE, and it is the one place in this file
   * where that is the right instrument: no live in-tree database can stage
   * this disagreement, and feeding the retired spelling is the ONLY exercise
   * the union's `isPrimary` arm now has anywhere in the tree. They pin the
   * behaviour a host-built driver still emitting that spelling depends on —
   * see `primaryKeyReader`'s docblock for why the arm is kept rather than
   * collapsed (#11123) — and they pin that a producer filling only one of the
   * two signals cannot silently lose half a composite key. If the arm is ever
   * retired, these two cases go with it. The spelling seam itself is pinned
   * above, against a real driver, where a fake would have been blind.
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
