// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `SqlDriver.introspectSchema()` emits the `packages/spec` introspection
 * contract — the shape every consumer downstream of `plugin.ts` is typed
 * against — and not a second vocabulary of its own.
 *
 * The defect this closes was invisible to types on both sides. The driver
 * declared its own `IntrospectedColumn` spelling key membership `isPrimary?`;
 * `packages/spec/src/contracts/schema-diff-service.ts` declares `primaryKey`,
 * `dialect` and a REQUIRED `introspectedAt`. Each side compiled against its
 * own declaration, the value crossed between them untyped, and the consumer
 * read keys no driver ever set. Maintainer ruling, 2026-08-22 (live session,
 * 「同意所有」 item 9 = 驱动侧对齐 spec 契约): the driver aligns to the spec.
 *
 * Asserted on the BYTES of a live introspection rather than on a type, because
 * a type is exactly what failed to catch this: a hand-written fixture in
 * either spelling is blind to the seam. Only better-sqlite3 is executed here —
 * every assertion below is on a value built at a single dialect-independent
 * site in `introspectSchema`, downstream of the per-dialect helpers, so the
 * SHAPE cannot vary by dialect even though the per-dialect CONTENT is not
 * measured here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver.introspectSchema emits the spec introspection contract', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as unknown as { knex: any }).knex;
    await knexInstance.schema.createTable('customers', (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.integer('age');
    });
  });

  afterEach(async () => {
    await knexInstance?.destroy();
  });

  it('spells column key membership `primaryKey`, the spec spelling', async () => {
    const schema = await driver.introspectSchema();
    const byName = Object.fromEntries(
      schema.tables['customers'].columns.map((c) => [c.name, c]),
    );

    expect(byName.id.primaryKey).toBe(true);
    // Negative half: an implementation that stamped the key onto the first
    // column, or onto every column, would satisfy the line above alone.
    expect(byName.name.primaryKey).toBe(false);
    expect(byName.age.primaryKey).toBe(false);
  });

  it('emits `dialect` and the required `introspectedAt`', async () => {
    const before = Date.now();
    const schema = await driver.introspectSchema();

    // #10998's acceptance criterion, spelled exactly as it was written: the
    // producer returned `{ tables }` alone while the contract declares three
    // keys, so consumers read two nobody set — type mapping ran with no
    // dialect on the whole federation path, and `refreshCatalog` persisted
    // `dialect: undefined` into the record Studio and the boot gate read back.
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining(['tables', 'dialect', 'introspectedAt']),
    );

    // The dialect TOKEN, not merely the key's presence. The consumer is
    // `suggestFieldTypeForSqlType(col.type, schema.dialect as SqlDialect)`,
    // whose vocabulary spells these `sqlite` / `postgres` / `mysql`; a token
    // outside it (`better-sqlite3`, or the spec enum's `postgresql`) would
    // leave every per-dialect alias unreachable with the key still present.
    expect(schema.dialect).toBe('sqlite');

    // Required in the contract, so it is emitted unconditionally — and it is a
    // real ISO 8601 instant, not a placeholder a consumer would have to guard.
    expect(typeof schema.introspectedAt).toBe('string');
    expect(new Date(schema.introspectedAt).toISOString()).toBe(schema.introspectedAt);
    const at = Date.parse(schema.introspectedAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('no longer emits the retired `isPrimary` spelling', async () => {
    const schema = await driver.introspectSchema();
    const id = schema.tables['customers'].columns.find((c) => c.name === 'id')!;

    // `in`, not a truthiness check: the failure this closes was a consumer
    // reading a key that was ABSENT, so absence is what has to be pinned. Two
    // spellings emitted side by side would keep the second contract alive in
    // the bytes even with both values agreeing today.
    expect('isPrimary' in id).toBe(false);
    expect(Object.keys(id)).toEqual(
      expect.arrayContaining(['name', 'type', 'nullable', 'primaryKey']),
    );
  });
});
