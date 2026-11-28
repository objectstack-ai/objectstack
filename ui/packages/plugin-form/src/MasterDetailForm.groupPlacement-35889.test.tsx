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
    expect(placed.closest('[data-form-slot]')!.closest('form')).toBe(header.closest('form'));
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

  it('a placed collection\'s controls are not the header form\'s: no native validation, no submit from a line button', async () => {
    const ds = makeDataSource(parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]));
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details } as any} dataSource={ds} />,
    );
    await waitFor(() => {
      if (!container.querySelector('[data-form-slot] [data-testid="md-collection"] button')) throw new Error('not placed');
    });
    const header = container.querySelector('[data-form-section="__section_header"]')!.closest('form')!;
    const slot = container.querySelector('[data-form-slot]')!;
    const controls = [...slot.querySelectorAll('input, select, textarea, button')] as HTMLInputElement[];
    expect(controls.length).toBeGreaterThan(0);
    // `requestSubmit()` validates, and a submit button submits, only the
    // controls the form owns.
    for (const control of controls) expect(control.form).not.toBe(header);

    const submitted = vi.fn();
    header.addEventListener('submit', submitted);
    for (const button of slot.querySelectorAll('button')) fireEvent.click(button);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('an expanded row editor opens in the slot beside its collection, a form of its own, with no nesting warning', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parent = parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]);
    const child = { name: 'po_line', fields: { qty: { type: 'number', label: 'Qty' }, note: { type: 'text', label: 'Note' }, po: { type: 'master_detail', label: 'PO', reference: 'po' } } };
    const ds = makeDataSource(parent, {
      getObjectSchema: vi.fn(async (object: string) => (object === 'po_line' ? child : parent)),
      findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-7', memo: 'm' }),
      find: vi.fn().mockImplementation((object: string) =>
        Promise.resolve({ data: object === 'po_line' ? [{ id: 'l1', po: 'po1', qty: 3, note: 'n' }] : [] }),
      ),
    });
    const withEditor = [{ ...details[0], formFields: ['qty', 'note'] }];
    const { container } = render(
      <MasterDetailForm schema={{ objectName: 'po', mode: 'edit', recordId: 'po1', details: withEditor } as any} dataSource={ds} />,
    );
    const expand = await waitFor(() => {
      const el = container.querySelector('[data-form-slot] [data-testid="line-items-expand-0"]') as HTMLElement | null;
      if (!el) throw new Error('no expand in the placed collection');
      return el;
    });
    fireEvent.click(expand);
    const editor = await waitFor(() => {
      const el = container.querySelector('[data-testid="md-row-form"]') as HTMLElement | null;
      if (!el || !el.querySelector('input')) throw new Error('editor not open');
      return el;
    });
    const header = container.querySelector('[data-form-section="__section_header"]')!.closest('form')!;
    expect(editor.closest('[data-form-slot]')).toBe(container.querySelector('[data-form-slot]'));
    for (const input of editor.querySelectorAll('input')) {
      expect((input as HTMLInputElement).form).not.toBe(header);
      expect(editor.contains((input as HTMLInputElement).form)).toBe(true);
    }
    const nesting = errors.mock.calls.filter((call) => /cannot be a descendant of|cannot contain a nested|validateDOMNesting/i.test(call.map(String).join(' ')));
    expect(nesting).toEqual([]);
    errors.mockRestore();
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

describe('MasterDetailForm — a refused save marks the tab of the placed lines it was refused on', () => {
  const tabbed = {
    objectName: 'po',
    mode: 'edit',
    recordId: 'po1',
    formType: 'tabbed',
    sections: [
      { name: 'header', label: 'Header', fields: ['ref'] },
      { name: 'totals', label: 'Totals', fields: ['memo'] },
    ],
    details,
  };
  const refusal = (field: string, failedOperation?: { index: number; object: string }) =>
    Object.assign(new Error(`${field} is not valid`), {
      details: { code: 'VALIDATION_FAILED', fields: [{ field, message: `${field} is not valid` }], ...(failedOperation ? { failedOperation } : {}) },
    });

  async function saveRefusedWith(err: Error) {
    const parent = parentWith([HEADER_GROUP, LINES_GROUP, TOTALS_GROUP]);
    const child = { name: 'po_line', fields: { qty: { type: 'number', label: 'Qty' }, po: { type: 'master_detail', label: 'PO', reference: 'po' } } };
    const batchTransaction = vi.fn().mockRejectedValue(err);
    const ds = makeDataSource(parent, {
      batchTransaction,
      getObjectSchema: vi.fn(async (object: string) => (object === 'po_line' ? child : parent)),
      findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-7', memo: 'm' }),
      find: vi.fn().mockImplementation((object: string) =>
        Promise.resolve({ data: object === 'po_line' ? [{ id: 'l1', po: 'po1', qty: 3 }] : [] }),
      ),
    });
    const { container } = render(<MasterDetailForm schema={tabbed as any} dataSource={ds} />);
    const qty = await waitFor(() => {
      const el = [...container.querySelectorAll('[data-form-slot] [data-testid="md-collection"] input')]
        .find((input) => (input as HTMLInputElement).value === '3') as HTMLInputElement | undefined;
      if (!el) throw new Error('lines not placed');
      return el;
    });
    fireEvent.change(qty, { target: { value: '4' } });
    fireEvent.change(container.querySelector('input[name="ref"]') as HTMLInputElement, { target: { value: 'PO-8' } });
    fireEvent.click(screen.getByTestId('md-form-submit'));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    return container;
  }

  it('a field only a line writes: the lines tab is marked, the header tab is not', async () => {
    await saveRefusedWith(refusal('qty'));
    await waitFor(() => expect(screen.getByTestId('form-tab:lines').getAttribute('data-error')).toBe('true'));
    expect(screen.getByTestId('form-tab:header').hasAttribute('data-error')).toBe(false);
  });

  it('the operation the server names as failed: a line op marks the lines tab', async () => {
    await saveRefusedWith(refusal('anything', { index: 1, object: 'po_line' }));
    await waitFor(() => expect(screen.getByTestId('form-tab:lines').getAttribute('data-error')).toBe('true'));
  });

  it('control: a refusal on the header\'s own field marks its tab and leaves the lines tab unmarked', async () => {
    await saveRefusedWith(refusal('ref'));
    await waitFor(() => expect(screen.getByTestId('form-tab:header').getAttribute('data-error')).toBe('true'));
    expect(screen.getByTestId('form-tab:lines').hasAttribute('data-error')).toBe(false);
  });
});
