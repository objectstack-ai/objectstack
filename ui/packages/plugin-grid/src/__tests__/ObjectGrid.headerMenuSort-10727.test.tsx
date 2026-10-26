/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10727 — through the real `ObjectGrid`, a column's header context
 * menu offers no sort the grid withholds from its header.
 *
 * `ObjectGrid` marks `sortable: false` on every column the server cannot
 * honestly order by (`withSortability`): a relational column (#3096) and an
 * unmaterialized `formula` column (#3950). The header obeyed; the `data-table`
 * context menu did not, and its Sort ascending became a refetch whose
 * `$orderby` named the withheld field. Measured before the fix, on a
 * deployment that serves no sortability projection (the pre-objectstack#10235
 * floor this grid still supports): the formula column's entry sent
 * `$orderby: [{ field: 'expected_revenue', order: 'asc' }]`, a platform that
 * answers `400 INVALID_SORT` refused it, and the rows were replaced by the
 * error; the lookup column's entry sent an `$orderby` naming `owner`.
 *
 * The data source below refuses the way the platform does, so a regression
 * shows up as the refusal it causes, not only as a menu entry.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

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

/** The fields a sort must never name: withheld by the grid, refused or meaningless on the server. */
const WITHHELD = ['expected_revenue', 'owner'];
/** What the platform refuses outright: an unmaterialized column. */
const REFUSED = new Set(['expected_revenue']);

/**
 * No `sortability` projection on the metadata (a backend older than
 * objectstack#10235), and a `find` that refuses a sort by an unmaterialized
 * column with the platform's `400 INVALID_SORT`.
 */
function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const orderBy: any[] = Array.isArray(params.$orderby) ? params.$orderby : [];
    const refused = orderBy.find((s) => REFUSED.has(s.field));
    if (refused) {
      throw Object.assign(new Error(`Cannot sort by '${refused.field}'`), {
        status: 400,
        code: 'INVALID_SORT',
      });
    }
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(top, TOTAL - skip)) }, (_, i) => ({
      id: `id-${skip + i}`,
      name: `Row ${skip + i}`,
      amount: 100 + i,
      expected_revenue: 42,
      owner: { id: `u${i}`, name: `User ${i}` },
    }));
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL, pageSize: top };
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        amount: { type: 'currency' },
        expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
        owner: { type: 'lookup', reference: 'user' },
      },
    }),
  } as any;
}

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find(
    (th) => th.textContent?.trim() === label,
  ) as HTMLElement;

const orderedFields = (ds: any): string[] =>
  ds.find.mock.calls.flatMap(([, params]: any[]) =>
    Array.isArray(params.$orderby) ? params.$orderby.map((s: any) => s.field) : [],
  );

describe('ObjectGrid — the header context menu offers no withheld sort (objectui#10727)', () => {
  it('the menu on a platform-unsortable column offers no sort, and no request names it', async () => {
    const ds = makeDataSource();
    // CONTROL: the data source refuses the way the platform does.
    await expect(
      ds.find('crm_opportunity', { $orderby: [{ field: 'expected_revenue', order: 'asc' }] }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_SORT' });
    ds.find.mockClear();

    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'crm_opportunity',
            columns: ['name', 'amount', 'expected_revenue', 'owner'].map((field) => ({ field, label: field })),
            pagination: { pageSize: PAGE_SIZE },
          } as any}
          dataSource={ds}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    const loaded = ds.find.mock.calls.length;

    for (const field of WITHHELD) {
      const th = headerCell(container, field);
      expect(th.className, `the ${field} header offers no sort`).not.toContain('cursor-pointer');
      fireEvent.contextMenu(th);
      const menu = screen.getByTestId('column-context-menu');
      expect(within(menu).queryByText('Hide column'), 'CONTROL: the menu opened').not.toBeNull();
      expect(within(menu).queryByText('Sort ascending'), `no Sort ascending on ${field}`).toBeNull();
      expect(within(menu).queryByText('Sort descending'), `no Sort descending on ${field}`).toBeNull();
      fireEvent.click(document.body);
    }

    expect(ds.find.mock.calls.length, 'the menus put nothing on the wire').toBe(loaded);
    expect(screen.getByText('Row 0'), 'the rows are still drawn').toBeInTheDocument();

    // POSITIVE CONTROL, same render: a sortable column's menu offers the sort
    // and it reaches the wire, so the absences above are about the withheld
    // columns and not about a menu that offers nothing.
    fireEvent.contextMenu(headerCell(container, 'amount'));
    fireEvent.click(within(screen.getByTestId('column-context-menu')).getByText('Sort ascending'));
    await waitFor(() =>
      expect(ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$orderby).toEqual([
        { field: 'amount', order: 'asc' },
      ]),
    );

    expect(orderedFields(ds).filter((f) => WITHHELD.includes(f)), 'no request named a withheld field').toEqual([]);
  });
});
