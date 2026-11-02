// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29179 — inside a package's "All metadata" area (ADR-0146 D1),
 * the Diagnostics page sweeps that package, as the directory beside it does.
 * An unscoped sweep listed another package's invalid item under this package's
 * area, and its row link, relative to the area, opened an unrelated page.
 *
 * The real `useGlobalDiagnostics` runs against a fake client that answers as
 * the server does: a `packageId` narrows the sweep to that package's items,
 * none answers every package's. The cross-package leg and Setup (no area)
 * keep the environment-wide sweep.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MetadataDiagnosticsSummary } from '@object-ui/data-objectstack';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const SHOWCASE = 'com.example.showcase';
const PKG_A = 'com.qa.pkga';

/** Each swept item and the package that owns it (the server's `_packageId`). */
const SWEPT: Array<{ packageId: string; entry: MetadataDiagnosticsSummary['entries'][number] }> = [
  {
    packageId: PKG_A,
    entry: {
      type: 'view',
      name: 'pkga_qa_obj.qa_diag_view',
      diagnostics: { valid: false, errors: [{ path: 'columns.0.field', message: 'Expected string' }] },
    },
  },
  {
    packageId: SHOWCASE,
    entry: {
      type: 'object',
      name: 'showcase_loose',
      diagnostics: { valid: true, warnings: [{ path: 'label', message: 'Missing label' }] },
    },
  },
];
let showcaseInvalid: MetadataDiagnosticsSummary['entries'][number] | null = null;

const requests: Array<{ severity: 'error' | 'warning'; packageId?: string }> = [];
const client = {
  diagnostics: async (opts: { severity: 'error' | 'warning'; packageId?: string }) => {
    requests.push(opts);
    const rows = [
      ...SWEPT,
      ...(showcaseInvalid ? [{ packageId: SHOWCASE, entry: showcaseInvalid }] : []),
    ].filter((r) => opts.packageId === undefined || r.packageId === opts.packageId);
    const entries = rows
      .map((r) => r.entry)
      .filter((e) => (e.diagnostics.errors?.length ?? 0) > 0 || opts.severity === 'warning');
    return { entries, total: entries.length, scannedTypes: 2, scannedItems: rows.length, stats: {} };
  },
};

vi.mock('./useMetadata', async (importActual) => {
  const actual = await importActual<typeof import('./useMetadata')>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

import { MetadataDiagnosticsPage } from './DiagnosticsPage';

beforeEach(() => {
  requests.length = 0;
  showcaseInvalid = null;
});
afterEach(cleanup);

/** The page at `<root>/_diagnostics`, nested as the area and Setup mount it, so its relative links resolve as there. */
function mount(root: string, host: MetadataAreaHost | null) {
  const page = <MetadataDiagnosticsPage />;
  render(
    <MemoryRouter initialEntries={[`${root}/_diagnostics`]}>
      <Routes>
        <Route
          path={`${root}/*`}
          element={
            <Routes>
              <Route
                path="_diagnostics"
                element={host ? <MetadataAreaHostContext.Provider value={host}>{page}</MetadataAreaHostContext.Provider> : page}
              />
            </Routes>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByTestId('diagnostics-summary-badge');
}

const areaOf = (packageId: string | null): MetadataAreaHost => {
  const basePath = `/studio/${packageId ?? '~all'}/metadata`;
  return { packageId, readOnly: false, basePath };
};

describe('the Diagnostics page sweeps the package its area is open on (objectstack#29179)', () => {
  it("a package's area: another package's invalid item is not listed, and the page reads clean", async () => {
    await mount(`/studio/${SHOWCASE}/metadata`, areaOf(SHOWCASE));
    expect(requests).toEqual([{ severity: 'error', packageId: SHOWCASE }]);
    expect(await screen.findByText('All clear')).toBeInTheDocument();
    expect(screen.queryByText('pkga_qa_obj.qa_diag_view')).toBeNull();
  });

  it("a package's area: each row is the package's own item and links to it in the area", async () => {
    showcaseInvalid = {
      type: 'view',
      name: 'showcase_broken_view',
      diagnostics: { valid: false, errors: [{ path: 'columns', message: 'Required' }] },
    };
    await mount(`/studio/${SHOWCASE}/metadata`, areaOf(SHOWCASE));
    const link = await screen.findByRole('link', { name: 'showcase_broken_view' });
    expect(link).toHaveAttribute('href', `/studio/${SHOWCASE}/metadata/view/showcase_broken_view`);
    expect(screen.queryByText('pkga_qa_obj.qa_diag_view')).toBeNull();
  });

  it('switching to Errors + Warnings keeps the package scope', async () => {
    await mount(`/studio/${SHOWCASE}/metadata`, areaOf(SHOWCASE));
    fireEvent.click(screen.getByRole('tab', { name: 'Errors + Warnings' }));
    await screen.findByText('showcase_loose');
    expect(requests.at(-1)).toEqual({ severity: 'warning', packageId: SHOWCASE });
    expect(screen.queryByText('pkga_qa_obj.qa_diag_view')).toBeNull();
  });

  it('the cross-package leg keeps the environment-wide sweep', async () => {
    const badge = await mount('/studio/~all/metadata', areaOf(null));
    expect(requests).toEqual([{ severity: 'error' }]);
    expect(within(badge).getByText(/1 issue\(s\)/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'pkga_qa_obj.qa_diag_view' })).toHaveAttribute(
      'href',
      '/studio/~all/metadata/view/pkga_qa_obj.qa_diag_view',
    );
  });

  it('Setup (no area) keeps the environment-wide sweep', async () => {
    await mount('/apps/setup/metadata', null);
    expect(requests).toEqual([{ severity: 'error' }]);
    expect(await screen.findByRole('link', { name: 'pkga_qa_obj.qa_diag_view' })).toHaveAttribute(
      'href',
      '/apps/setup/metadata/view/pkga_qa_obj.qa_diag_view',
    );
  });
});
