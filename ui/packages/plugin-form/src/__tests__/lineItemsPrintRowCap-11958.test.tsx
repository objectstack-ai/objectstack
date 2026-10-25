/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11958 — on a page that declares `print`, `record:line_items` does
 * not cut lines off at its row cap in silence.
 *
 * The contract review of card ① on objectstack#8346 named the gap: the panel
 * loads at most `limit` rows (500 when unset), and a printed document carrying
 * part of its lines with nothing on paper saying so is the failure the
 * printable block subset exists to prevent. On a print page (a
 * `PrintPageProvider` above the panel, which `PageRenderer` mounts for a page
 * whose `print` is an object) the read asks for one probe row past the cap and
 * for the count, and when the probe comes back the panel draws the cap's rows
 * and the shared row-ceiling note under them.
 *
 * Each case is paired with its control: off a print page the wire and the
 * panel are unchanged, and a print page whose lines fit the cap draws no note.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, PrintPageProvider } from '@object-ui/react';
// Registers `record:line_items`.
import '../index';

const COLUMNS = [{ name: 'qty', label: 'Qty', type: 'number' as const }];
const LIMIT = 2;

const panel = {
  type: 'record:line_items',
  childObject: 'invoice_line',
  relationshipField: 'invoice',
  parentId: 'inv-1',
  columns: COLUMNS,
  readonly: true,
  limit: LIMIT,
};

function makeAdapter(rows: number, total?: number) {
  return {
    find: vi.fn(async (_object: string, params: { $top?: number }) => ({
      data: Array.from({ length: Math.min(rows, params.$top ?? rows) }, (_, i) => ({ id: `l${i}`, qty: i + 1 })),
      ...(total === undefined ? {} : { total }),
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'invoice_line',
      fields: { qty: { name: 'qty', type: 'number', label: 'Qty' } },
    }),
  };
}

function renderPanel(adapter: ReturnType<typeof makeAdapter>, printing: boolean) {
  const tree = (
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={panel as never} />
    </SchemaRendererProvider>
  );
  return render(printing ? <PrintPageProvider value={{ paperSize: 'A4' }}>{tree}</PrintPageProvider> : tree);
}

const note = () => document.querySelector('[data-row-ceiling-note]');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('record:line_items on a print page — the row cap is named on paper, never silent (objectui#11958)', () => {
  it('asks for one probe row past the cap and for the count', async () => {
    const adapter = makeAdapter(7, 7);
    renderPanel(adapter, true);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][1]).toMatchObject({ $top: LIMIT + 1, $count: true });
  });

  it('CONTROL — off a print page the read is the cap alone, with no count', async () => {
    const adapter = makeAdapter(7, 7);
    renderPanel(adapter, false);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][1].$top).toBe(LIMIT);
    expect(adapter.find.mock.calls[0][1]).not.toHaveProperty('$count');
  });

  it('draws the cap’s rows and names both numbers when lines were cut off', async () => {
    renderPanel(makeAdapter(7, 7), true);
    await waitFor(() => expect(note()).not.toBeNull());
    expect(note()!.textContent).toContain(String(LIMIT));
    expect(note()!.textContent).toContain('7');
    // The probe row is not drawn: the grid shows exactly the cap.
    expect(document.querySelectorAll('tbody tr').length).toBe(LIMIT);
  });

  it('names the cap when the adapter reports no total', async () => {
    renderPanel(makeAdapter(7), true);
    await waitFor(() => expect(note()).not.toBeNull());
    expect(note()!.textContent).toContain(String(LIMIT));
  });

  it('CONTROL — a print page whose lines fit the cap draws no note', async () => {
    const adapter = makeAdapter(LIMIT, LIMIT);
    renderPanel(adapter, true);
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(LIMIT));
    expect(note()).toBeNull();
  });

  it('CONTROL — off a print page a cut-off read draws no note (unchanged behaviour)', async () => {
    renderPanel(makeAdapter(7, 7), false);
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBe(LIMIT));
    expect(note()).toBeNull();
  });
});
