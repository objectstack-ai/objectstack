/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The grouped grid's "Rows per page" picks with the shared `Select`
 * (objectui#11865).
 *
 * The flat grid's pager (the DataTable's) already drew its size picker with
 * the shared Radix `Select`; the grouped pager's was a browser-native select.
 * The card asks for one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - it IS the primitive (a Radix combobox trigger), shows the size in force
 *     and lists the native control's sizes in its order, a declared size that
 *     is not one of the steps merged in as before;
 *   - every size does what the native control did, picked from page 2: the
 *     same page label and the same number of groups on screen, back on page
 *     1; re-picking the size in force changes nothing;
 *   - the keyboard alone opens the picker and selects.
 *
 * The picker has no name: the native control had none either ("Rows per page"
 * is a plain span beside it, and it had no `aria-label`), so there is no name
 * to keep. The pager has no read-only state.
 *
 * DIRECTION, observed against the native control: every pin here reads the
 * control as the primitive's trigger, so each is red there. What makes the
 * size rows guards of "the conversion changed nothing the pager does" is the
 * reading each compares against: a `change` event on the pre-conversion native
 * control, from page 2, left that same page label and that many groups, read
 * once on this component with this fixture. That probe's `change` event fired
 * for the size in force too, which a browser's native select does not do, so
 * the re-pick row pins the primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';
import type { ObjectGridSchema } from '@object-ui/types';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();
afterEach(() => cleanup());

const DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;
/** Two full pages of the display default and ten groups more, one row each. */
const GROUP_COUNT = DISPLAY_DEFAULT * 2 + 10;
const ITEMS = Array.from({ length: GROUP_COUNT }, (_, i) => ({
  id: String(i + 1),
  name: `Row ${i + 1}`,
  category: `Cat ${String(i + 1).padStart(3, '0')}`,
}));

const groupRows = () => document.querySelectorAll('[data-testid^="group-row-"]');
const pageLabel = () => screen.queryByText(/^Page \d+ of \d+$/)?.textContent ?? 'NO PAGER';

function renderGrouped(extra?: Partial<ObjectGridSchema>) {
  const schema: ObjectGridSchema = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ITEMS },
    grouping: { fields: [{ field: 'category' }] },
    ...extra,
  };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

/** Render, step to page 2, and return the size picker. */
async function onPageTwo(): Promise<HTMLElement> {
  renderGrouped();
  await waitFor(() => expect(pageLabel()).toMatch(/^Page 1 of/));
  const nav = screen.getByText(/^Page 1 of/).parentElement!.querySelectorAll('button');
  fireEvent.click(nav[2]);
  await waitFor(() => expect(pageLabel()).toMatch(/^Page 2 of/));
  return screen.getByRole('combobox');
}

/**
 * [size, the page label and group count the native control left, picked from
 * page 2], read on the fixture above, where the display default is 50.
 */
const SIZES: ReadonlyArray<readonly [number, string, number]> = [
  [5, 'Page 1 of 22', 5],
  [10, 'Page 1 of 11', 10],
  [20, 'Page 1 of 6', 20],
  [100, 'Page 1 of 2', 100],
];

describe('ObjectGrid — the grouped pager\'s size picker is the shared Select (objectui#11865)', () => {
  it('reads the fixture the size rows were measured on', () => {
    // Guards the premise: the rows below were read with a display default of 50.
    expect(DISPLAY_DEFAULT).toBe(50);
  });

  it('is the primitive, shows the size in force, and lists the native sizes in order', async () => {
    const trigger = await onPageTwo();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toBe(String(DISPLAY_DEFAULT));
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['5', '10', '20', '50', '100']);
  });

  it('merges a declared size that is not one of the steps, as before', async () => {
    renderGrouped({ pagination: { pageSize: 7 } });
    await waitFor(() => expect(pageLabel()).toMatch(/^Page 1 of/));
    const trigger = screen.getByRole('combobox');
    expect(trigger.textContent).toBe('7');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['5', '7', '10', '20', '50', '100']);
  });

  it.each(SIZES)('picking %i from page 2 does what the native control did', async (size, label, rows) => {
    const trigger = await onPageTwo();
    const options = await openPicker(trigger);
    fireEvent.click(options.find((o) => o.textContent === String(size))!);
    await act(async () => {});
    expect(pageLabel()).toBe(label);
    expect(groupRows()).toHaveLength(rows);
    expect(trigger.textContent).toBe(String(size));
  });

  it('re-picking the size in force changes nothing', async () => {
    const trigger = await onPageTwo();
    const options = await openPicker(trigger);
    fireEvent.click(options.find((o) => o.textContent === String(DISPLAY_DEFAULT))!);
    await act(async () => {});
    expect(pageLabel()).toBe('Page 2 of 3');
    expect(groupRows()).toHaveLength(DISPLAY_DEFAULT);
  });

  it('Enter opens the picker and Enter on a size selects it', async () => {
    const trigger = await onPageTwo();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: '20' }), { key: 'Enter' });
    await act(async () => {});
    expect(pageLabel()).toBe('Page 1 of 6');
    expect(groupRows()).toHaveLength(20);
  });
});
