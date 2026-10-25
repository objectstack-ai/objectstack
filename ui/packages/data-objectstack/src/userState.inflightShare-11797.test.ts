/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11797 — the `sys_user_preference` reads on console entry, counted
 * on the wire.
 *
 * The card reported three `GET /api/v1/data/sys_user_preference` reads "with
 * the identical filter" on Home → Studio. Measured through the REAL adapter
 * and the REAL client, the console's user-state bridge attaches three
 * adapters — favorites, recent items and flow-palette recents — and each
 * loads its own `(user, key)` row. The card was closed on that reading: three
 * requests whose filters differ in the `key` predicate.
 *
 * objectui#12187 ruled the budget at one read per load: the three loads now
 * share ONE request that asks for the three keys (`key in (...)`), and each
 * adapter takes its own row from the answer. The first case below pins that.
 *
 * The case that was already a duplicate — two loads of one `(user, key)` at
 * once — is one request, and a load after a save still reaches the server.
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
async function heldAdapter() {
  const held: HeldRequest[] = [];
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

/** The keys `UserStateBridge` attaches, in its order. */
const BRIDGE_KEYS = ['ui.favorites', 'ui.recent', 'ui.flow.palette.recents'];

describe('sys_user_preference reads on console entry (objectui#11797)', () => {
  it("the bridge's three loads share one request, and each takes its own row (objectui#12187)", async () => {
    const { ds, held } = await heldAdapter();
    const loads = BRIDGE_KEYS.map((key) =>
      createObjectStackUserStateAdapter({ dataSource: ds, userId: 'u1', key }).load(),
    );
    await drain();

    expect(held).toHaveLength(1);
    expect(held[0].path.startsWith('/api/v1/data/sys_user_preference?')).toBe(true);
    expect(held[0].path).toContain('["user_id","=","u1"]');
    expect(held[0].path).toContain(`["key","in",${JSON.stringify(BRIDGE_KEYS)}]`);
    expect(held[0].path).toContain('top=3');

    held[0].respond(
      200,
      rows(BRIDGE_KEYS.map((key, i) => ({ id: `p${i}`, user_id: 'u1', key, value: [key] }))),
    );
    await expect(Promise.all(loads)).resolves.toEqual(BRIDGE_KEYS.map((key) => [key]));
  });

  it('two loads of one (user, key) at once put one request on the wire', async () => {
    const { ds, held } = await heldAdapter();
    const first = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });
    const second = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });
    const loads = [first.load(), second.load()];
    await drain();

    expect(held).toHaveLength(1);
    held[0].respond(200, rows([{ id: 'p1', user_id: 'u1', key: 'ui.recent', value: ['a'] }]));
    await expect(Promise.all(loads)).resolves.toEqual([['a'], ['a']]);
  });

  it('a load asked after a preference save reaches the server', async () => {
    const { ds, held } = await heldAdapter();
    const adapter = createObjectStackUserStateAdapter<string>({ dataSource: ds, userId: 'u1', key: 'ui.recent' });

    const loading = adapter.load();
    await drain();
    held[0].respond(200, rows([{ id: 'p1', user_id: 'u1', key: 'ui.recent', value: ['a'] }]));
    await loading;

    const saving = adapter.save(['b', 'a']);
    await drain();
    const write = held.filter((r) => r.method !== 'GET');
    expect(write).toHaveLength(1);
    write[0].respond(200, { success: true, data: { object: 'sys_user_preference', id: 'p1', record: { id: 'p1' } } });
    await saving;

    const reloading = adapter.load();
    await drain();
    const gets = held.filter((r) => r.method === 'GET');
    expect(gets).toHaveLength(2);
    gets[1].respond(200, rows([{ id: 'p1', user_id: 'u1', key: 'ui.recent', value: ['b', 'a'] }]));
    await expect(reloading).resolves.toEqual(['b', 'a']);
  });
});
