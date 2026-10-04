// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20444] The `$empty` operator on BOTH of TursoDriver's faces — the
 * local transport (which inherits `SqlDriver.applyFilterCondition`) and the
 * remote one (`RemoteTransport.buildWhereSQL`, an independent compiler) — held
 * to one row set, by the field's DECLARED row of the ruled 「is empty」 table
 * (ruling A on #20399, record 5865693155; the spec's `expandEmptyOperator`):
 * text-like = null or `''`; multi-value = null or `[]`; every other type = null
 * only; `$empty: false` the exact complement.
 *
 * The remote transport keeps no schema: the driver hands it the declaration
 * (`setDeclaredValueShapeResolver`, answered from the registration
 * `registerRemoteFieldMetadata` performs), and a transport nobody handed it to
 * refuses the operator rather than guessing a row.
 *
 * libSQL IS SQLite, so `makeLibsqlSqliteStub` gives the remote transport real
 * SQLite semantics with no network — the same stub the remote conformance
 * suites use.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { RemoteTransport } from './remote-transport.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const OBJECT = {
  name: 'os20444_empty',
  fields: {
    title: { type: 'text' },
    tags: { type: 'tags' },
    score: { type: 'number' },
  },
};

const ROWS = [
  { id: 'r1', title: 'x', tags: ['a'], score: 5 },
  { id: 'r2', title: '', tags: [], score: 0 },
  { id: 'r3', title: null, tags: null, score: null },
  { id: 'r4', title: '  ', tags: ['a', 'b'], score: -1 },
];

/** Each filter and the ids it must select, on both faces. */
const CASES: Array<{ where: FilterCondition; expected: string[] }> = [
  { where: { title: { $empty: true } }, expected: ['r2', 'r3'] },
  { where: { title: { $empty: false } }, expected: ['r1', 'r4'] },
  { where: { tags: { $empty: true } }, expected: ['r2', 'r3'] },
  { where: { tags: { $empty: false } }, expected: ['r1', 'r4'] },
  { where: { score: { $empty: true } }, expected: ['r3'] },
  { where: { score: { $empty: false } }, expected: ['r1', 'r2', 'r4'] },
  { where: { $not: { title: { $empty: true } } }, expected: ['r1', 'r4'] },
  { where: { $not: { tags: { $empty: false } } }, expected: ['r2', 'r3'] },
  { where: { $not: { score: { $empty: true } } }, expected: ['r1', 'r2', 'r4'] },
  { where: { $or: [{ score: 5 }, { tags: { $empty: true } }] }, expected: ['r1', 'r2', 'r3'] },
  { where: { $and: [{ title: { $empty: false } }, { tags: { $empty: false } }] }, expected: ['r1', 'r4'] },
  { where: { title: { $empty: false, $ne: 'x' } }, expected: ['r4'] },
];

const NO_AUDIT = { bypassTenantAudit: true };

async function refusal(run: () => Promise<unknown>): Promise<{ code?: string; status?: number } | 'answered'> {
  try {
    await run();
  } catch (err) {
    return { code: (err as { code?: string }).code, status: (err as { status?: number }).status };
  }
  return 'answered';
}

describe('[#20444] TursoDriver — $empty on the local and the remote face', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;
  const ids = async (driver: TursoDriver, where: FilterCondition) =>
    (await driver.find(OBJECT.name, { where }, NO_AUDIT)).map((r) => String(r.id)).sort();

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://os20444.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);

    for (const row of ROWS) {
      await local.create(OBJECT.name, { ...row }, NO_AUDIT);
      await remote.create(OBJECT.name, { ...row }, NO_AUDIT);
    }
  });

  afterAll(async () => {
    await local?.disconnect();
    await remote?.disconnect();
    stub?.close();
  });

  it('the fixture landed on both faces', async () => {
    expect(await ids(local, {})).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(await ids(remote, {})).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  for (const c of CASES) {
    it(`${JSON.stringify(c.where)} → ${JSON.stringify(c.expected)} on both faces`, async () => {
      expect(await ids(local, c.where), 'local').toEqual(c.expected);
      expect(await ids(remote, c.where), 'remote').toEqual(c.expected);
    });
  }

  it('count() agrees with find() on the remote face', async () => {
    for (const c of CASES) {
      expect(await remote.count(OBJECT.name, { where: c.where }, NO_AUDIT), JSON.stringify(c.where)).toBe(c.expected.length);
    }
  });

  it('a field with no declaration is refused on both faces, never guessed', async () => {
    for (const driver of [local, remote]) {
      expect(await refusal(() => driver.find(OBJECT.name, { where: { id: { $empty: true } } }, NO_AUDIT)))
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
  });

  it('a non-boolean flag is refused on both faces', async () => {
    for (const driver of [local, remote]) {
      expect(await refusal(() => driver.find(OBJECT.name, { where: { title: { $empty: 'yes' as never } } }, NO_AUDIT)))
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
    }
  });

  it('a RemoteTransport nobody handed the declaration refuses $empty rather than guessing a row', async () => {
    const bare = new RemoteTransport();
    let executed = false;
    bare.setClient({
      execute: async () => {
        executed = true;
        return { rows: [], columns: [] };
      },
    } as never);
    expect(await refusal(() => bare.find(OBJECT.name, { where: { title: { $empty: true } } } as never)))
      .toEqual({ code: 'INVALID_FILTER', status: 400 });
    expect(executed, 'the refusal came before any statement ran').toBe(false);
  });
});
