/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — the view's `kanban.summary` (a lane statistic at each
 * lane's foot) and the two card toggles, `showFieldLabels` and
 * `hideEmptyFields`, as `ListView` relays them onto the board node.
 *
 * Rows:
 *   (a) `{ type: 'count' }` draws each lane's count at its foot;
 *   (b) `{ type: 'sum', field }` totals the field at the foot, in place of the
 *       header's `summarizeField` total; over a lane that holds more than it
 *       drew, the sum says so in words (no `+`: a sum over part of a lane is
 *       no bound); a type the board does not compute (`avg`, refused by the
 *       spec) draws no foot and keeps the `summarizeField` total;
 *   (c) `{ type: 'none' }` draws neither the foot nor the header total;
 *   (d) without the keys a card names its fields and leaves out an empty one;
 *       `showFieldLabels: false` draws the values alone; `hideEmptyFields:
 *       false` keeps the empty field's line.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { ObjectKanban } from './ObjectKanban';
import { laneStatistic } from './KanbanColumnSummary';
import './KanbanImpl';

const OBJECT_SCHEMA = {
  name: 'stat_deal',
  fields: {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
    stage: {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
    },
  },
};

const ROWS = [
  { id: 'd1', name: 'Alpha', stage: 'open', amount: 10, region: 'North' },
  { id: 'd2', name: 'Beta', stage: 'open', amount: 30, region: null },
  { id: 'd3', name: 'Gamma', stage: 'won', amount: 5, region: 'South' },
];

async function renderBoard(extra: Record<string, unknown>) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
  } as any;
  const result = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ObjectKanban
        schema={{ type: 'object-kanban', objectName: 'stat_deal', groupBy: 'stage', cardFields: ['amount', 'region'], ...extra } as any}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(result.container.textContent).toContain('Gamma'));
  return result;
}

const laneNamed = (container: HTMLElement, name: string): HTMLElement => {
  const lane = Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]'))
    .find((l) => l.getAttribute('aria-label') === name);
  if (!lane) throw new Error(`no lane named ${name}`);
  return lane;
};
const footOf = (lane: HTMLElement) => lane.querySelector<HTMLElement>('[data-kanban-lane-statistic]');

afterEach(cleanup);

describe('the lane statistic and card toggles (objectstack#36370)', () => {
  it('(a) counts each lane at its foot', async () => {
    const { container } = await renderBoard({ summary: { type: 'count' } });
    await waitFor(() => expect(footOf(laneNamed(container, 'Open'))).not.toBeNull());
    expect(footOf(laneNamed(container, 'Open'))!.textContent).toBe('Count2');
    expect(footOf(laneNamed(container, 'Won'))!.textContent).toBe('Count1');
  });

  it('(b) totals a field at the foot, in place of the summarizeField header total; an uncomputed type keeps the total', async () => {
    const { container } = await renderBoard({ summary: { type: 'sum', field: 'amount' }, summarizeField: 'amount' });
    await waitFor(() => expect(footOf(laneNamed(container, 'Open'))).not.toBeNull());
    expect(footOf(laneNamed(container, 'Open'))!.textContent).toContain('Sum · Amount');
    expect(footOf(laneNamed(container, 'Open'))!.textContent).toContain('40');
    expect(container.querySelector('[data-kanban-lane-total]')).toBeNull();
    cleanup();

    const avg = await renderBoard({ summary: { type: 'avg', field: 'amount' }, summarizeField: 'amount' });
    await waitFor(() => expect(avg.container.querySelector('[data-kanban-lane-total]')).not.toBeNull());
    expect(avg.container.querySelector('[data-kanban-lane-statistic]')).toBeNull();
  });

  it('(b) marks a sum over a lane that holds more than it drew in words, not with a +', async () => {
    // A windowed board (objectui#4025): as many rows came back as the window
    // asked for, so every lane may hold more than it drew.
    const { container } = await renderBoard({ summary: { type: 'sum', field: 'amount' }, limit: ROWS.length });
    await waitFor(() => expect(footOf(laneNamed(container, 'Open'))).not.toBeNull());
    const foot = footOf(laneNamed(container, 'Open'))!;
    expect(foot).toHaveAttribute('data-kanban-lane-statistic-partial');
    expect(foot.textContent).toContain('Sum · Amount · loaded cards');
    expect(foot.textContent).not.toContain('+');
    cleanup();

    // CONTROL: a board that drew everything says nothing of the kind.
    const whole = await renderBoard({ summary: { type: 'sum', field: 'amount' } });
    await waitFor(() => expect(footOf(laneNamed(whole.container, 'Open'))).not.toBeNull());
    expect(footOf(laneNamed(whole.container, 'Open'))).not.toHaveAttribute('data-kanban-lane-statistic-partial');
    expect(footOf(laneNamed(whole.container, 'Open'))!.textContent).not.toContain('loaded cards');
  });

  it('(c) draws no statistic for none, also over a summarizeField', async () => {
    const { container } = await renderBoard({ summary: { type: 'none' }, summarizeField: 'amount' });
    expect(container.querySelector('[data-kanban-lane-statistic]')).toBeNull();
    expect(container.querySelector('[data-kanban-lane-total]')).toBeNull();
  });

  it('(d) names the card fields and leaves out an empty one by default; the toggles turn each off', async () => {
    const plain = await renderBoard({});
    expect(laneNamed(plain.container, 'Open').querySelectorAll('dt').length).toBeGreaterThan(0);
    expect(laneNamed(plain.container, 'Open').querySelector('[data-kanban-card-field-empty]')).toBeNull();
    cleanup();

    const noLabels = await renderBoard({ showFieldLabels: false });
    expect(noLabels.container.querySelectorAll('dt')).toHaveLength(0);
    expect(laneNamed(noLabels.container, 'Open').textContent).toContain('North');
    cleanup();

    const keepEmpty = await renderBoard({ hideEmptyFields: false });
    expect(laneNamed(keepEmpty.container, 'Open').querySelectorAll('[data-kanban-card-field-empty]')).toHaveLength(1);
  });
});

describe('laneStatistic (objectstack#36370)', () => {
  const cards = [{ v: 1 }, { v: 2.5 }, { v: null }, { v: '4' }];
  it('counts the cards and sums the values', () => {
    expect(laneStatistic(cards, 'v', 'count')).toBe(4);
    expect(laneStatistic(cards, 'v', 'sum')).toBe(7.5);
  });
  it('answers null for a sum over a value that is not a number', () => {
    expect(laneStatistic([{ v: 'x' }], 'v', 'sum')).toBeNull();
  });
});
