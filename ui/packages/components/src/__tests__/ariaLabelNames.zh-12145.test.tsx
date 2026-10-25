/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — `@object-ui/components`' accessible names are read from
 * the pack, so under `zh` a screen reader hears the zh pack's words.
 *
 *  - `Spinner`'s status region: `common.loading` (was `"Loading"`).
 *  - the data table's row menu trigger: `table.rowActions` (was `"Row actions"`).
 *  - the `pagination` renderer's previous / next links: `table.previousPage` /
 *    `table.nextPage`. The No-Touch Shadcn primitive keeps its English
 *    defaults; this call site names the links, since the primitive spreads
 *    `props` after them.
 *
 * Every name is read against the PACK, never against a literal, and each zh
 * case first proves the two packs disagree, or it would pin nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { Spinner } from '../custom/spinner';
// Registers `data-table` and `pagination`.
import '../renderers/complex/data-table';
import '../renderers/basic/pagination';

afterEach(cleanup);

const inZh = (node: React.ReactNode) => (
  <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
    {node}
  </I18nProvider>
);

function rowMenuTable() {
  const DataTable = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }>;
  return (
    <PredicateScopeProvider scope={{}}>
      <DataTable
        schema={{
          type: 'data-table',
          pagination: false,
          searchable: false,
          rowActions: true,
          columns: [{ header: 'Name', accessorKey: 'name' }],
          data: [{ id: 'r1', name: 'Ada' }],
          onRowEdit: () => {},
        }}
      />
    </PredicateScopeProvider>
  );
}

function pager() {
  const Pagination = ComponentRegistry.get('pagination') as React.ComponentType<{ schema: unknown }>;
  return <Pagination schema={{ type: 'pagination', currentPage: 2, totalPages: 3 }} />;
}

describe('components name their controls from the pack (objectui#12145)', () => {
  it('with no provider, each name is the en pack value', () => {
    render(
      <>
        <Spinner />
        {rowMenuTable()}
        {pager()}
      </>,
    );
    expect(screen.getByRole('status', { name: en.common.loading })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.table.rowActions })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.table.previousPage })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.table.nextPage })).toBeInTheDocument();
  });

  it('under zh, the spinner is named by the zh pack', async () => {
    expect(zh.common.loading).not.toBe(en.common.loading);
    render(inZh(<Spinner />));
    expect(await screen.findByRole('status', { name: zh.common.loading })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: en.common.loading })).toBeNull();
  });

  it('under zh, the row menu trigger is named by the zh pack', async () => {
    expect(zh.table.rowActions).not.toBe(en.table.rowActions);
    render(inZh(rowMenuTable()));
    expect(await screen.findByRole('button', { name: zh.table.rowActions })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.table.rowActions })).toBeNull();
  });

  it('under zh, the pagination links are named by the zh pack, not by the primitive defaults', async () => {
    expect(zh.table.previousPage).not.toBe(en.table.previousPage);
    expect(zh.table.nextPage).not.toBe(en.table.nextPage);
    render(inZh(pager()));
    expect(await screen.findByRole('link', { name: zh.table.previousPage })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: zh.table.nextPage })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Go to previous page' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Go to next page' })).toBeNull();
  });
});
