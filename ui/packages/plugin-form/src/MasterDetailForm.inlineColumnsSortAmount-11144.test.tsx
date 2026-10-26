/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail child that declares its inline columns still gets the
 * derived sort field and amount field (objectui#11144).
 *
 * The resolve effect in `MasterDetailForm` used to split in two. A detail with
 * a relationship field AND an authored column set only hydrated the column
 * types; every other detail went through `deriveDetail`, which also picks the
 * line's sort field (a `position`-named field) and the amount field summed
 * into the running total. A child whose relationship field declares
 * `inlineColumns` takes the first branch, and nothing else can supply the two:
 * the spec has no inline sort-field key, and `attachInlineSubforms` carries
 * only `inlineColumns` (as `columns`) and `inlineAmountField` (as
 * `amountField`). So a line created or dragged in that grid carried no
 * `position`, and without `inlineAmountField` no running total rendered.
 *
 * The fixture is the showcase invoice line's shape: identity-only `{ name }`
 * columns, a `position` number field that is not a column, a computed currency
 * `amount`, and a header `tax_rate`, so the Subtotal / Tax / Total stack is
 * the running total under test. The subform is the object `attachInlineSubforms`
 * builds from such a relationship field (childObject, relationshipField,
 * inlineMode, title, columns), written out here because this package sits
 * below the app shell that owns that function.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PARENT = 'inv';
const PARENT_SCHEMA = {
  name: PARENT,
  fields: {
    ref: { type: 'text', label: 'Ref' },
    // Present so the Subtotal / Tax / Total stack renders once an entry has an
    // amount field.
    tax_rate: { type: 'number', label: 'Tax Rate' },
  },
};

/** The showcase invoice line's shape, trimmed to the fields the pins read. */
function lineSchema(extra: Record<string, unknown> = {}) {
  return {
    name: 'inv_line',
    fields: {
      invoice: { type: 'master_detail', label: 'Invoice', reference: PARENT, inlineEdit: 'grid' },
      // The grid stamps it on every change; it is never a column.
      position: { type: 'number', label: 'Position', defaultValue: 0 },
      description: { type: 'text', label: 'Description' },
      quantity: { type: 'number', label: 'Qty' },
      unit_price: { type: 'currency', label: 'Unit Price' },
      amount: { type: 'currency', label: 'Amount', expression: 'record.quantity * record.unit_price' },
      ...extra,
    },
  };
}

/** What `attachInlineSubforms` builds for a relationship field with identity-only `inlineColumns`. */
const INLINE_COLUMNS = {
  childObject: 'inv_line',
  relationshipField: 'invoice',
  inlineMode: 'grid',
  title: 'Line Items',
  columns: [{ name: 'description' }, { name: 'quantity' }, { name: 'unit_price' }, { name: 'amount' }],
};
/** The control: the same relationship field with no `inlineColumns` (the derive branch). */
const NO_INLINE_COLUMNS = {
  childObject: 'inv_line',
  relationshipField: 'invoice',
  inlineMode: 'grid',
  title: 'Line Items',
};

function dataSource(child: ReturnType<typeof lineSchema>) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => (obj === PARENT ? PARENT_SCHEMA : child)),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'inv1' }] }),
  };
}

/** Type into the given row's cell (the trailing ghost row materializes a new line). */
function typeCell(label: string, row: number, value: string) {
  const cell = screen.getAllByLabelText(label)[row] as HTMLInputElement;
  fireEvent.change(cell, { target: { value } });
}

interface Run {
  /** The child create operations the save sent, in order. */
  lines: Array<Record<string, unknown>>;
  /** The Subtotal line of the totals stack, or null when the stack is absent. */
  subtotal: string | null;
}

/**
 * Render, enter two lines (A: 2 x 5, B: 1 x 3), drag B above A, read the
 * totals stack, then save and return the line payloads.
 */
async function enterReorderAndSave(detail: Record<string, unknown>, child = lineSchema()): Promise<Run> {
  const ds = dataSource(child);
  const view = render(
    <MasterDetailForm
      schema={{ objectName: PARENT, mode: 'create', fields: ['ref', 'tax_rate'], details: [detail] } as never}
      dataSource={ds as never}
    />,
  );
  const ref = await waitFor(() => {
    const el = view.container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  });
  await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(1));

  typeCell('Description', 0, 'A');
  await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(2));
  typeCell('Qty', 0, '2');
  typeCell('Unit Price', 0, '5');
  typeCell('Description', 1, 'B');
  await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(3));
  typeCell('Qty', 1, '1');
  typeCell('Unit Price', 1, '3');

  // Drag line 2 (B) onto line 1 (A).
  const target = screen.getByTestId('line-items-drag-0').closest('tr')!;
  fireEvent.dragStart(screen.getByTestId('line-items-drag-1'));
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  await waitFor(() => expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).value).toBe('B'));

  // Enter the header's tax rate: its `change` is what the header scrape
  // listens for, so the stack's own trigger is in place before it is read.
  const rate = await waitFor(() => {
    const el = view.container.querySelector('input[name="tax_rate"]') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(rate, { target: { value: '10' } });
  // Null when the stack never renders: that absence is the defect under test,
  // so it is read as a value rather than thrown as a timeout.
  const subtotal = await waitFor(() => screen.getByTestId('md-subtotal').textContent?.trim() ?? '').catch(() => null);

  fireEvent.change(ref, { target: { value: 'INV-1' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
  const ops = ds.batchTransaction.mock.calls[0][0] as Array<{ object: string; data: Record<string, unknown> }>;
  return { lines: ops.filter((o) => o.object === 'inv_line').map((o) => o.data), subtotal };
}

describe('a master-detail child with authored inline columns derives its sort and amount fields (objectui#11144)', () => {
  it('the showcase-shaped subform stamps `position` on created and reordered lines, and shows the running total', async () => {
    const run = await enterReorderAndSave(INLINE_COLUMNS);
    // One comparison, so a failure shows both halves: the order the save
    // persists, and A (2 x 5) + B (1 x 3) summed from the derived `amount`.
    expect({ lines: run.lines.map((l) => [l.description, l.position]), subtotal: run.subtotal }).toEqual({
      lines: [
        ['B', 0],
        ['A', 1],
      ],
      subtotal: '13.00',
    });
  });

  it('CONTROL: the same child with no inline columns (the derive branch) behaves the same', async () => {
    const run = await enterReorderAndSave(NO_INLINE_COLUMNS);
    expect({ lines: run.lines.map((l) => [l.description, l.position]), subtotal: run.subtotal }).toEqual({
      lines: [
        ['B', 0],
        ['A', 1],
      ],
      subtotal: '13.00',
    });
  });

  it('an authored amount field (`inlineAmountField`) wins over the derived one', async () => {
    const run = await enterReorderAndSave({ ...INLINE_COLUMNS, amountField: 'unit_price' });
    // 5 + 3 from `unit_price`, not 10 + 3 from the derived `amount`.
    expect(run.subtotal).toBe('8.00');
    expect(run.lines.map((l) => l.position)).toEqual([0, 1]);
  });

  // There is no authored-sort-field row: a detail's `sortField` override was
  // retired by objectui#11070 round 9 (it had no writer in either repository
  // and no spec key), so the derived `position` above is the only sort field.
  // `__tests__/masterDetailDetailsMembers-8071.test.tsx` row 2c pins that a
  // `sortField` written on a detail is read by nothing.
});
