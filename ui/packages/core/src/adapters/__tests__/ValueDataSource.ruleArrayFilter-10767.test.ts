/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10767 — `ValueDataSource.find` reads a spec `ViewFilterRule[]`, the
 * ONLY filter form the spec's converged `filter` doors accept (objectui#6206 B).
 *
 * ## What was wrong
 *
 * `find()` picks a matcher on the SHAPE of `$filter`: an object goes to the
 * `$`-dialect matcher, an array to the AST matcher. A rule array IS an array, so
 * it went to `matchesASTFilter`, whose nodes are `['and' | 'or', …]`, a
 * comparison tuple, or a flat list of tuples. A rule OBJECT is none of those, so
 * every row was refused — "is not a shape the matcher reads" — and the author
 * of the one filter form the spec accepts got an EMPTY list with one warning.
 * The four blocks with inline rows (`object-map`, `object-tree`,
 * `object-calendar`, `object-gantt`) hand `schema.filter` to this adapter
 * unlowered, so on them a spec-conformant filter rendered NO rows.
 *
 * ## The repair, and why it is here rather than at the four call sites
 *
 * `QueryParams.$filter` (`@object-ui/types`) declares the array form legal for
 * every DataSource and names `translateFilterToAST` (`@object-ui/data-objectstack`)
 * as the authoritative accept set, which includes the rule array. This adapter
 * was the one face in the family that did not read it, so `resolveDataSource`
 * handed back an adapter whose `find` read FEWER filter shapes on `provider:
 * 'value'` than on `provider: 'object'`. The array arm now lowers through the
 * repo's ONE sink, `toFilterNode` (`toFilterNodeSafely`), the same function the
 * grid, the list and every other lowering caller already use — no second
 * lowering, no second operator table. The `$`-dialect arm is untouched.
 *
 * ## Why every case here needs a control
 *
 * The broken answer is ZERO rows, so `expect(ids).toEqual([])` would be green on
 * the defect. Every rule-array case therefore asserts the NON-EMPTY id set the
 * card's own probe recorded for the record form and the AST form of the same
 * predicate, and those two forms sit beside it as controls, green on both trees.
 *
 * ## What stays refused (the matcher is not relaxed)
 *
 * A node that is genuinely unreadable — an object with no string `field`, a
 * rule whose operator the vocabulary does not know, a rule the lowering itself
 * refuses (an ARRAY on a single-valued operator, an empty `icontains` comparand)
 * — still excludes every row and logs ONCE, with the same sentence tail. The
 * lowering's refusal is delivered the way this adapter delivers every refusal:
 * excluded and logged, never thrown, because `find()` is deciding about rows.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered `params.$filter` on the array arm: every case
 * under "the rule array is read" goes RED, and so do the three cases under
 * "what stays refused" that read a RULE — `unknownOperatorRefusalIsTheASTTwin`
 * (the two dialects' refusals no longer agree), the array-comparand rule and
 * the empty-`icontains` rule (their refusal no longer names the field and the
 * operator as a refusal about a RULE does; it names the whole node as an
 * unreadable shape). The controls, the empty array, the unreadable node and
 * the `$`-dialect refusal stay GREEN: they read the same on both trees, which
 * is what makes them controls. Measured on the base tree before the fix was
 * written: 16 red / 15 green across this file and the four component pins.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ValueDataSource } from '../ValueDataSource';

/** The card's probe rows: ids 1 and 3 are `open`; only id 1 has `amount > 100`. */
const ROWS = [
  { id: 1, status: 'open', amount: 150 },
  { id: 2, status: 'closed', amount: 50 },
  { id: 3, status: 'open', amount: 75 },
];

const ALL_IDS = [1, 2, 3];
const OPEN_IDS = [1, 3];
const OVER_100_IDS = [1];

async function query(filter: unknown, rows: Array<Record<string, unknown>> = ROWS) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const ds = new ValueDataSource({ items: rows });
    const result = await ds.find('rows', { $filter: filter as any });
    return {
      ids: result.data.map((r) => r.id as number),
      total: result.total,
      warns: warn.mock.calls.map((c) => String(c[0])),
    };
  } finally {
    warn.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#10767 — controls: the two forms the adapter already read (the probe’s ids)', () => {
  it('record form `{ status: open }` selects ids 1 and 3 with no warning', async () => {
    expect(await query({ status: 'open' })).toEqual({ ids: OPEN_IDS, total: 2, warns: [] });
  });

  it('record form `{ amount: { $gt: 100 } }` selects id 1 with no warning', async () => {
    expect(await query({ amount: { $gt: 100 } })).toEqual({ ids: OVER_100_IDS, total: 1, warns: [] });
  });

  it('AST `[[status, =, open]]` selects ids 1 and 3 with no warning', async () => {
    expect(await query([['status', '=', 'open']])).toEqual({ ids: OPEN_IDS, total: 2, warns: [] });
  });

  it('the broken answer is the EMPTY set, so every rule-array case below discriminates', async () => {
    // A rule array used to be refused node by node; the assertion shape that
    // catches that is a non-empty id set, which is what every case below uses.
    expect(await query([])).toEqual({ ids: ALL_IDS, total: 3, warns: [] });
  });
});

describe('objectui#10767 — the rule array is read: the spec’s vocabulary selects the probe’s ids', () => {
  it('`equals` — the probe’s first rule — selects ids 1 and 3 with no warning', async () => {
    expect(
      await query([{ field: 'status', operator: 'equals', value: 'open' }]),
    ).toEqual({ ids: OPEN_IDS, total: 2, warns: [] });
  });

  it('`greater_than` — the probe’s second rule — selects id 1 with no warning', async () => {
    expect(
      await query([{ field: 'amount', operator: 'greater_than', value: 100 }]),
    ).toEqual({ ids: OVER_100_IDS, total: 1, warns: [] });
  });

  it('two rules AND, as a flat rule array does on every other face', async () => {
    expect(
      await query([
        { field: 'status', operator: 'equals', value: 'open' },
        { field: 'amount', operator: 'greater_than', value: 100 },
      ]),
    ).toEqual({ ids: OVER_100_IDS, total: 1, warns: [] });
  });

  it('a spec alias is folded by the spec’s own `normalizeFilterOperator`, not by a second table here', async () => {
    // `eq` is an alias of `equals` in the spec's `VIEW_FILTER_OPERATOR_ALIASES`;
    // `toFilterNode` folds it through the spec's exit, so this adapter reads it
    // without naming it anywhere.
    expect(
      await query([{ field: 'status', operator: 'eq', value: 'open' }]),
    ).toEqual({ ids: OPEN_IDS, total: 2, warns: [] });
  });

  it('a rule mixed with an AST tuple lowers element-wise, the way `toFilterNode` does', async () => {
    expect(
      await query([{ field: 'status', operator: 'equals', value: 'open' }, ['amount', '>', 100]]),
    ).toEqual({ ids: OVER_100_IDS, total: 1, warns: [] });
  });

  it('a valueless rule (`is_null`) reads its direction from the operator NAME', async () => {
    const rows = [
      { id: 1, closed_at: null },
      { id: 2, closed_at: '2026-01-01' },
      { id: 3 },
    ];
    expect(await query([{ field: 'closed_at', operator: 'is_null' }], rows)).toEqual({
      ids: [1, 3],
      total: 2,
      warns: [],
    });
  });

  it('the rule array and its AST spelling select the SAME rows — one lowering, two dialects', async () => {
    const viaRules = await query([{ field: 'amount', operator: 'less_than_or_equal', value: 75 }]);
    const viaAst = await query([['amount', '<=', 75]]);
    expect(viaRules.ids).toEqual([2, 3]);
    expect(viaRules).toEqual(viaAst);
  });
});

describe('objectui#10767 — what stays refused: the matcher is not relaxed', () => {
  it('an empty rule array is "no filter", as it is on the object-bound arm', async () => {
    // `translateFilterToAST([])` (the wire adapter) and `toFilterNode([])` both
    // answer `undefined`, i.e. no constraint; this adapter answers every row and
    // logs nothing, on both trees.
    expect(await query([])).toEqual({ ids: ALL_IDS, total: 3, warns: [] });
  });

  it('a genuinely unreadable node still excludes every row and logs ONCE, with the same sentence', async () => {
    const result = await query([{ foo: 'bar' }]);
    expect(result.ids).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain('is not a shape the matcher reads');
    expect(result.warns[0]).toContain('Rows are excluded rather than passed through.');
  });

  it('unknownOperatorRefusalIsTheASTTwin: an operator the vocabulary does not know is refused as its AST spelling is', async () => {
    // `toFilterNode` passes an unknown operator through VERBATIM (a misspelling
    // must not be coerced into a valid one), so the rule reaches the AST arm as
    // `['status', 'bogus', 'open']` and gets exactly the refusal that tuple
    // gets: excluded, logged once, naming the operator. Read against the twin
    // rather than against a sentence, so the wording is free to move.
    const viaRule = await query([{ field: 'status', operator: 'bogus', value: 'open' }]);
    const viaAst = await query([['status', 'bogus', 'open']]);
    expect(viaRule.ids).toEqual([]);
    expect(viaRule.warns).toHaveLength(1);
    expect(viaRule.warns[0]).toContain("'bogus'");
    expect(viaRule).toEqual(viaAst);
  });

  it('a rule the lowering refuses (an ARRAY on a single-valued operator) excludes every row, logs once, and does NOT throw', async () => {
    // objectui#8557's refusal in `viewFilterRuleToNode` is a throw for the
    // producers that call `toFilterNode` before a wire query. Here it is
    // delivered as this adapter delivers every refusal — excluded and logged
    // once — because `find()` is deciding about rows, not about sending a query.
    const result = await query([{ field: 'status', operator: 'equals', value: ['open'] }]);
    expect(result.ids).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain("'status'");
    expect(result.warns[0]).toContain("'equals'");
    expect(result.warns[0]).toContain('Rows are excluded rather than passed through.');
  });

  it('an empty `icontains` comparand in a rule is refused the same way, on the same face', async () => {
    const result = await query([{ field: 'status', operator: 'icontains', value: '' }]);
    expect(result.ids).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain("'icontains'");
    expect(result.warns[0]).toContain('Rows are excluded rather than passed through.');
  });

  it('the `$`-dialect arm is untouched: a record filter the object matcher refuses still refuses', async () => {
    const result = await query({ status: { $like: 'op%' } });
    expect(result.ids).toEqual([]);
    expect(result.warns).toHaveLength(1);
    expect(result.warns[0]).toContain("'$like'");
  });
});
