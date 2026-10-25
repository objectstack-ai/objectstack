// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12768 — the metadata directory's "View all issues (N)" link takes
 * its tone from the sweep it counts, by the same rule the Diagnostics header
 * uses (objectui#12721): destructive when any entry is an error, the warning
 * colour when the entries carry warnings only, and no link when the sweep is
 * clean. The directory reads the sweep with severity `warning`, so its count
 * includes warnings-only entries and a destructive link would call them errors.
 *
 * The real `useGlobalDiagnostics` runs against a fake client, so the tone is
 * read from the `/meta/diagnostics` envelope exactly as the page reads it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MetadataDiagnosticsSummary } from '@object-ui/data-objectstack';
import type { RichMetadataTypeEntry } from './useMetadata';

const PKG = 'com.example.showcase';

const SERVED_TYPES: RichMetadataTypeEntry[] = [
  { type: 'object', label: 'Object', domain: 'data' },
  { type: 'view', label: 'View', domain: 'ui' },
];

let answer: (opts: { severity: 'error' | 'warning'; packageId?: string }) => MetadataDiagnosticsSummary;
const seen: Array<{ severity: 'error' | 'warning'; packageId?: string }> = [];

/** Stable singleton: the page's package load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) =>
    type === 'package' ? [{ manifest: { id: PKG, scope: 'project', name: 'Showcase' } }] : [],
  diagnostics: async (opts: { severity: 'error' | 'warning'; packageId?: string }) => {
    seen.push(opts);
    return answer(opts);
  },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => CLIENT,
    useMetadataTypes: () => ({ loading: false, error: null, entries: SERVED_TYPES }),
  };
});

import { MetadataDirectoryPage } from './DirectoryPage';

afterEach(() => {
  cleanup();
  seen.length = 0;
});

function envelope(entries: MetadataDiagnosticsSummary['entries']): MetadataDiagnosticsSummary {
  return {
    entries,
    total: entries.length,
    scannedTypes: SERVED_TYPES.length,
    scannedItems: 12,
    stats: Object.fromEntries(
      SERVED_TYPES.map((e) => [e.type, { count: 6, locked: 0, packages: [PKG] }]),
    ),
  };
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

/** Today's error look, which the error tone keeps exactly. */
const DESTRUCTIVE_LINK_CLASSES = [
  'border-destructive/40',
  'text-destructive',
  'hover:bg-destructive/10',
  'hover:text-destructive',
];

function renderDirectory() {
  return render(
    <MemoryRouter initialEntries={[`/metadata?package=${PKG}`]}>
      <MetadataDirectoryPage />
    </MemoryRouter>,
  );
}

async function directoryLoaded() {
  // A type tile only renders once the package scope and the sweep resolved.
  await screen.findByText('object', { selector: 'code' });
}

describe('DirectoryPage — the "View all issues" link takes the sweep\'s tone (objectui#12768)', () => {
  it('warnings only: the link takes the warning colour and no destructive class', async () => {
    answer = () => envelope([warnedOnly]);
    renderDirectory();
    const link = await screen.findByRole('link', { name: 'View all issues (1)' });

    expect(link.className).toMatch(/\btext-amber-700\b/);
    expect(link.className).toMatch(/\bborder-amber-500\/40\b/);
    expect(link.className).not.toMatch(/destructive/);
    expect(link.querySelector('svg')?.getAttribute('class')).toMatch(/triangle-alert/);
    expect(link.getAttribute('href')).toMatch(/\/_diagnostics$/);
    // The count it shows is the warning-severity sweep for the active package.
    expect(seen.at(-1)).toEqual({ severity: 'warning', packageId: PKG });
  });

  it('an error present: the link keeps the destructive look', async () => {
    answer = () => envelope([invalid, warnedOnly]);
    renderDirectory();
    const link = await screen.findByRole('link', { name: 'View all issues (2)' });

    const classes = link.className.split(/\s+/);
    for (const c of DESTRUCTIVE_LINK_CLASSES) expect(classes).toContain(c);
    expect(link.className).not.toMatch(/amber/);
    expect(link.querySelector('svg')?.getAttribute('class')).toMatch(/triangle-alert/);
    expect(link.getAttribute('href')).toMatch(/\/_diagnostics$/);
  });

  it('clean: no link', async () => {
    answer = () => envelope([]);
    renderDirectory();
    await directoryLoaded();

    expect(screen.queryByRole('link', { name: /View all issues/ })).toBeNull();
  });
});
