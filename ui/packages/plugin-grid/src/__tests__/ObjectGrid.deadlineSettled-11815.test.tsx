/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — through the real `ObjectGrid`, every column builder
 * forwards a declared deadline (`dueLike`, `settledWhen`) and hands each row's
 * cell `deadlineSettled`: a done row's past deadline reads neutral, an open
 * row's reads "Overdue Nd" in red (ruling D). The projection asks for the
 * `settledWhen` operand when no column shows it.
 *
 * The deadline is named `deliver_by` on purpose: no retired name guess can
 * paint it, so only the declaration can.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => installRecordSecurityExplainDouble(vi));
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
    deliver_by: {
      type: 'date',
      label: 'Deliver by',
      dueLike: true,
      settledWhen: "record.status == 'done'",
    },
    started_on: { type: 'date', label: 'Started on' },
  },
};

const ROWS = [
  { id: 't-open', title: 'Open task', status: 'open', deliver_by: daysAgo(5), started_on: daysAgo(4) },
  { id: 't-done', title: 'Done task', status: 'done', deliver_by: daysAgo(5), started_on: daysAgo(4) },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => TASK_SCHEMA),
  } as any;
}

function renderGrid(schemaOverrides: Record<string, unknown>, props: Record<string, unknown> = {}, ds = makeDataSource()) {
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: 'task', ...schemaOverrides } as never}
        dataSource={ds}
        {...props}
      />
    </ActionProvider>,
  );
  return ds;
}

const isRed = (text: string) => screen.getByText(text).closest('span.tabular-nums')?.className.includes('text-red-600');

/** One overdue (open row) and one neutral (done row) deadline, and the undeclared control. */
async function expectOpenOverdueDoneNeutral() {
  await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
  expect(screen.getAllByText('Overdue 5d')).toHaveLength(1);
  expect(isRed('Overdue 5d')).toBe(true);
  expect(screen.getAllByText('5 days ago')).toHaveLength(1);
  expect(isRed('5 days ago')).toBe(false);
  // CONTROL: an undeclared past date reads neutral on both rows.
  expect(screen.getAllByText('4 days ago')).toHaveLength(2);
}

const NAMES = ['title', 'deliver_by', 'started_on'];

describe('objectui#11815 — every ObjectGrid path judges a declared deadline per row', () => {
  it('A: object `columns`', async () => {
    renderGrid({ columns: NAMES.map((field) => ({ field })), data: { provider: 'value', items: ROWS } });
    await expectOpenOverdueDoneNeutral();
  });

  it('A: an object column drawn as a link', async () => {
    renderGrid({
      columns: [{ field: 'title' }, { field: 'deliver_by', link: true }, { field: 'started_on' }],
      data: { provider: 'value', items: ROWS },
    });
    await expectOpenOverdueDoneNeutral();
  });

  it('B: string `columns`', async () => {
    renderGrid({ columns: NAMES, data: { provider: 'value', items: ROWS } });
    await expectOpenOverdueDoneNeutral();
  });

  it('B: string `columns` with the deadline as the primary (link) column', async () => {
    renderGrid({ columns: ['deliver_by', 'title', 'started_on'], data: { provider: 'value', items: ROWS } });
    await expectOpenOverdueDoneNeutral();
  });

  it('C: inline-data projection (`fields`, no `columns`)', async () => {
    renderGrid({ fields: NAMES, data: { provider: 'value', items: ROWS } });
    await expectOpenOverdueDoneNeutral();
  });

  it('D: object-schema default columns (rows handed down)', async () => {
    renderGrid({}, { data: ROWS });
    await expectOpenOverdueDoneNeutral();
  });
});

describe('objectui#11815 — the projection carries what settledWhen reads', () => {
  it("asks for `status` when only Title and the deadline are shown, and judges each row", async () => {
    const ds = renderGrid({ columns: ['title', 'deliver_by'] });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const selects = ds.find.mock.calls.map(([, params]: any[]) => params?.$select);
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) expect(sel).toEqual(expect.arrayContaining(['id', 'title', 'deliver_by', 'status']));
    await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
  });

  it('CONTROL — an undeclared shown date pulls nothing extra into the projection', async () => {
    const ds = renderGrid({ columns: ['title', 'started_on'] });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    for (const [, params] of ds.find.mock.calls as any[]) expect(params?.$select).not.toContain('status');
  });
});
