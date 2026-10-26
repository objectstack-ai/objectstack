/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Verifies the drill chain completes through DrillDownDrawer: the filtered
 * record list it renders (for pivot / dataset / chart drill-through) is itself
 * drill-to-record, so clicking a row opens that record.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { DrillDownDrawer } from '../DrillDownDrawer';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

const records = [
  { id: '1', name: 'Acme Renewal', amount: 1500 },
  { id: '2', name: 'Globex Expansion', amount: 9000 },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: records })),
    getObjectSchema: vi.fn(async () => ({
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
    })),
  };
}

describe('DrillDownDrawer — completes the drill chain to a record', () => {
  it('wires record drill on the filtered drill list (chain completion)', async () => {
    render(
      <DrillDownDrawer
        open
        onClose={vi.fn()}
        title="Won × Web"
        objectName="opportunity"
        filter={{ stage: 'won' }}
        dataSource={makeDataSource()}
      />,
    );

    // The drill-through list renders the underlying records.
    await waitFor(() => expect(screen.getByText('Acme Renewal')).toBeInTheDocument());

    // Its rows are drill-to-record: the data-table marks clickable rows with
    // `cursor-pointer` only when an onRowClick is wired, which ObjectDataTable
    // does only when record drill is enabled. (The record drawer opening on
    // click is covered by ObjectDataTable.drill.test.)
    const row = screen.getByText('Acme Renewal').closest('tr') as HTMLElement;
    expect(row.className).toContain('cursor-pointer');
  });
});
