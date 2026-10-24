/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `aggregate()` lowers an array filter through `parseFilterAST` before the
 * analytics wire, so the posted `where` is the `FilterCondition` the protocol
 * declares.
 *
 * WHY THIS FILE EXISTS, AND WHY IT MOVED (objectui#6302, then objectui#7752 /
 * objectstack#15828). `find()` has translated `[{ field, operator, value }, ...]`
 * into the server's filter AST since the day `convertQueryParams` learned to —
 * see `filter-entry-translation.test.ts`. The analytics path did not: it posted
 * `params.filter` verbatim. #6302 fixed half of that by running the same
 * `translateFilterArray`, and this file pinned the AST it produced as the value
 * on the wire.
 *
 * That pin named the wrong door. `translateFilterArray` normalises rule objects
 * into AST tuples; the result is still a `FilterArray`, and a `FilterArray` is
 * input-only sugar (objectstack#5158 ruling C, `data/filter.zod.ts`): it is
 * lowered to a `FilterCondition` at the single sink `parseFilterAST` the moment
 * it arrives, and only the lowered condition travels further. `where` on a query
 * is a `FilterCondition` and stays one. The door #6302 measured —
 * `lowerAnalyticsWhere` in `@objectstack/service-analytics` (objectstack#5334) —
 * is the IN-PROCESS door and sits one hop too late: `POST /analytics/query`
 * parses the body with `AnalyticsQueryRequestSchema` first, whose `where` is
 * `FilterConditionSchema`, so every array shape answered `400 Invalid
 * AnalyticsQuery body: where: ...`. An `element:number` (array-only since
 * objectstack#12039) therefore rendered into its error state on any deployment
 * served through the runtime route, and the only surviving authoring form was
 * the MongoDB-style record — the exact form objectui#6206 ruling B retired.
 *
 * So the assertions below are re-pointed one hop, and TWO properties are pinned
 * rather than one:
 *
 * 1. The posted `where` is `parseFilterAST`'s own output for the same filter —
 *    read from the spec's function, never hand-written here, so this file cannot
 *    drift away from the contract it exists to pin.
 * 2. The whole posted payload passes `AnalyticsQueryRequestSchema.safeParse` —
 *    the runtime route's own gate, run on the real body. That is the hop nobody
 *    had a test for on either side of the repo boundary, which is how the two
 *    declarations diverged unnoticed in the first place.
 *
 * One lowering, not two, is still load-bearing and still asserted: the
 * cross-path block requires `aggregate()`'s `where` to be exactly
 * `parseFilterAST` applied to the AST `find()` puts on its `filter=` query
 * string. The two doors differ by that lowering and by nothing else — `$filter`
 * is a declared door where an array may arrive, a POST body is transport.
 *
 * Non-array filters are deliberately untouched: the MongoDB-style object this
 * branch was written for is already a `FilterCondition`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { AnalyticsQueryRequestSchema } from '@objectstack/spec/api';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  isMalformedFilterError,
  UnlowerableAnalyticsFilterError,
} from './index';

/** Rows that carry the requested measure, so nothing degrades to the fallback. */
const ANALYTICS_ROWS = { rows: [{ amount_sum: 150 }] };

function makeAdapter() {
  /** Every parsed `/analytics/query` request body, in order. */
  const analyticsBodies: any[] = [];
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    if (u.includes('/api/v1/analytics/query')) {
      analyticsBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return { ok: true, status: 200, statusText: 'OK', json: async () => ANALYTICS_ROWS } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'opportunity', records: [], total: 0 } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, analyticsBodies, urls };
}

const SUM_BY_STAGE = { function: 'sum', field: 'amount', groupBy: '_all' };

/**
 * The `where` this filter put on the analytics wire.
 *
 * `HAS_NO_WHERE` distinguishes "the key was absent" from "the key was present
 * and undefined" — the empty-filter cases below turn on exactly that.
 */
const HAS_NO_WHERE = Symbol('no where key');

/** The whole body posted to `/analytics/query` — what the route's gate parses. */
async function payloadOnWire(filter?: unknown): Promise<any> {
  const { adapter, analyticsBodies } = makeAdapter();
  const params = filter === undefined ? SUM_BY_STAGE : { ...SUM_BY_STAGE, filter };
  await adapter.aggregate('opportunity', params);
  expect(analyticsBodies).toHaveLength(1);
  return analyticsBodies[0];
}

async function whereOnWire(filter: unknown): Promise<unknown> {
  const body = await payloadOnWire(filter);
  return 'where' in body ? body.where : HAS_NO_WHERE;
}

/** The `filter=` the SAME value produces on the plain `find()` route. */
async function filterOnFindWire(filter: unknown): Promise<unknown> {
  const { adapter, urls } = makeAdapter();
  await adapter.find('opportunity', { $filter: filter } as any);
  const dataCall = urls.filter((u) => u.includes('/data/opportunity')).pop();
  const raw = dataCall ? new URL(dataCall).searchParams.get('filter') : null;
  return raw === null ? HAS_NO_WHERE : JSON.parse(raw);
}

describe('aggregate() posts the LOWERED FilterCondition, not the filter array', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('lowers a single rule the way the spec lowers its AST equivalent', async () => {
    // Expected value read from the spec's own sink, on the AST this rule
    // translates to. A hand-written `{ stage: 'won' }` would pin this file to
    // today's `parseFilterAST` output instead of to `parseFilterAST`.
    expect(await whereOnWire([{ field: 'stage', operator: 'equals', value: 'won' }]))
      .toEqual(parseFilterAST(['stage', '=', 'won']));
  });

  it('posts a condition, never the FilterArray the wire refuses', async () => {
    const rules = [{ field: 'stage', operator: 'equals', value: 'won' }];
    // What used to reach the wire, at both stages of the old pipeline: the raw
    // rules, and the AST `translateFilterArray` normalises them into. Neither is
    // a `FilterCondition`, and `AnalyticsQueryRequestSchema` refuses both.
    expect(isFilterAST(rules)).toBe(false);
    expect(isFilterAST(['stage', '=', 'won'])).toBe(true);

    const where = await whereOnWire(rules);
    expect(Array.isArray(where)).toBe(false);
    expect(where).toEqual({ stage: 'won' });
  });

  it('maps operator aliases the way the find() path does, then lowers', async () => {
    expect(await whereOnWire([{ field: 'amount', operator: 'greater_than_or_equal', value: 3 }]))
      .toEqual(parseFilterAST(['amount', '>=', 3]));
  });

  it('joins several rules with `and`, lowered', async () => {
    expect(await whereOnWire([
      { field: 'stage', operator: 'eq', value: 'won' },
      { field: 'amount', operator: 'gt', value: 100 },
    ])).toEqual(parseFilterAST(['and', ['stage', '=', 'won'], ['amount', '>', 100]]));
  });

  it('lowers rules SPREAD into a logical node, not just top-level ones', async () => {
    // The commonest composite there is: a view's stored filter plus one the
    // user added in the panel. The head is the string `and`, so a top-level-only
    // check would call the whole thing "already AST" and ship the rule raw.
    const composite = ['and', { field: 'stage', operator: 'eq', value: 'won' }, ['amount', '>', 100]];
    expect(isFilterAST(composite as any)).toBe(false);
    expect(await whereOnWire(composite))
      .toEqual(parseFilterAST(['and', ['stage', '=', 'won'], ['amount', '>', 100]]));
  });

  it('produces the SAME `where` as the AST-tuple equivalent (the acceptance criterion)', async () => {
    const fromRules = await whereOnWire([{ field: 'stage', operator: 'equals', value: 'won' }]);
    const fromTuple = await whereOnWire(['stage', '=', 'won']);
    expect(fromRules).toEqual(fromTuple);
  });
});

describe('the posted payload passes the route\'s own gate, AnalyticsQueryRequestSchema', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // The hop objectui#6302 never measured. `POST /analytics/query` runs exactly
  // this parse on the body BEFORE any normalisation, so a payload this schema
  // refuses is a 400 in production, whatever the in-process door would accept.
  const GATED_CASES: Array<[string, unknown]> = [
    ['a comparison tuple', ['stage', '=', 'won']],
    ['a rule array', [{ field: 'stage', operator: 'equals', value: 'won' }]],
    ['a logical group', ['and', ['stage', '=', 'won'], ['amount', '>', 100]]],
    ['a bare list of nodes', [['stage', '=', 'won'], ['amount', '>', 100]]],
    ['a record-shaped filter', { stage: 'won' }],
    ['a record-shaped filter with an operator object', { amount: { $gt: 100 } }],
    ['an empty array', []],
  ];

  for (const [name, filter] of GATED_CASES) {
    it(`accepts the body built from ${name}`, async () => {
      const body = await payloadOnWire(filter);
      const parsed = AnalyticsQueryRequestSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });
  }

  it('accepts the body built with no filter at all', async () => {
    expect(AnalyticsQueryRequestSchema.safeParse(await payloadOnWire()).success).toBe(true);
  });

  it('refuses the un-lowered array this branch used to post (the negative control)', async () => {
    // Without this row the rows above could pass against a gate that accepts
    // anything. This is the exact body objectstack#15828 measured a 400 for.
    const body = await payloadOnWire(['stage', '=', 'won']);
    const unlowered = { ...body, where: ['stage', '=', 'won'] };
    expect(AnalyticsQueryRequestSchema.safeParse(unlowered).success).toBe(false);
  });
});

describe('aggregate() leaves every already-lowered filter shape byte-unchanged', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('a record-shaped (MongoDB-style) filter is NOT translated', async () => {
    // The shape this branch was written for, and what `AnalyticsQuerySchema.where`
    // declares. Lowering it would be a semantic change, not a fix.
    expect(await whereOnWire({ stage: 'won' })).toEqual({ stage: 'won' });
  });

  it('a record-shaped filter with an operator object is NOT translated either', async () => {
    expect(await whereOnWire({ amount: { $gt: 100 } })).toEqual({ amount: { $gt: 100 } });
  });

  it('an empty array posts no `where` at all', async () => {
    // Pinned by objectui#7752: `parseFilterAST([])` is `undefined`, and the
    // in-process door reads `[]` the same way ("`[]` is no filter",
    // objectstack#5334). Before the lowering this posted a literal `[]`.
    expect(await whereOnWire([])).toBe(HAS_NO_WHERE);
  });

  it('no filter means no `where` key at all', async () => {
    const body = await payloadOnWire();
    expect(body).not.toHaveProperty('where');
  });
});

describe('the find() path is unchanged, and the two paths share one lowering', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // Each row is one input. `find()` puts the AST on its `$filter` query string —
  // a declared door where a `FilterArray` may arrive — and the analytics body
  // carries that same AST lowered by the sink. So the two paths differ by
  // `parseFilterAST` and by nothing else; a change to either that the other does
  // not make turns this red.
  const SHARED_CASES: Array<[string, unknown]> = [
    ['a single rule', [{ field: 'stage', operator: 'equals', value: 'won' }]],
    ['an aliased operator', [{ field: 'amount', operator: 'greater_than_or_equal', value: 3 }]],
    ['several rules', [
      { field: 'stage', operator: 'eq', value: 'won' },
      { field: 'amount', operator: 'gt', value: 100 },
    ]],
    ['rules spread into a logical node', ['and', { field: 'stage', operator: 'eq', value: 'won' }, ['amount', '>', 100]]],
    ['an AST tuple', ['stage', '=', 'won']],
    ['a logical AST node', ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']]],
    ['a bare list of nodes', [['stage', '=', 'won'], ['amount', '>', 100]]],
  ];

  for (const [name, filter] of SHARED_CASES) {
    it(`aggregate() posts find()'s AST, lowered, for ${name}`, async () => {
      const viaFind = await filterOnFindWire(filter);
      expect(viaFind).not.toBe(HAS_NO_WHERE);
      expect(await whereOnWire(filter)).toEqual(parseFilterAST(viaFind));
    });
  }

  it('find() still lowers a single rule exactly as it did before', async () => {
    // The `find()` half of the card's acceptance, stated independently of
    // `aggregate()` so a regression there cannot hide behind the parity rows.
    // `$filter` is a declared door: the AST arrives there and is lowered by the
    // metadata protocol on the far side, so this side stays an array.
    expect(await filterOnFindWire([{ field: 'stage', operator: 'equals', value: 'won' }]))
      .toEqual(['stage', '=', 'won']);
  });

  it('neither path sends a filter for an empty array', async () => {
    // The two paths used to disagree here — `convertQueryParams` dropped an
    // empty filter while the analytics payload kept `[]`. The lowering settles
    // it: `parseFilterAST([])` is `undefined`, so both now send nothing.
    expect(await filterOnFindWire([])).toBe(HAS_NO_WHERE);
    expect(await whereOnWire([])).toBe(HAS_NO_WHERE);
  });
});

describe('an array the sink cannot lower is refused before the wire, never dropped', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('refuses an infix join instead of posting an unfiltered aggregate', async () => {
    // `['stage','=','won'] or ['stage','=','lost']` written infix. The spec's
    // gate rejects it and `parseFilterAST` answers `undefined` for it — and
    // `undefined` on this path would mean "no `where`", i.e. an aggregate over
    // EVERY row returned as a confident number under a filtered question.
    const infix = [['stage', '=', 'won'], 'or', ['stage', '=', 'lost']];
    expect(isFilterAST(infix as any)).toBe(false);
    expect(parseFilterAST(infix as any)).toBeUndefined();

    const { adapter, analyticsBodies, urls } = makeAdapter();
    const err = await adapter
      .aggregate('opportunity', { ...SUM_BY_STAGE, filter: infix })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(UnlowerableAnalyticsFilterError);
    // Same `INVALID_FILTER` / 400 envelope its two siblings carry, so a widget
    // renders "this filter is malformed" rather than "check your connection".
    expect((err as UnlowerableAnalyticsFilterError).code).toBe('INVALID_FILTER');
    expect((err as UnlowerableAnalyticsFilterError).httpStatus).toBe(400);
    expect(isMalformedFilterError(err)).toBe(true);
    expect((err as UnlowerableAnalyticsFilterError).filter).toBe(infix);
    expect((err as UnlowerableAnalyticsFilterError).resource).toBe('opportunity');

    // Nothing was posted, and the client-side fallback did not answer it either.
    expect(analyticsBodies).toHaveLength(0);
    expect(urls.some((u) => u.includes('/analytics/query'))).toBe(false);
    expect(urls.some((u) => u.includes('/data/opportunity'))).toBe(false);
  });

  it('refuses a tuple the sink itself throws on, keeping the sink\'s words', async () => {
    // `isFilterAST` accepts this two-element tuple; `parseFilterAST` refuses it
    // ("comparand is undefined"). Re-dressed in this adapter's envelope rather
    // than escaping as a bare `Error` that reads like a transport failure.
    const truncated = ['stage', '='];
    expect(isFilterAST(truncated as any)).toBe(true);
    expect(() => parseFilterAST(truncated as any)).toThrow();

    const { adapter, analyticsBodies, urls } = makeAdapter();
    const err = await adapter
      .aggregate('opportunity', { ...SUM_BY_STAGE, filter: truncated })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(UnlowerableAnalyticsFilterError);
    expect(isMalformedFilterError(err)).toBe(true);
    expect(analyticsBodies).toHaveLength(0);
    expect(urls.some((u) => u.includes('/data/opportunity'))).toBe(false);
  });
});

describe('a rule the adapter cannot translate refuses on the aggregate path too', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('throws the same malformed-filter refusal `find()` raises, without inventing numbers', async () => {
    // Dropping the untranslatable entry would WIDEN the result set and report
    // success — the silent over-fetch `MalformedFilterError` exists to stop.
    // Sharing the lowering means the analytics path inherits that refusal.
    const { adapter, analyticsBodies, urls } = makeAdapter();
    const err = await adapter
      .aggregate('opportunity', {
        ...SUM_BY_STAGE,
        filter: [
          { field: 'stage', operator: 'eq', value: 'won' },
          { operator: 'eq', value: 'no field here' },
        ],
      })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(isMalformedFilterError(err)).toBe(true);
    // Nothing was posted to analytics, and no plausible-looking number came
    // back from the fallback instead.
    expect(analyticsBodies).toHaveLength(0);
    expect(urls.some((u) => u.includes('/data/opportunity'))).toBe(false);
  });
});
