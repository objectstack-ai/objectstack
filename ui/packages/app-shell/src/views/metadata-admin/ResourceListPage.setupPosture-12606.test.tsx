/**
 * objectui#12606 — the metadata-type page under the Setup route draws Setup's
 * one page header: no "All Metadata Types" breadcrumb, no ITEMS / FILTERED
 * tiles, the count in the description line, and the source as plain text
 * with its explanation in a tooltip instead of a chip on every row.
 *
 * The same page outside Setup — the directory's list, Studio's "Open in
 * Setup" target — keeps today's shell: that half is the control, mounted
 * with the same items and only the route's `:appName` changed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// The activation column waits on `audienceAnchorsOf`'s dynamic import of this
// exact specifier; loaded here so its cost lands in the import phase.
import '@objectstack/spec/identity';

const TYPE = 'position';
const ITEMS: Record<string, unknown>[] = [
  { name: 'everyone', label: 'Everyone', _packageId: 'com.objectstack.plugin-security', _provenance: 'package' },
  { name: 'auditor', label: 'Auditor', _packageId: 'com.example.showcase', _provenance: 'package' },
  { name: 'env_only', label: 'Environment only' },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) =>
    type === 'package'
      ? [{ manifest: { id: 'com.example.showcase', scope: 'project', name: 'Showcase' } }]
      : type === TYPE
        ? ITEMS
        : [],
};

const ENTRY = { type: TYPE, label: 'Position', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [ENTRY] }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
}));

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { t } from './i18n';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ records: [], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(appName: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/${appName}/metadata/${TYPE}?scope=environment`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ALL_TYPES = t('engine.breadcrumb.allTypes', 'en-US');
const ITEMS_TILE = t('engine.list.items', 'en-US');
const FILTERED_TILE = t('engine.list.filtered', 'en-US');

describe('the metadata-type page under the Setup route (objectui#12606)', () => {
  it('renders no breadcrumb and no stat tiles, and says the count in the header’s description', async () => {
    const { container } = mount('setup');
    await screen.findByRole('link', { name: 'everyone' });

    const header = screen.getByTestId('metadata-list-setup-header');
    expect(header.getAttribute('data-posture')).toBe('setup');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Position');
    expect(within(header).getByTestId('page-header-description').textContent).toBe('3 items');

    expect(screen.queryByText(ALL_TYPES)).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.queryByText(ITEMS_TILE)).toBeNull();
    expect(screen.queryByText(FILTERED_TILE)).toBeNull();

    // The source select stays, as a filter chip.
    expect(screen.getByTestId('metadata-source-filter').className).toContain('rounded-full');
    // The source column carries text with a tooltip, not a chip per row.
    expect(screen.getAllByTestId('metadata-row-source')).toHaveLength(3);
    expect(container.querySelector('tbody .text-\\[10px\\]')).toBeNull();
  });

  it('CONTROL — the same page outside Setup still draws the breadcrumb and the stat tiles', async () => {
    const { container } = mount('studio');
    await screen.findByRole('link', { name: 'everyone' });

    expect(screen.queryByTestId('metadata-list-setup-header')).toBeNull();
    expect(screen.getByRole('link', { name: ALL_TYPES })).toBeInTheDocument();
    expect(screen.getByText(ITEMS_TILE)).toBeInTheDocument();
    expect(screen.getByText(FILTERED_TILE)).toBeInTheDocument();
    expect(screen.queryAllByTestId('metadata-row-source')).toHaveLength(0);
    expect(container.querySelectorAll('tbody .text-\\[10px\\]').length).toBe(3);
  });
});
