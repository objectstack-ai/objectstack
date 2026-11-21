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
