/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Export what the user is looking at."
 *
 * The server-streamed export mirrored the view's FILTER and sort, and the code
 * comment claimed that made the file match the screen. It did not: there was no
 * way to carry the search term, and `ExportDownloadRequest` had no field for
 * one. Exporting during a search downloaded the UNSEARCHED superset — more rows
 * than the list showed, in a file that looks authoritative, with nothing saying
 * so. (The client-side fallback was always right; it serializes the already
 * searched `data`. Only the server path was wrong — and it is the one that
 * handles xlsx.) Server half: objectstack#4230.
 *
 * The filter half was built twice — once for the fetch, once for the export —
 * as verbatim copies that had to stay in sync. Those two decide what the user
 * SEES and what they DOWNLOAD, so the parity test below compares the real
 * arguments of the two real calls rather than asserting a shape twice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won' }];

function harness(schema: ListViewSchema, props: Record<string, unknown> = {}) {
  const exportDownload = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'text/csv' }));
  const find = vi.fn().mockResolvedValue({ data: RECORDS, total: 1 });
  const ds: any = { find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), exportDownload };
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema }} dataSource={ds} {...props} />
    </SchemaRendererProvider>,
  );
  return { exportDownload, find };
}

async function clickExportCsv() {
  fireEvent.click(screen.getByRole('button', { name: /export/i }));
  fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
}

const BASE: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name'],
  exportOptions: { formats: ['csv'] },
};

describe('ListView export mirrors the active view', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('carries the active search term', async () => {
    const { exportDownload } = harness(BASE, { initialSearchTerm: 'acme' });
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]).toMatchObject({ search: 'acme' });
  });

  it('forwards the view’s searchableFields alongside the term', async () => {
    const { exportDownload } = harness(
      { ...BASE, searchableFields: ['name', 'stage'] },
      { initialSearchTerm: 'acme' },
    );
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]).toMatchObject({
      search: 'acme',
      searchFields: ['name', 'stage'],
    });
  });

  it('sends no search key when nothing is searched', async () => {
    const { exportDownload } = harness(BASE);
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]).not.toHaveProperty('search');
    expect(exportDownload.mock.calls[0][1]).not.toHaveProperty('searchFields');
  });

  it('omits searchFields when the view declares none', async () => {
    const { exportDownload } = harness(BASE, { initialSearchTerm: 'acme' });
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]).not.toHaveProperty('searchFields');
  });
});

describe('a MongoDB-style view filter is not dropped', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * `ObjectView` passes `mergedFilters` straight into this schema's `filter`,
   * and its last fallback is `table.defaultFilters` — declared
   * `Record<string, any>`. The old `baseFilter.length > 0` guard read false for
   * an object, so the list queried unfiltered and showed every record. An
   * earlier comment here called that unreachable; it was not.
   */
  it('reaches the query as an AST instead of vanishing', async () => {
    const { find } = harness({ ...BASE, filter: { status: 'active' } as any });
    await vi.waitFor(() => expect(find).toHaveBeenCalled());
    expect(find.mock.calls[0][1]?.$filter).toEqual(['status', '=', 'active']);
  });

  it('reaches the export too, by the same route', async () => {
    const { exportDownload } = harness({ ...BASE, filter: { status: 'active' } as any });
    await clickExportCsv();
    await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    expect(exportDownload.mock.calls[0][1]?.filter).toEqual(['status', '=', 'active']);
  });
});

describe('the fetch and the export build the SAME filter', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * Derived, not restated: compare what the two real calls actually carried.
   * An assertion that spelled out the expected AST twice would go on passing if
   * both copies drifted the same wrong way.
   */
  const cases: Array<[string, ListViewSchema]> = [
    ['a view filter alone', { ...BASE, filter: [{ field: 'stage', operator: 'eq', value: 'won' }] as any }],
    ['a multi-rule view filter', {
      ...BASE,
      filter: [
        { field: 'stage', operator: 'eq', value: 'won' },
        { field: 'amount', operator: 'gt', value: 10 },
      ] as any,
    }],
    ['an AST-shaped view filter', { ...BASE, filter: [['stage', '=', 'won']] as any }],
    ['no filter at all', BASE],
  ];

  for (const [name, schema] of cases) {
    it(`agree for ${name}`, async () => {
      const { exportDownload, find } = harness(schema);
      await vi.waitFor(() => expect(find).toHaveBeenCalled());
      const fetched = find.mock.calls[0][1]?.$filter;

      await clickExportCsv();
      await vi.waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
      const exported = exportDownload.mock.calls[0][1]?.filter;

      expect(exported).toEqual(fetched);
    });
  }
});
