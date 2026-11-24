/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36023 — the record page's related tab edits its cells as the
 * list page does. Driven through the real chain the tab draws: `RelatedList`
 * (enlarged, a list of the parent record) → `object-grid` → `data-table`'s
 * select-first cells. Three of the card's acceptance lines, repeated on the
 * tab:
 *
 *   1. a select cell opens its option list under the cell, and the cell keeps
 *      showing its value;
 *   2. Enter in a text cell's editor saves and the cell stays selected;
 *   3. a rich-content cell opens its text box under the cell; Enter there is
 *      a new line and Ctrl+Enter saves.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ isLoaded: false, checkField: () => true, getObjectApiOperations: () => undefined, can: () => true }),
  };
});

// Registers `object-grid`, the enlarged related tab's face.
import '../index';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, FilterScopeProvider, SchemaRendererProvider } from '@object-ui/react';
import { RelatedList } from '../../../plugin-detail/src/RelatedList';
import { RelatedListEnlargedContext } from '../../../plugin-detail/src/relatedListCompact';
import { resetRelatedTabConditionsForTests } from '../../../plugin-detail/src/relatedTabConditions';
// The rich-content panel's widget sits behind `React.lazy` in `FieldEditWidget`;
// loaded here so it resolves at once.
import '../../../fields/src/widgets/RichTextField';
import { installExplainDouble } from './explainDouble';

registerAllFields();

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as any;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRelatedTabConditionsForTests();
});

const FIELDS = {
  id: { type: 'text' },
  name: { type: 'text', label: 'Name' },
  stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }] },
  notes: { type: 'richtext', label: 'Notes' },
  opportunity: { type: 'lookup', reference: 'opportunity', label: 'Opportunity' },
};

function makeDataSource() {
  const store: Record<string, any> = {
    q1: { id: 'q1', name: 'Quote one', stage: 'open', notes: '<p>First</p>', opportunity: 'O-1' },
  };
  return {
    store,
    find: vi.fn(async () => ({ data: Object.values(store).map((r) => ({ ...r })), total: 1 })),
    update: vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
  } as any;
}

async function renderTab() {
  installExplainDouble();
  const ds = makeDataSource();
  const utils = render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <FilterScopeProvider currentUserId="u-1">
          <RelatedListEnlargedContext.Provider value>
            <RelatedList
              title="Quotes"
              type="table"
              api="quote"
              objectName="quote"
              referenceField="opportunity"
              parentId="O-1"
              columns={[{ field: 'name', label: 'Name' }, { field: 'stage', label: 'Stage' }, { field: 'notes', label: 'Notes' }]}
              dataSource={ds}
            />
          </RelatedListEnlargedContext.Provider>
        </FilterScopeProvider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await screen.findByText('Quote one', {}, { timeout: 5000 });
  const cell = (col: number) => utils.container.querySelectorAll<HTMLElement>('tbody tr td[data-grid-cell]')[col];
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  const overlayOf = (col: number) => cell(col).querySelector<HTMLElement>('[data-slot="cell-editor-overlay"]');
  const open = async (col: number) => {
    fireEvent.click(cell(col));
    fireEvent.keyDown(catcher(), { key: 'Enter' });
    return waitFor(() => {
      const el = overlayOf(col);
      expect(el).not.toBeNull();
      return el!;
    });
  };
  return { ...utils, ds, cell, open, overlayOf };
}

describe('the related tab edits cells as the list page does (objectstack#36023)', () => {
  it('a select opens its list under the cell; Enter saves a text cell and stays; rich text opens its panel', async () => {
    const g = await renderTab();
    const col = { name: 0, stage: 1, notes: 2 };
    expect(g.cell(col.name)).toHaveTextContent('Quote one');

    // 1. A picker opens under the cell, which keeps showing its value.
    const picker = await g.open(col.stage);
    expect(picker).toHaveAttribute('data-placement', 'below');
    expect(g.cell(col.stage).querySelector('[data-slot="cell-display"]')).toHaveTextContent('Open');
    expect(picker.querySelector('[role="listbox"], [role="option"]')).not.toBeNull();
    fireEvent.keyDown(picker.querySelector('input')!, { key: 'Escape' });
    await waitFor(() => expect(g.overlayOf(col.stage)).toBeNull());

    // 2. Enter saves a text cell and the selection stays on it.
    const textEditor = await g.open(col.name);
    expect(textEditor).toHaveAttribute('data-placement', 'cover');
    const input = textEditor.querySelector<HTMLInputElement>('input')!;
    fireEvent.change(input, { target: { value: 'Quote uno' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(g.ds.update).toHaveBeenCalledTimes(1));
    expect(g.ds.update.mock.calls[0][1]).toBe('q1');
    expect(g.ds.update.mock.calls[0][2]).toEqual({ name: 'Quote uno' });
    await waitFor(() => expect(g.overlayOf(col.name)).toBeNull());
    expect(g.cell(col.name)).toHaveAttribute('data-selected-cell');

    // 3. Rich text opens its text box under the cell; Enter is a new line,
    //    Ctrl+Enter saves.
    const panel = await g.open(col.notes);
    expect(panel).toHaveAttribute('data-placement', 'below');
    const box = await waitFor(() => {
      const el = panel.querySelector<HTMLTextAreaElement>('textarea');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(box).toHaveValue('<p>First</p>');
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(g.ds.update).toHaveBeenCalledTimes(1);
    fireEvent.change(box, { target: { value: '<p>First</p>\n<p>Second</p>' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(g.ds.update).toHaveBeenCalledTimes(2));
    expect(g.ds.update.mock.calls[1][2]).toEqual({ notes: '<p>First</p>\n<p>Second</p>' });
    expect(g.cell(col.notes)).toHaveAttribute('data-selected-cell');
  });
});
