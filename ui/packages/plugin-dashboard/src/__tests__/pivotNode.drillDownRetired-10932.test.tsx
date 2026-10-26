/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `pivot` NODE drills nowhere, whatever `drillDown` it carries
 * (objectui#10932): the runtime half of the retirement, read through the real
 * `SchemaRenderer` and the real `pivot` registration rather than by calling
 * `PivotTable` directly.
 *
 * The route matters. `SchemaRenderer` spreads a node's keys as React props, so
 * a component can consume a key it never reads off `schema`. This render is
 * what an author's document goes through, so it sees both channels: `schema`
 * and the spread. `drillDown` on a `pivot` node is refused at validation (the
 * `@object-ui/types` pin is `pivot-drilldown-retired-10932.test.ts`); this
 * file pins that a document which reaches the renderer anyway draws a plain
 * cross-tab with no drill affordance, rather than a clickable cell that does
 * nothing.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import type { PivotTableSchema } from '@object-ui/types';
import { undeclaredNode } from '@object-ui/test-support';
// Registers `pivot` → `PivotTable`, the registration every `pivot` path uses.
import '../index';
import { PivotTable } from '../PivotTable';

afterEach(cleanup);

const PIVOT = {
  type: 'pivot' as const,
  rowField: 'stage',
  columnField: 'source',
  valueField: 'amount',
  data: [
    { stage: 'won', source: 'web', amount: 100 },
    { stage: 'lost', source: 'event', amount: 25 },
  ],
};

/**
 * What an author's document carries: the retired key, reaching the renderer
 * anyway. `PivotTableSchema` refuses `drillDown` by name, which is the point, so
 * the node crosses through the one test helper for undeclared input
 * (objectui#11466).
 */
const NODE = undeclaredNode<PivotTableSchema>({ ...PIVOT, drillDown: { enabled: true } });

describe('a `pivot` node authored with `drillDown` draws no drill affordance (objectui#10932)', () => {
  it('renders the cross-tab through SchemaRenderer, with no interactive cell or header', () => {
    render(<SchemaRenderer schema={NODE} />);
    // Lit control: the pivot itself rendered, cells and headers included.
    expect(screen.getByText('won')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText('Drill into stage=won, source=web')).toBeNull();
  });

  it('CONTROL — the query can see a drill affordance when a host passes `onDrillDown`', () => {
    render(<PivotTable schema={PIVOT} onDrillDown={vi.fn()} />);
    expect(screen.getByLabelText('Drill into stage=won, source=web')).toBeTruthy();
    expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
  });
});
