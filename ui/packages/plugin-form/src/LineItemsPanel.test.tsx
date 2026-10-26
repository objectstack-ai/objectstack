import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();

// One existing child line so load() populates `original` and an edit produces
// a diff. The panel edits details of an ALREADY-SAVED parent (parentId known),
// so there is never a $ref — children carry the parent id directly.
function makeDataSource(overrides: any = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue({ data: [{ id: 'l1', amount: 10 }] }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'newline', ...d })),
    update: vi.fn(async (_o: string, id: string, d: any) => ({ id, ...d })),
    delete: vi.fn(async () => true),
    ...overrides,
  } as any;
}

const schema = {
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  amountField: 'amount',
  totalField: 'total_amount',
  columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
} as any;

function renderPanel(ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <LineItemsPanel schema={schema} />
    </SchemaRendererProvider>,
  );
}

/** Wait for load() to finish, edit the first line's Amount → mark dirty. */
async function editFirstLine(to: string) {
  const cell = await waitFor(() => {
    const el = screen.getAllByLabelText('Amount')[0] as HTMLInputElement | undefined;
    if (!el) throw new Error('grid not ready');
    return el;
  });
  fireEvent.change(cell, { target: { value: to } });
}

describe('LineItemsPanel — save via batchTransaction (#2679)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds an edit batch (parent rollup as op 0 + child diff) and calls batchTransaction once', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [] });
    const ds = makeDataSource({ batchTransaction });
    renderPanel(ds);

    await editFirstLine('15');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0];
    // op 0 is the parent update carrying the rolled-up total (10 → 15).
    expect(ops[0]).toEqual({
      object: 'po',
      action: 'update',
      id: 'p1',
      data: { total_amount: 15 },
    });
    // The edited line is a child update carrying the parent FK directly.
    const childUpdate = ops.find((o: any) => o.object === 'po_line' && o.action === 'update');
    expect(childUpdate).toMatchObject({ id: 'l1', data: { po: 'p1', amount: 15 } });
  });

  it('still saves against an adapter without batchTransaction (emulation drives update primitives)', async () => {
    const ds = makeDataSource(); // no batchTransaction
    renderPanel(ds);

    await editFirstLine('20');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    // Emulation applies op 0 (parent rollup) and the child update via the
    // adapter's own update() primitive.
    await waitFor(() =>
      expect(ds.update).toHaveBeenCalledWith('po', 'p1', { total_amount: 20 }),
    );
    await waitFor(() =>
      expect(ds.update).toHaveBeenCalledWith('po_line', 'l1', expect.objectContaining({ po: 'p1', amount: 20 })),
    );
  });
});
