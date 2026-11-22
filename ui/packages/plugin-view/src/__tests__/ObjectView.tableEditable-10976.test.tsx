/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10976 — `table: { editable: true }` on an `object-view` turns on
 * in-cell editing in the REAL grid, and cannot widen editing past the object's
 * grant.
 *
 * The card's headline: the key type-checked on the view's `table` slot and did
 * nothing, because the grid node `ObjectView` builds never copied it.
 * `ObjectView.tableSlotRelay-10976.test.tsx` pins the key arriving on that node;
 * this file reads what a user sees. `ObjectGrid` gates the key itself
 * (`inlineEditable` is `schema.editable` AND the object's inline-edit verdict
 * AND the principal's `update` grant), so these cases mount the real grid and
 * ask one question: does selecting a cell and pressing Enter open an in-cell
 * editor (the select-first model, objectstack#36270). Same harness
 * as the named-view twin, `ObjectView.namedViewInlineEdit-10885.test.tsx`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const OBJECT = 'table_editable_task';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

beforeEach(() => {
  installExplainDouble();
});

afterEach(() => {
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A data source whose object schema carries `userActions` when given. */
function makeDataSource(userActions?: Record<string, unknown>): DataSource {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Alpha' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      label: 'Task',
      ...(userActions ? { userActions } : {}),
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    })),
  } as unknown as DataSource;
}

/**
 * Mount an `object-view` whose `table` is `table`, click its `Alpha` cell, and
 * report whether an in-cell editor opened. A cell that is not editable lets the
 * click through to the row, which opens the record form: that is read too, so a
 * `false` is a reading of a click that landed, not of one that never did.
 */
async function clickCell(table: NonNullable<ObjectViewSchema['table']>, userActions?: Record<string, unknown>) {
  const ds = makeDataSource(userActions);
  const schema: ObjectViewSchema = { type: 'object-view', objectName: OBJECT, layout: 'drawer', table };
  render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
  await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
  const td = screen.getByText('Alpha').closest('td') as HTMLElement;
  fireEvent.click(td);
  // objectstack#36270 — a grid that renders editable selects the cell on that
  // click (the list page's select-first model) and Enter asks for its editor;
  // a grid that renders read-only has no selected cell, and the click opens
  // the row.
  const catcher = document.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');
  if (catcher) fireEvent.keyDown(catcher, { key: 'Enter' });
  // One tick lets React flush the editor, so `false` means "never opened",
  // not "not opened yet".
  await new Promise((r) => setTimeout(r, 50));
  return {
    editor: document.querySelector('td[data-editing-cell] input') != null,
    recordForm: screen.queryByTestId('object-form') != null,
  };
}

describe('objectui#10976 — `table.editable` reaches the real grid', () => {
  it('THE FIX: `table: { editable: true }` opens an in-cell editor when the object grants inline edit', async () => {
    const r = await clickCell({ columns: ['name'], editable: true });
    expect(r.editor).toBe(true);
    expect(r.recordForm).toBe(false);
  });

  it('THE GRANT STILL WINS: `table.editable: true` opens no editor when the object refuses inline edit', async () => {
    const r = await clickCell({ columns: ['name'], editable: true }, { edit: false });
    expect(r.editor).toBe(false);
    // The click landed: a grid that renders read-only keeps click-to-open
    // (objectstack#36270), so it went through to the row.
    expect(r.recordForm).toBe(true);
  });

  it('CONTROL: a `table` that writes no `editable` stays read-only, as before', async () => {
    const r = await clickCell({ columns: ['name'] });
    expect(r.editor).toBe(false);
    expect(r.recordForm).toBe(true);
  });
});
