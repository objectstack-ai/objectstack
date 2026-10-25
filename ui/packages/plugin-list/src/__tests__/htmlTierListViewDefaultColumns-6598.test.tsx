/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The reported page, end to end: a `kind:'html'` page whose `<list-view>` must
 * render DATA COLUMNS and not just the index column (objectui#6598).
 *
 * The production report (objectstack#12649, hotcrm, promo-video recon) tried
 * eight spellings of `columns` on an html-kind page and got the same picture
 * every time: the row count, the filter/group/sort toolbar, and "no data
 * columns at all — only the index column". Two of the eight were the grammar
 * cases objectui#6614/#6669 legalised (single-quoted arrays, bare identifier
 * object keys) and they render today; this file pins the one that was NOT a
 * grammar question and was the only one that failed with **zero diagnostics** —
 * declaring no `columns` at all and expecting the block's defaults.
 *
 * ## Why this file goes through the REAL grid
 *
 * `ListView.unauthoredColumnProjection-6598.test.tsx` pins the handoff — what
 * this component feeds the child grid — against a stub. That is the mechanism,
 * and it is not the symptom: the symptom is a `<th>` count, and it emerges from
 * ListView and ObjectGrid disagreeing about how "unauthored" is spelled. A stub
 * cannot see a disagreement it is standing in for. So this file mounts the real
 * page renderer, the real html-tier compile, the real `list-view` registration
 * and the real `object-grid`, and counts headers.
 *
 * Registered in `heavyDomTests` for the setup's `@object-ui/plugin-grid`
 * side-effect registration, the same route
 * `ListView.crossPageSelectAll.test.tsx` takes — a plugin-list → plugin-grid
 * import would be the heavier change.
 *
 * ⚠️ The assertions are deliberately "which business columns are present", not
 * an exact header list. When the grid owns the fetch it derives defaults from
 * the object schema (hidden and readonly system-managed fields dropped); when a
 * host like ListView owns it, the grid takes its inline-data branch and derives
 * them from the row payload's keys instead. That precedence is a separate,
 * open question against `packages/plugin-grid` and it moves the exact list —
 * it must not be able to move whether the page shows data columns at all.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import '../index';

const OBJECT = 'opportunity';

const dataSource = {
  find: async () => ({
    data: [
      { id: 'o-1', name: 'Acme expansion', amount: 1000, stage: 'new' },
      { id: 'o-2', name: 'Globex renewal', amount: 2000, stage: 'won' },
    ],
    total: 23,
    hasMore: true,
  }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  count: async () => 23,
  getObjectSchema: async (name: string) => ({
    name,
    label: 'Opportunity',
    fields: {
      id: { type: 'text', label: 'Id', hidden: true },
      name: { type: 'text', label: 'Opportunity Name' },
      stage: { type: 'text', label: 'Stage' },
      amount: { type: 'currency', label: 'Amount' },
    },
  }),
  getObjects: async () => [],
  onMutation: () => () => {},
} as any;

async function renderHtmlPage(source: string) {
  const { container } = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={{ type: 'page', kind: 'html', name: 'columns_page', source } as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
  return container;
}

const headersOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('th')).map((th) => (th.textContent || '').trim());

describe("kind:'html' page — <list-view> renders data columns (#6598)", () => {
  it('renders the object\'s default columns when the author declared none', async () => {
    const container = await renderHtmlPage(`<list-view data={{provider:'object',object:'${OBJECT}'}} />`);

    await waitFor(() => expect(headersOf(container).length).toBeGreaterThan(1));
    const headers = headersOf(container);
    // Before: exactly ['#'] — the reporter's "only the index column", with no
    // diagnostic anywhere, because ListView spelled "unauthored" as `fields: []`
    // and that pinned the grid's projection at zero.
    expect(headers).toContain('Opportunity Name');
    expect(headers).toContain('Amount');
    // The page still fetched all along — rows were never the problem.
    expect(container.textContent).toContain('23 records');
  });

  it('renders exactly the authored columns when the author declared them', async () => {
    // The single-quoted array is the spelling every JSX author reaches for
    // first, and the one objectui#6669 made legal; it is the control that keeps
    // the default above from swallowing an authored projection.
    const container = await renderHtmlPage(
      `<list-view data={{provider:'object',object:'${OBJECT}'}} columns={['name','amount']} />`,
    );

    await waitFor(() => expect(headersOf(container).length).toBeGreaterThan(1));
    const headers = headersOf(container);
    expect(headers).toEqual(['#', 'Opportunity Name', 'Amount']);
    expect(headers).not.toContain('Stage');
  });
});
