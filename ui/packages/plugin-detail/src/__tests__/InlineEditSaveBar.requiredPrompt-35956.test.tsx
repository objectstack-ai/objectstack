/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35956 — the record page's inline Save asks for the fields its
 * draft makes required before writing, in the shared `RequiredFieldsDialog`:
 *
 *   1. A draft moving 「Stage」 to 「Won」 when 「Win Reason」 is required on Won
 *      opens the dialog (the field need not be on the page) and writes nothing.
 *   2. Save writes the draft and the typed value in ONE guarded update, then
 *      re-reads and leaves edit mode.
 *   3. Cancel writes nothing and keeps the edit session and its draft.
 *   4. A refusal of that write stays in the dialog; a 409 opens the page's
 *      conflict dialog over it, as a plain Save's 409 does (L1 7057894230
 *      S1): its Overwrite sends the draft AND the typed values at the version
 *      the server reported, its Cancel comes back to the typed values.
 *   5. Control: a draft that makes nothing required saves at once, as before.
 *
 * objectstack#35995 — the drawer's per-field callback mode asks too, when its
 * host hands the bar the record and the data source (`RecordDetailPanel`
 * does): Save writes the change and the typed values in ONE guarded update at
 * the version the edit began on, never through the per-field callback; Cancel
 * writes nothing; a change that makes nothing required still goes through the
 * callback at once; a 409 keeps the fill-in dialog open under the conflict
 * dialog.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { InlineEditSaveBar } from '../InlineEditSaveBar';
import { RecordDetailPanel } from '../RecordDetailPanel';

registerAllFields();
afterEach(() => cleanup());

const OBJECT_SCHEMA = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] },
    priority: { type: 'select', label: 'Priority', options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] },
    win_reason: { type: 'text', label: 'Win Reason', requiredWhen: 'record.stage == "won"' },
  },
};
const DATA = { id: 'd1', name: 'Acme deal', stage: 'new', priority: 'low', win_reason: null, updated_at: 'v1' };

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('stage')}>edit-enter</button>
      <button onClick={() => inline.setField('stage', 'won')}>edit-stage-won</button>
      <button onClick={() => inline.setField('priority', 'high')}>edit-priority</button>
      <span data-testid="editing">{inline.editing ? 'editing' : 'idle'}</span>
      <span data-testid="draft">{JSON.stringify(inline.draft)}</span>
    </>
  );
}

function renderBar(update: ReturnType<typeof vi.fn>, extra: Partial<React.ComponentProps<typeof InlineEditSaveBar>> = {}) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const tree = (data: typeof DATA) => (
    <RecordContextProvider objectName="deal" recordId="d1" data={data} objectSchema={OBJECT_SCHEMA} dataSource={{ update } as never}>
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="deal"
          recordId="d1"
          data={data}
          refresh={refresh}
          {...extra}
        />
      </InlineEditProvider>
    </RecordContextProvider>
  );
  const { rerender } = render(tree(DATA));
  return { refresh, rereadAs: (data: typeof DATA) => rerender(tree(data)) };
}

const winReasonInput = (dialog: HTMLElement) =>
  dialog.querySelector<HTMLInputElement>('[data-required-fields-field="win_reason"] input')!;

function stageWon() {
  fireEvent.click(screen.getByText('edit-enter'));
  fireEvent.click(screen.getByText('edit-stage-won'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('InlineEditSaveBar asks for the fields a draft makes required (objectstack#35956)', () => {
  it('opens the dialog naming the record and the change, and writes nothing yet', async () => {
    const update = vi.fn().mockResolvedValue({});
    renderBar(update);
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    expect(dialog).toHaveTextContent('Acme deal');
    expect(dialog.querySelector('[data-required-fields-change-row="stage"]')).toHaveTextContent('Stage:Won');
    expect(winReasonInput(dialog)).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('Save writes the draft and the typed value in one guarded update, then leaves edit mode', async () => {
    const update = vi.fn().mockResolvedValue({});
    const { refresh } = renderBar(update);
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('deal', 'd1', { stage: 'won', win_reason: 'Better price' }, { ifMatch: 'v1' });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('editing')).toHaveTextContent('idle'));
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('Cancel writes nothing and keeps the edit session and its draft', async () => {
    const update = vi.fn().mockResolvedValue({});
    renderBar(update);
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('required-fields-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByTestId('editing')).toHaveTextContent('editing');
    expect(screen.getByTestId('draft')).toHaveTextContent('"stage":"won"');
  });

  it('a refusal of the combined write stays in the dialog', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('Someone else changed this record'));
    renderBar(update);
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-required-fields-refusal]')).toHaveTextContent('Someone else changed this record'));
    expect(screen.getByTestId('editing')).toHaveTextContent('editing');
  });

  it('control: a draft that makes nothing required saves at once', async () => {
    const update = vi.fn().mockResolvedValue({});
    renderBar(update);
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-priority'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('deal', 'd1', { priority: 'high' }, { ifMatch: 'v1' });
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('the per-field callback mode (drawer) asks too, and writes nothing yet (objectstack#35995)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    expect(winReasonInput(dialog)).toBeTruthy();
    expect(onFieldSave).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  describe('a 409 of the combined write opens the conflict dialog, as a plain Save does', () => {
    const conflict = {
      code: 'CONCURRENT_UPDATE',
      currentVersion: 'v2',
      currentRecord: { ...DATA, priority: 'high', updated_at: 'v2' },
    };

    it('Overwrite sends the draft and the typed value at the version the server reported', async () => {
      const update = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({});
      const { refresh } = renderBar(update);
      stageWon();
      const dialog = await screen.findByTestId('required-fields-dialog');
      fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      // Nothing is re-read under the reader: the choice is theirs.
      expect(refresh).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /overwrite/i }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(update).toHaveBeenLastCalledWith('deal', 'd1', { stage: 'won', win_reason: 'Better price' }, { ifMatch: 'v2' });
      await waitFor(() => expect(screen.getByTestId('editing')).toHaveTextContent('idle'));
      expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
    });

    it('the conflict dialog\'s Cancel comes back to the fill-in dialog with the value still typed', async () => {
      const update = vi.fn().mockRejectedValueOnce(conflict);
      renderBar(update);
      stageWon();
      const dialog = await screen.findByTestId('required-fields-dialog');
      fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancel/i }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      const still = screen.getByTestId('required-fields-dialog');
      expect(winReasonInput(still).value).toBe('Better price');
      expect(update).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('editing')).toHaveTextContent('editing');
    });
  });
});

describe('the drawer\'s per-field callback mode asks for the fields a change makes required (objectstack#35995)', () => {
  it('Save writes the change and the typed value in ONE guarded update, never through the callback', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('editing')).toHaveTextContent('idle'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('deal', 'd1', { stage: 'won', win_reason: 'Better price' }, { ifMatch: 'v1' });
    expect(onFieldSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('the guard is the version the edit began on, not one read again meanwhile', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    const { rereadAs } = renderBar(update, { onFieldSave });
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-stage-won'));
    // The host reads the record again mid-edit (a write elsewhere).
    rereadAs({ ...DATA, priority: 'high', updated_at: 'v2' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('deal', 'd1', { stage: 'won', win_reason: 'Better price' }, { ifMatch: 'v1' });
  });

  it('Cancel writes nothing and keeps the field\'s edit', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('required-fields-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();
    expect(onFieldSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('editing')).toHaveTextContent('editing');
    expect(screen.getByTestId('draft')).toHaveTextContent('"stage":"won"');
  });

  it('control: a change that makes nothing required saves at once through the callback, as before', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-priority'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onFieldSave).toHaveBeenCalledWith('priority', 'high'));
    expect(onFieldSave).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('a 409 keeps the fill-in dialog open under the conflict dialog, with the value still typed', async () => {
    const conflict = {
      code: 'CONCURRENT_UPDATE',
      currentVersion: 'v2',
      currentRecord: { ...DATA, priority: 'high', updated_at: 'v2' },
    };
    const update = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    stageWon();
    const dialog = await screen.findByTestId('required-fields-dialog');
    fireEvent.change(winReasonInput(dialog), { target: { value: 'Better price' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    expect(winReasonInput(screen.getByTestId('required-fields-dialog')).value).toBe('Better price');
    fireEvent.click(screen.getByRole('button', { name: /overwrite/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith('deal', 'd1', { stage: 'won', win_reason: 'Better price' }, { ifMatch: 'v2' });
    expect(onFieldSave).not.toHaveBeenCalled();
  });

  it('control: with no data source handed over there is no one write to make, so it never asks', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave, dataSource: undefined });
    stageWon();
    await waitFor(() => expect(onFieldSave).toHaveBeenCalledWith('stage', 'won'));
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });

  it('RecordDetailPanel hands the bar what it needs: the drawer asks before its per-field save', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })));
    try {
      const schema = {
        name: 'task',
        fields: {
          subject: { type: 'text', label: 'Subject' },
          status: { type: 'text', label: 'Status' },
          outcome: { type: 'text', label: 'Outcome', requiredWhen: 'record.status == "done"' },
        },
      };
      const record = { id: 't1', subject: 'Call Acme', status: 'open', outcome: null, updated_at: 'v1' };
      const update = vi.fn().mockResolvedValue({});
      const onFieldSave = vi.fn().mockResolvedValue(undefined);
      render(
        <RecordDetailPanel
          record={record}
          objectName="task"
          recordId="t1"
          dataSource={{ update } as never}
          objectSchema={schema as never}
          onFieldSave={onFieldSave}
        />,
      );
      fireEvent.doubleClick(screen.getByText('open'));
      fireEvent.change(screen.getByDisplayValue('open'), { target: { value: 'done' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const dialog = await screen.findByTestId('required-fields-dialog');
      const outcome = dialog.querySelector<HTMLInputElement>('[data-required-fields-field="outcome"] input')!;
      fireEvent.change(outcome, { target: { value: 'Signed' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(update).toHaveBeenCalledWith('task', 't1', { status: 'done', outcome: 'Signed' }, { ifMatch: 'v1' });
      expect(onFieldSave).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
