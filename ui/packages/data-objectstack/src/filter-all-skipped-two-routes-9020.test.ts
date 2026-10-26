/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A filter whose every key is SKIPPED must select the same rows on both
 * `find()` routes — objectui#9020.
 *
 * ## What was wrong
 *
 * `convertFiltersToAST` skips a key whose value is `null` / `undefined`. That is
 * this file's oldest documented behaviour and objectui#9020 did not touch it:
 * `{ a: null, s: 1 }` still lowers to `['s', '=', 1]`. But when EVERY key was
 * skipped, the general tail handed back the CALLER'S ORIGINAL OBJECT — and
 * `find()` has two routes to the server, which read that object differently:
 *
 * ```
 * plain  GET /data/account                        →  EVERY row
 * expand GET /data/account?populate=…&filter={"a":null}  →  the `a = null` rows
 * ```
 *
 * The plain route hands the value to `client.data.find`, whose non-AST branch
 * spreads a plain object's entries as query parameters and SKIPS the null ones,
 * so nothing at all was appended. The `$expand` / `$search` route
 * JSON-serialises the same object into `filter=`, and `{ a: null }` is a
 * well-formed `FilterCondition` — `null` is in the spec's
 * `ACCEPTED_FILTER_COMPARAND_TYPES` — so it arrived as a real predicate.
 *
 * ⭐ That last sentence is why triage graded this p2 and why the assertions
 * below are shaped the way they are: *"the deciding factor is unrelated to the
 * filter"*. A caller cannot predict which behaviour they get from the filter
 * alone, and **both routes look correct in isolation**. So the oracle is the
 * DISAGREEMENT between them, never a shape on either — a test that drove one
 * route and asserted a shape would go green on a repair that left the two
 * disagreeing differently.
 *
 * ## Why the assertions are shaped the way they are
 *
 * Every case is driven down BOTH routes and the two answers are compared with
 * each other before either is compared with a literal. Both halves are needed:
 *
 *   - agreement ALONE passes on two routes that agree on the wrong answer, so
 *     each case also names the row set it expects;
 *   - the row set alone cannot tell "honoured" from "dropped" for a filter whose
 *     correct answer is every row, so §0 proves the fixture can distinguish
 *     every-row from the `a = null` subset before any of it is read that way.
 *
 * The row sets are read through `ValueDataSource`'s matcher — the same AST/object
 * evaluator `@object-ui/core` ships — fed with exactly what each route put on the
 * wire, so "what the server would answer" is measured rather than asserted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValueDataSource } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

/**
 * Four rows that tell the two candidate answers apart: `2` is the only row with
 * an explicit `a: null`, so "every row" and "the `a = null` subset" are
 * different answers here — §0 pins that they are.
 */
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
 *
 * `$expand` is the discriminator `find()` branches on — the only two are a
 * non-empty `$expand` and a non-blank `$search` — so these two calls are the two
 * routes, not two spellings of one.
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

/** The rows a wire value selects. No wire value means no filter: every row. */
async function rowsFor(wire: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS as never });
  const result = await ds.find('rows', (wire === undefined ? {} : { $filter: wire }) as never);
  return (result.data as Array<{ id: string }>).map((r) => String(r.id));
}

/** Drive one filter down both routes and hand back both readings. */
async function bothRoutes($filter: unknown) {
  const plain = await wireFilter($filter, 'plain');
  const expand = await wireFilter($filter, 'expand');
  return { plain, expand, plainRows: await rowsFor(plain), expandRows: await rowsFor(expand) };
}

// ---------------------------------------------------------------------------
// 0. The harness has to be able to fail
// ---------------------------------------------------------------------------

describe('objectui#9020 — harness', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('every row and the `a = null` subset are distinguishable answers here', async () => {
    expect(await rowsFor(undefined)).toEqual(ALL_IDS);
    // The exact predicate the `$expand` route used to ship. It is a real one,
    // and it is NOT "every row" — which is the whole defect in one line.
    expect(await rowsFor({ a: null })).toEqual(['2']);
    // A filter that really constrains lands strictly between the two, so
    // "every row" below is a measurement and not this fixture's only answer.
    expect(await rowsFor(['s', '=', 1])).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// 1. The card's own measurement, re-driven — the two routes must AGREE
// ---------------------------------------------------------------------------

describe('objectui#9020 — an all-skipped filter selects one row set', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it.each([
    ['{ a: null }', { a: null }],
    ['{ b: undefined }', { b: undefined }],
    ['{ a: null, b: undefined }', { a: null, b: undefined }],
  ])('%s — both routes agree, and on "no constraint"', async (_label, filter) => {
    const { plain, expand, plainRows, expandRows } = await bothRoutes(filter);

    // The oracle. Compared with EACH OTHER first: a repair that left the two
    // disagreeing differently fails here even if it satisfies every literal
    // below.
    expect(plainRows).toEqual(expandRows);
    expect(plain).toEqual(expand);

    // …and on the answer the converter's own skip already gives this key when a
    // sibling survives: no constraint, so no `filter` parameter and every row.
    expect(plain).toBeUndefined();
    expect(plainRows).toEqual(ALL_IDS);
  });

  it('is the whole reason the routes disagreed — the object no longer reaches either', async () => {
    // Before the fix `plain` was `undefined` (the client SKIPS null entries when
    // it spreads a plain object, so no parameter at all) while `expand` was the
    // object itself, JSON-serialised into `filter=`. Naming both spellings keeps
    // this readable as the disagreement it was rather than as one more shape
    // assertion.
    const { plain, expand } = await bothRoutes({ a: null });
    expect(expand).not.toEqual({ a: null });
    expect(plain).toBeUndefined();
    expect(expand).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Controls — everything that must NOT have moved
// ---------------------------------------------------------------------------

describe('objectui#9020 — controls', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('⭐ a skipped key beside a LIVE one lowers exactly as it always has', async () => {
    // The pin objectui#9020 was fenced against breaking. If this reddens, the
    // repair made null-valued keys meaningful instead of making the tail
    // consistent, and every caller's row set moved.
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ a: null, s: 1 });
    expect(plain).toEqual(['s', '=', 1]);
    expect(expand).toEqual(['s', '=', 1]);
    expect(plainRows).toEqual(['1', '2']);
    expect(expandRows).toEqual(['1', '2']);
  });

  it('⭐ objectui#8770\'s TRUE identity keeps ITS answer', async () => {
    // The other "this constrains nothing" state in the same tail. It reached
    // `undefined` through its own count, for objectstack#5322's reasons, and
    // must still do so — this is what proves the two states were told apart
    // rather than merged into one counter.
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ $and: [] });
    expect(plain).toBeUndefined();
    expect(expand).toBeUndefined();
    expect(plainRows).toEqual(ALL_IDS);
    expect(expandRows).toEqual(ALL_IDS);
  });

  it('⭐ the FALSE identity `{ $or: [] }` still selects NO row', async () => {
    // FALSE is not "no constraint". A fold that swept the identities together
    // would take this control with it.
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

  it('an author who MEANT the predicate still gets it, on both routes', async () => {
    // The spelling that survives the skip, and the reason the skip did not have
    // to be made meaningful: `$null` is a declared operator with an AST target.
    const { plain, expand, plainRows, expandRows } = await bothRoutes({ a: { $null: true } });
    expect(plain).toEqual(['a', 'is_null', true]);
    expect(expand).toEqual(['a', 'is_null', true]);
    expect(plainRows).toEqual(['2']);
    expect(expandRows).toEqual(['2']);
  });
});

// ---------------------------------------------------------------------------
// 3. The boundary this card deliberately did NOT move
// ---------------------------------------------------------------------------

describe('objectui#9020 — the mixed filter is a different card', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('an identity group beside a PROCESSED key that produced nothing is not folded', async () => {
    // ⚠️ UPDATED. This used to name `{ $and: [], a: null }` — a filter mixing an
    // identity group with a SKIPPED key — as the case each guard declines
    // because each is keyed on "EVERY key was of MY kind". objectui#9030
    // answered that one: the identity fold now counts only the keys the loop
    // actually PROCESSED, so the mixed filter folds and both routes agree on it
    // (measured in `filter-identity-skipped-mix-two-routes-9030.test.ts`).
    //
    // ⭐ The boundary this card was fenced against moving is still here, one
    // shape over: `{ a: {} }` is a key the loop ENTERED that pushed no
    // condition, so it is neither an identity group nor a skipped key and no fold
    // claims it. That is what proves the two counts were not merged into "no
    // conditions were produced".
    //
    // ⚠️ Asserted at the CONVERTER, not on the routes.
    //
    // ⚠️ UPDATED. This used to pin the caller's object coming back, which then
    // reached both routes; since objectui#9164 the converter refuses it, so
    // neither route sends it. Still not folded — a fold would answer `undefined`.
    const { convertFiltersToAST, FilterOperatorError } = await import('@object-ui/core');
    expect(() => convertFiltersToAST({ $and: [], a: {} })).toThrow(FilterOperatorError);
  });
});
