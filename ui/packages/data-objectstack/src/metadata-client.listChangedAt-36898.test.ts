// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36898 — `MetadataClient.listResponse` carries the list's
 * `changedAt` sibling (objectstack#36894, `GetMetaItemsResponseSchema`): each
 * listed item's change time, keyed by name, each entry read with the spec's
 * own rule. `list` still returns the items alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

function clientAnswering(body: unknown) {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
  return new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });
}

const ITEMS = [{ name: 'sales_board' }, { name: 'ops_board' }, { name: 'shipped_board' }];

describe('MetadataClient.listResponse — the change times beside a list (objectstack#36898)', () => {
  it('returns each served change time by name; a code-shipped item has no entry', async () => {
    const changedAt = { sales_board: '2026-11-24T10:15:00.000Z', ops_board: '2026-11-20T08:00:00Z' };
    const c = clientAnswering({ type: 'dashboard', items: ITEMS, changedAt });
    const answer = await c.listResponse('dashboard');
    expect(answer.items).toEqual(ITEMS);
    expect(answer.changedAt).toEqual(changedAt);
    expect(answer.changedAt?.shipped_board).toBeUndefined();
  });

  it('absence stays absence: no `changedAt` key when the server sent none', async () => {
    const answer = await clientAnswering({ type: 'dashboard', items: ITEMS }).listResponse('dashboard');
    expect('changedAt' in answer).toBe(false);
  });

  it('an entry that is not an instant is dropped; the others stand', async () => {
    const c = clientAnswering({
      type: 'dashboard',
      items: ITEMS,
      changedAt: { sales_board: 'yesterday', ops_board: 1732440000, shipped_board: '2026-11-24T10:15:00Z' },
    });
    expect((await c.listResponse('dashboard')).changedAt).toEqual({ shipped_board: '2026-11-24T10:15:00Z' });
  });

  it('`list` returns the items alone', async () => {
    const c = clientAnswering({ type: 'dashboard', items: ITEMS, changedAt: { sales_board: '2026-11-24T10:15:00Z' } });
    expect(await c.list('dashboard')).toEqual(ITEMS);
  });
});
