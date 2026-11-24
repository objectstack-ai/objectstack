// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37133] A group key on the remote face is presented as `find()` presents
 * the same column, and the grouped answer equals the local face's.
 *
 * `RemoteTransport.aggregate` hands back raw libSQL columns: a declared boolean
 * is the stored `1` / `0`. The local face presents every group key through the
 * one read presenter (`SqlDriver.presentReadColumns`), so one grouped query
 * answered `true` / `false` locally and `1` / `0` on a hosted environment.
 *
 * Every pin here runs on the REAL libSQL engine (`@libsql/client` over
 * `file::memory:`) behind the remote face, never the better-sqlite3 stub: the
 * defect is what the real client hands back, so a stub would only pin itself.
 * Measures are not presented by this fix and are pinned unchanged: a count is a
 * number on both faces, and `min` / `max` over a boolean stay `0` / `1` (the
 * ruled numeric aggregation domain, `SqlDriver.aggregate` [#11152]).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { TursoDriver } from './turso-driver.js';

type Row = Record<string, unknown>;

const TASK = {
  name: 'os37133_task',
  fields: {
    title: { type: 'text' },
    done: { type: 'boolean' },
    due: { type: 'date' },
    points: { type: 'number' },
  },
};

const ROWS: Row[] = [
  { title: 'a', done: true, due: '2026-01-05', points: 3 },
  { title: 'b', done: true, due: '2026-01-05', points: 5 },
  { title: 'c', done: false, due: '2026-02-10', points: 3 },
  { title: 'd', done: null, due: null, points: null },
];

/** A fresh copy per sync: neither face may see a definition the other one mutated. */
const fresh = () => ({
  ...TASK,
  fields: Object.fromEntries(Object.entries(TASK.fields).map(([k, v]) => [k, { ...v }])),
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function seed(driver: TursoDriver): Promise<TursoDriver> {
  await driver.connect();
  cleanups.push(() => driver.disconnect());
  await driver.initObjects([fresh()] as never);
  for (const row of ROWS) await driver.create(TASK.name, { ...row });
  return driver;
}

const localFace = async () => {
  const driver = await seed(new TursoDriver({ url: ':memory:' }));
  expect(driver.transportMode).toBe('local');
  return driver;
};

const remoteFace = async () => {
  const client = createClient({ url: 'file::memory:' });
  const driver = await seed(new TursoDriver({ url: 'libsql://group-key-presentation.turso.io', client }));
  expect(driver.transportMode).toBe('remote');
  return driver;
};

/** Order-independent comparison: neither face promises a group order. */
const sorted = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('[#37133] remote aggregate presents its group keys as find() does', () => {
  it('a boolean group key answers true / false / null, never 1 / 0', async () => {
    const remote = await remoteFace();
    const rows = await remote.aggregate(TASK.name, {
      groupBy: ['done'],
      aggregations: [{ function: 'count', alias: 'c' }],
    } as never);
    expect(sorted(rows)).toEqual(sorted([
      { done: null, c: 1 },
      { done: false, c: 1 },
      { done: true, c: 2 },
    ]));
  });

  it('an aliased structured group key is presented under the name the row carries', async () => {
    const remote = await remoteFace();
    const rows = await remote.aggregate(TASK.name, {
      groupBy: [{ field: 'done', alias: 'is_done' }],
      aggregations: [{ function: 'count', alias: 'c' }],
    } as never);
    expect(sorted(rows)).toEqual(sorted([
      { is_done: null, c: 1 },
      { is_done: false, c: 1 },
      { is_done: true, c: 2 },
    ]));
  });

  it('the remote answer equals the local answer on the same data', async () => {
    const local = await localFace();
    const remote = await remoteFace();
    const queries = [
      { groupBy: ['done'], aggregations: [{ function: 'count', alias: 'c' }] },
      { groupBy: [{ field: 'done', alias: 'is_done' }], aggregations: [{ function: 'sum', field: 'points', alias: 'total' }] },
      { groupBy: ['done', 'due'], aggregations: [{ function: 'count', alias: 'c' }] },
      { groupBy: ['points'], aggregations: [{ function: 'count', alias: 'c' }] },
      // Measures: a boolean aggregand stays in the ruled numeric domain on both faces.
      { groupBy: ['due'], aggregations: [{ function: 'max', field: 'done', alias: 'any_done' }, { function: 'min', field: 'done', alias: 'all_done' }] },
    ];
    for (const query of queries) {
      const want = await local.aggregate(TASK.name, query as never);
      const got = await remote.aggregate(TASK.name, query as never);
      expect(sorted(got), JSON.stringify(query)).toEqual(sorted(want));
    }
    // The ruled numeric answer is what both faces agree on, not a shared presentation slip.
    const measured = await remote.aggregate(TASK.name, queries[4] as never);
    expect(measured.map((r) => r.any_done).filter((v) => v !== null).every((v) => v === 0 || v === 1)).toBe(true);
  });

  it('distinct over the boolean answers the presented values on both faces', async () => {
    const local = await localFace();
    const remote = await remoteFace();
    const want = await local.distinct(TASK.name, 'done');
    const got = await remote.distinct(TASK.name, 'done');
    expect([...got].map(String).sort()).toEqual([...want].map(String).sort());
    expect(got.filter((v) => v !== null).every((v) => typeof v === 'boolean')).toBe(true);
  });
});
