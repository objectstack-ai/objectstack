// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20446] The flip, on `driver-sql`: a STORED view rule's 「is empty」 /
 * 「is not empty」 reaches the compiler as `$empty` (the spec's `parseFilterAST`
 * — the one lowering every door runs — emits it since #20446; it emitted `$null`
 * before) and is answered by the field's DECLARED row.
 *
 * - Ruling A on #20399 (record 5865693155): a stored rule's 「is empty」 on a
 *   multi-value field returns the rows holding `[]` or null, and refuses
 *   nothing.
 * - Ruling B on #20311 (record 5861435168): a text field holding `''` is
 *   empty; `is_not_empty` is the exact complement.
 * - A federated (ADR-0015) object is answered too: this driver implements
 *   `registerExternalObject`, which records the declarations the engine hands
 *   it — the corrected premise of ruling 5881556735 on #20446.
 * - N2, the narrowing the changeset declares, in its two `driver-sql` shapes:
 *   the built-in `id` (no object declares it), and a multi-value column over a
 *   knex client this driver does not model (mssql here — its client builds
 *   without a server, so the statement is compiled, not run). Each is REFUSED,
 *   loudly, with the `$null` prescription, where the old `$null` lowering
 *   compiled `IS NULL`.
 *
 * SQLite only: the per-dialect JSON constructs are `sql-driver-20444-empty-
 * operator.test.ts`'s matrix; this file pins the lowering's reach.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { parseFilterAST, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';

const TABLE = 'os20446_task';

/** What the engine's registry hands the driver — `id` is NOT a declared field there. */
const FIELDS = {
  title: { type: 'text' },
  tags: { type: 'tags' },
  amount: { type: 'number' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: null, tags: null, amount: null },
  { id: 'r2', title: '', tags: [], amount: 1 },
  { id: 'r3', title: 'a', tags: ['x'], amount: 2 },
];
const ALL = ['r1', 'r2', 'r3'];

/** A stored rule, lowered the way every door lowers it. */
const rule = (field: string, op: string) => parseFilterAST([field, op, true]) as FilterCondition;

type Refusal = { code?: string; status?: number; message: string };

async function refusalOf(run: () => unknown): Promise<Refusal | 'answered'> {
  try {
    await run();
    return 'answered';
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    return { code: e.code, status: e.status, message: String(e.message) };
  }
}

function expectPrescribedRefusal(got: Refusal | 'answered', label: string): void {
  expect(got, label).not.toBe('answered');
  const r = got as Refusal;
  expect({ code: r.code, status: r.status }, label).toEqual({ code: 'INVALID_FILTER', status: 400 });
  expect(r.message, label).toContain('Operator "$empty"');
  expect(r.message, label).toContain('"$null"');
}

describe('[#20446] SqlDriver (SQLite) — a stored 「is empty」 rule, lowered to $empty', () => {
  let driver: SqlDriver;
  const rows = async (where: FilterCondition) =>
    ((await driver.find(TABLE, { where })) as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([{ name: TABLE, fields: FIELDS } as never]);
    for (const row of ROWS) await driver.create(TABLE, { ...row });
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('the lowering this file drives is the flipped one', () => {
    expect(rule('tags', 'is_empty')).toEqual({ tags: { $empty: true } });
    expect(rule('tags', 'isnotempty')).toEqual({ tags: { $empty: false } });
  });

  it('ruling A: a stored 「is empty」 on a multi-value field returns the [] and null rows, and refuses nothing', async () => {
    for (const op of ['is_empty', 'isempty']) {
      expect(await rows(rule('tags', op)), op).toEqual(['r1', 'r2']);
    }
  });

  it('ruling B: a stored 「is empty」 on a text field finds \'\' as well as null; a scalar keeps null only', async () => {
    expect(await rows(rule('title', 'is_empty'))).toEqual(['r1', 'r2']);
    expect(await rows(rule('amount', 'is_empty'))).toEqual(['r1']);
  });

  it('is_not_empty is the exact complement of is_empty on every declared field', async () => {
    for (const field of Object.keys(FIELDS)) {
      const empty = await rows(rule(field, 'is_empty'));
      const full = await rows(rule(field, 'is_not_empty'));
      expect(empty.filter((id) => full.includes(id)), `${field}: overlap`).toEqual([]);
      expect([...empty, ...full].sort(), `${field}: union`).toEqual(ALL);
    }
    expect(await rows(rule('tags', 'is_not_empty'))).toEqual(['r3']);
  });

  it('N2: a stored rule on the built-in `id` is REFUSED with the $null prescription, both directions', async () => {
    for (const op of ['is_empty', 'is_not_empty']) {
      expectPrescribedRefusal(await refusalOf(() => rows(rule('id', op))), op);
    }
  });
});

describe('[#20446] SqlDriver — a federated object bound by registerExternalObject is answered', () => {
  const file = join(tmpdir(), `os-20446-fed-${process.pid}-${Date.now()}.db`);
  let ext: SqlDriver;

  beforeAll(async () => {
    const fixture = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    await fixture.initObjects([{ name: 'remote_task', fields: FIELDS } as never]);
    for (const row of ROWS) await fixture.create('remote_task', { ...row });
    await fixture.disconnect?.();
    ext = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: file },
      useNullAsDefault: true,
      schemaMode: 'external',
    } as never);
    // What the engine's boot does for an `external` object on a driver that implements federation.
    ext.registerExternalObject({ name: 'os20446_ext_task', fields: FIELDS, external: { remoteName: 'remote_task' } } as never);
  });
  afterAll(async () => {
    await ext?.disconnect?.();
    rmSync(file, { force: true });
  });

  it('every author-declared column answers the stored rule by its declared row', async () => {
    const rows = async (where: FilterCondition) =>
      ((await ext.find('os20446_ext_task', { where })) as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
    expect(await rows(rule('tags', 'is_empty'))).toEqual(['r1', 'r2']);
    expect(await rows(rule('title', 'is_empty'))).toEqual(['r1', 'r2']);
    expect(await rows(rule('amount', 'is_empty'))).toEqual(['r1']);
    expect(await rows(rule('tags', 'is_not_empty'))).toEqual(['r3']);
  });
});

describe('[#20446] SqlDriver — a multi-value column over a knex client this driver does not model', () => {
  /** Compiles the WHERE without a server — the `[#6518]` probe shape. */
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(TABLE);
      this.applyFilters(builder, where);
      return builder.toString();
    }
  }

  it('N2: the lowered rule is REFUSED with the $null prescription on the multi-value column only', async () => {
    // mssql is not a platform datasource driver; its knex client builds without
    // a server, and this driver reads it as the `'unknown'` dialect.
    const d = new CompilerProbeDriver({ client: 'mssql', connection: {} } as never);
    expect(d.dialectName).toBe('unknown');
    d.registerObjectMetadata([{ name: TABLE, fields: FIELDS } as never]);
    for (const op of ['is_empty', 'is_not_empty']) {
      expectPrescribedRefusal(await refusalOf(() => d.compileWhere(rule('tags', op))), `tags ${op}`);
    }
    // The text and null-only rows need no dialect construct, and `$null` never did.
    expect(d.compileWhere(rule('title', 'is_empty'))).toMatch(/is null or/i);
    expect(d.compileWhere(rule('amount', 'is_empty'))).toMatch(/is null/i);
    expect(d.compileWhere({ tags: { $null: true } })).toMatch(/is null/i);
  });
});
