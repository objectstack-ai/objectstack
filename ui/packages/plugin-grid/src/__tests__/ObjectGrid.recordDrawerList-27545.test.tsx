/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545, Target 1 — a list under an open record stays readable,
 * and objectstack#28915 — it keeps its full width.
 *
 * The split pane narrowed the list beside it to three columns or to card
 * rows. It retired: a record opens in the drawer over the list, so the grid
 * draws every view column, avatars and the row-actions label included,
 * whether or not a record is open. The drawer publishes which row is open
 * (`ActiveListRecordProvider`), and that row is marked.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ActiveListRecordProvider } from '@object-ui/components';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function mount(openRecordId: string | null = null, onRowClick = vi.fn()) {
  render(
    <ActionProvider>
      <ActiveListRecordProvider recordId={openRecordId}>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: OBJECT,
              columns: ['photo', 'name', 'company', 'source', 'owner', 'city'],
            } as never}
            dataSource={dataSource as never}
            onRowClick={onRowClick}
          />
      </ActiveListRecordProvider>
    </ActionProvider>,
  );
  return { onRowClick };
}

/** The view columns' headers: the leading row-number / checkbox cell is not one. */
const headerTexts = () =>
  screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim()).filter((text) => text !== '' && text !== '#');

describe('the grid under the record drawer (objectstack#27545, objectstack#28915)', () => {
  const ALL_COLUMNS = ['Photo', 'Lead Name', 'Company', 'Source', 'Owner', 'City'];

  it('a record open: every view column is drawn, in the view\'s order, and a row opens its record', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { onRowClick } = mount('l1');
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    expect(headerTexts()).toEqual(expect.arrayContaining(ALL_COLUMNS));
    expect(screen.getByText('Oslo')).toBeInTheDocument();
    expect(screen.queryByTestId('grid-compact-card')).toBeNull();
    fireEvent.click(screen.getByText('Contoso'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'l2' });
  });

  it('CONTROL — no record open: the same columns', async () => {
    mount(null);
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    expect(headerTexts()).toEqual(expect.arrayContaining(ALL_COLUMNS));
  });

  it('a record open: the row-actions header keeps its label', async () => {
    __clearRecordCrudVerdictCache();
    installExplainDouble();
    render(
      <ActionProvider>
        <ActiveListRecordProvider recordId="l2">
          <ObjectGrid
            schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', 'company'], data: { provider: 'value', items: ROWS } } as never}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </ActiveListRecordProvider>
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Contoso')).toBeInTheDocument());
    const actions = screen.getByRole('columnheader', { name: 'Actions' });
    expect(actions.querySelector('.sr-only')).toBeNull();
    expect(actions.textContent).toContain('Actions');
  });

  it('marks the open record\'s row, and the mark moves with it', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    mount('l2');
    await waitFor(() => expect(screen.getByText('Contoso')).toBeInTheDocument());
    expect(screen.getByText('Contoso').closest('tr')?.hasAttribute('data-active-record')).toBe(true);
    expect(screen.getByText('Fabrikam').closest('tr')?.hasAttribute('data-active-record')).toBe(false);
    cleanup();
    mount('l1');
    await waitFor(() => expect(screen.getByText('Fabrikam')).toBeInTheDocument());
    expect(screen.getByText('Fabrikam').closest('tr')?.hasAttribute('data-active-record')).toBe(true);
  });
});
