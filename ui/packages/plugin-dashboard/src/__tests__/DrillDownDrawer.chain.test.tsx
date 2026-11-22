/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The drill list stacks no record panel over the drill
 * (objectstack-ai/objectstack#36256 item 6): a record opens as its page from
 * the standard list's record name. Without the standard list registered, the
 * data-table fallback lists the records and, when the host offers a record
 * page, its rows open nothing. A host with no record page (a page block)
 * keeps the rows drill-to-record, as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { DrillNavigationProvider } from '@object-ui/react';
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

const drill = () => (
  <DrillDownDrawer
    open
    onClose={vi.fn()}
    title="Won × Web"
    objectName="opportunity"
    filter={{ stage: 'won' }}
    dataSource={makeDataSource()}
  />
);

/** The data-table marks a row `cursor-pointer` only when an onRowClick is wired. */
const rowOf = async (name: string) => {
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  return screen.getByText(name).closest('tr') as HTMLElement;
};

describe('DrillDownDrawer — no record panel stacked over the drill', () => {
  it('the data-table fallback rows open no record drawer when the host offers a record page', async () => {
    render(<DrillNavigationProvider value={{ openRecord: vi.fn() }}>{drill()}</DrillNavigationProvider>);
    expect((await rowOf('Acme Renewal')).className).not.toContain('cursor-pointer');
  });

  it('a host with no record page keeps the rows drill-to-record', async () => {
    render(drill());
    expect((await rowOf('Acme Renewal')).className).toContain('cursor-pointer');
  });
});
