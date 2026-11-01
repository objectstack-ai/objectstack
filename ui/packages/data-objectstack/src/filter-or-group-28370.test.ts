/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28370 — the adapter's own translator reads a view filter list's
 * any-of group element, `{ or: [rule, ...] }` (`ViewFilterOrGroupSchema`).
 *
 * An unlowered view filter list reaches `find()` from producers that hand the
 * stored value straight to `$filter` (a view data provider, an element data
 * source). Before this, a list OPENING with a group was not recognised as the
 * entry form and shipped raw (a `400 INVALID_FILTER` from the server), and a
 * group LATER in the list had no `field`, so the adapter refused the whole
 * query with `MalformedFilterError`. Both `find()` routes translate, so every
 * case runs down both and asserts the same wire.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { ObjectStackAdapter, clearSharedDiscoveryCache, isMalformedFilterError } from './index';

function makeAdapter() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'account', records: [], total: 0 } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, calls };
}

type Route = 'plain' | 'expand';
const ROUTES: Route[] = ['plain', 'expand'];

async function filterOnWire($filter: unknown, route: Route): Promise<unknown | undefined> {
  const { adapter, calls } = makeAdapter();
  await adapter.find('account', { $filter, ...(route === 'expand' ? { $expand: ['owner'] } : {}) } as any);
  const dataCall = calls.filter((u) => u.includes('/data/account')).pop();
  const raw = dataCall ? new URL(dataCall).searchParams.get('filter') : null;
  return raw === null ? undefined : JSON.parse(raw);
}

async function findRejects($filter: unknown, route: Route) {
  const { adapter } = makeAdapter();
  return adapter
    .find('account', { $filter, ...(route === 'expand' ? { $expand: ['owner'] } : {}) } as any)
    .then(() => null, (e) => e);
}

const OPEN = { field: 'status', operator: 'equals', value: 'open' };
const BLOCKED = { field: 'status', operator: 'equals', value: 'blocked' };
const MINE = { field: 'owner', operator: 'equals', value: 'u1' };
const OPEN_OR_BLOCKED = { $or: [{ status: 'open' }, { status: 'blocked' }] };

describe('an any-of group in an unlowered view filter list reaches the wire as an `or` node (objectstack#28370)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  for (const route of ROUTES) {
    it(`a list that is one group (${route} route)`, async () => {
      const wire = await filterOnWire([{ or: [OPEN, BLOCKED] }], route);
      expect(wire).toEqual(['or', ['status', '=', 'open'], ['status', '=', 'blocked']]);
      expect(isFilterAST(wire)).toBe(true);
      expect(parseFilterAST(wire as never)).toEqual(OPEN_OR_BLOCKED);
    });

    it(`a group first, then a rule (${route} route)`, async () => {
      const wire = await filterOnWire([{ or: [OPEN, BLOCKED] }, MINE], route);
      expect(wire).toEqual(['and', ['or', ['status', '=', 'open'], ['status', '=', 'blocked']], ['owner', '=', 'u1']]);
      expect(parseFilterAST(wire as never)).toEqual({ $and: [OPEN_OR_BLOCKED, { owner: 'u1' }] });
    });

    it(`a rule first, then a group (${route} route)`, async () => {
      const wire = await filterOnWire([MINE, { or: [OPEN, BLOCKED] }], route);
      expect(wire).toEqual(['and', ['owner', '=', 'u1'], ['or', ['status', '=', 'open'], ['status', '=', 'blocked']]]);
      expect(isFilterAST(wire)).toBe(true);
    });

    it(`a group spread into an \`and\` beside a tuple (${route} route)`, async () => {
      const wire = await filterOnWire(['and', { or: [OPEN, BLOCKED] }, ['owner', '=', 'u1']], route);
      expect(wire).toEqual(['and', ['or', ['status', '=', 'open'], ['status', '=', 'blocked']], ['owner', '=', 'u1']]);
      expect(isFilterAST(wire)).toBe(true);
    });

    it(`a group that does not translate is refused whole, never dropped (${route} route)`, async () => {
      for (const refused of [
        [MINE, { or: [] }],
        [MINE, { or: [OPEN, { field: '', operator: 'equals', value: 'x' }] }],
        [{ or: [{ or: [OPEN] }] }],
      ]) {
        const error = await findRejects(refused, route);
        expect(isMalformedFilterError(error), JSON.stringify(refused)).toBe(true);
        expect((error as { code?: string }).code).toBe('INVALID_FILTER');
        expect((error as { httpStatus?: number }).httpStatus).toBe(400);
      }
    });
  }
});
