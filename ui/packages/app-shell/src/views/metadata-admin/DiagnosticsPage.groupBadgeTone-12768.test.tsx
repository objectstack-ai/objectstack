// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12768 — on the Metadata Diagnostics page, the count badge beside
 * each type heading takes that group's tone by the rule the page header uses
 * (objectui#12721): destructive when any of the group's entries is an error,
 * the warning colour when they carry warnings only. On the "Errors + Warnings"
 * tab a warnings-only group therefore no longer shows a red count under an
 * amber header, and a group's tone is its own, not the page's.
 *
 * The real `useGlobalDiagnostics` runs against a fake client, so the tone is
 * read from the `/meta/diagnostics` envelope exactly as the page reads it.
 */

import '@testing-library/jest-dom/vitest';
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

/** The group badge's look before objectui#12768, which the error tone keeps exactly. */
const DESTRUCTIVE_GROUP_BADGE_CLASSES = [
  'text-[10px]',
  'border-destructive/40',
  'text-destructive',
  'bg-destructive/[0.06]',
];

/** The count badge beside a type heading, addressed by the machine name the heading prints. */
function groupBadge(type: string): HTMLElement {
  const h2 = screen.getByText(type, { selector: 'h2 span' }).closest('h2') as HTMLElement;
  return h2.lastElementChild as HTMLElement;
}

async function openErrorsAndWarnings(firstRow: string) {
  render(
    <MemoryRouter>
      <MetadataDiagnosticsPage />
    </MemoryRouter>,
  );
  await screen.findByTestId('diagnostics-summary-badge');
  fireEvent.click(screen.getByRole('tab', { name: 'Errors + Warnings' }));
  await screen.findByText(firstRow);
}

describe('MetadataDiagnosticsPage group count badge tone (objectui#12768)', () => {
  it('a warnings-only group: the badge takes the warning colour, no destructive class', async () => {
    answer = (severity) => envelope(severity === 'warning' ? [warnedOnly] : []);
    await openErrorsAndWarnings('loose_object');

    const badge = groupBadge('object');
    expect(badge).toHaveTextContent('1');
    expect(badge.className).toMatch(/\btext-amber-700\b/);
    expect(badge.className).toMatch(/\bborder-amber-500\/40\b/);
    expect(badge.className).not.toMatch(/destructive/);
  });

  it('an error group: the badge keeps the destructive look', async () => {
    answer = () => envelope([invalid]);
    render(
      <MemoryRouter>
        <MetadataDiagnosticsPage />
      </MemoryRouter>,
    );
    await screen.findByText('broken_view');

    const classes = groupBadge('view').className.split(/\s+/);
    for (const c of DESTRUCTIVE_GROUP_BADGE_CLASSES) expect(classes).toContain(c);
    expect(groupBadge('view').className).not.toMatch(/amber/);
  });

  it('each group takes its own tone: an error group beside a warnings-only one', async () => {
    answer = (severity) => envelope(severity === 'warning' ? [invalid, warnedOnly] : [invalid]);
    await openErrorsAndWarnings('loose_object');

    // The page header is destructive (one entry is an error) ...
    expect(screen.getByTestId('diagnostics-summary-badge').className).toMatch(/text-destructive/);
    // ... while each group reads its own entries.
    const viewClasses = groupBadge('view').className.split(/\s+/);
    for (const c of DESTRUCTIVE_GROUP_BADGE_CLASSES) expect(viewClasses).toContain(c);
    expect(groupBadge('object').className).toMatch(/\btext-amber-700\b/);
    expect(groupBadge('object').className).not.toMatch(/destructive/);
  });
});
