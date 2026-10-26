/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10885 member 4 — a named view's `inlineEdit` reaches the grid on
 * route 2, and cannot widen editing past the object's grant.
 *
 * Route 2 (the registered `object-view` renderer, with no `renderListView`)
 * hands `ObjectGrid` the node `ObjectView` builds. That node carried no
 * `editable`, so a named view's `inlineEdit: true` was accepted and ignored:
 * the Studio's view preview showed a stored inline-edit view read-only. The node
 * now carries the named view's `inlineEdit` as `editable`.
 *
 * `ObjectGrid` gates the key itself: `inlineEditable` is `schema.editable` AND
 * the object's inline-edit verdict (ADR-0103 bucket, `userActions.edit`, the
 * server's effective operations) AND the principal's `update` grant. So these
 * cases mount the REAL `ObjectGrid` and read the user-visible outcome: does a
 * click on a cell open an in-cell editor.
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

const OBJECT = 'inline_edit_task';

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
 * Mount one grid named view on route 2, click its `Alpha` cell, and report
 * whether an in-cell editor opened. A cell that is not editable lets the click
 * through to the row, which opens the record form: that is read too, so a
 * `false` is a reading of a click that landed, not of one that never did.
 */
async function clickCell(named: Record<string, unknown>, userActions?: Record<string, unknown>) {
  const ds = makeDataSource(userActions);
  const schema = {
    type: 'object-view',
    objectName: OBJECT,
    layout: 'drawer',
    defaultListView: 'v1',
    listViews: { v1: { label: 'Open work', type: 'grid', columns: ['name'], ...named } },
  } as unknown as ObjectViewSchema;
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
  // The editor mounts on click; one tick lets React flush it, so `false` means
  // "never opened", not "not opened yet".
  await new Promise((r) => setTimeout(r, 50));
  return {
    editor: td.querySelector('input') != null,
    recordForm: screen.queryByTestId('object-form') != null,
  };
}

describe('objectui#10885 — route 2 hands `ObjectGrid` the named view\'s `inlineEdit` as `editable`', () => {
  it('THE FIX: a named `inlineEdit: true` opens an in-cell editor when the object grants inline edit', async () => {
    const r = await clickCell({ inlineEdit: true });
    expect(r.editor).toBe(true);
    expect(r.recordForm).toBe(false);
  });

  it('THE GRANT STILL WINS: a named `inlineEdit: true` opens no editor when the object refuses inline edit', async () => {
    const r = await clickCell({ inlineEdit: true }, { edit: false });
    expect(r.editor).toBe(false);
    // The click landed: it went through to the row, as on a read-only grid.
    expect(r.recordForm).toBe(true);
  });

  it('CONTROL: a named view that declares no `inlineEdit` stays read-only, as before', async () => {
    const r = await clickCell({});
    expect(r.editor).toBe(false);
    expect(r.recordForm).toBe(true);
  });
});
