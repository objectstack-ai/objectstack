/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An identity group beside a skipped key selects one row set on both routes —
 * objectui#9030.
 *
 * ## Why this file exists beside the converter's own pins
 *
 * The card that filed this reasoned about the wire from `JSON.stringify`
 * semantics and from objectui#8770's measurements, and said so: *"Whoever takes
 * it should confirm, rather than inherit from here, that `undefined`-valued keys
 * really do vanish on BOTH wire routes."* This file is that confirmation, driven
 * rather than inherited.
 *
 * ## What was wrong, per route
 *
 * `find()` has two routes to the server and they read a plain OBJECT in the
 * `$filter` slot differently — the split objectui#6948 recorded on this shape
 * and objectui#9020 measured for the all-skipped filter. For a filter MIXING an
 * identity group with a skipped key the converter used to hand back that object,
 * so both routes were wrong and they were wrong differently:
 *
 * ```
 * plain   client.data.find spreads a non-AST object's entries as query
 *         parameters, so `{ $and: [], b: undefined }` left as `?$and=` with no
 *         `filter` parameter at all — the `400 UNSUPPORTED_QUERY_PARAM`
 *         objectui#8770 exists to end.
 * expand  the same object is JSON-serialised into `filter=`, which the server
 *         accepts as a `FilterCondition` — so `{ $and: [] }` arrived as the
 *         ruled every-row answer, and `{ $and: [], a: null }` arrived carrying a
 *         real `a IS NULL` predicate the converter had already dropped.
 * ```
 *
 * ⭐ So the two members of the family failed in two different directions, and
 * neither matched the converter's own answer for either of their keys alone.
 *
 * ## Why the assertions are shaped the way they are
 *
 * The oracle is the DISAGREEMENT between the routes, never a shape on either —
 * objectui#9020's file argues this at length and the shape is taken from it: a
 * test that drove one route and asserted a shape goes green on a repair that
 * leaves the two disagreeing differently. So every case is driven down both
 * routes and the two answers are compared with EACH OTHER before either is
 * compared with a literal, and §0 proves the fixture can tell every-row from the
 * `a = null` subset before any of it is read that way.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValueDataSource } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const ROWS = [
  { id: '1', a: 'x', s: 1 },
  { id: '2', a: null, s: 1 },
  { id: '3', a: 'y', s: 2 },
  { id: '4', a: 'z', s: 2 },
];
const ALL_IDS = ['1', '2', '3', '4'];

function makeAdapter() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as never;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'account', records: [], total: 0 } }),
    } as never;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as never,
  });
  return { adapter, calls };
}

type Route = 'plain' | 'expand';

/**
 * What one route actually sent: the parsed `filter=` parameter, or `undefined`
 * when no filter parameter was emitted at all.
 */
async function wireFilter($filter: unknown, route: Route): Promise<unknown> {
  const { adapter, calls } = makeAdapter();
  await adapter.find('account', {
    $filter,
    ...(route === 'expand' ? { $expand: ['owner'] } : {}),
  } as never);
  const dataCall = calls.filter((u) => u.includes('/data/account')).pop();
  const raw = dataCall ? new URL(dataCall).searchParams.get('filter') : null;
  return raw === null ? undefined : JSON.parse(raw);
}

/** Every query parameter one route put on the wire, so a `$`-prefixed leak is visible. */
async function wireParams($filter: unknown, route: Route): Promise<string[]> {
  const { adapter, calls } = makeAdapter();
  await adapter.find('account', {
    $filter,
    ...(route === 'expand' ? { $expand: ['owner'] } : {}),
  } as never);
  const dataCall = calls.filter((u) => u.includes('/data/account')).pop();
  return dataCall ? [...new URL(dataCall).searchParams.keys()].sort() : [];
}

/** The rows a wire value selects. No wire value means no filter: every row. */
async function rowsFor(wire: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS as never });
  const result = await ds.find('rows', (wire === undefined ? {} : { $filter: wire }) as never);
  return (result.data as Array<{ id: string }>).map((r) => String(r.id));
}

async function bothRoutes($filter: unknown) {
  const plain = await wireFilter($filter, 'plain');
  const expand = await wireFilter($filter, 'expand');
  return { plain, expand, plainRows: await rowsFor(plain), expandRows: await rowsFor(expand) };
}

const MIXED_FAMILY: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['{ $and: [], b: undefined }', { $and: [], b: undefined }],
  ['{ $and: [], a: null }', { $and: [], a: null }],
  ['{ $or: [{}], b: undefined }', { $or: [{}], b: undefined }],
  ['{ $and: [{}], a: null }', { $and: [{}], a: null }],
];

// ---------------------------------------------------------------------------
// 0. The harness has to be able to fail
// ---------------------------------------------------------------------------

describe('objectui#9030 — harness', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('every row, the `a = null` subset and a real predicate are three answers here', async () => {
    expect(await rowsFor(undefined)).toEqual(ALL_IDS);
    expect(await rowsFor({ a: null })).toEqual(['2']);
    expect(await rowsFor(['s', '=', 1])).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// 1. The two routes must AGREE, and on the ruled answer
// ---------------------------------------------------------------------------

describe('objectui#9030 — a mixed filter selects one row set', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it.each(MIXED_FAMILY)('%s — both routes agree, and on "no constraint"', async (_label, filter) => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes(filter);

    // The oracle, compared with EACH OTHER first: a repair that left the two
    // disagreeing differently fails here even if it satisfies every literal
    // below.
    expect(plainRows).toEqual(expandRows);
    expect(plain).toEqual(expand);

    // …and on objectstack#5322's ruled answer for the identity, which is also
    // the answer the converter's own skip gives the other key.
    expect(plain).toBeUndefined();
    expect(plainRows).toEqual(ALL_IDS);
  });

  it.each(MIXED_FAMILY)('%s puts no `$`-prefixed parameter on the wire', async (_label, filter) => {
    // ⭐ The half a `filter=` assertion cannot see. The plain route's failure was
    // never a wrong `filter` value — it was an object spread into query
    // parameters, so `$and` became a parameter NAME and the server refused the
    // request outright. Naming the parameter keys is what pins that it is gone.
    for (const route of ['plain', 'expand'] as const) {
      const keys = await wireParams(filter, route);
      expect(keys.filter((k) => k.startsWith('$'))).toEqual([]);
      expect(keys).not.toContain('filter');
    }
  });

  it('⭐ the card`s own literal, stated as the disagreement it was', async () => {
    // `{ $and: [], b: undefined }`: `JSON.stringify` drops the undefined key, so
    // the `$expand` route used to ship `filter={"$and":[]}` — the ruled answer —
    // while the plain route shipped `?$and=` and 400'd. Same filter, one route
    // right by accident.
    const { plain, expand } = await bothRoutes({ $and: [], b: undefined });
    expect(plain).toBeUndefined();
    expect(expand).toBeUndefined();
  });

  it('⭐ and its `null` sibling, where the disagreement ran the other way', async () => {
    // `{ $and: [], a: null }`: the `$expand` route shipped
    // `filter={"$and":[],"a":null}`, so it carried a real `a IS NULL` predicate
    // that the converter had already decided contributes nothing — the two
    // routes selected two different row sets from one filter.
    const { plain, expand, expandRows } = await bothRoutes({ $and: [], a: null });
    expect(expand).not.toEqual({ $and: [], a: null });
    expect(plain).toBeUndefined();
    expect(expand).toBeUndefined();
    expect(expandRows).toEqual(ALL_IDS);
  });
});

// ---------------------------------------------------------------------------
// 2. Controls — everything that must NOT have moved
// ---------------------------------------------------------------------------

describe('objectui#9030 — controls', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('⭐ a skipped key beside a LIVE one lowers exactly as it always has', async () => {
    // The pin this card was forbidden to break. If this reddens, the repair made
    // null-valued keys meaningful instead of narrowing a denominator.
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ a: null, s: 1 });
    expect(plain).toEqual(['s', '=', 1]);
    expect(expand).toEqual(['s', '=', 1]);
    expect(plainRows).toEqual(['1', '2']);
    expect(expandRows).toEqual(['1', '2']);
  });

  it('⭐ an identity group beside a LIVE key lets the sibling carry the filter', async () => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ $and: [], a: 'x' });
    expect(plain).toEqual(['a', '=', 'x']);
    expect(expand).toEqual(['a', '=', 'x']);
    expect(plainRows).toEqual(['1']);
    expect(expandRows).toEqual(['1']);
  });

  it('⭐ the FALSE identity `{ $or: [] }` still selects NO row on both routes', async () => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ $or: [] });
    expect(plain).toEqual(['$or', '=', []]);
    expect(expand).toEqual(['$or', '=', []]);
    expect(plainRows).toEqual([]);
    expect(expandRows).toEqual([]);
  });

  it('a real predicate is untouched on both routes', async () => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ a: 'x' });
    expect(plain).toEqual(['a', '=', 'x']);
    expect(expand).toEqual(['a', '=', 'x']);
    expect(plainRows).toEqual(['1']);
    expect(expandRows).toEqual(['1']);
  });

  it('an author who MEANT `a IS NULL` still gets it, on both routes', async () => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ a: { $null: true } });
    expect(plain).toEqual(['a', 'is_null', true]);
    expect(expand).toEqual(['a', 'is_null', true]);
    expect(plainRows).toEqual(['2']);
    expect(expandRows).toEqual(['2']);
  });
});
