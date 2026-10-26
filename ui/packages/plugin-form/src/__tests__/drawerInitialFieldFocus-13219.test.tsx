/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13219 — the record Create/Edit drawer opens with focus on its first
 * editable field, not on the sheet's Close button. The drawer half of
 * objectui#13130, whose modal half is pinned in
 * `modalInitialFieldFocus-13130.test.tsx`.
 *
 * THE PRODUCER. `DrawerForm` opens its `SheetContent` before its body exists:
 * the object schema (and, on edit, the record) are read after the sheet
 * mounts, the field widgets are `React.lazy`, and the footer is drawn only
 * once the load ends. Radix's focus scope focuses the first tabbable element
 * the moment the content MOUNTS, and at that moment the one tabbable element
 * is the sheet's Close button, so the drawer opened on Close and kept it once
 * the fields arrived.
 *
 * THE FIX is the one the modal took: `DrawerForm` hands the `SheetContent`
 * the `onOpenAutoFocus` / `onCloseAutoFocus` pair from `useInitialFieldFocus`
 * (`initialFieldFocus.ts`). The sheet holds focus itself while the body
 * loads, and moves it to the first editable field when that field lands,
 * unless the user has moved focus in the meantime.
 *
 * Driven through `ObjectForm` (the `object-form` renderer, `formType:
 * 'drawer'`), with one case mounting `DrawerForm` directly, with the real
 * field widgets.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';
import { DrawerForm } from '../DrawerForm';

registerAllFields();
afterEach(() => cleanup());

const TASK = {
  name: 'task',
  fields: {
    title: { type: 'text', label: 'Title' },
    note: { type: 'text', label: 'Note' },
  },
};

type ObjectFormNode = React.ComponentProps<typeof ObjectForm>['schema'];
type DrawerFormNode = React.ComponentProps<typeof DrawerForm>['schema'];

function dataSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(TASK),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue({ id: 'T1', title: 'Ship it', note: 'today' }),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  } as unknown as DataSource;
}

function renderDrawer(extra: Record<string, unknown>, ds: DataSource = dataSource()) {
  return render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'task',
        mode: 'create',
        formType: 'drawer',
        title: 'New task',
        ...extra,
      } as unknown as ObjectFormNode}
      dataSource={ds}
    />,
  );
}

/** A schema read the test releases by hand, so the loading window is deterministic. */
function heldSchema() {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => { release = resolve; });
  return { getObjectSchema: vi.fn().mockReturnValue(pending), release: (v: unknown) => release(v) };
}

const closeButton = () => screen.getByRole('button', { name: /close/i });

describe('the record drawer opens on its first editable field, not on Close (objectui#13219)', () => {
  it('create: focus lands on the first field once the body has loaded', async () => {
    renderDrawer({});
    const first = await screen.findByLabelText('Title');
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it('edit: focus lands on the first field once the record has loaded', async () => {
    renderDrawer({ mode: 'edit', recordId: 'T1', title: 'Edit task' });
    const first = await screen.findByLabelText('Title');
    await waitFor(() => expect((first as HTMLInputElement).value).toBe('Ship it'));
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it('DrawerForm mounted directly (no ObjectForm routing) opens on its first field too', async () => {
    render(
      <DrawerForm
        schema={{
          type: 'object-form',
          objectName: 'task',
          mode: 'create',
          formType: 'drawer',
          title: 'New task',
          fields: ['title', 'note'],
        } as unknown as DrawerFormNode}
        dataSource={dataSource()}
      />,
    );
    const first = await screen.findByLabelText('Title');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('while the body loads, the sheet itself holds focus (named by its title), not Close', async () => {
    const held = heldSchema();
    renderDrawer({}, dataSource({ getObjectSchema: held.getObjectSchema }));
    const sheet = await screen.findByRole('dialog');
    expect(screen.getByText('Loading form…')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    expect(document.activeElement).not.toBe(closeButton());
    // Then the body lands, and focus moves in.
    await act(async () => { held.release(TASK); });
    const first = await screen.findByLabelText('Title');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('does not take focus back from the user: a control focused while the body loads keeps it', async () => {
    const held = heldSchema();
    renderDrawer({}, dataSource({ getObjectSchema: held.getObjectSchema }));
    await screen.findByRole('dialog');
    // The user tabs to Close before the fields arrive.
    act(() => closeButton().focus());
    expect(document.activeElement).toBe(closeButton());
    await act(async () => { held.release(TASK); });
    await screen.findByLabelText('Title');
    // Let any late observer callback run before reading focus.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.activeElement).toBe(closeButton());
  });

  it('skips a field the user cannot edit: a read-only first field leaves focus to the next one', async () => {
    const ds = dataSource({
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'task',
        fields: {
          title: { type: 'text', label: 'Title', readonly: true },
          note: { type: 'text', label: 'Note' },
        },
      }),
    });
    renderDrawer({}, ds);
    const note = await screen.findByLabelText('Note');
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  it('the subforms (master-detail) arm opens on its first header field too', async () => {
    // The child object answers with its own schema, so the line-items grid
    // draws no input a "Title" query could also match.
    const LINE = { name: 'task_line', fields: { qty: { type: 'number', label: 'Qty' } } };
    const ds = dataSource({
      getObjectSchema: vi.fn((name: string) => Promise.resolve(name === 'task_line' ? LINE : TASK)),
    });
    renderDrawer({ subforms: [{ childObject: 'task_line', relationshipField: 'task' }] }, ds);
    const first = await screen.findByLabelText('Title');
    expect(first.closest('[data-field]')?.getAttribute('data-field')).toBe('title');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
});
