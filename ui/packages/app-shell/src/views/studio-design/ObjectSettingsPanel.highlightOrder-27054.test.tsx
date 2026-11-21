/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `highlightFields` is an ORDERED list (ADR-0085: "first entry wins where only
 * one fits"), and the object settings panel authors it as one.
 *
 * The real panel, inside a host that feeds every patch back into the draft:
 *  - the stored order is the row order, and no strip preview is drawn: the
 *    default record page draws no strip from the key, so the rows are the one
 *    rendering of the list;
 *  - up / down and a drag move a field, and the written list keeps every other
 *    field in place;
 *  - a picked field is appended at the end;
 *  - at six fields the add picker is withdrawn and a note says why; a longer
 *    stored list is shown whole, never truncated;
 *  - removing the last field removes the key.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'select', label: 'Status' },
  amount: { type: 'currency', label: 'Amount' },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  close_date: { type: 'date', label: 'Close date' },
  stage: { type: 'select', label: 'Stage' },
  region: { type: 'text', label: 'Region' },
};

type Row = Record<string, unknown>;

function Host({ initial, writes }: { initial: Row; writes: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  return (
    <ObjectSettingsPanel
      name="deal"
      draft={draft}
      onPatch={(patch: Row) => setDraft((d) => {
        const next = { ...d, ...patch };
        writes.push(next);
        return next;
      })}
      locale="en-US"
    />
  );
}

const rowOrder = () =>
  screen.getAllByTestId(/^highlight-row-/).map((el) => el.getAttribute('data-testid')!.replace('highlight-row-', ''));
const lastHighlights = (writes: Row[]) => writes.at(-1)!.highlightFields;

describe('ObjectSettingsPanel — highlightFields is an ordered pick list', () => {
  it('shows the stored order in the rows, and draws no strip preview', () => {
    render(<Host initial={{ fields: FIELDS, highlightFields: ['status', 'amount', 'name'] }} writes={[]} />);
    expect(rowOrder()).toEqual(['status', 'amount', 'name']);
    // The editor itself is drawn (the control), with no preview beside its rows.
    expect(screen.getByTestId('highlight-fields-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('highlight-preview')).toBeNull();
    expect(screen.queryAllByTestId('highlight-preview-cell')).toHaveLength(0);
  });

  it('moves a field with the up / down buttons, keeping every other field in place', () => {
    const writes: Row[] = [];
    render(<Host initial={{ fields: FIELDS, highlightFields: ['status', 'amount', 'name'] }} writes={writes} />);
    const amountRow = screen.getByTestId('highlight-row-amount');
    fireEvent.click(within(amountRow).getByRole('button', { name: 'Move up' }));
    expect(lastHighlights(writes)).toEqual(['amount', 'status', 'name']);
    expect(rowOrder()).toEqual(['amount', 'status', 'name']);
    fireEvent.click(within(screen.getByTestId('highlight-row-amount')).getByRole('button', { name: 'Move down' }));
    expect(lastHighlights(writes)).toEqual(['status', 'amount', 'name']);
  });

  it('moves a field by dragging it onto another row', () => {
    const writes: Row[] = [];
    render(<Host initial={{ fields: FIELDS, highlightFields: ['status', 'amount', 'name'] }} writes={writes} />);
    const from = screen.getByTestId('highlight-row-name');
    const to = screen.getByTestId('highlight-row-status');
    expect(from).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(from);
    fireEvent.dragOver(to);
    fireEvent.drop(to);
    expect(lastHighlights(writes)).toEqual(['name', 'status', 'amount']);
    expect(rowOrder()).toEqual(['name', 'status', 'amount']);
  });

  it('appends a picked field at the end', async () => {
    const writes: Row[] = [];
    render(<Host initial={{ fields: FIELDS, highlightFields: ['status'] }} writes={writes} />);
    fireEvent.keyDown(screen.getByTestId('highlight-add-select'), { key: 'ArrowDown' });
    const list = within(await screen.findByRole('listbox'));
    // An already-picked field is not offered again.
    expect(list.queryByRole('option', { name: 'Status (status)' })).toBeNull();
    fireEvent.click(list.getByRole('option', { name: 'Owner (owner)' }));
    expect(lastHighlights(writes)).toEqual(['status', 'owner']);
  });

  it('withdraws the add picker at six fields, and shows a longer stored list whole', () => {
    const six = ['name', 'status', 'amount', 'owner', 'close_date', 'stage'];
    render(<Host initial={{ fields: FIELDS, highlightFields: six }} writes={[]} />);
    expect(screen.queryByTestId('highlight-add-select')).toBeNull();
    expect(screen.getByTestId('highlight-max-note')).toHaveTextContent(
      t('engine.studio.settings.highlightMax', 'en-US').replace('{max}', '6'),
    );
    cleanup();

    // Control: under the cap the picker is offered.
    render(<Host initial={{ fields: FIELDS, highlightFields: six.slice(0, 5) }} writes={[]} />);
    expect(screen.getByTestId('highlight-add-select')).toBeInTheDocument();
    expect(screen.queryByTestId('highlight-max-note')).toBeNull();
    cleanup();

    render(<Host initial={{ fields: FIELDS, highlightFields: [...six, 'region'] }} writes={[]} />);
    expect(rowOrder()).toHaveLength(7);
    expect(screen.queryByTestId('highlight-add-select')).toBeNull();
  });

  it('removing the last field removes the key', () => {
    const writes: Row[] = [];
    render(<Host initial={{ fields: FIELDS, highlightFields: ['status'] }} writes={writes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove status' }));
    expect(writes.at(-1)!.highlightFields).toBeUndefined();
    expect(screen.queryAllByTestId(/^highlight-row-/)).toHaveLength(0);
    expect(screen.getByText(t('engine.studio.settings.undeclared', 'en-US'))).toBeInTheDocument();
  });
});
