/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4618 — the static-data `table` widget, on both dashboard surfaces.
 *
 * Filed shape (measured on `origin/main` @ `c1d939f7f`): a widget authored as
 *
 *   { id, type: 'table', options: { data: [ {…}, {…} ] } }
 *
 * rendered through `DashboardRenderer` produced ONE `role="alert"` reading
 * `Component "data-table" failed to render / Maximum update depth exceeded…`,
 * while `bar` / `line` / `area` / `donut` / `metric` off the identical static
 * surface rendered clean.
 *
 * The crash and the emptiness are two DIFFERENT defects on the same authored
 * widget, and this suite pins both — a "no alert" assertion alone would have
 * passed on a tile that renders nothing at all, which is exactly the silent
 * blank #4612/#4613/#4614 spent three cards removing from these surfaces:
 *
 *   1. CRASH — `data-table`'s own prop→state loop, traced in
 *      `packages/components/src/renderers/complex/__tests__/data-table-render-loop.test.tsx`.
 *      A dashboard tile re-renders (filters, resize, any parent state), and the
 *      table then re-renders itself to the nested-update limit.
 *   2. EMPTY — `DataTableSchema.columns` is REQUIRED
 *      (`packages/types/src/data-display.ts:369`), and both surfaces built the
 *      static node WITHOUT it whenever the author declared no `options.columns`.
 *      Measured: zero `th`, zero `td`, and one empty `tr` per row — the table
 *      drew rows it had no cells for. The sibling path already derives them
 *      (`ObjectDataTable.tsx:327-339` maps the first row's keys), so the static
 *      path was the odd one out within one widget family.
 *   3. EMPTY, grid only — `DashboardGridLayout` read the rows as
 *      `widgetData?.items || []`, which is `[]` for the authored ARRAY shape.
 *      `DashboardRenderer` has carried the `Array.isArray` arm all along; the
 *      grid's mirror of the same branch never grew it.
 *
 * `@object-ui/components` and `@object-ui/plugin-charts` are imported at module
 * scope (never in a hook — the cold transform must not be billed to a bounded
 * test budget, AGENTS.md 测试纪律) for the reason the #4614 suite records: with
 * `data-table` / `chart` unregistered, `SchemaRenderer` renders its own red
 * "Unknown component type" box — which also carries `role="alert"`, so the
 * crash assertion would have passed on a surface that never mounted the table,
 * and the chart control would have failed for a reason unrelated to this card.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';

afterEach(cleanup);

const ROWS = [
  { name: 'INV-1', amount: 100 },
  { name: 'INV-2', amount: 200 },
];

/** The widget exactly as #4618 filed it. */
const staticTableWidget = {
  id: 't',
  title: 'Recent Invoices',
  type: 'table',
  options: { data: ROWS },
};

const dash = (widget: Record<string, unknown>): DashboardComponentSchema =>
  ({ type: 'dashboard', columns: 2, gap: 4, widgets: [widget] }) as unknown as DashboardComponentSchema;

/**
 * Both surfaces, driven identically. A dashboard tile is re-rendered by its
 * host all the time; `churn` is that, and it is what turns the latent loop into
 * the reported crash (mount alone never did).
 */
const SURFACES: Array<[string, React.ComponentType<{ schema: DashboardComponentSchema }>]> = [
  ['DashboardRenderer', DashboardRenderer as React.ComponentType<{ schema: DashboardComponentSchema }>],
  ['DashboardGridLayout', DashboardGridLayout as React.ComponentType<{ schema: DashboardComponentSchema }>],
];

function renderSurface(Surface: React.ComponentType<{ schema: DashboardComponentSchema }>, widget: Record<string, unknown>) {
  const schema = dash(widget);
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return <Surface schema={schema} />;
  };
  const utils = render(<Host />);
  return { ...utils, churn: () => act(() => { bump!(); }) };
}

describe.each(SURFACES)('%s renders a static-data table widget (#4618)', (_name, Surface) => {
  it('does not crash into the error boundary when the tile re-renders', () => {
    const surface = renderSurface(Surface, staticTableWidget);
    expect(() => surface.churn()).not.toThrow();
    // The boundary's own text, verbatim from the filing.
    expect(screen.queryByText(/failed to render/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Maximum update depth exceeded/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a real table — headers derived from the rows, and the cells', () => {
    const surface = renderSurface(Surface, staticTableWidget);
    const table = surface.container.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table!.querySelectorAll('th')).map((th) => th.textContent?.trim());
    // Humanized from the row keys, the way the object-bound sibling does it.
    expect(headers).toContain('Name');
    expect(headers).toContain('Amount');
    // …and the rows are actually in cells, not empty `tr`s.
    const cells = Array.from(table!.querySelectorAll('td')).map((td) => td.textContent?.trim());
    expect(cells).toContain('INV-1');
    expect(cells).toContain('200');
    // The widget's own title still frames it.
    expect(within(surface.container).getByText('Recent Invoices')).toBeInTheDocument();
  });

  it('honours author-declared columns instead of deriving them', () => {
    const surface = renderSurface(Surface, {
      id: 't',
      title: 'Recent Invoices',
      type: 'table',
      options: { data: ROWS, columns: [{ header: 'Invoice', accessorKey: 'name' }] },
    });
    const table = surface.container.querySelector('table')!;
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toContain('Invoice');
    // The undeclared key stays out — derivation must not widen an explicit list.
    expect(headers).not.toContain('Amount');
    expect(surface.container.textContent).toContain('INV-1');
    expect(surface.container.textContent).not.toContain('200');
  });

  it('renders an empty static table without inventing headers', () => {
    const surface = renderSurface(Surface, { id: 't', title: 'Nothing yet', type: 'table', options: { data: [] } });
    expect(() => surface.churn()).not.toThrow();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(surface.container.querySelector('table')!.querySelectorAll('th')).toHaveLength(0);
  });

  it('leaves the other widget families alone — a static bar widget still renders clean', () => {
    const surface = renderSurface(Surface, {
      id: 'b',
      title: 'Revenue',
      type: 'bar',
      options: { data: [{ name: 'Jan', value: 1 }] },
    });
    expect(() => surface.churn()).not.toThrow();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(surface.container).getByText('Revenue')).toBeInTheDocument();
  });
});
