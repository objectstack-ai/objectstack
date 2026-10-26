// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11681 — the measured dashboard charts draw whole-number ticks on a
 * count axis, and a sum over currency keeps its decimals.
 *
 * The card measured "Projects by Health", "Tasks by Status" and "Invoices by
 * Month": dataset widgets over an author-labelled count measure (for example
 * `{ name: 'task_count', label: 'Tasks', aggregate: 'count' }`), whose value
 * axis read 0.8 / 1.5 / 2.3 or 0.5 steps. The dataset answer states the
 * measure's aggregate on its column (`fields[].aggregate`), and the widget now
 * carries it to the chart, which draws integer ticks when every series on an
 * axis plots a count.
 *
 * The whole chain is real — `DatasetWidget` → `SchemaRenderer` → the
 * registered `chart` → `AdvancedChartImpl` — and the plot box is stubbed the way
 * `DatasetWidget.dimensionlessMeasures-11261` does it, so recharts lays out
 * real ticks. The answer's `fields` are the only variable between a count case
 * and its control.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
// Registers `chart`, which the `SchemaRenderer` inside `DatasetWidget`
// resolves. Imported at module scope so the cold transform is not billed to a
// bounded test budget (AGENTS.md's flaky-test discipline, objectui#3010).
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

const PLOT_BOX = { width: 480, height: 320 } as const;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList?.contains('recharts-responsive-container')) {
      return { ...PLOT_BOX, top: 0, left: 0, right: PLOT_BOX.width, bottom: PLOT_BOX.height, x: 0, y: 0, toJSON() {} } as DOMRect;
    }
    return originalGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

afterEach(cleanup);

/** "Tasks by Status": a small count domain (0 … 3), the measured shape. */
const TASK_ROWS = [
  { status: 'Backlog', task_count: 1 },
  { status: 'In Progress', task_count: 3 },
  { status: 'Done', task_count: 2 },
];
const CATEGORIES = new Set(['Backlog', 'In Progress', 'Done', 'Tasks', 'Projects']);

const STATUS = { name: 'status', type: 'string', label: 'Status' };
const countField = (name: string, label: string) => ({ name, type: 'number', label, aggregate: 'count' });

const sourceOf = (rows: Record<string, unknown>[], fields: Record<string, unknown>[]) => ({
  queryDataset: vi.fn(async () => ({ rows, fields })),
});

async function renderChart(widget: Record<string, unknown>, rows: Record<string, unknown>[], fields: Record<string, unknown>[]) {
  const view = render(<DatasetWidget widget={widget} dataSource={sourceOf(rows, fields)} />);
  await waitFor(() => expect(view.container.querySelector('.recharts-surface')).not.toBeNull(), { timeout: 15000 });
  return view.container;
}

/** The VALUE axis' tick labels: every tick that is not a category. */
const valueTicks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-cartesian-axis-tick-value'))
    .map((t) => (t.textContent ?? '').trim())
    .filter((t) => t !== '' && !CATEGORIES.has(t));

const isWhole = (tick: string) => /^-?\d+$/.test(tick.replace(/[$,]/g, ''));

async function expectWhole(c: HTMLElement, what: string) {
  await waitFor(() => expect(valueTicks(c).length, `${what}: no value ticks were drawn`).toBeGreaterThan(1));
  const ticks = valueTicks(c);
  expect(ticks.filter((t) => !isWhole(t)), `${what}: fractional ticks ${JSON.stringify(ticks)}`).toEqual([]);
}

async function expectDecimals(c: HTMLElement, what: string) {
  await waitFor(() => expect(valueTicks(c).length, `${what}: no value ticks were drawn`).toBeGreaterThan(1));
  const ticks = valueTicks(c);
  expect(ticks.some((t) => !isWhole(t)), `${what}: lost its decimal ticks ${JSON.stringify(ticks)}`).toBe(true);
}

const TASKS_BY_STATUS = { id: 'tasks', dataset: 'tasks', dimensions: ['status'], values: ['task_count'] };

describe('objectui#11681 — a count measure draws integer ticks on the measured dashboard charts', () => {
  it.each(['bar', 'line', 'area', 'horizontal-bar'])('"Tasks by Status" as a %s: integer ticks', async (type) => {
    const c = await renderChart({ ...TASKS_BY_STATUS, type }, TASK_ROWS, [STATUS, countField('task_count', 'Tasks')]);
    await expectWhole(c, `${type} over a count`);
  });

  it('a dimensionless chart of two counts: the transposed series states their shared aggregate', async () => {
    const c = await renderChart(
      { id: 'totals', type: 'bar', dataset: 'tasks', values: ['task_count', 'project_count'] },
      [{ task_count: 3, project_count: 2 }],
      [countField('task_count', 'Tasks'), countField('project_count', 'Projects')],
    );
    await expectWhole(c, 'a dimensionless bar of two counts');
  });

  it('the comparison overlay keeps its primary\'s aggregate, so the axis stays integer', async () => {
    const c = await renderChart(
      {
        ...TASKS_BY_STATUS,
        type: 'bar',
        filter: { created: { $gte: '2026-04-01', $lte: '2026-06-30' } },
        compareTo: { kind: 'previousYear' },
      },
      TASK_ROWS.map((r, i) => ({ ...r, task_count__compare: [2, 1, 3][i] })),
      [STATUS, countField('task_count', 'Tasks')],
    );
    await waitFor(() => expect(c.querySelectorAll('.recharts-bar-rectangle').length).toBe(6));
    await expectWhole(c, 'a count with its comparison overlay');
  });
});

describe('objectui#11681 — non-integer measures are unchanged (controls)', () => {
  it('a sum over currency keeps its decimals', async () => {
    const c = await renderChart(
      { id: 'revenue', type: 'bar', dataset: 'invoices', dimensions: ['status'], values: ['amount'] },
      [
        { status: 'Backlog', amount: 1 },
        { status: 'In Progress', amount: 3 },
        { status: 'Done', amount: 2 },
      ],
      [STATUS, { name: 'amount', type: 'number', label: 'Amount', aggregate: 'sum', currency: 'USD' }],
    );
    await expectDecimals(c, 'a currency sum');
  });

  it('a count column the answer states no aggregate for keeps recharts\' default (the measured fractional ticks)', async () => {
    const c = await renderChart({ ...TASKS_BY_STATUS, type: 'bar' }, TASK_ROWS, [
      STATUS,
      { name: 'task_count', type: 'number', label: 'Tasks' },
    ]);
    await expectDecimals(c, 'a column without an aggregate');
  });

  it('a dimensionless chart mixing a count and a sum states no aggregate', async () => {
    const c = await renderChart(
      { id: 'totals', type: 'bar', dataset: 'tasks', values: ['task_count', 'project_count'] },
      [{ task_count: 3, project_count: 2 }],
      [countField('task_count', 'Tasks'), { name: 'project_count', type: 'number', label: 'Projects', aggregate: 'sum' }],
    );
    await expectDecimals(c, 'a count beside a sum');
  });
});
