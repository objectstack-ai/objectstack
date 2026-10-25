/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9853 — one authored `pageSize` reaches THREE read points in this
 * component, and before this change they disagreed about a non-positive value.
 *
 * ## What the author suffers
 *
 * The flat display size read the value with `||`, so `0` was falsy and fell
 * through to a default; both seeds (the grouped one and the server-window one)
 * read it with `??`, so `0` survived as a real page size. The same declaration
 * therefore rendered a working table until the author added `grouping`, at
 * which point the grouped pager divided by it: no group reached the screen and
 * the page count read `Infinity`. The server window sent `$top: 0`.
 *
 * ## Why "refuse it" is not this file inventing a meaning
 *
 * `@objectstack/spec` already answers what `pageSize: 0` means. Its pagination
 * config declares the member `z.number().int().positive()` with a default, and
 * its own suite pins the refusal under the name `should reject zero pageSize`
 * (a sibling row pins the negative). The `limit` this block's
 * `ElementDataSourceMapping` lowers `pagination.pageSize` into is declared
 * `.positive()` too. So `0` is not a spelling with a meaning the renderer may
 * choose for; it is a value the contract refuses, and the renderer's job is to
 * say so instead of dividing by it.
 *
 * ## What is pinned, and why each site gets its own assertion
 *
 * A pin that reddens on one read point and tolerates the others is exactly the
 * shape this card was filed about, so all three are asserted separately:
 * the grouped seed by COUNTING GROUPS ON SCREEN, the server seed by reading the
 * `$top` that reached the data source, and the flat site by the diagnostic —
 * the flat site already fell back to its default before this change, so only
 * the loud half can be red-first there.
 *
 * Every refusal row is paired with a control that must NOT fire, so a pin that
 * is simply always-on cannot pass for a measurement.
 *
 * ## Test-source note
 *
 * `../ObjectGrid` is imported relatively and the root vitest config aliases
 * `@object-ui/*` to each package's `src`, so no build step stands between the
 * edit and the run (the standing arrangement `groupingProjection-7179.test.tsx`
 * records).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

/**
 * The display page size an undeclared grid falls back to — the protocol's,
 * read the way the renderer reads it (objectui#9853, ruling C-prime). Before
 * that ruling the flat fallback was a local ten.
 */
const DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

const OBJECT = 'duly_task';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  business_unit: { type: 'text', label: 'Business Unit' },
};

/** Seven rows over seven distinct units — the card's own group count. */
const UNITS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];
const ROWS = UNITS.map((unit, i) => ({
  id: `r-${i}`,
  subject: `Task ${i}`,
  business_unit: unit,
}));

const makeDataSource = (rows = ROWS) => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      calls.push(params);
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? rows.length;
      return { data: rows.slice(skip, skip + top), total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
};

const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const bodyText = () => document.body.textContent ?? '';

const renderGrid = async (props: Record<string, unknown>) => {
  const result = render(
    <ActionProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <ObjectGrid {...(props as any)} />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(document.querySelector('[data-testid]')).toBeTruthy());
  return result;
};

const gridSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: OBJECT,
  columns: ['subject'],
  ...extra,
});

// The seven rows handed in WHOLE: since objectui#10881 a grouped grid that
// fetches its own rows over a data source with no group header query refuses
// grouping, and the page of groups read here is the same on either path.
const groupedSchema = (extra: Record<string, unknown> = {}) =>
  gridSchema({
    grouping: { fields: [{ field: 'business_unit' }] },
    data: { provider: 'value', items: ROWS },
    ...extra,
  });

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const paginationWarnings = () =>
  warnings.filter((w) => w.includes('ObjectGrid pagination'));

describe('ObjectGrid — a non-positive authored page size is refused at every read point (objectui#9853)', () => {
  // ── SITE 1: THE GROUPED SEED, COUNTED ON SCREEN ─────────────────────────
  it('renders every group when the author declares `pagination.pageSize: 0` alongside `grouping`', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: groupedSchema({ pagination: { pageSize: 0 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    // Seven rows, seven distinct units, a default group page larger than
    // seven: every group is on screen. Before this change `groups.slice(0, 0)` put NONE
    // of them there.
    expect(
      groupRows().length,
      'the grouped view divided by the authored 0 and rendered no groups at all',
    ).toBe(UNITS.length);
  });

  it('never puts `Infinity` on screen for that same declaration', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: groupedSchema({ pagination: { pageSize: 0 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    // `Math.ceil(7 / 0)` is the page total the pager printed.
    expect(bodyText()).not.toContain('Infinity');
  });

  it('CONTROL — an authored group page of 2 still splits the seven groups', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: groupedSchema({ pagination: { pageSize: 2 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    // Without this row the pin above is consistent with a grid that ignores
    // the member entirely and always shows every group.
    expect(groupRows().length).toBe(2);
  });

  // ── SITE 2: THE SERVER WINDOW, READ OFF THE WIRE ────────────────────────
  it('never sends `$top: 0` to the data source', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: gridSchema({ pagination: { pageSize: 0 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    const tops = ds.calls.map((p) => p.$top);
    expect(tops.length).toBeGreaterThan(0);
    expect(
      tops,
      'the fetch window took the authored 0 and asked the server for nothing',
    ).not.toContain(0);
    for (const top of tops) expect(top).toBeGreaterThan(0);
  });

  it('CONTROL — an authored page size of 3 does reach the wire as `$top`', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: gridSchema({ pagination: { pageSize: 3 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    // Without this row, "never 0" is satisfied by a grid that ignores the
    // member and always sends its own default.
    expect(ds.calls.map((p) => p.$top)).toContain(3);
  });

  // ── SITE 3: THE FLAT SITE, WHICH ONLY THE DIAGNOSTIC CAN REDDEN ─────────
  it('says so, once, naming the member and the value it refused', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: gridSchema({ pagination: { pageSize: 0 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(paginationWarnings().length).toBeGreaterThan(0));
    const message = paginationWarnings()[0];
    // The flat read point fell back to its default before this change too —
    // silently. The diagnostic is the only half of this site that can be
    // red-first, and it is what turns a quiet substitution into a signal.
    expect(message).toContain('pageSize');
    expect(message).toContain('0');
  });

  it('CONTROL — a valid page size produces no such diagnostic', async () => {
    const ds = makeDataSource();
    await renderGrid({
      schema: gridSchema({ pagination: { pageSize: 5 } }),
      dataSource: ds,
    });

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    // An always-on marker states nothing.
    expect(paginationWarnings()).toHaveLength(0);
  });

  it('CONTROL — declaring no pagination at all produces no diagnostic', async () => {
    const ds = makeDataSource();
    await renderGrid({ schema: gridSchema(), dataSource: ds });

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(paginationWarnings()).toHaveLength(0);
  });

  // ── SITE 3b: THE FLAT SIZE ITSELF, ON THE CHANNEL WHERE IT IS LIVE ──────
  //
  // ⚠️ The rows above cannot redden this site. For `0` the discarded `||`
  // spelling already produced the same 10 the resolver produces, so an
  // ablation of the flat read point passes every assertion written for `0` —
  // measured, and recorded in the PR body. What the two spellings actually
  // disagree about at this site is a TRUTHY invalid value: `-10 || 10` is
  // `-10` and `25.5 || 10` is `25.5`, both of which the old spelling passed
  // straight through to the table. These rows are that disagreement, read off
  // the rendered rows.
  //
  // The channel matters: the flat size is the table's live page size only when
  // `manualPaginationOn` is false, which is what inline `data` gives.
  //
  // Ten rows past the display default, so it leaves a second page and a
  // refused value that slipped through would show a different count.
  const INLINE_ROWS = Array.from({ length: DISPLAY_DEFAULT + 10 }, (_, i) => ({
    id: String(i + 1),
    name: `Row ${String(i + 1).padStart(2, '0')}`,
    status: 'open',
  }));

  const renderInline = (opts: Record<string, unknown>) =>
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'task',
            columns: [
              { field: 'name', label: 'Name' },
              { field: 'status', label: 'Status' },
            ],
            data: { provider: 'value', items: INLINE_ROWS },
            ...opts,
          } as any}
        />
      </ActionProvider>,
    );

  const bodyRows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('tbody tr'));

  it('a negative page size does not reach the flat table', async () => {
    const { container } = renderInline({ pagination: { pageSize: -10 } });
    await vi.waitFor(() => expect(bodyRows(container).length).toBeGreaterThan(0));
    // The display default plus ten rows: a full first page and a second one.
    expect(bodyRows(container)).toHaveLength(DISPLAY_DEFAULT);
    expect(paginationWarnings().length).toBeGreaterThan(0);
  });

  it('a non-integer page size does not reach the flat table', async () => {
    // `12.5`, not the `25.5` this row used while the default was ten: a
    // fractional size next to the new default would slice to the same count
    // and stop telling the two spellings apart.
    const { container } = renderInline({ pagination: { pageSize: 12.5 } });
    await vi.waitFor(() => expect(bodyRows(container).length).toBeGreaterThan(0));
    // `12.5` is truthy, so the old spelling handed it to the table.
    expect(bodyRows(container)).toHaveLength(DISPLAY_DEFAULT);
    expect(paginationWarnings().length).toBeGreaterThan(0);
  });

  it('CONTROL — a valid flat page size still sizes the table', async () => {
    const { container } = renderInline({ pagination: { pageSize: 5 } });
    await vi.waitFor(() => expect(bodyRows(container).length).toBeGreaterThan(0));
    expect(bodyRows(container)).toHaveLength(5);
    expect(paginationWarnings()).toHaveLength(0);
  });

  // ── THE REST OF WHAT THE CONTRACT REFUSES ───────────────────────────────
  it('refuses a negative and a non-integer page size the same way', async () => {
    for (const bad of [-10, 25.5]) {
      const ds = makeDataSource();
      await renderGrid({
        schema: groupedSchema({ pagination: { pageSize: bad } }),
        dataSource: ds,
      });
      await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
      expect(groupRows().length, `pageSize: ${bad} reached the grouped pager`).toBe(
        UNITS.length,
      );
      expect(paginationWarnings().length).toBeGreaterThan(0);
      cleanup();
      warnings = [];
    }
  });

  it('reads the deprecated flat `pageSize` through the same refusal', async () => {
    const ds = makeDataSource();
    await renderGrid({ schema: groupedSchema({ pageSize: 0 }), dataSource: ds });

    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(0));
    // The shorthand is a second spelling of the same member, so it cannot be
    // the one that still divides by zero.
    expect(groupRows().length).toBe(UNITS.length);
    expect(paginationWarnings().length).toBeGreaterThan(0);
  });
});
