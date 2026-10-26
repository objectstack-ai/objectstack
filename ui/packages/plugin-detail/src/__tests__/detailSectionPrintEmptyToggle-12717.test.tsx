/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12717 — on a page that declares `print`, a detail section prints
 * every field it declares and no "Show N empty fields" toggle.
 *
 * The empty-field auto-hide is a screen density heuristic nobody authored. On
 * paper it hid the empty rows and left its interactive toggle behind, while
 * `record:details` is in the printable block subset because it prints every
 * field it declares (objectui#11958). Under a `PrintPageProvider` the heuristic
 * is off: every declared row draws and there is no toggle. The AUTHORED
 * all-empty hide (`hideEmpty: true`) keeps doing what it declares on paper: the
 * section draws nothing. Off a print page all of it is unchanged.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer, PrintPageProvider } from '@object-ui/react';
// Module scope: importing the package index runs the registrations under test.
import '../index';

/** Four declared rows, two of them empty: the heuristic fires on screen. */
const sparseSection = {
  type: 'detail-section',
  title: 'Invoice Details',
  fields: [
    { name: 'number', label: 'Number' },
    { name: 'customer', label: 'Customer' },
    { name: 'po_number', label: 'PO Number' },
    { name: 'notes', label: 'Notes' },
  ],
} as never;

const SPARSE_RECORD = { number: 'INV-001', customer: 'Acme', po_number: null, notes: '' };

const allEmptyHiddenSection = {
  type: 'detail-section',
  title: 'Shipping Address',
  hideEmpty: true,
  fields: [
    { name: 'street', label: 'Street' },
    { name: 'city', label: 'City' },
  ],
} as never;

const PRINT = { paperSize: 'A4' } as never;

const toggle = () => screen.queryByRole('button', { name: /empty fields/i });

afterEach(() => cleanup());

describe('a detail section on a print page prints every declared field (objectui#12717)', () => {
  it('under a print page: no empty-field toggle, and every declared row draws, empty ones included', () => {
    render(
      <PrintPageProvider value={PRINT}>
        <SchemaRenderer schema={sparseSection} data={SPARSE_RECORD} />
      </PrintPageProvider>,
    );
    expect(toggle()).toBeNull();
    expect(screen.queryByText(/empty fields/i)).toBeNull();
    for (const label of ['Number', 'Customer', 'PO Number', 'Notes']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByTitle('No value')).toHaveLength(2);
  });

  it('under a print page: an authored `hideEmpty: true` all-empty section draws nothing', () => {
    const { container } = render(
      <PrintPageProvider value={PRINT}>
        <SchemaRenderer schema={allEmptyHiddenSection} data={{ street: null, city: '' }} />
      </PrintPageProvider>,
    );
    expect(screen.queryByText('Shipping Address')).toBeNull();
    expect(screen.queryByText('Street')).toBeNull();
    expect(toggle()).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('CONTROL — off a print page the heuristic hides the empty rows behind the toggle', () => {
    render(<SchemaRenderer schema={sparseSection} data={SPARSE_RECORD} />);
    expect(toggle()?.textContent).toMatch(/Show 2 empty fields/);
    expect(screen.getByText('Number')).toBeTruthy();
    expect(screen.queryByText('PO Number')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  });
});
