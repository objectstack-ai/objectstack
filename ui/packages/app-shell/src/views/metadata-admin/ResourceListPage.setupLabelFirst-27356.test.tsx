/**
 * objectstack#27356 (row 5) — a metadata list under Setup reads as an admin
 * list: the header names the page as the app's navigation entry that opens it
 * does ("Positions", not the type's singular "Position"), each row leads with
 * the item's label with the API name beneath it, and a description takes two
 * lines at most, so a row stays one row on a phone.
 *
 * The same page outside Setup is the control: the API name column, the Label
 * column and the type's label as the title, as before.
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
const LONG = 'Leads the sales organization and gives the final sign-off on the largest deals of the quarter.';
const ITEMS: Record<string, unknown>[] = [
  { name: 'sales_director', label: 'Sales Director', description: LONG, _packageId: 'com.example.crm' },
  { name: 'unlabelled', _packageId: 'com.example.crm' },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) => (type === TYPE ? ITEMS : []),
};

const ENTRY = { type: TYPE, label: 'Position', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

/** The served Setup app: its Access Control group names the list "Positions". */
let APP: unknown = null;

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

vi.mock('../../providers/ExpressionProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, useExpressionContext: () => ({ ...actual.useExpressionContext(), app: APP }) };
});

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';

beforeEach(() => {
  APP = {
    name: 'setup',
    navigation: [
      {
        id: 'grp_access',
        type: 'group',
        label: 'Access Control',
        children: [
          { id: 'nav_positions', type: 'url', label: 'Positions', url: '/apps/setup/metadata/position?scope=environment' },
          { id: 'nav_permission_sets', type: 'url', label: 'Permission Sets', url: '/apps/setup/metadata/permission?scope=environment' },
        ],
      },
    ],
  };
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

const headers = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);

describe('a metadata list under Setup leads with labels (objectstack#27356 row 5)', () => {
  it('titles the page as the navigation entry that opens it', async () => {
    mount('setup');
    await screen.findByRole('link', { name: 'Sales Director' });
    const header = screen.getByTestId('metadata-list-setup-header');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Positions');
  });

  it('falls back to the type label when no entry opens exactly this page', async () => {
    APP = { name: 'setup', navigation: [{ id: 'nav_users', type: 'url', label: 'Users', url: '/apps/setup/sys_user' }] };
    mount('setup');
    await screen.findByRole('link', { name: 'Sales Director' });
    const header = screen.getByTestId('metadata-list-setup-header');
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Position');
  });

  it('leads each row with the label, the API name beneath it, and no separate Label column', async () => {
    mount('setup');
    const link = await screen.findByRole('link', { name: 'Sales Director' });
    const row = screen.getByTestId('metadata-row-sales_director');
    expect(within(row).getByTestId('metadata-row-api-name').textContent).toBe('sales_director');
    expect(link).not.toHaveClass('font-mono');
    expect(headers()[0]).toBe('Label');
    expect(headers().filter((h) => h === 'Label')).toHaveLength(1);
    expect(headers()).not.toContain('Name');

    // An item with no label keeps its API name as the link.
    const bare = screen.getByTestId('metadata-row-unlabelled');
    expect(within(bare).getByRole('link', { name: 'unlabelled' })).toHaveClass('font-mono');
    expect(within(bare).queryByTestId('metadata-row-api-name')).toBeNull();
  });

  it('clamps a description to two lines and keeps the whole text on hover', async () => {
    mount('setup');
    await screen.findByRole('link', { name: 'Sales Director' });
    const row = screen.getByTestId('metadata-row-sales_director');
    const clamp = within(row).getByText(LONG);
    expect(clamp).toHaveClass('line-clamp-2');
    expect(clamp).toHaveAttribute('title', LONG);
  });

  it('CONTROL — outside Setup the page keeps the API name column, the Label column and the type title', async () => {
    mount('studio');
    const link = await screen.findByRole('link', { name: 'sales_director' });
    expect(link).toHaveClass('font-mono');
    expect(headers().slice(0, 2)).toEqual(['Name', 'Label']);
    expect(screen.queryAllByTestId('metadata-row-api-name')).toHaveLength(0);
    expect(screen.getByText(LONG)).not.toHaveClass('line-clamp-2');
  });
});
