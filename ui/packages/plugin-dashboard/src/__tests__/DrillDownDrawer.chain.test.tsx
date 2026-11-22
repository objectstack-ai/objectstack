/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The drill list stacks no record panel over the drill
 * (objectstack-ai/objectstack#36256 item 6): a record opens as its page from
 * the standard list's record name. Without the standard list registered, the
 * data-table fallback lists the records and its rows open nothing.
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

describe('DrillDownDrawer — no record panel stacked over the drill', () => {
  it('the data-table fallback rows open no record drawer', async () => {
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

    // The data-table marks clickable rows with `cursor-pointer` only when an
    // onRowClick is wired, which ObjectDataTable does only when record drill
    // is enabled — and the drill list no longer enables it.
    const row = screen.getByText('Acme Renewal').closest('tr') as HTMLElement;
    expect(row.className).not.toContain('cursor-pointer');
  });
});
