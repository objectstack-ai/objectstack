// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the two introspection-contract keys ruled in #11122 (maintainer
 * ruling 2026-08-23, option B — 「其他同意你的意见」): `IntrospectedTable.indexes`
 * is OPTIONAL (the required declaration was a promise no producer ever
 * honoured), and `IntrospectedColumn.defaultValue` is the raw `unknown`
 * producers actually report, not the `string` it used to promise.
 *
 * The load-bearing assertions here are COMPILE-TIME: the typed literals below
 * are exactly what the old declarations refused or lied about. Restoring
 * `indexes: IntrospectedIndex[]` (required) makes the no-indexes table literal
 * fail `tsc`; restoring `defaultValue?: string` makes the `null` / `true`
 * literals fail. The runtime expects only keep vitest honest about the same
 * values.
 */

import { describe, it, expect } from 'vitest';
import type {
  IntrospectedColumn,
  IntrospectedSchema,
  IntrospectedTable,
} from './schema-diff-service';

const col = (name: string, extra: Partial<IntrospectedColumn> = {}): IntrospectedColumn => ({
  name,
  type: 'varchar',
  nullable: true,
  primaryKey: false,
  ...extra,
});

describe('IntrospectedTable.indexes (#11122: optional, absence ≠ empty)', () => {
  it('a table WITHOUT `indexes` typechecks — absence means "not read", and the in-tree producer emits exactly this', () => {
    const table: IntrospectedTable = {
      name: 'customers',
      columns: [col('id', { primaryKey: true })],
      // no `indexes` key: the producer did not read indexes. Under the old
      // required declaration this literal did not compile, yet it is the only
      // shape any producer ever emitted.
    };
    expect('indexes' in table).toBe(false);
  });

  it('an empty array stays a DISTINCT legal claim: the table was read and HAS no indexes', () => {
    const none: IntrospectedTable = { name: 't_none', columns: [col('a')], indexes: [] };
    const some: IntrospectedTable = {
      name: 't_some',
      columns: [col('a')],
      indexes: [{ name: 'idx_a', columns: ['a'], unique: false }],
    };
    expect(none.indexes).toEqual([]);
    expect(some.indexes).toHaveLength(1);
  });

  it('a whole schema built from index-less tables satisfies the contract', () => {
    const schema: IntrospectedSchema = {
      dialect: 'sqlite',
      introspectedAt: new Date(0).toISOString(),
      tables: { customers: { name: 'customers', columns: [col('id')] } },
    };
    expect(Object.keys(schema.tables)).toEqual(['customers']);
  });
});

describe('IntrospectedColumn.defaultValue (#11122: raw `unknown`, not `string`)', () => {
  it('accepts the measured emitted values — `null`, a dialect-quoted string, a native boolean', () => {
    // Measured on live in-memory SQLite (knex `columnInfo()` pass-through,
    // 2026-08-23): `null` for a column with no default; dialect-quoted
    // strings such as `'abc'` when one exists. The boolean mirrors the
    // in-tree fixture for producers that report native values.
    const noDefault: IntrospectedColumn = col('id', { defaultValue: null });
    const quoted: IntrospectedColumn = col('name', { defaultValue: "'abc'" });
    const native: IntrospectedColumn = col('active', { defaultValue: true });
    const absent: IntrospectedColumn = col('note');

    expect(noDefault.defaultValue).toBeNull();
    expect(quoted.defaultValue).toBe("'abc'");
    expect(native.defaultValue).toBe(true);
    expect('defaultValue' in absent).toBe(false);
  });

  it('is `unknown`, so a consumer MUST narrow before string operations — the old declaration invited exactly that crash', () => {
    const c = col('x', { defaultValue: null });
    // Compile-time half: `c.defaultValue.startsWith('a')` must NOT typecheck
    // (that is the consumer bug the `string` promise produced at runtime).
    // Spelled as a narrowing guard, the only legal read:
    const asString = typeof c.defaultValue === 'string' ? c.defaultValue : undefined;
    expect(asString).toBeUndefined();
  });
});
