/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9136 — a `provider: 'value'` tree honours the two query keys the
 * fetching path honours: `filter` and the objectui#7210 row ceiling. The fourth
 * surface of the objectui#8769 / objectui#9061 short-circuit;
 * `ObjectCalendar.inlineQueryKeys-9061.test.tsx` and
 * `ObjectMap.inlineQueryKeys-9061.test.tsx` are the twins.
 *
 * ## What was wrong
 *
 * The record effect short-circuited the inline provider (`setRecords(items)`;
 * return) and never reached the `find`, which is the ONE site in the file that
 * lowers `schema.filter` to `$filter` and the ceiling to `$top`. An authored
 * `filter` therefore reached nothing and every inline row was drawn — the
 * fail-OPEN direction: the key that was ignored is the key that NARROWS, so the
 * author saw MORE nodes than declared, with no diagnostic.
 *
 * ⛔ Not a data-exposure boundary. The rows are already in the authored schema;
 * what is wrong is that the tree answers a question nobody asked.
 *
 * ## Two keys, not three
 *
 * `ObjectTree` reads `schema.sort` on NO provider, so there is no `inlineSort`
 * row here, unlike the twins. Sort on the tree is a question about the OBJECT
 * path as well, and it is not this card's.
 *
 * ## The two-sided reading is the finding
 *
 * A one-sided reproduction cannot tell "the filter was ignored" from "the
 * filter matched everything", so `twoSidedFilter` renders the SAME rows and the
 * SAME filter twice — once inline, once through a context adapter that is
 * itself a `ValueDataSource` over those rows — and reads the DISAGREEMENT.
 *
 * ## ORDER: filter first, ceiling second (objectui#7210 ruling a′)
 *
 * The ceiling is applied to the FILTERED set, matching the fetching path.
 * `ceilingOrder` pins it from the observable side: a set that is over the
 * ceiling BEFORE filtering and under it after draws every matching row and
 * shows NO footnote.
 *
 * ⚠️ MEASURED CONSEQUENCE, reported rather than hidden: an author who supplies
 * more than `NON_GRID_ROW_CEILING` inline rows now sees fewer nodes than they
 * supplied. `ceilingCap` is that measurement. It is the ruled behaviour rather
 * than a silent loss — ruling a′'s budget is measured in DOM ELEMENTS PER
 * RECORD, the tree is the view that budget was measured on, and
 * `NonGridRowCeilingNote` names BOTH numbers on screen. On a tree the footnote
 * carries a second fact the picture cannot: a hierarchy drawn from the first N
 * rows reparents every node whose parent fell past the cut to a root.
 *
 * ## The clone the adapter now makes (objectui#9061 ruling A, objectui#9175)
 *
 * Routing inline rows through `ValueDataSource` routes them through its
 * constructor clone. That clone is `structuredClone`, not a JSON round-trip,
 * so an inline value still never has to be serializable — the objectui#6018
 * guarantee `ObjectMap.dataConfigMemo.test.tsx` pins for the map.
 * `backReferenceGraph` pins the same guarantee on this route.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the early return in `ObjectTree.tsx`: `twoSidedFilter`,
 * `ceilingCap` and `ceilingOrder` go RED; `control`, `backReferenceGraph` and
 * `providerBackedControl` stay GREEN — the first draws the same rows either
 * way, the second draws its graph with or without the clone, and the third
 * never touches the inline path at all, which is what makes them controls.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE
 *
 * `{ provider: 'value', items }` under `schema.data`, and NO `data` PROP. The
 * `data` prop (and a bare array under `schema.data`) is the host-data
 * passthrough above the inline branch — rows a parent already queried, a
 * different question (objectui#7333's class) that this card does not touch.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery, ValueDataSource } from '@object-ui/core';
import { ObjectTree } from './ObjectTree';

// Same factory `ObjectTree.rowCeiling-7210.test.tsx` uses, and through `<any>`
// for the reason that file's comment records: `plugin-tree` does not declare
// `@object-ui/plugin-detail` as a type-position edge.
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...((await importOriginal<any>()) as Record<string, unknown>),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

afterEach(cleanup);

/** Two archived branches hang off an active root; `name` is each row's identity. */
const ROWS = [
  { id: '1', name: 'Acme', status: 'active', parent_id: null },
  { id: '2', name: 'Engineering', status: 'active', parent_id: '1' },
  { id: '3', name: 'Legacy Ops', status: 'archived', parent_id: '1' },
  { id: '4', name: 'Platform', status: 'active', parent_id: '2' },
  { id: '5', name: 'Old Lab', status: 'archived', parent_id: '2' },
];

/** The three rows an authored `status = active` filter declares, in tree order. */
const ACTIVE_NAMES = 'Acme,Engineering,Platform';
const ACTIVE_FILTER = [['status', '=', 'active']];

const base: any = {
  type: 'object-tree',
  parentField: 'parent_id',
  labelField: 'name',
};

/** The rows actually drawn, read off the DOM rather than off any state. */
function drawn() {
  const rows = screen.queryAllByTestId('object-tree-row');
  return {
    count: rows.length,
    names: rows.map((row) => row.querySelector('.truncate')?.textContent ?? '').join(','),
  };
}

/** A flat forest: every 10th record is a root, the rest hang off it. */
function makeRows(n: number, status: (i: number) => string = () => 'active') {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Node ${i + 1}`,
    status: status(i),
    parent_id: i % 10 === 0 ? null : String(i - (i % 10) + 1),
  }));
}

describe('objectui#9136 — the tree honours filter and the row ceiling on inline `value` data', () => {
  it('twoSidedFilter: the inline path and the fetching path agree on the SAME rows and the SAME filter', async () => {
    // One matcher, two branches of the record effect. Any disagreement here is
    // the short-circuit and nothing else.
    const dataSource = new ValueDataSource({ items: ROWS }) as any;

    const { unmount } = render(
      <ObjectTree
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: ACTIVE_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    const inline = drawn();
    unmount();

    render(
      <ObjectTree
        schema={{ ...base, objectName: 'org_unit', filter: ACTIVE_FILTER }}
        dataSource={dataSource}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    const fetching = drawn();

    expect(inline.names).toBe(ACTIVE_NAMES);
    expect(fetching.names).toBe(ACTIVE_NAMES);
    // The finding, stated as the two paths agreeing.
    expect(inline.names).toBe(fetching.names);
  });

  it('ceilingCap: an inline set past the ceiling draws exactly the ceiling, and the footnote names both numbers', async () => {
    const total = nonGridRowCeilingQuery().$top + 500;
    render(<ObjectTree schema={{ ...base, data: { provider: 'value', items: makeRows(total) } }} />);

    // Real rendered `<tr>`s, as `ObjectTree.rowCeiling-7210.test.tsx` reads them
    // for the object provider: the tree is the view whose DOM grows with the set.
    await waitFor(() => expect(drawn().count).toBe(NON_GRID_ROW_CEILING));

    const note = screen.getByRole('note');
    expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
    expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
    expect(note.textContent).toContain(String(total));
  });

  it('ceilingOrder: the ceiling is applied to the FILTERED set, not to the raw one', async () => {
    // Over the ceiling before filtering, under it after: 2,400 rows of which
    // only every third is `active` (800). Filter-then-ceiling draws all 800 and
    // stays quiet; ceiling-then-filter could not.
    const rows = makeRows(2400, (i) => (i % 3 === 0 ? 'active' : 'archived'));
    render(
      <ObjectTree
        schema={{ ...base, data: { provider: 'value', items: rows }, filter: ACTIVE_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(800));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('control: an inline tree with NO filter and under the ceiling is unchanged', async () => {
    // ⭐ Green on BOTH ablation legs by construction. Without it a reviewer
    // cannot tell this repair from "the inline path now drops rows".
    render(<ObjectTree schema={{ ...base, data: { provider: 'value', items: ROWS } }} />);
    await waitFor(() => expect(drawn().count).toBe(5));
    expect(drawn().names).toBe('Acme,Engineering,Platform,Old Lab,Legacy Ops');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('backReferenceGraph: an inline record graph carrying a back-reference still renders', async () => {
    // What an `$expand`-ed lookup looks like once a host hands the resolved rows
    // to the block as inline data: the child carries its parent RECORD, and the
    // parent carries its children. A cycle — which a JSON round-trip throws on
    // ("Converting circular structure to JSON") and `structuredClone` copies.
    const root: any = { id: '1', name: 'Acme', status: 'active', parent_id: null };
    const child: any = { id: '2', name: 'Engineering', status: 'active', parent_id: '1' };
    child.parent = root;
    root.children = [child];

    render(<ObjectTree schema={{ ...base, data: { provider: 'value', items: [root, child] } }} />);
    await waitFor(() => expect(drawn().count).toBe(2));
    expect(drawn().names).toBe('Acme,Engineering');
    expect(screen.queryByText(/Failed to load tree/)).toBeNull();
  });

  it('providerBackedControl: the OBJECT provider is untouched by this repair', async () => {
    // ⭐ The control that BOUNDS the change to the inline path: same filter,
    // same rows, resolved through the context adapter, and the query it sends
    // read at the module boundary it crosses. Green before this repair, green
    // after it, and green on both ablation legs.
    const adapter = new ValueDataSource({ items: ROWS }) as any;
    const find = vi.spyOn(adapter, 'find');

    render(
      <ObjectTree
        schema={{ ...base, objectName: 'org_unit', filter: ACTIVE_FILTER }}
        dataSource={adapter}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    expect(drawn().names).toBe(ACTIVE_NAMES);
    expect(screen.queryByRole('note')).toBeNull();

    expect(find).toHaveBeenCalled();
    for (const [resource, params] of find.mock.calls as Array<[string, any]>) {
      expect(resource).toBe('org_unit');
      expect(params.$filter).toBe(ACTIVE_FILTER);
      expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
    }
  });
});
