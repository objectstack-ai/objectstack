// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25333 — Setup → Positions says who holds each position and which
 * permission sets it grants, and the whole row opens the position.
 *
 * The two columns are the server's (`GET /meta/position?include=grants`,
 * computed where the authorization resolver enforces them); the page renders
 * them and computes neither. The rows below are fixture rows in the shape
 * objectstack#25333 serves.
 *
 * What is pinned, each against a control:
 *
 *  - the position list asks with `include: 'grants'`; the permission-set list
 *    (control) asks the plain list;
 *  - the holder count as served, and "—" — ⛔ never 0 — for a count the server
 *    did not serve (`null`) or a server that predates the key (absent);
 *  - the granted sets in served order, the same-named set the position-name
 *    fold grants marked "by name" (objectstack#24757), a declared set unmarked;
 *  - a click anywhere on the row opens the position; a click on the Active
 *    switch is the switch's, and a modified click is the browser's.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`; loaded here so the cost lands
// in the import phase (AGENTS.md, test discipline).
import '@objectstack/spec/identity';

const POSITIONS: Record<string, unknown>[] = [
  {
    name: 'sales_manager',
    label: 'Sales Manager',
    _holderCount: 3,
    _grantedPermissionSets: [
      { name: 'crm_sales_user', via: 'definition' },
      { name: 'forecasting', via: 'definition' },
      { name: 'sales_manager', via: 'name' },
    ],
  },
  // The server served no count (a caller who may not read the assignments).
  { name: 'support_agent', label: 'Support Agent', _holderCount: null, _grantedPermissionSets: [] },
  // A server that predates `include=grants`: neither key.
  { name: 'auditor', label: 'Auditor' },
];

const PERMISSION_SETS: Record<string, unknown>[] = [{ name: 'crm_sales_user', label: 'CRM Sales User' }];

const listCalls: Array<{ type: string; options: unknown }> = [];
/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string, options?: unknown) => {
    listCalls.push({ type, options });
    return type === 'position' ? POSITIONS : type === 'permission' ? PERMISSION_SETS : [];
  },
};

const POSITION_ENTRY = { type: 'position', label: 'Position', allowEnvironmentOverlay: false, allowRuntimeCreate: true };
const PERMISSION_ENTRY = { type: 'permission', label: 'Permission Set', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [POSITION_ENTRY, PERMISSION_ENTRY] }),
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

const requests: Array<{ url: string; method: string }> = [];

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { registerBuiltinAnchors } from './anchors';
import { t } from './i18n';
import '../../services/builtinComponents';

registerBuiltinAnchors();

beforeEach(() => {
  listCalls.length = 0;
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const u = String(url);
      requests.push({ url: u, method });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (method === 'GET' && u.startsWith('/api/v1/data/sys_metadata_activation')) {
        return json(200, { object: 'sys_metadata_activation', records: [], total: 0, hasMore: false });
      }
      if (method === 'POST' && u.startsWith('/api/v1/security/_activation/')) {
        return json(200, { success: true, data: { type: 'position', enabled: false } });
      }
      return json(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function mount(type = 'position', search = '?scope=environment') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}${search}`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const LOCALE = 'en-US';

describe('the position list reads its two columns from the server (objectstack#25333)', () => {
  it('asks the position list with include=grants; the permission-set list (control) asks the plain list', async () => {
    mount();
    await screen.findByTestId('metadata-row-sales_manager');
    expect(listCalls.filter((c) => c.type === 'position').map((c) => c.options)).toEqual([{ include: 'grants' }]);

    cleanup();
    listCalls.length = 0;
    mount('permission');
    await screen.findByTestId('metadata-row-crm_sales_user');
    expect(listCalls.filter((c) => c.type === 'permission').map((c) => c.options)).toEqual([undefined]);
  });

  it('shows the served holder count, and "—" — never 0 — where the server served none', async () => {
    mount();
    expect(await screen.findByRole('columnheader', { name: t('engine.list.col._holderCount', LOCALE) })).toBeInTheDocument();
    const count = (name: string) => within(screen.getByTestId(`metadata-row-${name}`)).getByTestId('position-holder-count');
    await waitFor(() => expect(count('sales_manager')).toHaveTextContent('3'));
    expect(count('support_agent')).toHaveTextContent('—');
    expect(count('support_agent')).toHaveAttribute('title', t('engine.position.holders.unknown', LOCALE));
    expect(count('auditor')).toHaveTextContent('—');
    expect(count('auditor')).not.toHaveTextContent('0');
  });

  it('lists the granted sets as served, the same-named set marked "by name" and the declared ones not', async () => {
    mount();
    expect(await screen.findByRole('columnheader', { name: t('engine.list.col._grantedPermissionSets', LOCALE) })).toBeInTheDocument();
    const cell = within(screen.getByTestId('metadata-row-sales_manager')).getByTestId('position-granted-sets');
    const badges = Array.from(cell.querySelectorAll('[data-via]'));
    expect(badges.map((b) => [b.firstChild?.textContent, b.getAttribute('data-via')])).toEqual([
      ['crm_sales_user', 'definition'],
      ['forecasting', 'definition'],
      ['sales_manager', 'name'],
    ]);
    const byName = badges[2];
    expect(byName).toHaveTextContent(t('engine.position.grants.byName', LOCALE));
    expect(byName).toHaveAttribute('title', t('engine.position.grants.byNameHint', LOCALE));
    expect(badges[0]).not.toHaveTextContent(t('engine.position.grants.byName', LOCALE));
    expect(badges[0]).not.toHaveAttribute('title');

    expect(within(screen.getByTestId('metadata-row-support_agent')).getByTestId('position-granted-sets'))
      .toHaveTextContent(t('engine.position.grants.none', LOCALE));
    expect(within(screen.getByTestId('metadata-row-auditor')).getByTestId('position-granted-sets')).toHaveTextContent('—');
  });
});

describe('the whole row opens the position (objectstack#25333)', () => {
  it('a click on a plain cell opens the position, keeping the scope', async () => {
    mount();
    const row = await screen.findByTestId('metadata-row-sales_manager');
    fireEvent.click(within(row).getByTestId('position-holder-count'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/apps/setup/metadata/position/sales_manager?scope=environment');
  });

  it('control: a click on the Active switch is the switch\'s, and a modified click is the browser\'s', async () => {
    mount();
    const row = await screen.findByTestId('metadata-row-sales_manager');
    const sw = await screen.findByTestId('catalog-active-sales_manager');
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(sw);
    // Switching off asks first (objectui#13338); the confirm opens on the
    // list, not on the position.
    expect(await screen.findByTestId('catalog-deactivate-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    const confirm = screen.getByTestId('catalog-deactivate-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    expect(screen.queryByTestId('where')).toBeNull();

    fireEvent.click(within(row).getByTestId('position-holder-count'), { metaKey: true });
    expect(screen.queryByTestId('where')).toBeNull();
  });
});
