/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12187 — the user-state adapters' shared read, at its edges.
 *
 * `load()` joins one open read per (data source, resource, user); every load
 * of that scope issued before the next microtask adds its key, and the read is
 * sent once. These cases pin what the share must NOT do, through the REAL
 * adapter and the REAL client, counted on the wire:
 *
 *   - serve one user's rows to another user's adapter;
 *   - serve a later load from an earlier answer (nothing is kept past the send);
 *   - let a second data source join the first one's read;
 *   - attribute a row that names no key to some key in a shared answer;
 *   - let one failed read throw out of any adapter's `load()`;
 *   - change a write: `save()` still finds and writes its own row.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import { createObjectStackUserStateAdapter } from './userState';

const BASE = 'http://test.local';

interface HeldRequest {
  method: string;
  path: string;
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

describe('the user-state adapters share one read per load (objectui#12187)', () => {
  it("never answers one user's adapter with another user's rows", async () => {
    const { ds, held } = await heldAdapter();
    const forU1 = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });
    const forU2 = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u2', key: 'ui.recent' });
    const loads = [forU1.load(), forU2.load()];
    await drain();

    // Two users, two reads, each scoped to its own user.
    expect(held).toHaveLength(2);
    const u1Read = held.find((r) => r.path.includes('["user_id","=","u1"]'));
    const u2Read = held.find((r) => r.path.includes('["user_id","=","u2"]'));
    expect(u1Read).toBeDefined();
    expect(u2Read).toBeDefined();

    u1Read!.respond(200, rows([{ id: 'p1', user_id: 'u1', key: 'ui.recent', value: ['u1-item'] }]));
    u2Read!.respond(200, rows([{ id: 'p2', user_id: 'u2', key: 'ui.recent', value: ['u2-item'] }]));
    await expect(Promise.all(loads)).resolves.toEqual([['u1-item'], ['u2-item']]);
  });

  it('a load issued after the shared read was sent asks the server again', async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    const recent = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });

    const first = [favorites.load(), recent.load()];
    await drain();
    expect(gets(held)).toHaveLength(1);

    // Asked while the first read is still in flight: it is already closed.
    const later = recent.load();
    await drain();
    expect(gets(held)).toHaveLength(2);
    // Alone in its read, so it is the per-key query this adapter always sent.
    expect(held[1].path).toContain('["key","=","ui.recent"]');
    expect(held[1].path).toContain('top=1');

    held[0].respond(200, rows([
      { id: 'p1', user_id: 'u1', key: 'ui.favorites', value: ['f-old'] },
      { id: 'p2', user_id: 'u1', key: 'ui.recent', value: ['r-old'] },
    ]));
    held[1].respond(200, rows([{ id: 'p2', user_id: 'u1', key: 'ui.recent', value: ['r-new'] }]));
    await expect(Promise.all(first)).resolves.toEqual([['f-old'], ['r-old']]);
    await expect(later).resolves.toEqual(['r-new']);
  });

  it("a second data source does not join the first one's read", async () => {
    const shared: HeldRequest[] = [];
    const { ds: one } = await heldAdapter(shared);
    const { ds: two } = await heldAdapter(shared);
    const loads = [
      createObjectStackUserStateAdapter<string>({ dataSource: one, userId: 'u1', key: 'ui.recent' }).load(),
      createObjectStackUserStateAdapter<string>({ dataSource: two, userId: 'u1', key: 'ui.recent' }).load(),
    ];
    await drain();

    expect(shared).toHaveLength(2);
    shared.forEach((r) => r.respond(200, rows([])));
    await expect(Promise.all(loads)).resolves.toEqual([[], []]);
  });

  it('a shared answer whose rows name no key is not attributed: each key reads its own row', async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    const recent = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });
    const loads = [favorites.load(), recent.load()];
    await drain();

    expect(held).toHaveLength(1);
    held[0].respond(200, rows([{ id: 'p0', value: ['which-key'] }]));
    await drain();

    // Neither adapter took the untagged row; each asked for its own key.
    const perKey = held.slice(1);
    expect(perKey).toHaveLength(2);
    expect(perKey.map((r) => r.path)).toEqual(expect.arrayContaining([
      expect.stringContaining('["key","=","ui.favorites"]'),
      expect.stringContaining('["key","=","ui.recent"]'),
    ]));
    perKey.find((r) => r.path.includes('ui.favorites'))!.respond(200, rows([{ id: 'p1', value: ['f'] }]));
    perKey.find((r) => r.path.includes('ui.recent'))!.respond(200, rows([{ id: 'p2', value: ['r'] }]));
    await expect(Promise.all(loads)).resolves.toEqual([['f'], ['r']]);
  });

  it('a failed shared read resolves every load to [] and reports it to each adapter', async () => {
    const { ds, held } = await heldAdapter();
    const onFavoritesError = vi.fn();
    const onRecentError = vi.fn();
    const loads = [
      createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites', onError: onFavoritesError }).load(),
      createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent', onError: onRecentError }).load(),
    ];
    await drain();

    expect(held).toHaveLength(1);
    held[0].respond(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    await expect(Promise.all(loads)).resolves.toEqual([[], []]);
    expect(onFavoritesError).toHaveBeenCalledWith('load', expect.anything());
    expect(onRecentError).toHaveBeenCalledWith('load', expect.anything());
  });

  it("a save with no row known finds its own key's row, then writes only that row", async () => {
    const { ds, held } = await heldAdapter();
    const favorites = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.favorites' });
    // A second adapter on the same scope, saving at the same time: writes do not share.
    const recent = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });

    const saves = [favorites.save(['f']), recent.save(['r'])];
    await drain();

    const finds = gets(held);
    expect(finds).toHaveLength(2);
    expect(finds.map((r) => r.path)).toEqual(expect.arrayContaining([
      expect.stringContaining('["key","=","ui.favorites"]'),
      expect.stringContaining('["key","=","ui.recent"]'),
    ]));
    finds.find((r) => r.path.includes('ui.favorites'))!.respond(200, rows([{ id: 'pf', user_id: 'u1', key: 'ui.favorites', value: [] }]));
    finds.find((r) => r.path.includes('ui.recent'))!.respond(200, rows([{ id: 'pr', user_id: 'u1', key: 'ui.recent', value: [] }]));
    await drain();

    const writes = held.filter((r) => r.method !== 'GET');
    expect(writes).toHaveLength(2);
    expect(writes.map((r) => r.path).sort()).toEqual([
      '/api/v1/data/sys_user_preference/pf',
      '/api/v1/data/sys_user_preference/pr',
    ]);
    writes.forEach((r) => r.respond(200, { success: true, data: { object: 'sys_user_preference', id: 'x', record: { id: 'x' } } }));
    await Promise.all(saves);
  });
});
