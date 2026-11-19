// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33695] The indexes the schema sync builds WITHOUT a declaration land on
 * the remote face as on the local one: the #31882 reference columns,
 * `(created_at, id)` (the default list order) and `(owner_id)` (the column a
 * private-OWD read filters on).
 *
 * The local face composes them in `SqlDriver.syncTableIndexes`; the remote
 * face (`RemoteTransport.buildDeclaredIndexDDL`) composed only the declared
 * half. The drift differ runs over both faces and expects the whole set, so a
 * remote sync that built fewer left a `create_index` behind every sync. Each
 * pin compares what physically landed on the two faces, anchored by names
 * from the shared `buildIndexName`: two faces that both lost the set would
 * agree perfectly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { buildIndexName } from '@objectstack/driver-sql';
import { TursoDriver } from './turso-driver.js';

type ObjectDef = { name: string; fields: Record<string, any> };
type Row = Record<string, unknown>;
type Query = (sql: string) => Promise<Row[]>;

const OWNED: ObjectDef = {
  name: 'os33695_deal',
  fields: {
    name: { type: 'text' },
    account: { type: 'lookup', reference: 'os33695_account' },
    owner_id: { type: 'lookup', reference: 'sys_user' },
    created_by: { type: 'lookup', reference: 'sys_user' },
  },
};
const UNOWNED: ObjectDef = { name: 'os33695_catalog', fields: { name: { type: 'text' } } };

/** Index name → key columns, the primary-key autoindex included. */
const EXPECTED: Record<string, Record<string, string[]>> = {
  [OWNED.name]: {
    [buildIndexName(OWNED.name, ['account'], false)]: ['account'],
    [buildIndexName(OWNED.name, ['created_at', 'id'], false)]: ['created_at', 'id'],
    [buildIndexName(OWNED.name, ['owner_id'], false)]: ['owner_id'],
    [`sqlite_autoindex_${OWNED.name}_1`]: ['id'],
  },
  [UNOWNED.name]: {
    [buildIndexName(UNOWNED.name, ['created_at', 'id'], false)]: ['created_at', 'id'],
    [`sqlite_autoindex_${UNOWNED.name}_1`]: ['id'],
  },
};

/** A fresh copy per sync: neither face may see a definition the other one mutated. */
const fresh = (o: ObjectDef): ObjectDef => ({
  ...o,
  fields: Object.fromEntries(Object.entries(o.fields).map(([k, v]) => [k, { ...v }])),
});

async function indexKeys(query: Query, table: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const row of await query(`PRAGMA index_list("${table}")`)) {
    const name = String(row.name);
    out[name] = (await query(`PRAGMA index_info("${name.replace(/"/g, '""')}")`))
      .sort((a, b) => Number(a.seqno) - Number(b.seqno))
      .map((k) => String(k.name));
  }
  return out;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function localFace(): Promise<{ driver: TursoDriver; query: Query }> {
  const driver = new TursoDriver({ url: ':memory:' });
  await driver.connect();
  expect(driver.transportMode).toBe('local');
  cleanups.push(() => driver.disconnect());
  return { driver, query: async (sql) => (await driver.execute(sql, [])) as Row[] };
}

async function remoteFace(): Promise<{ driver: TursoDriver; query: Query }> {
  const client = createClient({ url: 'file::memory:' });
  const driver = new TursoDriver({ url: 'libsql://implicit-index-parity.turso.io', client });
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  cleanups.push(() => driver.disconnect());
  return { driver, query: async (sql) => (await client.execute(sql)).rows as unknown as Row[] };
}

describe('[#33695] the implicit index set lands identically on both TursoDriver faces', () => {
  it('a fresh database: the same names and key parts on both faces, none on created_by', async () => {
    const local = await localFace();
    const remote = await remoteFace();
    await local.driver.initObjects([fresh(OWNED), fresh(UNOWNED)] as never);
    await remote.driver.initObjects([fresh(OWNED), fresh(UNOWNED)] as never);
    for (const name of [OWNED.name, UNOWNED.name]) {
      const localKeys = await indexKeys(local.query, name);
      expect(await indexKeys(remote.query, name), name).toEqual(localKeys);
      expect(localKeys, name).toEqual(EXPECTED[name]);
    }
  });

  it('after a remote sync the remote plan proposes no index: no create_index left behind', async () => {
    const remote = await remoteFace();
    await remote.driver.initObjects([fresh(OWNED), fresh(UNOWNED)] as never);
    const plan = await remote.driver.detectManagedDrift([fresh(OWNED), fresh(UNOWNED)] as never);
    expect(plan.filter((d) => /index/.test(d.op.type)).map((d) => (d.op as { indexName?: string }).indexName)).toEqual([]);
  });
});
