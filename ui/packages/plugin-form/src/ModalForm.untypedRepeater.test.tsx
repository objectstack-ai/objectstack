/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An untyped `repeater` field shows and edits its stored rows in the record
 * Edit dialog.
 *
 * `@objectstack/spec` declares `repeater` an untyped array of embedded JSON
 * objects: `FieldSchema` has no sub-field or column member, so nothing a widget
 * could read names the keys of a row. The alias table used to send it to the
 * line-items grid (`field:grid`), which draws only declared columns, so a
 * stored `[{label:'one',qty:1},…]` drew numbered rows with Duplicate and
 * Remove and no cell: the content could be neither read nor changed. It now
 * takes the JSON editor `composite` and `record` beside it use.
 *
 * Driven through the dialog the console mounts for Edit — the global
 * `ModalForm`, whose body is a real `SchemaRenderer` form — with the real
 * registered widgets and a click on the real submit button.
 *
 * The control: a line-items grid that DECLARES its columns still draws one
 * input per declared column and writes typed cells.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { registerAllFields, GridField, resolveFormWidgetType } from '@object-ui/fields';
import { ModalForm } from './ModalForm';

registerAllFields();

const ROWS = [
  { label: 'one', qty: 1 },
  { label: 'two', qty: 2 },
];

const STORED = {
  id: 'z1',
  name: 'Specimen — Full',
  f_repeater: ROWS,
};

function makeDS() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'field_zoo',
      fields: {
        name: { type: 'text', label: 'Name' },
        f_repeater: { type: 'repeater', label: 'Repeater (embedded array)' },
      },
    }),
    findOne: vi.fn().mockResolvedValue(structuredClone(STORED)),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, d: any) => ({ id: 'n1', ...d })),
    update: vi.fn(async (_o: string, _id: string, d: any) => ({ ...STORED, ...d })),
  };
}

function openEditDialog() {
  const ds = makeDS();
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'field_zoo',
        mode: 'edit',
        recordId: 'z1',
        open: true,
      } as any}
      dataSource={ds as any}
    />,
  );
  return ds;
}

const repeaterBox = () =>
  waitFor(() => {
    const el = document.querySelector('textarea[name="f_repeater"]') as HTMLTextAreaElement | null;
    if (!el) throw new Error('f_repeater not ready');
    return el;
  });

const type = async (el: HTMLElement, text: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value: text } });
  });
};

const clickUpdate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

const row = (name: string) => document.querySelector(`[data-field="${name}"]`) as HTMLElement | null;

const payloads = (ds: ReturnType<typeof makeDS>) => ds.update.mock.calls.map((call) => call[2]);

describe('an untyped repeater field in the record Edit dialog', () => {
  it('shows the stored rows: "one", "two", 1 and 2 are on screen', async () => {
    openEditDialog();
    const box = await repeaterBox();
    await waitFor(() => expect(box.value).toBe(JSON.stringify(ROWS, null, 2)));
    for (const shown of ['"one"', '"two"', '"qty": 1', '"qty": 2']) {
      expect(box.value).toContain(shown);
    }
    // Not the bare line-items grid it used to draw.
    expect(row('f_repeater')?.querySelector('[data-testid="line-items"]')).toBeNull();
  });

  it('saves an edit as an array of objects, never a string', async () => {
    const ds = openEditDialog();
    const box = await repeaterBox();
    await waitFor(() => expect(box.value).toContain('"one"'));
    const next = [
      { label: 'one', qty: 5 },
      { label: 'three', qty: 3 },
    ];
    await type(box, JSON.stringify(next));
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const sent = payloads(ds)[0].f_repeater;
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual(next);
    expect(typeof sent[0].qty).toBe('number');
  });

  it('an untouched save never writes the field as text', async () => {
    const ds = openEditDialog();
    await repeaterBox();
    await clickUpdate();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    const sent = payloads(ds)[0];
    // Present or absent are both safe; a string in this slot is the defect.
    if ('f_repeater' in sent) expect(sent.f_repeater).toEqual(ROWS);
    expect(typeof sent.f_repeater === 'string').toBe(false);
  });

  it('CONTROL — a grid that declares columns still draws the line-items grid', async () => {
    // `grid` is objectui's own line-items key (`GridFieldMetadata`), not a spec
    // field type, so it is driven at the widget the form resolves for it.
    expect(resolveFormWidgetType('grid')).toBe('grid');
    const onChange = vi.fn();
    render(
      <GridField
        field={{
          name: 'f_lines',
          columns: [
            { name: 'item', label: 'Item', type: 'text' },
            { name: 'qty', label: 'Qty', type: 'number' },
          ],
        } as any}
        value={[{ item: 'bolt', qty: 3 }]}
        onChange={onChange}
      />,
    );
    const grid = screen.getByTestId('line-items');
    expect((grid.querySelector('input[aria-label="Item"]') as HTMLInputElement).value).toBe('bolt');
    const qty = grid.querySelector('input[aria-label="Qty"]') as HTMLInputElement;
    expect(qty.value).toBe('3');
    await act(async () => {
      fireEvent.change(qty, { target: { value: '4' } });
    });
    expect(onChange).toHaveBeenLastCalledWith([{ item: 'bolt', qty: 4 }]);
  });
});
