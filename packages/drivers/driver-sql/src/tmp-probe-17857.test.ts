// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// THROWAWAY probe for objectstack#17857 — deleted before the PR is opened.

import { describe, it, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';

const TABLE = 'probe17857_t';

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    const v = await run();
    return { resolved: v };
  } catch (err) {
    return err;
  }
}

function row(label: string, e: any): void {
  if (e && 'resolved' in e && !(e instanceof Error)) {
    console.log(`ROW ${label} => RESOLVED ${JSON.stringify(e.resolved)}`);
    return;
  }
  const head = String(e?.message ?? e).slice(0, 110).replace(/\s+/g, ' ');
  console.log(`ROW ${label} => code=${e?.code} status=${e?.status} msg=${head}`);
}

describe('[#17857 probe] the five doors', () => {
  let d: SqlDriver;
  beforeAll(async () => {
    d = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await d.initObjects([{ name: TABLE, fields: { title: { type: 'string' } } }]);
    await d.create(TABLE, { id: 'a', title: 'Design' }, { bypassTenantAudit: true });
    await d.create(TABLE, { id: 'b', title: 'Build' }, { bypassTenantAudit: true });
  });
  afterAll(async () => { await d.disconnect(); });

  it('probes', async () => {
    row('1 count(where nosuchcol)   ', await caught(() => d.count(TABLE, { where: { nosuchcol: 1 } })));
    row('2 find(where nosuchcol)    ', await caught(() => d.find(TABLE, { where: { nosuchcol: 1 } })));
    row('3 aggregate(groupBy nosuch)', await caught(() => d.aggregate(TABLE, { groupBy: ['nosuchcol'], aggregations: [{ function: 'count', alias: 'n' }] })));
    row('4 distinct(title, {nosuch})', await caught(() => d.distinct(TABLE, 'title', { nosuchcol: 1 })));
    row('5 distinct(nosuchcol)      ', await caught(() => d.distinct(TABLE, 'nosuchcol')));
    row('C control distinct(title)  ', await caught(() => d.distinct(TABLE, 'title')));
  });
});
