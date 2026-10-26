/**
 * [#5729] The grid consumes the platform's per-column sortability signal —
 * objectstack#10235's ruling A, downstream leg.
 *
 * The header used to offer a sort click on any column whose field type the
 * grid itself judged orderable. On a `formula` column that click was a lie:
 * the platform returned `asc` and `desc` in byte-identical order under a 200,
 * and since objectstack#9313/#10234 it refuses the same click loudly
 * (`400 INVALID_SORT`). The ruling's answer is that the PLATFORM says which
 * columns it will order by, on the metadata envelope, and the grid reads that
 * — it does not re-derive "virtual ⇒ unsortable" from the field's type.
 *
 * ORACLE, both directions, in the SAME render. A "no sort affordance"
 * assertion is trivially satisfied by a grid that renders no header at all, so
 * every negative cell here sits beside a positive control on the same table: a
 * sortable sibling column whose header is still clickable and still puts its
 * `$orderby` on the wire. The two upstream oracle objects are used as they
 * were measured — `crm_opportunity.expected_revenue` and
 * `showcase_project.budget_remaining`.
 *
 * AGREEMENT over hardcoding: the served projection each data source hands over
 * is produced by the platform's own `resolveObjectSortability`
 * (`@objectstack/spec/api`) — the resolver the REST layer serves it from — so
 * these cells follow the runtime's predicate rather than a copied table.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const TOTAL = 300;
const PAGE_SIZE = 50;

const OBJECTS: Record<string, any> = {
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      amount: { type: 'currency' },
      expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
    },
  },
  showcase_project: {
    name: 'showcase_project',
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      budget: { type: 'currency' },
      budget_remaining: { type: 'formula', expression: 'budget - spent' },
    },
  },
};

/**
 * A data source whose `getObjectSchema` answers the way the adapter now does:
 * the document, carrying the served projection. `servesSignal: false` models a
 * deployment older than objectstack#10235 — no projection at all.
 */
function makeDataSource(objectName: string, opts: { servesSignal?: boolean } = {}) {
  const doc = OBJECTS[objectName];
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(top, TOTAL - skip)) }, (_, i) => ({
      id: `id-${skip + i}`,
      name: `Row ${skip + i}`,
      amount: 100 + i,
      budget: 100 + i,
      expected_revenue: 42,
      budget_remaining: 42,
    }));
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL, pageSize: top };
  });
  return {
    find,
    getObjectSchema: async () => {
      const schema = JSON.parse(JSON.stringify(doc));
      if (opts.servesSignal !== false) {
        attachObjectSortability(schema, resolveObjectSortability(doc));
      }
      return schema;
    },
  } as any;
}

function renderGrid(objectName: string, columns: string[], opts: Record<string, any> = {}, dsOpts = {}) {
  const ds = makeDataSource(objectName, dsOpts);
  const schema: any = {
    type: 'object-grid',
    objectName,
    columns: columns.map((field) => ({ field, label: field })),
    pagination: { pageSize: PAGE_SIZE },
    ...opts,
  };
  const utils = render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} {...(opts.gridProps ?? {})} />
    </ActionProvider>,
  );
  return { ...utils, ds };
}

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.trim() === label,
  ) as HTMLElement;

/**
 * Whether this header offers a sort. Read off the affordance itself, not off a
 * prop: DataTable makes a sortable header `cursor-pointer` and paints a sort
 * icon, and does neither for `sortable: false`.
 */
const offersSort = (th: HTMLElement) => th.className.includes('cursor-pointer');

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

describe('#5729 oracle — the refusal cells become unofferable clicks', () => {
  it('crm_opportunity.expected_revenue offers no sort, while `amount` on the same grid still does', async () => {
    const { container, ds } = renderGrid('crm_opportunity', ['name', 'amount', 'expected_revenue']);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    // NEGATIVE: the platform refuses this column, so the click ceases to exist.
    expect(offersSort(headerCell(container, 'expected_revenue'))).toBe(false);
    // POSITIVE CONTROL, same render: without it "the click is gone" is also
    // true of a grid that rendered no headers.
    expect(offersSort(headerCell(container, 'amount'))).toBe(true);
    expect(offersSort(headerCell(container, 'name'))).toBe(true);

    // And the control's click still reaches the wire.
    fireEvent.click(headerCell(container, 'amount'));
    await waitFor(() =>
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'amount', order: 'asc' }]),
    );
  });

  it('clicking the refused header puts no $orderby on the wire at all', async () => {
    const { container, ds } = renderGrid('crm_opportunity', ['name', 'amount', 'expected_revenue']);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    const before = ds.find.mock.calls.length;

    fireEvent.click(headerCell(container, 'expected_revenue'));
    fireEvent.click(headerCell(container, 'expected_revenue'));

    // No refetch, and nothing ordered by the refused name.
    await waitFor(() => expect(lastFindParams(ds).$orderby).toBeUndefined());
    expect(ds.find.mock.calls.length).toBe(before);

    // Counter-probe in the same test: the identical gesture on the sortable
    // sibling DOES refetch, so the assertion above measures the withheld
    // affordance and not an inert grid.
    fireEvent.click(headerCell(container, 'amount'));
    await waitFor(() =>
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'amount', order: 'asc' }]),
    );
  });

  it('showcase_project.budget_remaining offers no sort, while `budget` on the same grid does', async () => {
    const { container } = renderGrid('showcase_project', ['name', 'budget', 'budget_remaining']);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    expect(offersSort(headerCell(container, 'budget_remaining'))).toBe(false);
    expect(offersSort(headerCell(container, 'budget'))).toBe(true);
  });

  it('withholds a column ABSENT from the projection — absence is a refusal, not a default', async () => {
    // The asymmetry a `!== false` test gets exactly backwards. `created_at` is
    // hard-admitted by the ingress gate but provisioned by nobody here, so the
    // projection has no entry for it; the platform has no sort behind the name.
    const { container } = renderGrid('crm_opportunity', ['name', 'amount', 'created_at']);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    expect(offersSort(headerCell(container, 'created_at'))).toBe(false);
    expect(offersSort(headerCell(container, 'amount'))).toBe(true);
  });
});

describe('#5729 scope item 2 — the personalization PUT never carries a refused column', () => {
  it('a RESTORED sort on a refused column is inert: no affordance, no emission', async () => {
    // The half-fix this leg exists to prevent: the header click is gone, but a
    // sort persisted before the signal existed is replayed out of stored view
    // state and rides into the next sort the host stores.
    const onSortChange = vi.fn();
    const ds = makeDataSource('crm_opportunity');
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'crm_opportunity',
            columns: [
              { field: 'name', label: 'name' },
              { field: 'amount', label: 'amount' },
              { field: 'expected_revenue', label: 'expected_revenue' },
            ],
            pagination: { pageSize: PAGE_SIZE },
          } as any}
          dataSource={ds}
          manualPagination
          rowCount={TOTAL}
          page={1}
          pageSize={PAGE_SIZE}
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
          sort={[{ field: 'expected_revenue', order: 'desc' }]}
          onSortChange={onSortChange}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    // The restore alone writes nothing back — a PUT here would re-persist the
    // refused column on every page load.
    expect(onSortChange).not.toHaveBeenCalled();
    // And the header it names offers no click to re-emit it with.
    expect(offersSort(headerCell(container, 'expected_revenue'))).toBe(false);
    fireEvent.click(headerCell(container, 'expected_revenue'));
    expect(onSortChange).not.toHaveBeenCalled();

    // POSITIVE CONTROL, same render: the sortable sibling still emits, so the
    // three assertions above are about the refused column and not about a
    // grid whose sort callback was never wired.
    fireEvent.click(headerCell(container, 'amount'));
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(onSortChange.mock.calls[0][0]).toEqual([{ field: 'amount', order: 'asc' }]);
    // Nothing the grid ever emits names the refused column.
    for (const [emitted] of onSortChange.mock.calls) {
      expect((emitted as any[]).some((s) => s.field === 'expected_revenue')).toBe(false);
    }
  });
});

describe('#5729 — a deployment that serves no signal is unchanged', () => {
  it('keeps today behaviour when the metadata response carried no projection', async () => {
    // `undefined` projection means "no signal was served", NOT "nothing is
    // sortable". Collapsing the two would blank every sort arrow in the
    // product against a backend older than objectstack#10235.
    const { container } = renderGrid(
      'crm_opportunity',
      ['name', 'amount', 'expected_revenue'],
      {},
      { servesSignal: false },
    );
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    expect(offersSort(headerCell(container, 'amount'))).toBe(true);
    expect(offersSort(headerCell(container, 'name'))).toBe(true);
    // The pre-existing withholding (bound to the same `@objectstack/spec`
    // storage set the platform computes its projection from) still stands.
    expect(offersSort(headerCell(container, 'expected_revenue'))).toBe(false);
  });
});
