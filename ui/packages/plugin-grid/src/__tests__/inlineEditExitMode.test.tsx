/**
 * Exiting inline edit mode for host-injected widget editors (objectui#2321).
 *
 * The ObjectGrid injects the dedicated @object-ui/fields widget for each field
 * type (text, number, date, lookup, …) as the in-cell editor. Non-discrete
 * types stage their value on every change and used to have NO way to leave edit
 * mode — click-outside, Enter, and the Save button all failed to dismiss the
 * editor, leaving the cell permanently stuck showing the widget.
 *
 * These tests drive the real DataTable ← ObjectGrid path against an in-memory
 * fake server and assert the editor actually exits (its <input> / trigger is
 * gone) while the staged value is preserved (or reverted, for Escape).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

// objectstack#27365 — an editable grid asks the record-grained `update`
// verdict for the rows on screen even with no kebab Edit wired. Answer it from
// the double (every row permitted), never the network.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix popover uses pointer capture; jsdom lacks these.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
});

const OBJECT = 'os_widget_zoo';

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Row One', qty: 10 },
    r2: { id: 'r2', name: 'Row Two', qty: 20 },
  };
  const users: Record<string, any> = {
    u1: { id: 'u1', name: 'Dev Admin' },
    u2: { id: 'u2', name: 'Team Lead' },
  };
  const find = vi.fn(async (object: string) => {
    const src = object === 'users' ? users : store;
    const data = Object.values(src).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const findOne = vi.fn(async (object: string, id: string) => {
    const src = object === 'users' ? users : store;
    return src[id] ? { ...src[id] } : null;
  });
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  return {
    store,
    find,
    findOne,
    update,
    getObjectSchema: async (name: string) => {
      if (name === 'users') {
        return { name, fields: { id: { type: 'text' }, name: { type: 'text' } } };
      }
      return {
        name,
        fields: {
          id: { type: 'text' },
          name: { type: 'text', label: 'Name' },
          qty: { type: 'number', label: 'Qty' },
          manager: { type: 'lookup', label: 'Manager', reference: 'users' },
        },
      };
    },
  } as any;
}

function renderGrid(ds: any, columns: any[]) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns,
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <div>
          <button data-testid="outside">outside</button>
          <ObjectGrid schema={schema} dataSource={ds} />
        </div>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Find the <td> in `row` whose displayed text matches exactly. */
const cellByText = (row: HTMLElement, text: string) =>
  Array.from(row.querySelectorAll('td')).find(
    (td) => td.textContent?.trim() === text,
  ) as HTMLElement;

const firstRow = (container: HTMLElement) =>
  container.querySelector('tbody tr') as HTMLElement;

describe('ObjectGrid — injected text/number editor exits edit mode', () => {
  const textCols = [
    { field: 'name', label: 'Name', type: 'text' },
    { field: 'qty', label: 'Qty', type: 'number' },
  ];

  it('click-outside commits the staged value and exits edit mode (text)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, textCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const nameTd = cellByText(firstRow(container), 'Row One');
    fireEvent.click(nameTd);

    const input = await waitFor(() => {
      const el = nameTd.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: 'Row One EDITED' } });

    // Click truly outside the editor.
    fireEvent.pointerDown(screen.getByTestId('outside'));

    // Editor is gone…
    await waitFor(() => expect(nameTd.querySelector('input')).toBeNull());
    // …and the staged value remains (pending change).
    expect(within(nameTd).getByText('Row One EDITED')).toBeInTheDocument();
  });

  it('Enter commits the staged value and exits edit mode (number)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, textCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const qtyTd = cellByText(firstRow(container), '10');
    fireEvent.click(qtyTd);

    const input = await waitFor(() => {
      const el = qtyTd.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(qtyTd.querySelector('input')).toBeNull());
    expect(within(qtyTd).getByText('42')).toBeInTheDocument();
  });

  it('Escape reverts the staged value and exits edit mode (text)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, textCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const nameTd = cellByText(firstRow(container), 'Row One');
    fireEvent.click(nameTd);

    const input = await waitFor(() => {
      const el = nameTd.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: 'discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(nameTd.querySelector('input')).toBeNull());
    // Reverted to the original value — no pending change left behind.
    expect(within(nameTd).getByText('Row One')).toBeInTheDocument();
    expect(within(nameTd).queryByText('discard me')).toBeNull();
  });

  it('a staged injected edit persists through Save All after exiting', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, textCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const nameTd = cellByText(firstRow(container), 'Row One');
    fireEvent.click(nameTd);
    const input = await waitFor(() => {
      const el = nameTd.querySelector('input') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: 'Row One SAVED' } });
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(nameTd.querySelector('input')).toBeNull());

    const saveAll = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        /Save All|全部保存/.test(b.textContent || ''),
      ) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      return btn;
    });
    fireEvent.click(saveAll);

    // The fourth argument is the save's write options: this fixture's rows carry
    // no `updated_at`, so no `ifMatch` is sent (objectui#12292).
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { name: 'Row One SAVED' }, undefined));
    expect(ds.store.r1.name).toBe('Row One SAVED');
  });
});

describe('ObjectGrid — injected lookup editor exits edit mode', () => {
  const lookupCols = [
    { field: 'name', label: 'Name', type: 'text', editable: false },
    { field: 'manager', label: 'Manager', type: 'lookup' },
  ];

  // objectstack#35688 S3: the cell's lookup editor IS the candidate list (no
  // trigger to press first), and a single pick is the whole edit. These two
  // cases used to pin the popover era (pick stages, click-outside commits; Enter
  // on the trigger opens the dropdown); they now pin the in-cell list and
  // the click-outside guard around it.
  it('a pick in the in-cell list is the whole edit: the value lands and the editor closes', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, lookupCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const managerTd = () => {
      const row = firstRow(container);
      const tds = Array.from(row.querySelectorAll('td'));
      return tds[tds.length - 1] as HTMLElement; // manager is the last data column
    };
    const panel = () => managerTd().querySelector('[data-testid="lookup-in-cell"]') as HTMLElement | null;

    // Enter edit mode: the list is open at once, inside the cell.
    fireEvent.click(managerTd());
    await waitFor(() => expect(panel()).toBeTruthy());

    const option = await waitFor(() => within(panel()!).getByText('Dev Admin'));
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    // The editor closed on the pick, and the cell shows the picked record.
    await waitFor(() => expect(panel()).toBeNull());
    expect(within(managerTd()).getByText('Dev Admin')).toBeInTheDocument();
  });

  it('a press inside the open list does not exit edit mode; a press outside does', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, lookupCols);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());

    const managerTd = () => {
      const row = firstRow(container);
      const tds = Array.from(row.querySelectorAll('td'));
      return tds[tds.length - 1] as HTMLElement;
    };
    const panel = () => managerTd().querySelector('[data-testid="lookup-in-cell"]') as HTMLElement | null;

    fireEvent.click(managerTd());
    await waitFor(() => expect(panel()).toBeTruthy());

    // The click-outside guard treats the editor's own content as inside: a
    // press on the list's search box keeps the editor.
    const search = panel()!.querySelector('input') as HTMLInputElement;
    fireEvent.pointerDown(search);
    fireEvent.click(search);
    expect(panel()).toBeTruthy();

    // CONTROL — a press truly outside exits.
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(panel()).toBeNull());
  });
});
