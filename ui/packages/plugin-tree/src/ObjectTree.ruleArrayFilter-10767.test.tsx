/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10767 — an `object-tree` with inline rows draws the rows a spec
 * `ViewFilterRule[]` `filter` selects.
 *
 * ## What was wrong
 *
 * The inline arm hands `schema.filter` to an in-memory `ValueDataSource`
 * unlowered (objectui#9136 routed it there so `filter` and the ceiling are
 * honoured). That adapter read a MongoDB-style record and an AST array, but
 * refused a rule OBJECT node by node — so the one filter form the spec's
 * converged `filter` doors accept (objectui#6206 B) drew NO nodes, with one
 * `console.warn` as the only signal. The record form and the AST form drew the
 * three; they are the controls here.
 *
 * The repair is in `@object-ui/core`'s `ValueDataSource` (the array arm lowers
 * through `toFilterNode`), so this file changes nothing in `ObjectTree.tsx`; it
 * pins the consequence on THIS block, through its own inline spelling.
 *
 * ## HOW THE INLINE ROWS ARE SPELLED HERE
 *
 * `{ provider: 'value', items }` under `schema.data`, and NO `data` PROP. The
 * `data` prop is the host-data passthrough above the inline branch — rows a
 * parent already queried, which this card does not touch. (A bare array under
 * `schema.data` used to ride that passthrough too; objectui#8348 judges
 * `data` against the block's published row, the `ViewData` union, so it is no
 * longer a record source. `staticData` is the row's other inline rung and
 * reaches the same `value` branch.)
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered array arm in `ValueDataSource.find`:
 * `ruleArrayFilter` goes RED; `recordFormControl` and `astControl` stay GREEN —
 * they draw the same three either way, which is what makes them controls.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectTree } from './ObjectTree';

// Same factory `ObjectTree.inlineQueryKeys-9136.test.tsx` uses, and through
// `<any>` for the reason that file's comment records: `plugin-tree` does not
// declare `@object-ui/plugin-detail` as a type-position edge.
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

/** The three rows a `status = active` filter declares, in tree order, in every spelling. */
const ACTIVE_NAMES = 'Acme,Engineering,Platform';
const RULE_ARRAY_FILTER = [{ field: 'status', operator: 'equals', value: 'active' }];
const RECORD_FORM_FILTER = { status: 'active' };
const AST_FILTER = [['status', '=', 'active']];

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

describe('objectui#10767 — the tree draws the rows a rule-array `filter` selects on inline `value` data', () => {
  it('ruleArrayFilter: the spec’s rule array draws the three declared rows', async () => {
    render(
      <ObjectTree
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RULE_ARRAY_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    expect(drawn().names).toBe(ACTIVE_NAMES);
  });

  it('recordFormControl: the record form draws the same three (green on both trees)', async () => {
    render(
      <ObjectTree
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RECORD_FORM_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    expect(drawn().names).toBe(ACTIVE_NAMES);
  });

  it('astControl: the AST form draws the same three (green on both trees)', async () => {
    render(
      <ObjectTree
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: AST_FILTER }}
      />,
    );
    await waitFor(() => expect(drawn().count).toBe(3));
    expect(drawn().names).toBe(ACTIVE_NAMES);
  });
});
