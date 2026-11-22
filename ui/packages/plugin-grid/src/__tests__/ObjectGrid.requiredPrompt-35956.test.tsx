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
 *   7. The row is the view's PROJECTION (this file's server honours `$select`,
 *      as a real one does): a key the judgment reads that the row lacks is read
 *      from the record first, so a stored value not drawn as a column is not
 *      asked for again (L1 7057894230 M1), a predicate operand outside the
 *      columns is judged on its stored value, and a read that fails asks
 *      nothing.
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

/** Only the keys a `$select` names, as a real server answers a projection. */
const project = (record: Record<string, any>, select: unknown) =>
  Array.isArray(select)
    ? Object.fromEntries(select.filter((k) => k in record).map((k) => [k, record[k]]))
    : { ...record };

function makePromptDataSource(
  winReason: Record<string, unknown> = { type: 'text' },
  stored: unknown = null,
  extraFields: Record<string, unknown> = {},
) {
  const ds = makeDataSource();
  ds.store.d1.stage = 'new';
  ds.store.d1.win_reason = stored;
  ds.find = vi.fn(async (_object: string, params: any = {}) => {
    const data = Object.values(ds.store).map((r: any) => project(r, params.$select));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  ds.findOne = vi.fn(async (_object: string, id: string, params: any = {}) =>
    (ds.store[id] ? project(ds.store[id], params.$select) : null));
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
      ...extraFields,
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

  describe('the row is a projection: what it lacks is read from the record first', () => {
    it('a stored value that is not a column is read, not asked for again, and not overwritten', async () => {
      const ds = makePromptDataSource({ type: 'text' }, 'Known reason');
      const { container } = renderPromptGrid(ds);
      await screen.findByText('beta');
      // The row really lacks the field: the grid fetched its columns only.
      expect(ds.find.mock.calls[0][1].$select).not.toContain('win_reason');
      pasteInto(container, dataCell(container, 0, 'New'), 'Won');
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.findOne).toHaveBeenCalledWith(OBJECT, 'd1', { $select: ['win_reason'] });
      expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
      expect(ds.store.d1.win_reason).toBe('Known reason');
      expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
    });

    it('an empty stored value read the same way still opens the dialog', async () => {
      const ds = makePromptDataSource();
      const { container } = renderPromptGrid(ds);
      await screen.findByText('beta');
      pasteInto(container, dataCell(container, 0, 'New'), 'Won');
      await screen.findByTestId('required-fields-dialog');
      expect(ds.findOne).toHaveBeenCalledTimes(1);
      expect(ds.update).not.toHaveBeenCalled();
    });

    it('a predicate operand outside the columns is judged on its stored value', async () => {
      const rule = { type: 'text', requiredWhen: 'record.segment == "enterprise" && record.stage == "won"' };
      const segment = { segment: { type: 'text', label: 'Segment' } };
      const enterprise = makePromptDataSource(rule, null, segment);
      enterprise.store.d1.segment = 'enterprise';
      const first = renderPromptGrid(enterprise);
      await screen.findByText('beta');
      pasteInto(first.container, dataCell(first.container, 0, 'New'), 'Won');
      await screen.findByTestId('required-fields-dialog');
      expect(enterprise.findOne.mock.calls[0][2].$select).toEqual(['win_reason', 'segment']);
      first.unmount();

      const smb = makePromptDataSource(rule, null, segment);
      smb.store.d1.segment = 'smb';
      const second = renderPromptGrid(smb);
      await screen.findByText('beta');
      pasteInto(second.container, dataCell(second.container, 0, 'New'), 'Won');
      await waitFor(() => expect(smb.update).toHaveBeenCalledTimes(1));
      expect(smb.update.mock.calls[0][2]).toEqual({ stage: 'won' });
      expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
    });

    it('a read that fails asks nothing: the change is written and the server judges it', async () => {
      const ds = makePromptDataSource({ type: 'text' }, 'Known reason');
      ds.findOne.mockRejectedValueOnce(new Error('offline'));
      const { container } = renderPromptGrid(ds);
      await screen.findByText('beta');
      pasteInto(container, dataCell(container, 0, 'New'), 'Won');
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.update.mock.calls[0][2]).toEqual({ stage: 'won' });
      expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
    });

    it('a row that carries every key it needs reads nothing more', async () => {
      const ds = makePromptDataSource({ type: 'text' }, 'Known reason');
      const { container } = renderPromptGrid(ds, true);
      await screen.findByText('beta');
      pasteInto(container, dataCell(container, 0, 'New'), 'Won');
      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      expect(ds.findOne).not.toHaveBeenCalled();
    });
  });
});

/**
 * objectstack#36025 — the pre-read is made only when the edited column can
 * open the dialog. A commit to a column no askable `requiredWhen` reads leaves
 * every verdict where it was, so it sends no `findOne`; a predicate operand,
 * or a predicate that reads the clock or the acting user, still reads.
 */
describe('ObjectGrid — the fill-in pre-read is made only for a column that can open the dialog (objectstack#36025)', () => {
  it('committing a column no predicate reads sends no findOne, and the change saves at once', async () => {
    const ds = makePromptDataSource();
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    // The row lacks a key the judgment reads, so the read WOULD be due.
    expect(ds.find.mock.calls[0][1].$select).not.toContain('win_reason');
    pasteInto(container, dataCell(container, 0, 'alpha'), 'gamma');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toEqual({ name: 'gamma' });
    expect(ds.findOne).not.toHaveBeenCalled();
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('committing a predicate operand still reads once, and the dialog opens as before', async () => {
    const ds = makePromptDataSource();
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'New'), 'Won');
    await screen.findByTestId('required-fields-dialog');
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, 'd1', { $select: ['win_reason'] });
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('a predicate that reads the clock keeps the read for every column', async () => {
    const ds = makePromptDataSource({ type: 'text', requiredWhen: 'record.stage == "won" && today() > daysAgo(1)' });
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'alpha'), 'gamma');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.update.mock.calls[0][2]).toEqual({ name: 'gamma' });
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('a predicate that reads the acting user keeps the read for every column', async () => {
    const ds = makePromptDataSource({ type: 'text', requiredWhen: 'record.stage == "won" && current_user.id != ""' });
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'alpha'), 'gamma');
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.findOne).toHaveBeenCalledTimes(1);
  });

  it('a statically required field is asked for on any commit while it is empty, so that read stays', async () => {
    const ds = makePromptDataSource({ type: 'text', required: true });
    const { container } = renderPromptGrid(ds);
    await screen.findByText('beta');
    pasteInto(container, dataCell(container, 0, 'alpha'), 'gamma');
    await screen.findByTestId('required-fields-dialog');
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.update).not.toHaveBeenCalled();
  });
});
