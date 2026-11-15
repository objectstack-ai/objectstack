/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

/**
 * objectstack#33346 (row 118) — a 409 on an inline save that changed SEVERAL
 * fields used to fold them into one entry whose "your edit" and "current value"
 * were the two whole maps, which the dialog printed as raw JSON
 * (`{"status":"active","budget":100}`). It now lists each field on its own
 * row: the field's label, the value the user wrote, the value on the server.
 *
 * Driven through the real save path: fields staged in the shared inline-edit
 * context, Save clicked, the data source answering the 409 the adapter raises.
 */

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setField('status', 'active')}>edit-status</button>
      <button onClick={() => inline.setField('budget', 100)}>edit-budget</button>
    </>
  );
}

const LABELS: Record<string, string> = { status: 'Stage', budget: 'Budget' };

function renderBar() {
  const update = vi.fn().mockRejectedValue({
    code: 'CONCURRENT_UPDATE',
    currentVersion: 'v2',
    currentRecord: { status: 'closed', budget: 250, updated_at: 'v2' },
  });
  render(
    <InlineEditProvider canEdit>
      <Harness />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="proj"
        recordId="p1"
        data={{ updated_at: 'v1' }}
        refresh={vi.fn()}
        fieldLabelFor={(name) => LABELS[name]}
      />
    </InlineEditProvider>,
  );
  return { update };
}

describe('#33346 row 118 — a multi-field conflict reads per field, never as raw JSON', () => {
  it('lists each conflicting field with its label and both values', async () => {
    const { update } = renderBar();
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-status'));
    fireEvent.click(screen.getByText('edit-budget'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole('alertdialog');

    const rows = within(dialog).getAllByTestId('concurrent-update-field');
    expect(rows.map((r) => r.getAttribute('data-field'))).toEqual(['status', 'budget']);
    expect(within(rows[0]).getByText('Stage')).toBeInTheDocument();
    expect(within(rows[0]).getByText('active')).toBeInTheDocument();
    expect(within(rows[0]).getByText('closed')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Budget')).toBeInTheDocument();
    expect(within(rows[1]).getByText('100')).toBeInTheDocument();
    expect(within(rows[1]).getByText('250')).toBeInTheDocument();
    // No raw JSON anywhere in the dialog.
    expect(dialog.textContent).not.toMatch(/[{}]|"status"|"budget"/);
    // The resolver is still the same three choices.
    expect(within(dialog).getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /overwrite/i })).toBeInTheDocument();
  });

  it('CONTROL — a single-field conflict keeps the one before/after pair', async () => {
    const { update } = renderBar();
    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-status'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByTestId('concurrent-update-field-list')).toBeNull();
    expect(within(dialog).getByText('Stage')).toBeInTheDocument();
    expect(within(dialog).getByText('active')).toBeInTheDocument();
    expect(within(dialog).getByText('closed')).toBeInTheDocument();
  });
});
