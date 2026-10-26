// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12721 — the Metadata Diagnostics header paints its icon and
 * summary badge by what the sweep found, not destructive unconditionally.
 * A clean sweep (the body's "All clear") draws no alert glyph and no
 * destructive badge; errors draw destructive; warnings only draw the
 * warning colour.
 *
 * The real `useGlobalDiagnostics` runs against a fake client, so the tone
 * is read from the `/meta/diagnostics` envelope exactly as the page reads it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MetadataDiagnosticsSummary } from '@object-ui/data-objectstack';

let answer: (severity: 'error' | 'warning') => MetadataDiagnosticsSummary;
const client = {
  diagnostics: async (opts: { severity: 'error' | 'warning' }) => answer(opts.severity),
};

vi.mock('./useMetadata', async (importActual) => {
  const actual = await importActual<typeof import('./useMetadata')>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

import { MetadataDiagnosticsPage } from './DiagnosticsPage';

afterEach(cleanup);

function envelope(entries: MetadataDiagnosticsSummary['entries']): MetadataDiagnosticsSummary {
  return { entries, total: entries.length, scannedTypes: 27, scannedItems: 396, stats: {} };
}

const invalid = {
  type: 'view',
  name: 'broken_view',
  diagnostics: { valid: false, errors: [{ path: 'columns', message: 'Required' }] },
};
const warnedOnly = {
  type: 'object',
  name: 'loose_object',
  diagnostics: { valid: true, warnings: [{ path: 'label', message: 'Missing label' }] },
};

async function renderPage() {
  render(
    <MemoryRouter>
      <MetadataDiagnosticsPage />
    </MemoryRouter>,
  );
  return screen.findByTestId('diagnostics-summary-badge');
}

describe('MetadataDiagnosticsPage header tone (objectui#12721)', () => {
  it('zero issues: no alert glyph and no destructive class on the badge', async () => {
    answer = () => envelope([]);
    const badge = await renderPage();
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(badge.className).not.toMatch(/destructive/);
    const icon = screen.getByTestId('diagnostics-header-icon');
    expect(icon.getAttribute('data-tone')).toBe('clean');
    expect(icon.getAttribute('class')).not.toMatch(/destructive|triangle-alert/);
  });

  it('errors present: icon and badge are destructive', async () => {
    answer = () => envelope([invalid]);
    const badge = await renderPage();
    expect(badge.className).toMatch(/text-destructive/);
    const icon = screen.getByTestId('diagnostics-header-icon');
    expect(icon.getAttribute('class')).toMatch(/triangle-alert/);
    expect(icon.getAttribute('class')).toMatch(/text-destructive/);
  });

  it('warnings only: icon and badge take the warning colour, not destructive', async () => {
    answer = (severity) => envelope(severity === 'warning' ? [warnedOnly] : []);
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Errors + Warnings' }));
    await screen.findByText('loose_object');
    const badge = screen.getByTestId('diagnostics-summary-badge');
    expect(badge.className).toMatch(/text-amber-/);
    expect(badge.className).not.toMatch(/destructive/);
    const icon = screen.getByTestId('diagnostics-header-icon');
    expect(icon.getAttribute('class')).toMatch(/triangle-alert/);
    expect(icon.getAttribute('class')).toMatch(/text-amber-/);
  });

  it('a failed sweep is not reported as clean', async () => {
    answer = () => {
      throw new Error('503 metadata store unavailable');
    };
    render(
      <MemoryRouter>
        <MetadataDiagnosticsPage />
      </MemoryRouter>,
    );
    await screen.findByText(/Failed to load diagnostics/);
    expect(screen.queryByTestId('diagnostics-summary-badge')).toBeNull();
    expect(screen.getByTestId('diagnostics-header-icon').getAttribute('class')).toMatch(/text-destructive/);
  });
});
