import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

// objectstack#35889 — a master-detail collection a field group of the parent
// places (`fieldGroups[].relatedList`) is drawn at that group in the entry
// form, as the record page draws it: after the groups declared before it,
// before the groups declared after it. A collection no group places stays
// below the record's fields.

registerAllFields();

const LINES_GROUP = { key: 'lines', label: 'Lines', relatedList: 'po_line' };
function parentWith(fieldGroups: unknown[]) {
  return {
    name: 'po',
    fieldGroups,
    fields: {
      ref: { type: 'text', label: 'Ref', group: 'header' },
      memo: { type: 'text', label: 'Memo', group: 'totals' },
    },
  };
}
const HEADER_GROUP = { key: 'header', label: 'Header', fields: ['ref'] };
const TOTALS_GROUP = { key: 'totals', label: 'Totals', fields: ['memo'] };

function makeDataSource(parent: unknown, overrides: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(parent),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    ...overrides,
  } as any;
}

const details = [
  { childObject: 'po_line', relationshipField: 'po', title: 'Order lines', columns: [{ name: 'qty', label: 'Qty', type: 'number' } as any] },
];

/** Whether `a` comes before `b` in document order. */
function before(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

async function collection(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = container.querySelector('[data-testid="md-collection"]') as HTMLElement | null;
    if (!el) throw new Error('collection not drawn');
    return el;
  });
}

describe('MasterDetailForm — a group-placed collection sits at its group (objectstack#35889)', () => {
  it('simple form: between the sections of the groups around its group, inside the header form', async () => {
    const ds = makeDataSource(parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]));
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      const el = container.querySelector('[data-form-slot] [data-testid="md-collection"]');
      if (!el) throw new Error('collection not placed');
    });
    const placed = await collection(container);
    const header = container.querySelector('[data-form-section="__section_header"]')!;
    const totals = container.querySelector('[data-form-section="__section_totals"]')!;
    expect(header).toBeTruthy();
    expect(totals).toBeTruthy();
    expect(placed.closest('form')).toBe(header.closest('form'));
    expect(before(header, placed)).toBe(true);
    expect(before(placed, totals)).toBe(true);
    expect(placed.textContent).toContain('Order lines');
  });

  it('simple form: a collection no group places stays below the record fields', async () => {
    const ds = makeDataSource(parentWith([HEADER_GROUP, TOTALS_GROUP]));
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-form-section="__section_totals"]')) throw new Error('header not ready');
    });
    const below = await collection(container);
    expect(below.closest('form')).toBeNull();
    expect(container.querySelector('[data-form-slot]')).toBeNull();
    expect(before(container.querySelector('[data-form-section="__section_totals"]')!, below)).toBe(true);
  });

  it('a group placed last: after every declared group', async () => {
    const ds = makeDataSource(parentWith([HEADER_GROUP, TOTALS_GROUP, LINES_GROUP]));
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-form-slot] [data-testid="md-collection"]')) throw new Error('not placed');
    });
    const placed = await collection(container);
    expect(before(container.querySelector('[data-form-section="__section_totals"]')!, placed)).toBe(true);
  });

  it('edit form: the loaded record\'s lines are drawn at the group, and only there', async () => {
    const parent = parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]);
    const child = { name: 'po_line', fields: { qty: { type: 'number', label: 'Qty' }, po: { type: 'master_detail', label: 'PO', reference: 'po' } } };
    const ds = makeDataSource(parent, {
      getObjectSchema: vi.fn(async (object: string) => (object === 'po_line' ? child : parent)),
      findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-7', memo: 'm' }),
      find: vi.fn().mockImplementation((object: string) =>
        Promise.resolve({ data: object === 'po_line' ? [{ id: 'l1', po: 'po1', qty: 3 }] : [] }),
      ),
    });
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'edit', recordId: 'po1', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      const el = container.querySelector('[data-form-slot] [data-testid="md-collection"]');
      const values = el ? [...el.querySelectorAll('input')].map((input) => (input as HTMLInputElement).value) : [];
      if (!values.includes('3')) throw new Error('lines not placed');
    });
    const header = container.querySelector('[data-form-section="__section_header"]')!;
    const totals = container.querySelector('[data-form-section="__section_totals"]')!;
    const placed = container.querySelector('[data-form-slot] [data-testid="md-collection"]')!;
    expect(before(header, placed)).toBe(true);
    expect(before(placed, totals)).toBe(true);
    expect(container.querySelectorAll('[data-testid="md-collection"]')).toHaveLength(1);
  });

  it('saves the record and its lines in one batch from the placed table', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const ds = makeDataSource(parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]), { batchTransaction });
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-form-slot] [data-testid="md-collection"]')) throw new Error('not placed');
    });
    const ref = container.querySelector('input[name="ref"]') as HTMLInputElement;
    fireEvent.change(ref, { target: { value: 'PO-1' } });
    fireEvent.click(screen.getByTestId('md-form-submit'));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    const ops = batchTransaction.mock.calls[0][0] as Array<{ object?: string; objectName?: string; data?: any }>;
    expect(JSON.stringify(ops)).toContain('PO-1');
  });

  it('tabbed form: a tab of its own at its group, labelled with the group', async () => {
    const ds = makeDataSource(parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]));
    const { container } = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'create',
          formType: 'tabbed',
          sections: [
            { name: 'header', label: 'Header', fields: ['ref'] },
            { name: 'totals', label: 'Totals', fields: ['memo'] },
          ],
          details,
        } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-form-slot] [data-testid="md-collection"]')) throw new Error('not placed');
    });
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['Header', 'Lines', 'Totals']);
    const placed = await collection(container);
    const panel = placed.closest('[role="tabpanel"]') as HTMLElement;
    expect(panel).toBeTruthy();
    const label = panel.getAttribute('aria-labelledby');
    expect(label && document.getElementById(label)?.textContent?.trim()).toBe('Lines');
  });
});
