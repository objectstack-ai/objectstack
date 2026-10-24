/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10580 — the bar `ObjectDataTable` draws over its rows while it
 * re-reads them is named in the active locale.
 *
 * `RefreshIndicator` used to default its accessible name to the English
 * literal "Refreshing", and this table passed none, so a screen reader
 * announced English in every locale. The table now names the bar from the
 * pack (`dashboard.refreshing`), and the component has no default left to
 * fall to.
 *
 * The re-read is a changed `filter`, one of the fetch effect's inputs. The data
 * source has no `getObjectSchema`, so nothing else re-runs that effect, and the
 * second `find` is held open by hand: the bar is read while the query really
 * is in flight.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import React from 'react';

// The underlying `data-table` renderer is stubbed so the test does not depend
// on the component registry — the same shape the sibling suites in this
// directory use.
vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="table">
        {(schema.data ?? []).map((row: any, i: number) => (
          <span key={i}>{String(row.name)}</span>
        ))}
      </div>
    ),
  };
});

import { ObjectDataTable } from '../ObjectDataTable';

beforeEach(() => {
  // The provider persists the last language; keep one case from leaking into the next.
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

// Module constants: `I18nProvider` rebuilds its i18next instance whenever the
// `config` object changes identity, so an inline literal would re-boot it on
// every render.
const JA = { defaultLanguage: 'ja', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** The first `find` answers at once; every later one stays in flight. */
function makeDataSource() {
  let calls = 0;
  const find = vi.fn(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve({ data: [{ id: '1', name: 'Northwind' }], total: 1 });
    return new Promise<never>(() => {});
  });
  return { find } as any;
}

const schemaWith = (filter: unknown[]): any => ({
  type: 'object-data-table',
  objectName: 'accounts',
  columns: [{ accessorKey: 'name', header: 'Name' }],
  filter,
});
const FIRST = schemaWith(['stage', '=', 'open']);
const CHANGED = schemaWith(['stage', '=', 'closed']);

const indicator = () => screen.queryByTestId('refresh-indicator');

async function readBarNameDuringReRead(config: typeof JA) {
  const ds = makeDataSource();
  const tree = (schema: any) => (
    <I18nProvider config={config}>
      <ObjectDataTable schema={schema} dataSource={ds} />
    </I18nProvider>
  );
  const { rerender } = render(tree(FIRST));
  await waitFor(() => expect(screen.getByText('Northwind')).toBeInTheDocument());
  expect(indicator(), 'no bar while nothing is in flight').toBeNull();

  rerender(tree(CHANGED));
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(indicator()).not.toBeNull());
  // The rows on screen stay while the re-read runs; the bar sits over them.
  expect(screen.getByText('Northwind')).toBeInTheDocument();
}

describe('ObjectDataTable names its refresh bar in the active locale (objectui#10580)', () => {
  it('ja: the bar is named by the ja pack, not by an English literal', async () => {
    await readBarNameDuringReRead(JA);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: '更新中…' })).toBeInTheDocument());
    expect(indicator()!.getAttribute('aria-label')).not.toMatch(/Refreshing/);
  });

  it('en control: the bar is named by the en pack value', async () => {
    await readBarNameDuringReRead(EN);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Refreshing…' })).toBeInTheDocument());
  });
});
