/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35956 — a list cell's change that makes other fields required
 * asks for them in place (the shared `RequiredFieldsDialog`) before anything
 * is written:
 *
 *   1. Changing 「Stage」 to 「Won」 when 「Win Reason」 is required on Won opens
 *      the dialog, names the record and the change, and writes nothing yet —
 *      whether or not the view draws a Win Reason column.
 *   2. Save sends the cell's value and the typed value in ONE guarded update,
 *      and the row shows the new stage.
 *   3. Cancel writes nothing, and the cell keeps the stage it showed.
 *   4. A refusal of that write stays in the dialog, under the field it names.
 *   5. A field that already has a value asks nothing: the change saves at once.
 *   6. A field with no in-place editor (rich text) asks nothing: the change is
 *      written and refused as before.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// The grid's toast, to read the save toast's Undo button (the components
// entry is the module the grid imports `toast` from).
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: Object.assign(vi.fn(), toasts) };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, notifyDataChanged } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';
import { installExplainDouble } from './explainDouble';

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(toasts)) fn.mockClear();
});

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'deal';

/**
 * A fake server whose update hook rewrites the name it is sent to upper case,
 * and whose writes are announced on the data-invalidation bus.
 */
function makeDataSource() {
  const store: Record<string, any> = {
    d1: { id: 'd1', name: 'alpha', amount: 10, updated_at: '2026-11-20T10:00:00.000Z' },
    d2: { id: 'd2', name: 'beta', amount: 20, updated_at: '2026-11-20T10:00:00.000Z' },
  };
  let clock = 0;
  const find = vi.fn(async () => {
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    const next = { ...store[id], ...changes };
    if (typeof changes.name === 'string') next.name = changes.name.toUpperCase();
    next.updated_at = `2026-11-20T11:00:0${++clock}.000Z`;
    store[id] = next;
    // Announced on the bus inside the write, as the console's mutation bridge
    // does, so a grid that re-read on its own write would read again here.
    notifyDataChanged({ objectName: OBJECT, recordId: id });
    return { ...next };
  });
  return {
    store,
    find,
    update,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
        updated_at: { type: 'datetime' },
      },
    }),
  } as any;
}


const WON_RULE = 'record.stage == "won"';

function makePromptDataSource(winReason: Record<string, unknown> = { type: 'text' }, stored: unknown = null) {
  const ds = makeDataSource();
  ds.store.d1.stage = 'new';
  ds.store.d1.win_reason = stored;
  ds.getObjectSchema = async (name: string) => ({
    name,
    fields: {
      id: { type: 'text' },
      name: { type: 'text', label: 'Name' },
      stage: {
        type: 'select',
        label: 'Stage',
        options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }],
      },
      win_reason: { label: 'Win Reason', requiredWhen: WON_RULE, ...winReason },
      updated_at: { type: 'datetime' },
    },
  });
  return ds;
}

function renderPromptGrid(ds: any, withWinReasonColumn = false) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'stage', label: 'Stage' },
      ...(withWinReasonColumn ? [{ field: 'win_reason', label: 'Win Reason' }] : []),
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} cellSelection />
    </ActionProvider>,
  );
}

const dataCell = (container: HTMLElement, row: number, text: string) =>
  Array.from(container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td'))
    .find((td) => td.textContent === text)!;

/** Select a cell and paste `text` into it (a commit made without an editor). */
function pasteInto(container: HTMLElement, cell: HTMLElement, text: string) {
  fireEvent.click(cell);
  const catcher = container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  fireEvent.paste(catcher, { clipboardData: { getData: () => text } });
}

const winReasonInput = (dialog: HTMLElement) =>
  dialog.querySelector<HTMLInputElement>('[data-required-fields-field="win_reason"] input')!;

describe('ObjectGrid — a cell change that makes fields required asks for them in place (objectstack#35956)', () => {
  it('opens the dialog naming the record and the change, with no column for the field, and writes nothing yet', async () => {
    const ds = makePromptDataSource();
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    const dialog = await screen.findByTestId('required-fields-dialog');
    expect(dialog).toHaveTextContent('Complete required fields');
    expect(dialog).toHaveTextContent('alpha');
    expect(dialog.querySelector('[data-required-fields-change-row="stage"]')).toHaveTextContent('Stage:Won');
    expect(winReasonInput(dialog)).toBeTruthy();
    // The fill-in is the confirmation: no second (state) dialog, nothing sent.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('Save sends the change and the typed value in one guarded update', async () => {
    const ds = makePromptDataSource();
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith(
      OBJECT,
      'd1',
      { stage: 'won', win_reason: 'Better price' },
      { ifMatch: '2026-11-20T10:00:00.000Z' },
    );
    await waitFor(() => expect(screen.queryByTestId('required-fields-dialog')).toBeNull());
    await waitFor(() => expect(dataCell(container, 0, 'Won')).toBeTruthy());
    await act(async () => {});
    expect(ds.update).toHaveBeenCalledTimes(1);
  });

  it('Cancel writes nothing and the cell keeps its stage', async () => {
    const ds = makePromptDataSource();
    const { container } = renderPromptGrid(ds, true);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await screen.findByTestId('required-fields-dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('required-fields-dialog')).toBeNull());
    await act(async () => {});
    expect(ds.update).not.toHaveBeenCalled();
    expect(dataCell(container, 0, 'New')).toBeTruthy();
  });

  it('a refusal of the combined write stays in the dialog, under the field it names', async () => {
    const ds = makePromptDataSource();
    ds.update.mockRejectedValueOnce(Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field: 'win_reason', message: 'Win Reason is too short' }] },
    }));
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-required-fields-error="win_reason"]')).toHaveTextContent('Win Reason is too short'));
    expect(screen.getByTestId('required-fields-dialog')).toBeInTheDocument();
  });

  it('control: a field that already has a value asks nothing, and the change saves at once', async () => {
    const ds = makePromptDataSource({ type: 'text' }, 'Known reason');
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('control: a field with no in-place editor asks nothing, and the change is written as before', async () => {
    const ds = makePromptDataSource({ type: 'richtext' });
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });
});
