// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32985; maintainer decision 2026-11-14 on #32985] `detectStampOnlyRows`
 * reports the `sys_metadata` rows that name their package by the `_packageId`
 * stamp alone, each with the verdict its own history gives — read through
 * `find` only, nothing written. Fixtures follow what a 17.0.0–18.3.0 boot left
 * (a v1 create without the stamp, a v2 update adding `_packageId` and
 * `_provenance` only), what an 18.4.0 boot added (the column bound), and what
 * a package's own save writes (the stamp from the create on).
 */

import { describe, expect, it, vi } from 'vitest';
import { detectStampOnlyRows } from './index.js';

const HOST = 'com.host.app';
const OTHER = 'com.other.app';
const STAMP = { _packageId: HOST, _provenance: 'package' };

type Row = Record<string, unknown>;

/** Equality per field; an operator or a combinator is refused, never matched loosely. */
const matches = (row: Row, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (key.startsWith('$') || (value !== null && typeof value === 'object')) throw new Error(`readStore: ${key} is not implemented`);
    return row[key] === value;
  });

/** Two tables, `find` only. */
function readStore(tables: { rows: Row[]; history?: Row[] | 'missing' }) {
  const find = vi.fn(async (table: string, query: { where?: Record<string, unknown> }) => {
    const source = table === 'sys_metadata' ? tables.rows : tables.history;
    if (source === 'missing') throw new Error(`SQLITE_ERROR: no such table: ${table}`);
    return (source ?? []).filter((row) => matches(row, query?.where)).map((row) => ({ ...row }));
  });
  return { find };
}

const row = (id: string, type: string, name: string, body: Row, extra: Row = {}): Row => ({
  id, type, name, version: 2, checksum: `${id}-2`, source: 'database', package_id: null, metadata: JSON.stringify(body), ...extra,
});
const entry = (id: string, type: string, name: string, version: number, operation: string, body: Row, previous: string | null): Row => ({
  id: `${id}-h${version}`, type, name, version, operation_type: operation, checksum: `${id}-${version}`, previous_checksum: previous,
  metadata: JSON.stringify(body),
});
/** The history a 17.0.0–18.3.0 boot left: an unstamped create, then the stamp. */
const bootStamped = (id: string, type: string, name: string, body: Row): Row[] => [
  entry(id, type, name, 1, 'create', body, null),
  entry(id, type, name, 2, 'update', { ...body, ...STAMP }, `${id}-1`),
];

describe('detectStampOnlyRows (#32985)', () => {
  it('an environment row a boot stamped: `stamp-added`, with the unstamped version, the version that added the stamp and nothing else, for an empty column and for one an 18.4.0 boot bound', async () => {
    const env = { name: 'env_object', label: 'env' };
    const agent = { name: 'env_agent', label: 'env' };
    const store = readStore({
      rows: [row('o', 'object', 'env_object', { ...env, ...STAMP }), row('a', 'agent', 'env_agent', { ...agent, ...STAMP }, { package_id: HOST })],
      history: [...bootStamped('o', 'object', 'env_object', env), ...bootStamped('a', 'agent', 'env_agent', agent)],
    });
    const report = await detectStampOnlyRows(store);
    expect(report.scanned).toBe(2);
    expect(report.rows).toEqual([
      { id: 'o', type: 'object', name: 'env_object', packageId: HOST, column: null, source: 'database', version: 2, verdict: 'stamp-added', history: 'read', historyVersions: [1, 2], unstampedVersion: 1, stampedVersion: 2, onlyStampAdded: true },
      { id: 'a', type: 'agent', name: 'env_agent', packageId: HOST, column: HOST, source: 'database', version: 2, verdict: 'stamp-added', history: 'read', historyVersions: [1, 2], unstampedVersion: 1, stampedVersion: 2, onlyStampAdded: true },
    ]);
  });

  it('a version that added the stamp with another change: still `stamp-added`, `onlyStampAdded` false', async () => {
    const store = readStore({
      rows: [row('o', 'object', 'x', { name: 'x', label: 'b', ...STAMP })],
      history: [entry('o', 'object', 'x', 1, 'create', { name: 'x', label: 'a' }, null), entry('o', 'object', 'x', 2, 'update', { name: 'x', label: 'b', ...STAMP }, 'o-1')],
    });
    expect((await detectStampOnlyRows(store)).rows.map((r) => [r.verdict, r.onlyStampAdded])).toEqual([['stamp-added', false]]);
  });

  it('the package\'s own row, created with the stamp: `stamped-since-create` and reported while its column is empty; not reported once its column is bound', async () => {
    const body = { name: 'x', label: 'pkg', ...STAMP };
    const store = readStore({
      rows: [row('empty', 'object', 'x', body, { version: 1, checksum: 'empty-1' }), row('bound', 'agent', 'x', body, { version: 1, checksum: 'bound-1', package_id: HOST })],
      history: [entry('empty', 'object', 'x', 1, 'create', body, null), entry('bound', 'agent', 'x', 1, 'create', body, null)],
    });
    expect((await detectStampOnlyRows(store)).rows.map((r) => [r.id, r.verdict, r.column])).toEqual([['empty', 'stamped-since-create', null]]);
  });

  it('`undetermined` when the history does not reach back: none kept, or a chain that begins with an update', async () => {
    const store = readStore({
      rows: [row('none', 'object', 'a', { name: 'a', ...STAMP }), row('mid', 'object', 'b', { name: 'b', ...STAMP }, { version: 3, checksum: 'mid-3' })],
      history: [entry('mid', 'object', 'b', 3, 'update', { name: 'b', ...STAMP }, 'raw-seeded')],
    });
    expect((await detectStampOnlyRows(store)).rows.map((r) => [r.id, r.verdict, r.history, r.historyVersions])).toEqual([
      ['none', 'undetermined', 'read', []],
      ['mid', 'undetermined', 'read', [3]],
    ]);
  });

  it('`undetermined` with `history: unavailable` when the history table is not provisioned; any other read failure is thrown', async () => {
    const missing = readStore({ rows: [row('o', 'object', 'x', { name: 'x', ...STAMP })], history: 'missing' });
    expect((await detectStampOnlyRows(missing)).rows.map((r) => [r.verdict, r.history])).toEqual([['undetermined', 'unavailable']]);
    const failing = { find: vi.fn(async (table: string) => { if (table === 'sys_metadata') return [row('o', 'object', 'x', { name: 'x', ...STAMP })]; throw new Error('connection reset'); }) };
    await expect(detectStampOnlyRows(failing)).rejects.toThrow('connection reset');
  });

  it('reads one row\'s history by its own checksum chain: another holder\'s history of the name is never read as its own', async () => {
    const env = { name: 'helper', label: 'env' };
    const store = readStore({
      rows: [row('env', 'action', 'helper', { ...env, ...STAMP }), row('alpha', 'action', 'helper', { name: 'helper', label: 'alpha' }, { version: 1, checksum: 'alpha-1', package_id: OTHER })],
      history: [entry('alpha', 'action', 'helper', 1, 'create', { name: 'helper', label: 'alpha', _packageId: HOST }, null), ...bootStamped('env', 'action', 'helper', env)],
    });
    expect((await detectStampOnlyRows(store)).rows.map((r) => [r.id, r.verdict, r.historyVersions])).toEqual([['env', 'stamp-added', [1, 2]]]);
  });

  it('reports no row that names its package by its own key, names none, or whose column names another package; `packageId` narrows to one stamp', async () => {
    const store = readStore({
      rows: [
        row('own', 'object', 'a', { name: 'a', packageId: HOST, ...STAMP }),
        row('legacy', 'object', 'b', { name: 'b', package: HOST, ...STAMP }),
        row('env', 'object', 'c', { name: 'c' }),
        row('other-column', 'agent', 'd', { name: 'd', ...STAMP }, { package_id: OTHER }),
        row('host', 'object', 'e', { name: 'e', ...STAMP }),
        row('other', 'object', 'f', { name: 'f', _packageId: OTHER }),
      ],
      history: [],
    });
    expect((await detectStampOnlyRows(store)).rows.map((r) => r.id)).toEqual(['host', 'other']);
    expect((await detectStampOnlyRows(store, { packageId: HOST })).rows.map((r) => r.id)).toEqual(['host']);
  });

  it('is read-only: the handle it is given is read through `find` and nothing else', async () => {
    const store = { ...readStore({ rows: [row('o', 'object', 'x', { name: 'x', ...STAMP })], history: [] }), update: vi.fn(), create: vi.fn(), delete: vi.fn() };
    await detectStampOnlyRows(store);
    expect([store.find.mock.calls.map(([table]) => table), store.update, store.create, store.delete].map((v) => (typeof v === 'function' ? (v as any).mock.calls.length : v)))
      .toEqual([['sys_metadata', 'sys_metadata_history'], 0, 0, 0]);
  });
});
