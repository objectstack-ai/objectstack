/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10767 — an `object-gantt` with inline rows charts the rows a spec
 * `ViewFilterRule[]` `filter` selects.
 *
 * ## What was wrong
 *
 * `resolveDataSource` (`@object-ui/core`) answers `provider: 'value'` with an
 * in-memory `ValueDataSource`, and `reload` hands `schema.filter` to whichever
 * adapter it resolved, unlowered — the same call for every provider
 * (objectui#8769). On the wire adapter the rule array is translated; on
 * `ValueDataSource` it was refused node by node, so the one filter form the
 * spec's converged `filter` doors accept (objectui#6206 B) charted NO rows on
 * an inline gantt, with one `console.warn` as the only signal. The record form
 * and the AST form charted the three; they are the controls here.
 *
 * The repair is in `@object-ui/core`'s `ValueDataSource` (the array arm lowers
 * through `toFilterNode`), so this file changes nothing in `ObjectGantt.tsx`;
 * it pins the consequence on THIS block, through both of its inline spellings.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered array arm in `ValueDataSource.find`:
 * `ruleArrayFilter` and `ruleArrayFilterStaticData` go RED; `recordFormControl`
 * and `astControl` stay GREEN — they chart the same three either way, which is
 * what makes them controls.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant here — every assertion is about WHICH rows
// reached the chart. Same stub the sibling ObjectGantt pins use.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div
      data-testid="gantt-view"
      data-task-count={String(tasks.length)}
      data-task-ids={tasks.map((t: any) => String(t.id)).join(',')}
    />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

afterEach(cleanup);

const ROWS = [
  { id: '1', subject: 'Alpha', status: 'open', visible_from: '2026-01-01', due_date: '2026-01-31' },
  { id: '2', subject: 'Bravo', status: 'closed', visible_from: '2026-02-01', due_date: '2026-02-28' },
  { id: '3', subject: 'Charlie', status: 'open', visible_from: '2026-03-01', due_date: '2026-03-31' },
  { id: '4', subject: 'Delta', status: 'closed', visible_from: '2026-04-01', due_date: '2026-04-30' },
  { id: '5', subject: 'Echo', status: 'open', visible_from: '2026-05-01', due_date: '2026-05-31' },
];

/** The three rows a `status = open` filter declares, in every spelling. */
const OPEN_IDS = '1,3,5';
const RULE_ARRAY_FILTER = [{ field: 'status', operator: 'equals', value: 'open' }];
const RECORD_FORM_FILTER = { status: 'open' };
const AST_FILTER = [['status', '=', 'open']];

const base: any = {
  type: 'object-gantt',
  gantt: {
    titleField: 'subject',
    startDateField: 'visible_from',
    endDateField: 'due_date',
  },
};

function drawn() {
  const el = screen.getByTestId('gantt-view');
  return {
    count: el.getAttribute('data-task-count'),
    ids: el.getAttribute('data-task-ids'),
  };
}

describe('objectui#10767 — the gantt charts the rows a rule-array `filter` selects on inline `value` data', () => {
  it('ruleArrayFilter: the spec’s rule array charts the three declared rows', async () => {
    render(
      <ObjectGantt
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RULE_ARRAY_FILTER }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('ruleArrayFilterStaticData: the `staticData` rung reaches the same repair', async () => {
    render(<ObjectGantt schema={{ ...base, staticData: ROWS, filter: RULE_ARRAY_FILTER }} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('recordFormControl: the record form charts the same three (green on both trees)', async () => {
    render(
      <ObjectGantt
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RECORD_FORM_FILTER }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });

  it('astControl: the AST form charts the same three (green on both trees)', async () => {
    render(
      <ObjectGantt
        schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: AST_FILTER }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
    await waitFor(() => expect(drawn().count).toBe('3'));
    expect(drawn().ids).toBe(OPEN_IDS);
  });
});
