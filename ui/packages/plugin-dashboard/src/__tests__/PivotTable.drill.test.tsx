/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { PivotTable } from '../PivotTable';

const data = [
  { stage: 'won', source: 'web', amount: 100 },
  { stage: 'won', source: 'event', amount: 50 },
  { stage: 'lost', source: 'web', amount: 25 },
];

const baseSchema: any = {
  type: 'pivot',
  rowField: 'stage',
  columnField: 'source',
  valueField: 'amount',
  aggregation: 'sum',
  showRowTotals: true,
  showColumnTotals: true,
  data,
};

describe('PivotTable drill-down', () => {
  it('does not render interactive cells without a host `onDrillDown`', () => {
    render(<PivotTable schema={baseSchema} />);
    // No element with role="button"
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  // objectui#10932: `drillDown` on a `pivot` node is a retirement tombstone,
  // and `PivotTable` reads nothing off the node for its drill. The host's
  // `onDrillDown` is the only switch (`ObjectPivotTable` passes it exactly when
  // its `object-pivot` drill is enabled). Both directions are pinned: the node
  // key can neither turn the drill on nor turn it off.
  it('the node\'s `drillDown` cannot turn the drill on: no handler, no interactive cells (objectui#10932)', () => {
    render(<PivotTable schema={{ ...baseSchema, drillDown: { enabled: true } }} />);
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('the node\'s `drillDown` cannot turn the drill off: the host handler is the switch (objectui#10932)', () => {
    const onDrillDown = vi.fn();
    render(<PivotTable schema={{ ...baseSchema, drillDown: { enabled: false } }} onDrillDown={onDrillDown} />);
    fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));
    expect(onDrillDown).toHaveBeenCalledTimes(1);
  });

  it('emits cell payload with rowKey/colKey/value/scope on click', () => {
    const onDrillDown = vi.fn();
    render(
      <PivotTable
        schema={baseSchema}
        onDrillDown={onDrillDown}
      />,
    );
    const cell = screen.getByLabelText('Drill into stage=won, source=web');
    fireEvent.click(cell);
    expect(onDrillDown).toHaveBeenCalledTimes(1);
    expect(onDrillDown.mock.calls[0][0]).toMatchObject({
      scope: 'cell',
      rowKey: 'won',
      colKey: 'web',
      value: 100,
    });
  });

  it('row header click emits scope=row payload', () => {
    const onDrillDown = vi.fn();
    render(
      <PivotTable
        schema={baseSchema}
        onDrillDown={onDrillDown}
      />,
    );
    fireEvent.click(screen.getByLabelText('Drill into stage: won'));
    expect(onDrillDown.mock.calls[0][0]).toMatchObject({ scope: 'row', rowKey: 'won' });
  });

  it('column header click emits scope=column payload', () => {
    const onDrillDown = vi.fn();
    render(
      <PivotTable
        schema={baseSchema}
        onDrillDown={onDrillDown}
      />,
    );
    fireEvent.click(screen.getByLabelText('Drill into source: event'));
    expect(onDrillDown.mock.calls[0][0]).toMatchObject({ scope: 'column', colKey: 'event' });
  });

  it('Enter key on a cell triggers drill', () => {
    const onDrillDown = vi.fn();
    render(
      <PivotTable
        schema={baseSchema}
        onDrillDown={onDrillDown}
      />,
    );
    const cell = screen.getByLabelText('Drill into stage=lost, source=web');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onDrillDown).toHaveBeenCalledTimes(1);
    expect(onDrillDown.mock.calls[0][0]).toMatchObject({ scope: 'cell', rowKey: 'lost', colKey: 'web' });
  });

  it('passes rowLabels to drill payload as rowLabel', () => {
    const onDrillDown = vi.fn();
    render(
      <PivotTable
        schema={baseSchema}
        rowLabels={{ won: 'Won', lost: 'Lost' }}
        columnLabels={{ web: 'Web', event: 'Event' }}
        onDrillDown={onDrillDown}
      />,
    );
    fireEvent.click(screen.getByLabelText('Drill into stage=won, source=web'));
    expect(onDrillDown.mock.calls[0][0]).toMatchObject({ rowLabel: 'Won', colLabel: 'Web' });
  });
});
