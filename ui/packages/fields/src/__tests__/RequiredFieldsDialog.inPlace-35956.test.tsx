/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35956 — the shared fill-in dialog: it names the record and the
 * change that opened it, adds a field a typed value makes required, and keeps
 * a refusal inside the dialog (under the field it names, as a new row for a
 * field the reader can fill, or at the foot).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { RequiredFieldsDialog, type RequiredFieldsDialogField } from '../RequiredFieldsDialog';
import { collectRequiredWhenPromptFields } from '../requiredWhenPrompt';

afterEach(() => cleanup());

const OBJECT_FIELDS = {
  stage: { type: 'select', label: 'Stage', options: [{ value: 'won', label: 'Won' }] },
  win_reason: { type: 'text', label: 'Win Reason', requiredWhen: 'record.stage == "won"' },
  competitor: { type: 'text', label: 'Competitor', requiredWhen: 'record.win_reason == "price"' },
  notes: { type: 'textarea', label: 'Notes' },
};
const RECORD = { id: 'o1', name: 'Acme deal', stage: 'open', win_reason: null, competitor: null };
const CHANGE = { stage: 'won' };

const labelled = (fields: ReturnType<typeof collectRequiredWhenPromptFields>): RequiredFieldsDialogField[] =>
  fields.map((f) => ({ ...f, label: String((f.def as { label?: unknown }).label ?? f.name) }));

function renderDialog(onSubmit: (values: Record<string, unknown>) => void | Promise<void>, onCancel = vi.fn()) {
  render(
    <RequiredFieldsDialog
      open
      fields={labelled(collectRequiredWhenPromptFields(OBJECT_FIELDS, RECORD, CHANGE))}
      recordName="Acme deal"
      changes={[{ name: 'stage', label: 'Stage', value: 'Won' }]}
      moreFields={(values) => labelled(collectRequiredWhenPromptFields(
        OBJECT_FIELDS,
        RECORD,
        { ...CHANGE, ...values },
        { exclude: Object.keys(CHANGE) },
      ))}
      refusalField={(name) => (name === 'notes'
        ? { name, label: 'Notes', def: { name, ...OBJECT_FIELDS.notes } }
        : null)}
      labelOf={(name) => (name in OBJECT_FIELDS ? (OBJECT_FIELDS as Record<string, { label: string }>)[name].label : undefined)}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />,
  );
  return screen.getByTestId('required-fields-dialog');
}

const textboxOf = (dialog: HTMLElement, name: string) =>
  within(dialog.querySelector(`[data-required-fields-field="${name}"]`) as HTMLElement).getByRole('textbox');

describe('RequiredFieldsDialog in place (objectstack#35956)', () => {
  it('names the record and the change that opened it, read-only, above the fields', () => {
    const dialog = renderDialog(vi.fn());
    expect(within(dialog).getByText('Acme deal')).toBeInTheDocument();
    const row = dialog.querySelector('[data-required-fields-change-row="stage"]') as HTMLElement;
    expect(row).toHaveTextContent('Stage:');
    expect(row).toHaveTextContent('Won');
    // The change is not an input.
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(dialog.querySelector('[data-required-fields-field="win_reason"]')).not.toBeNull();
  });

  it('adds the field a typed value makes required, and waits for it before saving', () => {
    const onSubmit = vi.fn();
    const dialog = renderDialog(onSubmit);
    // CONTROL: no Competitor row before the value that requires it.
    expect(dialog.querySelector('[data-required-fields-field="competitor"]')).toBeNull();
    fireEvent.change(textboxOf(dialog, 'win_reason'), { target: { value: 'price' } });
    expect(dialog.querySelector('[data-required-fields-field="competitor"]')).not.toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Required')).toBeInTheDocument();

    fireEvent.change(textboxOf(dialog, 'competitor'), { target: { value: 'Globex' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ win_reason: 'price', competitor: 'Globex' });
  });

  it('keeps a refusal in the dialog: under its field, as a new row, or at the foot', async () => {
    const refusal = Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      details: {
        fields: [
          { field: 'win_reason', message: 'Too short' },
          { field: 'notes', message: 'Notes are required' },
          { field: 'stage', message: 'Stage cannot move back' },
        ],
      },
    });
    const onSubmit = vi.fn().mockRejectedValueOnce(refusal);
    const onCancel = vi.fn();
    const dialog = renderDialog(onSubmit, onCancel);
    fireEvent.change(textboxOf(dialog, 'win_reason'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(dialog.querySelector('[data-required-fields-error="win_reason"]')).toHaveTextContent('Too short'));
    // A field the reader can fill joins the dialog with its reason …
    expect(dialog.querySelector('[data-required-fields-field="notes"]')).not.toBeNull();
    expect(dialog.querySelector('[data-required-fields-error="notes"]')).toHaveTextContent('Notes are required');
    // … and a reason about a field it cannot offer reads at the foot, named.
    expect(dialog.querySelector('[data-required-fields-refusal]')).toHaveTextContent('Stage: Stage cannot move back');
    // The dialog did not close.
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('required-fields-dialog')).toBeInTheDocument();
  });

  it('a refusal naming no field reads at the foot', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('The record was changed by someone else'));
    const dialog = renderDialog(onSubmit);
    fireEvent.change(textboxOf(dialog, 'win_reason'), { target: { value: 'better fit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-required-fields-refusal]')).toHaveTextContent('The record was changed by someone else'));
  });

  it('Cancel hands back to the host and submits nothing', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const dialog = renderDialog(onSubmit, onCancel);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('RequiredFieldsDialog with nothing to fill (objectstack#35956 PR 2, the stage menu)', () => {
  it('is the change confirmation: Save takes the focus, and Save submits at once', async () => {
    const onSubmit = vi.fn();
    render(
      <RequiredFieldsDialog
        open
        fields={[]}
        recordName="Acme deal"
        changes={[{ name: 'stage', label: 'Stage', value: 'Negotiation' }]}
        submitLabel="Move"
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const dialog = screen.getByTestId('required-fields-dialog');
    expect(dialog.querySelector('[data-required-fields-field]')).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move' })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));
  });

  it('control: with a field to fill, that field takes the focus, not Save', async () => {
    const dialog = renderDialog(vi.fn());
    await waitFor(() => expect(textboxOf(dialog, 'win_reason')).toHaveFocus());
  });
});

describe('RequiredFieldsDialog judges option visibleWhen on the record with the change merged in (objectstack#37250)', () => {
  // The shape hotcrm authors on `crm_opportunity.loss_reason`: every option is
  // offered only once the record is (or is being moved to) `closed_lost` —
  // i.e. it reads the very field the change writes.
  const LOST_ONLY =
    '(has(record.stage) && record.stage == "closed_lost") || (has(record.requested_status) && record.requested_status == "closed_lost")';
  const PENDING_FIELDS = {
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'closed_lost', label: 'Closed Lost' },
        { value: 'closed_won', label: 'Closed Won' },
      ],
    },
    loss_reason: {
      type: 'select',
      label: 'Loss Reason',
      requiredWhen: 'record.stage == "closed_lost"',
      options: [
        { value: 'price', label: 'Price', visibleWhen: LOST_ONLY },
        { value: 'timing', label: 'Timing', visibleWhen: LOST_ONLY },
      ],
    },
    loss_channel: {
      type: 'radio',
      label: 'Loss Channel',
      requiredWhen: 'record.stage == "closed_lost"',
      options: [
        { value: 'lost_option', label: 'Lost option', visibleWhen: LOST_ONLY },
        { value: 'won_option', label: 'Won option', visibleWhen: 'record.stage == "closed_won"' },
        { value: 'plain_option', label: 'Plain option' },
        { value: 'detail_option', label: 'Detail option', visibleWhen: 'record.loss_detail == "price"' },
      ],
    },
    loss_detail: { type: 'text', label: 'Loss Detail', requiredWhen: 'record.stage == "closed_lost"' },
  };
  const STORED = { id: 'o2', name: 'Globex deal', stage: 'negotiation', loss_reason: null, loss_channel: null, loss_detail: null };
  const MOVE = { stage: 'closed_lost' };

  const renderPending = () => {
    render(
      <RequiredFieldsDialog
        open
        fields={labelled(collectRequiredWhenPromptFields(PENDING_FIELDS, STORED, MOVE))}
        recordName="Globex deal"
        changes={[{ name: 'stage', label: 'Stage', value: 'Closed Lost' }]}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    return screen.getByTestId('required-fields-dialog');
  };
  const rowOf = (dialog: HTMLElement, name: string) =>
    dialog.querySelector(`[data-required-fields-field="${name}"]`) as HTMLElement;

  it('the collector carries the record it judged: the stored record with the change merged in', () => {
    const out = collectRequiredWhenPromptFields(PENDING_FIELDS, STORED, MOVE);
    expect(out.map((f) => f.name)).toEqual(['loss_reason', 'loss_channel', 'loss_detail']);
    for (const f of out) expect(f.record).toEqual({ ...STORED, ...MOVE });
  });

  it('a select whose options read the changed field offers them, instead of the empty state', () => {
    const dialog = renderPending();
    const row = rowOf(dialog, 'loss_reason');
    expect(row).not.toBeNull();
    expect(row.querySelector('[data-testid="select-empty-loss_reason"]')).toBeNull();
    expect(within(row).getByRole('combobox')).toBeInTheDocument();
  });

  it('offers exactly the options visible on the merged record', () => {
    const dialog = renderPending();
    const row = rowOf(dialog, 'loss_channel');
    expect(row.querySelector('[data-testid="radio-empty-loss_channel"]')).toBeNull();
    expect(within(row).getByText('Lost option')).toBeInTheDocument();
    expect(within(row).getByText('Plain option')).toBeInTheDocument();
    // Judged on the merged record, not opened up: `stage` is `closed_lost`, so
    // the won-only option stays hidden.
    expect(within(row).queryByText('Won option')).toBeNull();
    expect(within(row).queryByText('Detail option')).toBeNull();
  });

  it('a value typed into the dialog joins the record the other rows read', () => {
    const dialog = renderPending();
    expect(within(rowOf(dialog, 'loss_channel')).queryByText('Detail option')).toBeNull();
    fireEvent.change(within(rowOf(dialog, 'loss_detail')).getByRole('textbox'), { target: { value: 'price' } });
    expect(within(rowOf(dialog, 'loss_channel')).getByText('Detail option')).toBeInTheDocument();
  });
});
