/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36147 item 6 — in the record page's field list the record's
 * provenance is its last group, 「系统信息」, folded until opened: created by,
 * created on, updated by, updated on, the owner when the body does not draw
 * it, and the record id, one field a row like every other group. It replaces
 * the one-line meta footer there (objectui#12307's line); outside the field
 * list the line is unchanged.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { DefaultRecordPageContext, DetailsColumnCapContext } from '../defaultRecordPage';
import { createEmptyFieldTally, RecordFieldListContext } from '../recordFieldList';

afterEach(cleanup);

const data = {
  id: 'C-1',
  created_at: '2026-10-16T08:00:00Z',
  created_by: 'Ada Admin',
  updated_at: '2026-11-02T09:30:00Z',
  updated_by: 'Bo Builder',
  owner_id: 'Cy Owner',
};
const contact = { name: 'contact', fields: { name: { type: 'text', label: 'Name' } } };

const inFieldList = (node: React.ReactNode) => (
  <DefaultRecordPageContext.Provider value>
    <DetailsColumnCapContext.Provider value={1}>
      <RecordFieldListContext.Provider value={{ showEmpty: false, toggleShowEmpty: vi.fn(), emptyFields: createEmptyFieldTally() }}>
        {node}
      </RecordFieldListContext.Provider>
    </DetailsColumnCapContext.Provider>
  </DefaultRecordPageContext.Provider>
);

const rowLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-detail-field-label]')).map((el) => el.textContent);

describe('「系统信息」: the provenance as the field list’s last group (objectstack#36147 item 6)', () => {
  it('is one folded group, opened by its title row, holding one row per fact', () => {
    const { container } = render(inFieldList(<RecordMetaFooter data={data} objectSchema={contact} />));
    expect(container.querySelector('[data-record-system-info]')).not.toBeNull();
    // Not the one-line footer.
    expect(container.querySelector('[data-record-meta-entry]')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'System information' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rowLabels(container)).toEqual([]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rowLabels(container)).toEqual(['Created by', 'Created on', 'Updated by', 'Updated on', 'Owner', 'Record ID']);
    expect(screen.getByText('C-1')).toBeTruthy();
  });

  it('no row offers edit, and none reports a field the body draws', () => {
    const { container } = render(inFieldList(<RecordMetaFooter data={data} objectSchema={contact} />));
    fireEvent.click(screen.getByRole('button', { name: 'System information' }));
    for (const row of Array.from(container.querySelectorAll('[data-detail-field-row]'))) {
      expect(row.querySelector('[aria-label="Double-click to edit"]')).toBeNull();
    }
  });

  it('a record never updated after it was made has no updated rows', () => {
    const fresh = { ...data, updated_at: data.created_at, updated_by: data.created_by };
    const { container } = render(inFieldList(<RecordMetaFooter data={fresh} objectSchema={contact} />));
    fireEvent.click(screen.getByRole('button', { name: 'System information' }));
    expect(rowLabels(container)).toEqual(['Created by', 'Created on', 'Owner', 'Record ID']);
  });

  it('control: outside the field list the one-line footer is unchanged', () => {
    const { container } = render(
      <DefaultRecordPageContext.Provider value>
        <RecordMetaFooter data={data} objectSchema={contact} />
      </DefaultRecordPageContext.Provider>,
    );
    expect(container.querySelector('[data-record-system-info]')).toBeNull();
    expect(container.querySelectorAll('[data-record-meta-entry]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-record-meta-id]')!.textContent).toBe('C-1');
  });
});
