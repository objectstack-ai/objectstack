/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12418 — a key FAMILY in the shared read.
 *
 * The console keeps one list-state row per object, `ui.list.<object>`, and
 * which objects those are is only known from the rows. The family loads them
 * by prefix, and it must ride the ONE read objectui#12187 budgeted per load:
 * the read asks for the slots' keys OR any key starting with the prefix.
 * Through the REAL adapter and the REAL client, counted on the wire:
 *
 *   - a family load and two key loads issued together are ONE request, and
 *     each takes its own rows from the answer;
 *   - the family takes only rows of its prefix, for its user, with an object
 *     value; a row that names no key is nobody's;
 *   - an answer that fills the read's `$top` may have left a key's row out,
 *     so a key missing from it asks for its own row;
 *   - a save writes only its own key's row, by the id the load found, or finds
 *     then creates it; a key outside the family writes nothing;
 *   - a failed read loads as no rows and is reported.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import {
  createObjectStackUserPreferenceFamily,
  createObjectStackUserStateAdapter,
  PREFERENCE_FAMILY_ROW_LIMIT,
} from './userState';

const BASE = 'http://test.local';

interface HeldRequest {
  method: string;
  path: string;
  body: unknown;
  respond: (status: number, body: unknown) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A connected adapter whose data requests wait until the test answers them. */
async function heldAdapter(held: HeldRequest[] = []) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json(200, { success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      held.push({
        method: (init?.method ?? 'GET').toUpperCase(),
        path: decodeURIComponent(url.replace(BASE, '')),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        respond: (status, body) => resolve(json(status, body)),
      });
    });
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  return { ds, held };
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const rows = (records: unknown[]) => ({ success: true, data: { records, total: records.length } });
const gets = (held: HeldRequest[]) => held.filter((r) => r.method === 'GET');
const writes = (held: HeldRequest[]) => held.filter((r) => r.method !== 'GET');
const ok = { success: true, data: { object: 'sys_user_preference', id: 'x', record: { id: 'x' } } };

const PREFIX = 'ui.list.';

describe('a key family rides the shared read (objectui#12418)', () => {
  it('a family load and two key loads issued together are ONE request, and each takes its own rows', async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    const recent = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX });

    const loads = Promise.all([favorites.load(), recent.load(), lists.load()]);
    await drain();

    expect(gets(held)).toHaveLength(1);
    const path = held[0].path;
    // The keys and the prefix, in one filter, scoped to the user.
    expect(path).toContain('["user_id","=","u1"]');
    expect(path).toContain('["key","in",["ui.favorites","ui.recent"]]');
    expect(path).toContain('["key","startswith","ui.list."]');
    expect(path).toContain(`top=${2 + PREFERENCE_FAMILY_ROW_LIMIT}`);

    held[0].respond(200, rows([
      { id: 'p1', user_id: 'u1', key: 'ui.favorites', value: ['f'] },
      { id: 'p2', user_id: 'u1', key: 'ui.recent', value: ['r'] },
      { id: 'p3', user_id: 'u1', key: 'ui.list.account', value: { viewOrder: ['b', 'a'] } },
      { id: 'p4', user_id: 'u1', key: 'ui.list.contact', value: JSON.stringify({ perView: { all: { sort: [] } } }) },
    ]));
    await expect(loads).resolves.toEqual([
      ['f'],
      ['r'],
      {
        'ui.list.account': { viewOrder: ['b', 'a'] },
        'ui.list.contact': { perView: { all: { sort: [] } } },
      },
    ]);
    expect(gets(held)).toHaveLength(1);
  });

  it('the family takes only its own rows: its prefix, its user, an object value; a row naming no key is nobody\'s', async () => {
    const { ds, held } = await heldAdapter();
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX });
    const load = lists.load();
    await drain();

    expect(held).toHaveLength(1);
    held[0].respond(200, rows([
      { id: 'a', user_id: 'u1', key: 'ui.list.account', value: { viewOrder: ['x'] } },
      { id: 'b', user_id: 'u2', key: 'ui.list.account', value: { viewOrder: ['other-user'] } },
      { id: 'c', user_id: 'u1', key: 'ui.favorites', value: ['not-the-family'] },
      { id: 'd', user_id: 'u1', key: 'ui.list.lead', value: ['an-array'] },
      { id: 'e', user_id: 'u1', key: 'ui.list.deal', value: 'not json' },
      { id: 'f', value: { viewOrder: ['which-key'] } },
    ]));
    await expect(load).resolves.toEqual({ 'ui.list.account': { viewOrder: ['x'] } });
  });

  it('an answer that fills the read\'s top may have cut a key\'s row: that key asks for its own row', async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX });
    const loads = Promise.all([favorites.load(), lists.load()]);
    await drain();

    expect(held).toHaveLength(1);
    const top = 1 + PREFERENCE_FAMILY_ROW_LIMIT;
    expect(held[0].path).toContain(`top=${top}`);
    // A full answer of family rows only: the favorites row did not fit.
    held[0].respond(200, rows(Array.from({ length: top }, (_, i) => ({
      id: `l${i}`, user_id: 'u1', key: `ui.list.o${i}`, value: { viewOrder: [] },
    }))));
    await drain();

    const own = gets(held).slice(1);
    expect(own).toHaveLength(1);
    expect(own[0].path).toContain('["key","=","ui.favorites"]');
    own[0].respond(200, rows([{ id: 'pf', user_id: 'u1', key: 'ui.favorites', value: ['f'] }]));
    const [fav, family] = await loads;
    expect(fav).toEqual(['f']);
    expect(Object.keys(family)).toHaveLength(top);
  });

  it('CONTROL: an answer short of the top is complete — a key missing from it has no row, and asks nothing more', async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX });
    const loads = Promise.all([favorites.load(), lists.load()]);
    await drain();

    held[0].respond(200, rows([{ id: 'l0', user_id: 'u1', key: 'ui.list.o0', value: { viewOrder: [] } }]));
    await expect(loads).resolves.toEqual([[], { 'ui.list.o0': { viewOrder: [] } }]);
    expect(held).toHaveLength(1);
  });

  it('a save writes only its own key\'s row: by the id the load found, or found then created', async () => {
    const { ds, held } = await heldAdapter();
    const lists = createObjectStackUserPreferenceFamily<{ viewOrder?: string[] }>({ dataSource: ds, userId: 'u1', prefix: PREFIX });
    const load = lists.load();
    await drain();
    held[0].respond(200, rows([{ id: 'acc', user_id: 'u1', key: 'ui.list.account', value: { viewOrder: ['a'] } }]));
    await load;

    // A key the load found: written straight to its row, nothing read first.
    const known = lists.save('ui.list.account', { viewOrder: ['b', 'a'] });
    await drain();
    expect(gets(held)).toHaveLength(1);
    expect(writes(held)).toHaveLength(1);
    expect(writes(held)[0].path).toBe('/api/v1/data/sys_user_preference/acc');
    expect((writes(held)[0].body as { value: unknown }).value).toEqual({ viewOrder: ['b', 'a'] });
    writes(held)[0].respond(200, ok);
    await known;

    // A key with no row: its own per-key read, then an insert of that key.
    const fresh = lists.save('ui.list.lead', { viewOrder: ['x'] });
    await drain();
    const find = gets(held)[1];
    expect(find.path).toContain('["key","=","ui.list.lead"]');
    find.respond(200, rows([]));
    await drain();
    const insert = writes(held)[1];
    expect(insert.method).toBe('POST');
    expect(insert.body).toEqual({ user_id: 'u1', key: 'ui.list.lead', value: { viewOrder: ['x'] } });
    insert.respond(200, { success: true, data: { object: 'sys_user_preference', id: 'lead-row', record: { id: 'lead-row' } } });
    await fresh;
  });

  it('a key outside the family writes nothing and is reported', async () => {
    const { ds, held } = await heldAdapter();
    const onError = vi.fn();
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX, onError });
    await lists.save('ui.favorites', { viewOrder: [] });
    await lists.save('ui.list.', { viewOrder: [] });
    await drain();
    expect(held).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith('save', expect.any(Error));
  });

  it('a failed shared read loads the family as no rows and reports it', async () => {
    const { ds, held } = await heldAdapter();
    const onError = vi.fn();
    const lists = createObjectStackUserPreferenceFamily({ dataSource: ds, userId: 'u1', prefix: PREFIX, onError });
    const load = lists.load();
    await drain();
    held[0].respond(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    await expect(load).resolves.toEqual({});
    expect(onError).toHaveBeenCalledWith('load', expect.anything());
  });
});
