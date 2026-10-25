/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12664 — a `date` / `datetime` cell in the grid's inline editor
 * draws the platform date picker, and the typed day reaches the edit.
 *
 * Driven on the real `ObjectGrid` → `DataTable` → `renderCellEditor` path
 * against an in-memory data source (the network is the only fake). The picker
 * reads its locale-formatted text when its control loses focus (and on
 * Enter); it does not stage per keystroke. The cell seam used to commit
 * without that blur, and with the value from before the stage, so a typed day
 * was lost on Enter and on a click outside (measured on objectui#12642). The
 * seam now blurs the focused control before it commits, and commits the last
 * value staged.
 *
 * The text cell at the bottom is the CONTROL: a widget that stages on every
 * keystroke commits exactly as before, with no focus and so no blur at all.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

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

const OBJECT = 'os_task_12664';

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Row One', due: '2026-10-01', remind_at: null },
  };
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  return {
    store,
    update,
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_object: string, id: string) => (store[id] ? { ...store[id] } : null)),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        due: { type: 'date', label: 'Due' },
        remind_at: { type: 'datetime', label: 'Remind at' },
      },
    }),
  } as any;
}

const COLUMNS = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'due', label: 'Due', type: 'date' },
  { field: 'remind_at', label: 'Remind at', type: 'datetime' },
];

function renderGrid(ds: any, language?: string) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: COLUMNS,
    pagination: { pageSize: 50 },
  };
  const grid = (
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <div>
          <button data-testid="outside">outside</button>
          <ObjectGrid schema={schema} dataSource={ds} />
        </div>
      </SchemaRendererProvider>
    </ActionProvider>
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {grid}
      </I18nProvider>
    ) : (
      grid
    ),
  );
}

/** The data cells of the first row, in column order (utility cells skipped). */
function cellOf(container: HTMLElement, column: 'name' | 'due' | 'remind_at'): HTMLElement {
  const header = Array.from(container.querySelectorAll('thead th'));
  const label = COLUMNS.find((c) => c.field === column)!.label;
  const index = header.findIndex((th) => th.textContent?.trim() === label);
  if (index < 0) throw new Error(`no header for ${column}`);
  const row = container.querySelector('tbody tr') as HTMLElement;
  return row.querySelectorAll('td')[index] as HTMLElement;
}

/** Click the cell into edit mode and wait for the lazily loaded picker's text box. */
async function openPicker(container: HTMLElement, column: 'due' | 'remind_at'): Promise<HTMLInputElement> {
  fireEvent.click(cellOf(container, column));
  return waitFor(() => {
    const input = cellOf(container, column).querySelector('[data-slot="date-picker"] input');
    if (!input) throw new Error('date picker not rendered');
    return input as HTMLInputElement;
  });
}

/** What a user does: put the caret in the box and type. The picker stages nothing yet. */
function typeInto(input: HTMLInputElement, text: string) {
  input.focus();
  fireEvent.change(input, { target: { value: text } });
}

async function saveAll(container: HTMLElement) {
  const btn = await waitFor(() => {
    const el = Array.from(container.querySelectorAll('button')).find((b) =>
      /Save All|全部保存/.test(b.textContent || ''),
    ) as HTMLButtonElement | undefined;
    if (!el) throw new Error('no Save All: nothing is staged');
    return el;
  });
  fireEvent.click(btn);
}

const saveAllButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).find((b) => /Save All|全部保存/.test(b.textContent || ''));

describe('ObjectGrid inline editor — date / datetime draw the platform picker (objectui#12664)', () => {
  it('a date cell edits with the picker, not input[type=date]', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'due');
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('MM/DD/YYYY');
    expect(input.value).toBe('10/01/2026');
    expect(cellOf(container, 'due').querySelector('input[type="date"]')).toBeNull();
  });

  it('the placeholder and digit order come from the console locale (zh)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, 'zh');
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'due');
    expect(input.placeholder).toBe('YYYY/MM/DD');
    expect(input.value).toBe('2026/10/01');
  });

  it('(a) typed day + Enter: the edit is staged with that day', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'due');
    typeInto(input, '10/20/2026');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cellOf(container, 'due').querySelector('[data-slot="date-picker"]')).toBeNull());
    await saveAll(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { due: '2026-10-20' }, undefined));
  });

  it('(b) typed day + click outside: the edit is staged with that day', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'due');
    typeInto(input, '10/20/2026');
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(cellOf(container, 'due').querySelector('[data-slot="date-picker"]')).toBeNull());
    await saveAll(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { due: '2026-10-20' }, undefined));
  });

  it('(b) datetime: typed date and time + click outside stages that local instant', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'remind_at');
    typeInto(input, '10/20/2026 14:30');
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(cellOf(container, 'remind_at').querySelector('[data-slot="date-picker"]')).toBeNull());
    await saveAll(container);
    await waitFor(() =>
      expect(ds.update).toHaveBeenCalledWith(
        OBJECT,
        'r1',
        { remind_at: new Date(2026, 9, 20, 14, 30).toISOString() },
        undefined,
      ),
    );
  });

  it('(c) typed day + Escape: nothing is staged', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const input = await openPicker(container, 'due');
    typeInto(input, '10/20/2026');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(cellOf(container, 'due').querySelector('[data-slot="date-picker"]')).toBeNull());
    // A pointer press elsewhere afterwards must not resurrect the discarded text.
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(saveAllButton(container)).toBeUndefined();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: a text cell still stages per keystroke, with no focus and no blur', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
    const nameTd = cellOf(container, 'name');
    fireEvent.click(nameTd);
    const input = await waitFor(() => {
      const el = nameTd.querySelector('input') as HTMLInputElement | null;
      if (!el) throw new Error('no text editor');
      return el;
    });
    fireEvent.change(input, { target: { value: 'Row One EDITED' } });
    // Staged already, while the editor is still open: Save All is offered.
    await waitFor(() => expect(saveAllButton(container)).toBeTruthy());
    expect(nameTd.querySelector('input')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    await waitFor(() => expect(nameTd.querySelector('input')).toBeNull());
    expect(within(nameTd).getByText('Row One EDITED')).toBeInTheDocument();
    await saveAll(container);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { name: 'Row One EDITED' }, undefined));
  });
});
