/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36310 — the record overlay (`RecordDetailPanel`, the quick look
 * of kanban, calendar, gantt and tree) names a field by its label wherever its
 * save bar names one, as the record page does, though it hands the bar no
 * `fieldLabelFor`: the bar labels from the record context the panel provides.
 *
 *   1. A refused save names the field by its label, in the bar's summary.
 *   2. A refusal that names a declared field the record does not carry is
 *      still that field's, labelled — not a bare record-level line.
 *   3. A 409 of the combined write lists each conflict row by its label.
 *   4. Control: a field that declares no label still reads by its name.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { RecordDetailPanel } from '../RecordDetailPanel';

registerAllFields();

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SCHEMA = {
  name: 'deal',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    deal_stage: { type: 'text', label: 'Deal Stage' },
    loss_reason: { type: 'text', label: 'Loss Reason', requiredWhen: 'record.deal_stage == "lost"' },
    memo: { type: 'text' },
    region_code: { type: 'text', label: 'Region' },
  },
};
const RECORD = { id: 'd1', subject: 'Acme deal', deal_stage: 'open', loss_reason: null, memo: 'first call', updated_at: 'v1' };

function renderPanel(opts: { update?: ReturnType<typeof vi.fn>; onFieldSave: ReturnType<typeof vi.fn> }) {
  return render(
    <RecordDetailPanel
      record={RECORD}
      objectName="deal"
      recordId="d1"
      dataSource={{ update: opts.update ?? vi.fn().mockResolvedValue({}) } as never}
      objectSchema={SCHEMA as never}
      onFieldSave={opts.onFieldSave}
    />,
  );
}

/** Edit the body value `from` to `to` and press Save. */
function editAndSave(from: string, to: string) {
  // A value can read in more than one place (the header's highlights, the
  // body); the body's value is the one a double-click edits.
  for (const el of screen.getAllByText(from)) fireEvent.doubleClick(el);
  fireEvent.change(screen.getAllByDisplayValue(from)[0], { target: { value: to } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

/** The save bar's summary line for `field` (the input's own hint is a second alert). */
const summaryLine = (field: string) =>
  document.querySelector<HTMLElement>(`[data-inline-field-error="${field}"]`);

describe('the record overlay names a field by its label (objectstack#36310)', () => {
  it('a refused save names the field by its label', async () => {
    const onFieldSave = vi.fn().mockRejectedValue(new Error('Refused by rule'));
    renderPanel({ onFieldSave });
    editAndSave('open', 'pending');
    await waitFor(() => expect(onFieldSave).toHaveBeenCalledWith('deal_stage', 'pending'));
    await waitFor(() => expect(summaryLine('deal_stage')).not.toBeNull());
    expect(summaryLine('deal_stage')).toHaveTextContent(/^Deal Stage: Refused by rule$/);
  });

  it('a refusal naming a declared field the record does not carry is that field\'s, by its label', async () => {
    const onFieldSave = vi.fn().mockRejectedValue({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { fields: [{ field: 'region_code', message: 'Pick a region first' }] },
    });
    renderPanel({ onFieldSave });
    editAndSave('open', 'pending');
    await waitFor(() => expect(summaryLine('region_code')).not.toBeNull());
    expect(summaryLine('region_code')).toHaveTextContent(/^Region: Pick a region first$/);
    expect(document.querySelector('[data-inline-record-error]')).toBeNull();
  });

  it('a 409 of the combined write lists each conflict row by its label', async () => {
    const update = vi.fn().mockRejectedValue({
      code: 'CONCURRENT_UPDATE',
      currentVersion: 'v2',
      currentRecord: { ...RECORD, deal_stage: 'won', updated_at: 'v2' },
    });
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderPanel({ update, onFieldSave });
    editAndSave('open', 'lost');
    const ask = await screen.findByTestId('required-fields-dialog');
    const reason = ask.querySelector<HTMLInputElement>('[data-required-fields-field="loss_reason"] input')!;
    fireEvent.change(reason, { target: { value: 'Price' } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Save' }));
    const conflict = await screen.findByRole('alertdialog');
    expect(update).toHaveBeenCalledWith('deal', 'd1', { deal_stage: 'lost', loss_reason: 'Price' }, { ifMatch: 'v1' });
    expect(within(conflict).getByText('Deal Stage')).toBeInTheDocument();
    expect(within(conflict).getByText('Loss Reason')).toBeInTheDocument();
    expect(within(conflict).queryByText('deal_stage')).toBeNull();
    expect(within(conflict).queryByText('loss_reason')).toBeNull();
    expect(onFieldSave).not.toHaveBeenCalled();
  });

  it('control: a field that declares no label still reads by its name', async () => {
    const onFieldSave = vi.fn().mockRejectedValue(new Error('Too short'));
    renderPanel({ onFieldSave });
    editAndSave('first call', 'x');
    await waitFor(() => expect(onFieldSave).toHaveBeenCalledWith('memo', 'x'));
    await waitFor(() => expect(summaryLine('memo')).not.toBeNull());
    expect(summaryLine('memo')).toHaveTextContent(/^memo: Too short$/);
  });
});
