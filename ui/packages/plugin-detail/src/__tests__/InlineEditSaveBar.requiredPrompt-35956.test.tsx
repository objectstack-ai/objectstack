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
 *   4. A refusal of that write stays in the dialog.
 *   5. Control: a draft that makes nothing required saves at once, as before;
 *      and the drawer's per-field callback mode never asks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

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
  render(
    <RecordContextProvider objectName="deal" recordId="d1" data={DATA} objectSchema={OBJECT_SCHEMA} dataSource={{ update } as never}>
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="deal"
          recordId="d1"
          data={DATA}
          refresh={refresh}
          {...extra}
        />
      </InlineEditProvider>
    </RecordContextProvider>,
  );
  return { refresh };
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

  it('control: the per-field callback mode (drawer) never asks', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderBar(update, { onFieldSave });
    stageWon();
    await waitFor(() => expect(onFieldSave).toHaveBeenCalledWith('stage', 'won'));
    expect(screen.queryByTestId('required-fields-dialog')).toBeNull();
  });
});
