/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `row-table` (#31856): the rows a page `api` binding answers, as a table,
 * rendered through the real `SchemaRenderer` with the binding read through the
 * host fetch on `SchemaRendererContext.apiFetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry, formatDateTime, setDisplayTimeZone } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import type { DeclaredNode } from '@object-ui/types';
import '../productBlocks';

const ACTORS = {
  success: true,
  data: {
    actors: [
      { name: 'Ada', status: 'active', lastRun: { at: '2026-11-09T08:30:00Z' } },
      { name: 'Grace', status: 'paused', lastRun: null },
      { name: 'Linus', status: 'retired' },
    ],
    none: [],
    summary: { count: 3 },
  },
};

const BINDING = { provider: 'api', read: { url: '/api/v1/ai/actors' }, path: 'data' } as const;

const COLUMNS = [
  { path: 'name', label: { en: 'Name', 'zh-CN': '名称' } },
  { path: 'status', label: 'Status', format: 'enum', enum: { active: { en: 'Active' }, paused: 'Paused' } },
  { path: 'lastRun.at', label: 'Last run', format: 'datetime' },
];

function renderTable(properties: Record<string, unknown>, bound = true) {
  const apiFetch = vi.fn(async () => new Response(JSON.stringify(ACTORS), { status: 200 }));
  const schema = { type: 'row-table', ...(bound ? { dataSource: BINDING } : {}), properties } as unknown as DeclaredNode;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter>
        <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
          <SchemaRenderer schema={schema} />
        </SchemaRendererContext.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return apiFetch;
}

/** The cell texts of one body row. */
function cells(row: number): string[] {
  return within(screen.getByTestId(`row-table-row-${row}`))
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

afterEach(() => {
  cleanup();
  setDisplayTimeZone(undefined);
});

describe('row-table (#31856)', () => {
  it('registers with declared inputs and the API binding input', () => {
    const config = ComponentRegistry.getConfig('row-table');
    const names = (config?.inputs ?? []).map((input) => input.name);
    expect(names).toEqual(['rows', 'columns', 'emptyLabel', 'dataSource']);
    for (const input of config?.inputs ?? []) expect(input.description, input.name).toBeTruthy();
  });

  it('draws every row the binding answers, its columns in authored order', async () => {
    const apiFetch = renderTable({ rows: '${data.actors}', columns: COLUMNS });
    await waitFor(() => expect(screen.getByTestId('row-table-row-2')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual(['Name', 'Status', 'Last run']);
    expect(cells(0)[0]).toBe('Ada');
    expect(cells(1)[0]).toBe('Grace');
    expect(cells(2)[0]).toBe('Linus');
  });

  it('draws an enum value through its label map, and a value the map does not name as written', async () => {
    renderTable({ rows: '${data.actors}', columns: COLUMNS });
    await waitFor(() => expect(screen.getByTestId('row-table-row-2')).toBeInTheDocument());
    expect(cells(0)[1]).toBe('Active');
    expect(cells(1)[1]).toBe('Paused');
    expect(cells(2)[1]).toBe('retired');
  });

  it('draws a datetime as an instant in the display time zone', async () => {
    setDisplayTimeZone('Asia/Tokyo');
    renderTable({ rows: '${data.actors}', columns: COLUMNS });
    await waitFor(() => expect(screen.getByTestId('row-table-row-0')).toBeInTheDocument());
    const shown = cells(0)[2];
    // The one date-display path, in the declared zone: 08:30Z is 17:30 in Tokyo.
    expect(shown).toBe(formatDateTime('2026-11-09T08:30:00Z', { locale: 'en', style: 'compact' }));
    expect(shown).toMatch(/17:30|5:30/);
    expect(shown).not.toMatch(/08:30|8:30/);
  });

  it('draws "—" for a field the row lacks or holds null', async () => {
    renderTable({ rows: '${data.actors}', columns: COLUMNS });
    await waitFor(() => expect(screen.getByTestId('row-table-row-2')).toBeInTheDocument());
    expect(cells(1)[2]).toBe('—');
    expect(cells(2)[2]).toBe('—');
  });

  it('draws the authored empty label for an empty list, else the bundle\'s', async () => {
    renderTable({ rows: '${data.none}', columns: COLUMNS, emptyLabel: { en: 'No agents yet' } });
    expect((await screen.findByTestId('row-table-empty')).textContent).toBe('No agents yet');
    cleanup();
    renderTable({ rows: [], columns: COLUMNS }, false);
    expect(screen.getByTestId('row-table-empty').textContent).toBe('No rows to display');
  });

  it('refuses a hole that resolves to a non-list with the error panel, never the empty state', async () => {
    renderTable({ rows: '${data.summary}', columns: COLUMNS, emptyLabel: 'No agents yet' });
    const panel = await screen.findByTestId('row-table-datasource-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel.textContent).toContain('rows resolved to an object');
    expect(screen.queryByTestId('row-table-empty')).toBeNull();
  });

  it('refuses a column format it does not draw with the error panel', () => {
    renderTable({ rows: [{ name: 'Ada' }], columns: [{ path: 'name', label: 'Name', format: 'currency' }] }, false);
    const panel = screen.getByTestId('row-table-datasource-error');
    expect(panel.textContent).toContain('columns[0].format "currency"');
    expect(screen.queryByTestId('row-table-block')).toBeNull();
  });
});
