/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: a `fitContent` column (used by the row-actions column) must size
 * to its own content and never clip it. Bug context: the actions column had no
 * string data, so the width auto-sizer pinned it to the 80px floor, and the
 * fixed-width cell's `overflow-hidden` clipped multiple inline action buttons
 * (the cloud environments list showed "Open" cut to a sliver behind "Upgrade
 * Plan"). `fitContent` columns now hug content (`width:1%` + nowrap) with no
 * overflow clamp; normal columns keep `overflow-hidden` truncation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function renderTable(schema: any) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(<DataTable schema={schema} />);
}

const baseSchema = {
  data: [{ id: '1', name: 'Alice' }],
  pagination: false,
  searchable: false,
  columns: [
    { header: 'Name', accessorKey: 'name' },
    {
      header: 'Actions',
      accessorKey: '_acts',
      fitContent: true,
      align: 'right',
      cell: () => <button data-testid="act-btn" type="button">Open · Upgrade Plan</button>,
    },
  ],
};

describe('data-table fitContent column', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  it('does not clip the fitContent cell and hugs its content width', () => {
    renderTable(baseSchema);
    const cell = screen.getByTestId('act-btn').closest('td');
    expect(cell).not.toBeNull();
    // The actions cell must not carry the generic truncation clip.
    expect(cell!.className).not.toContain('overflow-hidden');
    expect(cell!.className).toContain('whitespace-nowrap');
    // It hugs content via a 1% width with no max-width clamp.
    const style = cell!.getAttribute('style') || '';
    expect(style).toContain('width: 1%');
    expect(style).not.toContain('max-width');
  });

  it('keeps overflow-hidden truncation on normal columns', () => {
    renderTable(baseSchema);
    const cell = screen.getByText('Alice').closest('td');
    expect(cell).not.toBeNull();
    expect(cell!.className).toContain('overflow-hidden');
  });
});
