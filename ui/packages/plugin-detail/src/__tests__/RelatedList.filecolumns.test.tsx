/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression coverage (objectui#2360): auto-derived related-list columns must
 * NOT drop file/image fields. They have dedicated cell renderers (file-name
 * chip / thumbnail), and excluding them hid business columns like an expense
 * line's receipt attachment unless the author declared columns explicitly.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * This case reads a derived column and the file name its cell draws.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const fields = {
  description: { type: 'text', label: 'Description' },
  amount: { type: 'currency', label: 'Amount' },
  receipt: { type: 'file', label: 'Receipt' },
};

const makeDS = (rows: any[]) => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'expense_line', fields })),
});

describe('RelatedList — file fields survive auto-derived columns', () => {
  it('includes a file field as a column and renders its file name', async () => {
    const rows = [{
      id: 'l1',
      description: 'Taxi',
      amount: 42,
      receipt: { name: 'receipt.pdf', size: 1024, mime_type: 'application/pdf' },
    }];
    render(
      <RelatedList
        title="Expense Lines"
        type="table"
        api="expense_line"
        objectName="expense_line"
        referenceField="expense"
        parentId="EXP-1"
        dataSource={makeDS(rows) as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Receipt')).toBeTruthy(); // the column header
    });
    // The FileCellRenderer shows the stored file's name, not "[object Object]".
    expect(screen.getByText('receipt.pdf')).toBeTruthy();
  });
});
