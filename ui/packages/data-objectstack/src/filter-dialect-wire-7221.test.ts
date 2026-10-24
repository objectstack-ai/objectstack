/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One authored view filter, two lowered dialects — the WIRE half of the
 * objectui#7221 measurement. (`@object-ui/core`'s
 * `filter-dialect-equivalence-7221.test.ts` is the row-set half.)
 *
 * objectui#7210 saw one page load of a `type: 'gantt'` list view put two filters
 * on the wire from one authored filter. This file reproduces BOTH strings from
 * named inputs, and then asks the only question that decides the severity: does
 * the server read them as the same query?
 *
 * ## The answer
 *
 * Yes. Both are accepted by `isFilterAST` and both lower, through the shipped
 * `@objectstack/spec` the adapter already depends on, to the identical
 * `FilterCondition`:
 *
 * ```
 * {"$and":[{"visible_from":{"$null":false}},{"due_date":{"$null":false}}]}
 * ```
 *
 * Two spellings, one meaning — the null-ness direction comes from the operator
 * NAME on the server (`data/filter.zod.ts`), so the `null` value slot in the
 * second dialect is filler that is never read, and `is_not_null` / `isnotnull`
 * are both members of `VALID_AST_OPERATORS` with the same lowering.
 *
 * ## Where dialect B actually comes from — measured, not assumed
 *
 * objectui#7221 attributed the `and`-wrapped 3-tuple form to `mergeFilterNodes`.
 * It is not that function's shape (the core pin measures what that produces). It
 * is THIS package's `objectFilterEntriesToAST`, reached when an UNLOWERED
 * `ViewFilterRule[]` arrives at the adapter: it emits `[field, op, entry.value]`
 * always three long, normalizes `is_not_null` to `isnotnull` through
 * `FILTER_OPERATOR_ALIASES`, and wraps 2+ entries in `and`. The `null` slot is
 * `entry.value` being `undefined` and surviving `JSON.stringify` as `null`.
 *
 * A tuple, by contrast, is passed through untouched — operators in an already-AST
 * node are never normalized — which is why the lowered path keeps the authored
 * `is_not_null` spelling all the way to the wire.
 *
 * ⛔ No product code is changed by this card; it records what today does.
 */

import { describe, it, expect, vi } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { ObjectStackAdapter } from './index';

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
      json: async () => ({ success: true, data: { object: 'task', records: [], total: 0 } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, calls };
}

/** The raw `filter=` string this `$filter` produced, exactly as it left the client. */
async function filterOnWire($filter: unknown, route: 'plain' | 'expand' = 'plain'): Promise<string | undefined> {
  const { adapter, calls } = makeAdapter();
  await adapter.find('task', {
    $filter,
    ...(route === 'expand' ? { $expand: ['owner'] } : {}),
  } as any);
  const dataCall = calls.filter((u) => u.includes('/data/task')).pop();
  const raw = dataCall ? new URL(dataCall).searchParams.get('filter') : null;
  return raw === null ? undefined : raw;
}

/** The authored view filter, unlowered — a spec `ViewFilterRule[]`. */
const AUTHORED_RULES = [
  { field: 'visible_from', operator: 'is_not_null' },
  { field: 'due_date', operator: 'is_not_null' },
];

/** The same filter, lowered by `@object-ui/core` first. */
const LOWERED_FLAT = [
  ['visible_from', 'is_not_null'],
  ['due_date', 'is_not_null'],
];

/** The two strings objectui#7210 observed, verbatim. */
const WIRE_A = '[["visible_from","is_not_null"],["due_date","is_not_null"]]';
const WIRE_B = '["and",["visible_from","isnotnull",null],["due_date","isnotnull",null]]';

describe('objectui#7221 — both observed wire strings, reproduced from named inputs', () => {
  it('the lowered flat array reaches the wire verbatim — dialect A', async () => {
    expect(await filterOnWire(LOWERED_FLAT)).toBe(WIRE_A);
  });

  it('the UNLOWERED rules reach the wire as dialect B — the adapter lowers them', async () => {
    // Where the `and`, the third slot and the `isnotnull` spelling all come from.
    expect(await filterOnWire(AUTHORED_RULES)).toBe(WIRE_B);
  });

  it('dialect B travels unchanged when it is already dialect B', async () => {
    expect(await filterOnWire(JSON.parse(WIRE_B))).toBe(WIRE_B);
  });

  it('both routes through find() agree — plain and $expand', async () => {
    expect(await filterOnWire(LOWERED_FLAT, 'expand')).toBe(WIRE_A);
    expect(await filterOnWire(AUTHORED_RULES, 'expand')).toBe(WIRE_B);
  });

  it('the gate’s two-source shape keeps its nested child on the wire', async () => {
    // `mergeFilterNodes(authored, composed)` output, serialized. The authored
    // array stays one nested child; the adapter does not flatten it.
    expect(await filterOnWire(['and', LOWERED_FLAT, ['owner', '=', 'me']]))
      .toBe('["and",[["visible_from","is_not_null"],["due_date","is_not_null"]],["owner","=","me"]]');
  });
});

describe('objectui#7221 — what the server makes of each dialect', () => {
  /** The one `FilterCondition` both dialects lower to. */
  const MEANING = {
    $and: [{ visible_from: { $null: false } }, { due_date: { $null: false } }],
  };

  it('accepts both dialects — neither is a 400 INVALID_FILTER', () => {
    expect(isFilterAST(JSON.parse(WIRE_A))).toBe(true);
    expect(isFilterAST(JSON.parse(WIRE_B))).toBe(true);
  });

  it('reads both dialects as the SAME query', () => {
    expect(parseFilterAST(JSON.parse(WIRE_A))).toEqual(MEANING);
    expect(parseFilterAST(JSON.parse(WIRE_B))).toEqual(MEANING);
    expect(parseFilterAST(JSON.parse(WIRE_A))).toEqual(parseFilterAST(JSON.parse(WIRE_B)));
  });

  it('takes the null-ness direction from the operator NAME, never the value slot', () => {
    // Why the `null` third element is harmless: 2-tuple, 3-tuple with `null`, and
    // either spelling all mean "this column is not null".
    const expected = { visible_from: { $null: false } };
    expect(parseFilterAST(['visible_from', 'isnotnull'])).toEqual(expected);
    expect(parseFilterAST(['visible_from', 'isnotnull', null])).toEqual(expected);
    expect(parseFilterAST(['visible_from', 'is_not_null'])).toEqual(expected);
    expect(parseFilterAST(['visible_from', 'is_not_null', null])).toEqual(expected);
  });

  it('accepts the gate’s nested shape too, as a nested $and of the same conditions', () => {
    const gateShape = ['and', LOWERED_FLAT, ['owner', '=', 'me']];
    expect(isFilterAST(gateShape)).toBe(true);
    expect(parseFilterAST(gateShape)).toEqual({
      $and: [MEANING, { owner: 'me' }],
    });
  });
});
