/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEMBERS of `object-grid.aggregations`, pinned at what the RENDERER reads
 * (objectui#8071 slice 14).
 *
 * The registration declares an `array` arm and describes the member in prose —
 * `[{ field, type: "sum" | "count" | "avg" | "min" | "max" | "count_distinct" }]`
 * — and the spec row constrains nothing inside a member, so the READ SITE is the
 * whole member contract. That read site is one call
 * (`useGroupedData(schema.grouping, data, schema.aggregations, …)`) and one sink
 * (`GroupRow`'s chip row), and every rule below lives in `computeAggregations`
 * where no declaration can reach it.
 *
 * ⛔ What a declaration can never publish, which is why each row is a behaviour
 * rather than a restatement of that prose:
 *
 *   - **`field` selects the rows' column for five of the six types and is
 *     IGNORED by the sixth.** `count` answers `rows.length` without ever
 *     touching the member, so `{ field: 'amount', type: 'count' }` counts ROWS
 *     — including the rows that have no `amount` at all. An author who wanted
 *     "how many of these have an amount" wrote something that cannot fail and
 *     cannot be right; `count_distinct` is the type that reads the field.
 *   - **Coercion is `Number()`, and `Number(null)` is `0`.** A `null` cell is
 *     therefore a real zero in the roll-up — it lowers `avg` and it WINS `min`
 *     — while an ABSENT cell (`undefined` → `NaN`) is dropped. Two spellings an
 *     author reads as the same emptiness, two different numbers, no diagnostic.
 *   - **`avg`'s denominator is the coerced list, not the group.** A group of
 *     three rows whose two numeric cells are 5 and 6 reports `avg: 5.50` beside
 *     `count: 3`, and the two numbers are consistent with each other under a
 *     rule nothing states.
 *   - **`min` / `max` over NO numeric cell report `0`, not `Infinity`.** The
 *     bare `Math.min(...[])` a reader expects would put `Infinity` in a group
 *     header; the guard that prevents it is unlabelled and its removal is
 *     invisible to every other suite in this package.
 *   - **The chip renders the `type` member and never the `field` member.** Two
 *     aggregations of one type over two fields render as two chips reading the
 *     same word, distinguished only by their values and their authored order.
 *   - **`aggregations` alone does nothing.** Without `grouping` there are no
 *     groups, so there is no header to carry a roll-up and nothing is computed
 *     or reported — the key is a modifier on another key, which its own
 *     description says and nothing enforces.
 *
 * DIRECTION, predicted before running: every row is RED against the plausible
 * "improvement" of the read site it covers, and green as written. The ablation
 * is recorded in the PR body.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/**
 * Three groups, each chosen so that the six types disagree WITHIN it — a
 * fixture where `sum`, `avg` and `count` coincide cannot separate the rules.
 *
 *  - `open`   — 10, 20 and an explicit `null`. Coerced: [10, 20, 0].
 *  - `done`   — 5, 6 and a row with NO `amount` key. Coerced: [5, 6].
 *  - `stuck`  — one non-numeric string. Coerced: [].
 *
 * `score` exists so a second aggregation of the SAME type can name a different
 * field and be told apart by its value.
 */
const ROWS = [
  { id: '1', name: 'Row 1', status: 'open', amount: 10, score: 1 },
  { id: '2', name: 'Row 2', status: 'open', amount: 20, score: 1 },
  { id: '3', name: 'Row 3', status: 'open', amount: null, score: 1 },
  { id: '4', name: 'Row 4', status: 'done', amount: 5, score: 2 },
  { id: '5', name: 'Row 5', status: 'done', amount: 6, score: 2 },
  { id: '6', name: 'Row 6', status: 'done', score: 2 },
  { id: '7', name: 'Row 7', status: 'stuck', amount: 'n/a', score: 4 },
];

const GROUP_BY_STATUS = { fields: [{ field: 'status' }] };

function renderGrid(opts: Record<string, unknown>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'task',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
      { field: 'amount', label: 'Amount' },
    ],
    data: { provider: 'value', items: ROWS },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

/**
 * The rendered roll-up chips, by group label — read off the DOM the author
 * sees, never off the hook. `GroupRow` prints `TYPE: VALUE` and omits the chip
 * row entirely when a group has no results, so an empty array here is the
 * rendered absence rather than a missing query.
 */
function chipsByGroup(container: HTMLElement): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of Array.from(container.querySelectorAll('[data-testid^="group-row-"]'))) {
    const label = row.querySelector('.group-label')?.textContent?.trim() ?? '';
    out[label] = Array.from(row.querySelectorAll('.group-aggregations > span')).map(
      (chip) => (chip.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }
  return out;
}

/** Wait until the grouped view has painted its three headers. */
async function groupedChips(container: HTMLElement): Promise<Record<string, string[]>> {
  await waitFor(() =>
    expect(container.querySelectorAll('[data-testid^="group-row-"]')).toHaveLength(3),
  );
  return chipsByGroup(container);
}

describe('object-grid `aggregations` members reach the group header (objectui#8071)', () => {
  it('LIT CONTROL: one authored member renders one chip on every group', async () => {
    // First, because every absence asserted below would be vacuous against a
    // grid that renders no chips at all.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [{ field: 'amount', type: 'sum' }],
    });
    const chips = await groupedChips(container);
    expect(Object.keys(chips).sort()).toEqual(['done', 'open', 'stuck']);
    expect(chips.open).toEqual(['sum: 30']);
  });

  it('`field` selects the column — same `type`, two fields, two numbers', async () => {
    // The member is read, and it is read per entry: a renderer that aggregated
    // one field for every entry would print the same number twice.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [
        { field: 'amount', type: 'sum' },
        { field: 'score', type: 'sum' },
      ],
    });
    const chips = await groupedChips(container);
    expect(chips.open).toEqual(['sum: 30', 'sum: 3']);
    // …and the chip never names the field it summed, so the only thing telling
    // the author which is which is the order they authored them in.
    expect(chips.open.join(' ')).not.toContain('amount');
    expect(chips.open.join(' ')).not.toContain('score');
  });

  it('`type: count` IGNORES `field` — it counts rows, present cell or not', async () => {
    // `done` holds three rows and only two of them have an `amount`. Both
    // entries below report 3: the first because `count` never reads the field,
    // the second because a field no row carries changes nothing.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [
        { field: 'amount', type: 'count' },
        { field: 'no_such_field', type: 'count' },
      ],
    });
    const chips = await groupedChips(container);
    expect(chips.done).toEqual(['count: 3', 'count: 3']);
  });

  it('`count_distinct` is the type that DOES read the cell — empties skipped', async () => {
    // The contrast with `count` above, on the same group: three rows, two
    // distinct non-empty amounts, one absent cell that is not counted.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [{ field: 'amount', type: 'count_distinct' }],
    });
    const chips = await groupedChips(container);
    expect(chips.done).toEqual(['count_distinct: 2']);
    // `open` carries an explicit `null`, which is skipped here — the opposite
    // of what the same cell does to `sum`/`avg`/`min` in the next row.
    expect(chips.open).toEqual(['count_distinct: 2']);
    // `stuck`'s one cell is a non-numeric STRING: no coercion happens on this
    // path, so it is a distinct value like any other.
    expect(chips.stuck).toEqual(['count_distinct: 1']);
  });

  it('a `null` cell is coerced to 0 — it lowers `avg` and WINS `min`', async () => {
    // `open` is 10, 20 and one `null`. The author reads three amounts of which
    // one is unset; the roll-up reads three amounts of which one is zero.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [
        { field: 'amount', type: 'sum' },
        { field: 'amount', type: 'avg' },
        { field: 'amount', type: 'min' },
        { field: 'amount', type: 'max' },
      ],
    });
    const chips = await groupedChips(container);
    expect(chips.open).toEqual(['sum: 30', 'avg: 10', 'min: 0', 'max: 20']);
  });

  it('an ABSENT cell is dropped instead, so `avg` divides by the coerced list', async () => {
    // `done` is 5, 6 and one row with no `amount` key at all. `count` says 3
    // and `avg` says 5.50 in the same header, because they count different
    // things — and 5 + 6 over THREE rows would have been 3.67.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [
        { field: 'amount', type: 'count' },
        { field: 'amount', type: 'sum' },
        { field: 'amount', type: 'avg' },
      ],
    });
    const chips = await groupedChips(container);
    expect(chips.done).toEqual(['count: 3', 'sum: 11', 'avg: 5.50']);
  });

  it('`min` / `max` over no numeric cell report 0, not Infinity', async () => {
    // `stuck` holds one non-numeric string, so the coerced list is EMPTY. The
    // bare spread a reader expects here puts `Infinity` / `-Infinity` in a
    // group header; `sum` of nothing is 0 by the same arithmetic either way,
    // which is why it sits beside them as the control that stays still.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [
        { field: 'amount', type: 'min' },
        { field: 'amount', type: 'max' },
        { field: 'amount', type: 'sum' },
        { field: 'amount', type: 'avg' },
      ],
    });
    const chips = await groupedChips(container);
    expect(chips.stuck).toEqual(['min: 0', 'max: 0', 'sum: 0', 'avg: 0']);
    // The same four entries over a group that HAS numbers, so none of the four
    // zeroes above can be read as "this renderer prints zero".
    expect(chips.done).toEqual(['min: 5', 'max: 6', 'sum: 11', 'avg: 5.50']);
  });

  it('a non-integer result is printed to exactly two decimals', async () => {
    // 5.5 renders as `5.50` — the padding is what makes this a formatting rule
    // rather than an accident of the number, and a renderer handing the raw
    // value to React would print `5.5`.
    const { container } = renderGrid({
      grouping: GROUP_BY_STATUS,
      aggregations: [{ field: 'amount', type: 'avg' }],
    });
    const chips = await groupedChips(container);
    expect(chips.done).toEqual(['avg: 5.50']);
    // An integer result is NOT padded, so both branches are pinned.
    expect(chips.open).toEqual(['avg: 10']);
  });

  it('`aggregations` without `grouping` computes and renders NOTHING', async () => {
    // The key is a modifier on `grouping`: no groups, no headers, nowhere for a
    // roll-up to go. Nothing is thrown and nothing is reported, so an author who
    // wrote only this key sees a perfectly ordinary flat grid.
    const { container } = renderGrid({
      aggregations: [{ field: 'amount', type: 'sum' }],
    });
    await waitFor(() => expect(screen.getByText('Row 1')).toBeInTheDocument());
    expect(container.querySelectorAll('[data-testid^="group-row-"]')).toHaveLength(0);
    expect(container.querySelectorAll('.group-aggregations')).toHaveLength(0);
  });

  it('an EMPTY `aggregations` array renders the same as no key at all', async () => {
    // `[]` is what a designer emits for an unconfigured list. It reaches the
    // group entry as an empty result set and `GroupRow` skips the chip row, so
    // the header is byte-identical to the unaggregated one beside it.
    const { container: empty } = renderGrid({ grouping: GROUP_BY_STATUS, aggregations: [] });
    const emptyChips = await groupedChips(empty);
    expect(emptyChips.open).toEqual([]);
    expect(empty.querySelectorAll('.group-aggregations')).toHaveLength(0);

    const { container: absent } = renderGrid({ grouping: GROUP_BY_STATUS });
    const absentChips = await groupedChips(absent);
    expect(absentChips.open).toEqual([]);
    expect(absent.querySelectorAll('.group-aggregations')).toHaveLength(0);
  });
});
