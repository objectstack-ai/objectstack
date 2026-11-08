// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A paged read of a federated object whose `external.columnMap` names its key
 * column is a PARTITION of the result set (objectui#3106, #4363), ordered by
 * that key — the column the by-id doors already address.
 *
 * The tie-breaker used to be imposed only on tables this driver created, so
 * every federated page walk was unordered among ties. SQLite mostly hides it
 * (a plain table scan returns rowid order), which is why these pins read the
 * compiled ORDER BY as well as the rows; a dialect that promises no order
 * among ties repeats and loses rows across pages.
 *
 * A federated object with NO mapped key keeps the old behaviour exactly — no
 * column is guessed (`paginationTieBreaker`'s docblock says why).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

let driver: any;
afterEach(async () => { await driver?.disconnect(); driver = undefined; });

async function over(columnMap: Record<string, string> | undefined): Promise<{ driver: any; sql: string[] }> {
  const d = new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, schemaMode: 'external',
  } as any) as any;
  d.name = 'extds';
  await d.connect();
  await d.knex.raw('create table REMOTE_T (T_NO text primary key, STATUS text)');
  await d.knex.raw("insert into REMOTE_T values ('b', 'open'), ('a', 'open'), ('c', 'done')");
  d.registerExternalObject({
    name: 't',
    external: { remoteName: 'REMOTE_T', ...(columnMap ? { columnMap } : {}) },
    fields: { status: { type: 'text' } },
  });
  const sql: string[] = [];
  d.knex.on('query', (q: { sql: string }) => sql.push(q.sql));
  return { driver: d, sql };
}

describe('paged reads of a columnMap-keyed federated object', () => {
  it('an unsorted page is ordered by the mapped key column', async () => {
    const run = await over({ T_NO: 'id', STATUS: 'status' });
    driver = run.driver;
    const rows = await driver.find('t', { limit: 2 });
    expect(rows.map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(run.sql.at(-1)).toMatch(/order by [`"]T_NO[`"] asc/);
  });

  it('a sorted page breaks its ties on the mapped key, in the last key’s direction', async () => {
    const run = await over({ T_NO: 'id', STATUS: 'status' });
    driver = run.driver;
    await driver.find('t', { orderBy: [{ field: 'status', order: 'desc' }], limit: 2 });
    expect(run.sql.at(-1)).toMatch(/order by [`"]STATUS[`"] desc, [`"]T_NO[`"] desc/);
  });

  it('an object with no mapped key is left alone: no column is guessed', async () => {
    const run = await over(undefined);
    driver = run.driver;
    await driver.find('t', { orderBy: [{ field: 'status', order: 'asc' }], limit: 2 }).catch(() => undefined);
    expect(run.sql.at(-1)).not.toMatch(/[`"]id[`"]/);
  });
});
