/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545, Target 1 — a list beside an open record stays readable.
 *
 * The record pane publishes the face it narrowed the list to
 * (`RecordListFaceProvider`): at ≥ 440 px the grid keeps its first three
 * view columns that are not avatars (and its row actions); narrower, it draws
 * one card row per record — the name and two chips — that opens the record
 * like a table row. Under no pane (`full`) every column is drawn. The row of
 * the open record is marked in both faces.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { RecordListFaceProvider, ActiveListRecordProvider, type RecordListFace } from '@object-ui/components';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

afterEach(() => cleanup());

const OBJECT = 'crm_lead';
const OBJECT_FIELDS = {
  photo: { name: 'photo', type: 'avatar', label: 'Photo' },
  name: { name: 'name', type: 'text', label: 'Lead Name' },
  company: { name: 'company', type: 'text', label: 'Company' },
  source: { name: 'source', type: 'text', label: 'Source' },
  owner: { name: 'owner', type: 'text', label: 'Owner' },
  city: { name: 'city', type: 'text', label: 'City' },
};
const ROWS = [
  { id: 'l1', photo: null, name: 'Fabrikam', company: 'Fabrikam Inc', source: 'Web', owner: 'Ada', city: 'Oslo' },
  { id: 'l2', photo: null, name: 'Contoso', company: 'Contoso Ltd', source: 'Event', owner: 'Bo', city: 'Rome' },
];

const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => true,
  getObjectSchema: async () => ({ name: OBJECT, fields: OBJECT_FIELDS }),
};

function mount(face: RecordListFace, openRecordId: string | null = null, onRowClick = vi.fn()) {
  render(
    <ActionProvider>
      <ActiveListRecordProvider recordId={openRecordId}>
        <RecordListFaceProvider value={face}>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: OBJECT,
              columns: ['photo', 'name', 'company', 'source', 'owner', 'city'],
            } as never}
            dataSource={dataSource as never}
            onRowClick={onRowClick}
          />
        </RecordListFaceProvider>
      </ActiveListRecordProvider>
    </ActionProvider>,
  );
  return { onRowClick };
}

/** The view columns' headers: the leading row-number / checkbox cell is not one. */
const headerTexts = () =>
  screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim()).filter((text) => text !== '' && text !== '#');

describe('the grid beside a record pane (objectstack#27545)', () => {
  it('`columns`: the first three view columns that are not avatars, in the view\'s order', async () => {
    mount('columns');
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    expect(headerTexts()).toEqual(['Lead Name', 'Company', 'Source']);
    expect(screen.queryByText('Oslo')).toBeNull();
  });

  it('CONTROL — `full` (no pane): every view column is drawn', async () => {
    mount('full');
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    const headers = headerTexts();
    expect(headers).toEqual(expect.arrayContaining(['Photo', 'Lead Name', 'Company', 'Source', 'Owner', 'City']));
  });

  it('`cards`: one card row per record — the name and two chips — that opens the record', async () => {
    const { onRowClick } = mount('cards');
    await waitFor(() => expect(screen.getAllByTestId('grid-compact-card')).toHaveLength(2));
    expect(screen.queryByRole('columnheader')).toBeNull();
    const [first] = screen.getAllByTestId('grid-compact-card');
    expect(first.querySelector('[data-testid="grid-card-title"]')?.textContent).toContain('Fabrikam');
    const chips = Array.from(first.querySelectorAll('[data-testid="grid-compact-card-chip"]')).map((c) => c.textContent);
    expect(chips).toEqual(['Fabrikam Inc', 'Web']);
    fireEvent.click(first);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'l1' });
  });

  it('marks the open record\'s row in both faces', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    mount('columns', 'l2');
    await waitFor(() => expect(screen.getByText('Contoso')).toBeInTheDocument());
    expect(screen.getByText('Contoso').closest('tr')?.hasAttribute('data-active-record')).toBe(true);
    expect(screen.getByText('Fabrikam').closest('tr')?.hasAttribute('data-active-record')).toBe(false);
    cleanup();
    mount('cards', 'l2');
    await waitFor(() => expect(screen.getAllByTestId('grid-compact-card')).toHaveLength(2));
    const cards = screen.getAllByTestId('grid-compact-card');
    expect(cards.map((c) => c.hasAttribute('data-active-record'))).toEqual([false, true]);
  });
});
