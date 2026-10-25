/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10881 — a grouped grid over a data source with no group header
 * query REFUSES grouping, and rows handed in whole still group exactly.
 *
 * Maintainer ruling F: grouping is a property of the query (ruling A on
 * objectui#7189), so a data source that cannot answer the group header query
 * (`DataSource.queryGroupHeaders`) cannot group. A grid that fetches its own
 * rows over such a source used to fetch one window and bucket it — on the
 * 186-row, five-unit fixture below with a 100-row page, two headers (86, 14)
 * and three units missing — and mark the counts "Partial". It now renders an
 * error panel naming `queryGroupHeaders` and asks for no rows at all.
 *
 * Kept, and pinned here beside it: rows handed in whole — a page schema's
 * `value` provider, or a parent view's `data` — are grouped in the browser,
 * where the counts are exact because nothing was withheld.
 *
 * Every refusal pin has a lit control: the SAME find-only source, ungrouped,
 * is queried and draws its rows (so "no row query" is a measurement, not a
 * harness that never queries), and the same grouping over a source that
 * declares the member is not refused.
 *
 * The second refusal (patch round 2, the seat's decision B): rows a host
 * hands in while DECLARING them one page of more — `manualPagination` with a
 * `rowCount` above the rows handed — are a window, not whole rows, and a
 * grouped grid refuses them with a sentence of its own. On the fixture's first
 * 100 rows with `rowCount: 186` the grid used to draw two groups (86, 14),
 * three units missing, and nothing saying so. Its controls: the same host
 * declaring `rowCount` equal to the rows it handed, and a host declaring no
 * `rowCount` at all, both group as whole rows.
 *
 * Also here, re-homed from the retired `groupedPartialDisclosure-7189` file:
 * grouping never reaches the mobile card view (`useCardView` requires
 * `!isGrouped`), with the ungrouped mobile render as its lit control.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'duly_task';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  business_unit: { type: 'text', label: 'Business Unit' },
};

/** 186 rows over five units sized 86/61/31/7/1, stored contiguously. */
const UNITS: Array<[string, number]> = [
  ['Northgate Operations', 86],
  ['Northgate Plant', 61],
  ['Northgate Quality', 31],
  ['Riverside Plant', 7],
  ['Riverside Depot', 1],
];
const EXPECTED: Record<string, number> = Object.fromEntries(UNITS);
const ROWS = UNITS.flatMap(([unit, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${unit}-${i}`, subject: `${unit} #${i}`, business_unit: unit })),
);

/** A data source that can only `find` — no `queryGroupHeaders`. */
const makeFindOnlyDataSource = () => ({
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const skip = (params.$skip as number | undefined) ?? 0;
    const top = (params.$top as number | undefined) ?? ROWS.length;
    return { data: ROWS.slice(skip, skip + top), total: ROWS.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

const GROUPING = { fields: [{ field: 'business_unit' }] };

const renderGrid = (dataSource: unknown, schemaExtra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['subject'],
          pagination: { pageSize: 100 },
          ...schemaExtra,
        } as any}
        dataSource={dataSource as any}
        {...props}
      />
    </ActionProvider>,
  );

/** Let the load effect run to its end: the schema read, then whatever follows it. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const refusal = () => screen.queryByTestId('grid-grouping-needs-header-query');
const wholeRowsRefusal = () => screen.queryByTestId('grid-grouping-needs-whole-rows');

/** The host-driven paging props (`ObjectGridExternalPaginationProps`) declaring `rowCount`. */
const hostPaging = (rowCount: number) => ({
  manualPagination: true,
  rowCount,
  page: 1,
  pageSize: 100,
  onPageChange: vi.fn(),
});
const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const headerCounts = () => Object.fromEntries(groupRows().map((row) => [
  row.querySelector('.group-label')?.textContent ?? '',
  Number(row.querySelector('.group-count')?.textContent ?? NaN),
]));

afterEach(() => cleanup());

describe('ObjectGrid refuses grouping over a data source with no header query (objectui#10881)', () => {
  it('renders the refusal naming queryGroupHeaders, and issues no row query', async () => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds, { grouping: GROUPING });

    await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await settle();

    const panel = refusal();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel!.textContent).toContain('queryGroupHeaders');
    expect(ds.find).not.toHaveBeenCalled();
    expect(groupRows()).toHaveLength(0);
  });

  // CONTROL — the same source is queried, and draws, when nothing is grouped.
  it('CONTROL — the same find-only source, ungrouped, is queried and draws its rows', async () => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds);

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(screen.getByText('Northgate Operations #0')).toBeInTheDocument());
    expect(refusal()).not.toBeInTheDocument();
  });

  // CONTROL — the refusal keys on the member, not on grouping.
  it('CONTROL — the same grouping over a source that declares queryGroupHeaders is not refused', async () => {
    const ds = {
      ...makeFindOnlyDataSource(),
      queryGroupHeaders: vi.fn(async () => UNITS.map(([business_unit, count]) => ({ business_unit, count }))),
    };
    renderGrid(ds, { grouping: GROUPING });

    await vi.waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(refusal()).not.toBeInTheDocument();
  });
});

describe('rows handed in whole still group in the browser, exactly (objectui#10881)', () => {
  it.each([
    ['a page schema (`value` provider)', { data: { provider: 'value', items: ROWS } }, {}],
    ['a parent view (`data` prop)', {}, { data: ROWS }],
  ])('%s: five headers reading 86/61/31/7/1 over a find-only source, no refusal, no query', async (_name, schemaExtra, props) => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds, { grouping: GROUPING, ...schemaExtra }, props);

    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(headerCounts()).toEqual(EXPECTED);
    expect(refusal()).not.toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });
});

describe('a host-declared window is refused too, with its own sentence (objectui#10881, round 2)', () => {
  it('100 rows handed with rowCount 186: the refusal, no group drawn, no query', async () => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds, { grouping: GROUPING }, { data: ROWS.slice(0, 100), ...hostPaging(ROWS.length) });

    await vi.waitFor(() => expect(wholeRowsRefusal()).toBeInTheDocument());
    await settle();
    const panel = wholeRowsRefusal()!;
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel.textContent).toMatch(/every record/i);
    // Not the header-query refusal: the host owns this fetch.
    expect(refusal()).not.toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('refuses the same window over a source that DOES declare queryGroupHeaders', async () => {
    const ds = {
      ...makeFindOnlyDataSource(),
      queryGroupHeaders: vi.fn(async () => UNITS.map(([business_unit, count]) => ({ business_unit, count }))),
    };
    renderGrid(ds, { grouping: GROUPING }, { data: ROWS.slice(0, 100), ...hostPaging(ROWS.length) });

    await vi.waitFor(() => expect(wholeRowsRefusal()).toBeInTheDocument());
    await settle();
    expect(groupRows()).toHaveLength(0);
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });

  // CONTROL — whole rows under the same props: rowCount equals the rows handed.
  it('CONTROL — 186 rows handed with rowCount 186 still group exactly: 86/61/31/7/1', async () => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds, { grouping: GROUPING }, { data: ROWS, ...hostPaging(ROWS.length) });

    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(headerCounts()).toEqual(EXPECTED);
    expect(wholeRowsRefusal()).not.toBeInTheDocument();
  });

  // CONTROL — no rowCount declared: the rows are the whole set, as handed.
  it('CONTROL — 100 rows handed with no rowCount group as handed, unrefused', async () => {
    const ds = makeFindOnlyDataSource();
    renderGrid(ds, { grouping: GROUPING }, { data: ROWS.slice(0, 100) });

    await vi.waitFor(() => expect(groupRows()).toHaveLength(2));
    expect(headerCounts()).toEqual({ 'Northgate Operations': 86, 'Northgate Plant': 14 });
    expect(wholeRowsRefusal()).not.toBeInTheDocument();
  });
});

describe('a masked-only grouping key shows loading, never an error it withdraws (objectui#10881, round 2)', () => {
  it('while the object definition is in flight: the spinner, not the refusal; then the flat rows', async () => {
    // ONE definition read in flight, answered once: every call (the load
    // effect re-runs when the grouping flips) waits on the same answer.
    let answer!: (value: unknown) => void;
    const definition = new Promise((resolve) => { answer = resolve; });
    const ds = {
      ...makeFindOnlyDataSource(),
      getObjectSchema: vi.fn(() => definition),
    };
    renderGrid(ds, { grouping: { fields: [{ field: 'secret' }] } });

    await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await settle();
    // The key's type is not known yet, so the grouping still counts as one.
    expect(refusal()).not.toBeInTheDocument();
    expect(screen.getByText('Loading grid…')).toBeInTheDocument();

    // It is a masked type: no grouping at all, so the flat window goes out.
    await act(async () => {
      answer({ name: OBJECT, fields: { ...OBJECT_FIELDS, secret: { type: 'password', label: 'Secret' } } });
    });
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(screen.getByText('Northgate Operations #0')).toBeInTheDocument());
    expect(refusal()).not.toBeInTheDocument();
    expect(groupRows()).toHaveLength(0);
  });
});

describe('grouping never reaches the mobile card view (re-homed from groupedPartialDisclosure-7189)', () => {
  const originalWidth = window.innerWidth;
  const setWidth = (value: number) =>
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value });
  afterEach(() => setWidth(originalWidth));

  it('a grouped grid under 768px draws its groups, not cards', async () => {
    setWidth(390);
    renderGrid(makeFindOnlyDataSource(), { grouping: GROUPING, data: { provider: 'value', items: ROWS } });

    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(document.querySelector('table')).not.toBeNull();
  });

  // CONTROL — the same rows ungrouped at the same width ARE the card view.
  it('CONTROL — the same rows ungrouped under 768px are drawn as cards, with no table', async () => {
    setWidth(390);
    renderGrid(makeFindOnlyDataSource(), { data: { provider: 'value', items: ROWS } });

    await vi.waitFor(() => expect(screen.getAllByText('Northgate Operations #0').length).toBeGreaterThan(0));
    expect(document.querySelector('table')).toBeNull();
    expect(groupRows()).toHaveLength(0);
  });
});
