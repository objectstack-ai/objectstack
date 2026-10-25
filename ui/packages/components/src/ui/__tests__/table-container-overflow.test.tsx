/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression guard for the list-view horizontal-scrollbar fix.
 *
 * The shadcn <Table> wraps its <table> in a scroll <div>. By default that
 * wrapper is `overflow-auto`, making it its OWN horizontal scroll container.
 * When DataTable already renders the table inside a bounded
 * `flex-1 min-h-0 overflow-auto` region, that default wrapper becomes a
 * SECOND, height-unbounded scroll context: it stretches to the full table
 * height, so its horizontal scrollbar sits below the last row — reachable
 * only after scrolling all rows to the bottom (the reported bug).
 *
 * The fix lets callers pass `containerClassName="overflow-visible"` so the
 * outer bounded container owns both axes and the horizontal scrollbar stays
 * pinned to the viewport bottom. This relies on `cn`/twMerge collapsing the
 * conflicting `overflow-*` utilities to the caller's value. jsdom has no
 * layout engine, so we can't measure the scrollbar position here — instead we
 * assert the mechanism: the override wins and the default `overflow-auto` is
 * gone from the wrapper.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Table, TableBody, TableCell, TableRow } from '../table';

function renderTable(containerClassName?: string) {
  const { container } = render(
    <Table containerClassName={containerClassName} data-testid="tbl">
      <TableBody>
        <TableRow>
          <TableCell>cell</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
  // The wrapper <div> is the <table>'s parent element.
  const table = container.querySelector('table')!;
  return table.parentElement as HTMLElement;
}

describe('ui/Table scroll-wrapper container overflow', () => {
  it('defaults the wrapper to overflow-auto (unchanged shadcn behavior)', () => {
    const wrapper = renderTable();
    expect(wrapper.className).toContain('overflow-auto');
    expect(wrapper.className).toContain('relative');
    expect(wrapper.className).toContain('w-full');
  });

  it('lets containerClass="overflow-visible" override the default overflow', () => {
    const wrapper = renderTable('overflow-visible');
    // twMerge must collapse the conflicting overflow utilities to the override.
    expect(wrapper.className).toContain('overflow-visible');
    expect(wrapper.className).not.toContain('overflow-auto');
    // Non-conflicting base utilities are preserved.
    expect(wrapper.className).toContain('relative');
    expect(wrapper.className).toContain('w-full');
  });
});
