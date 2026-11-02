// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every Setup metadata route and alias opens Studio's "All metadata" area, the
 * datasource excepted (objectstack ADR-0146 D1, D11 "Retire"; N-28).
 *
 * The table below is the whole input surface `AppContent` declares for
 * metadata, on both of its branches (an active app, and a zero-app
 * deployment):
 *
 *   canonical   metadata, metadata/_diagnostics, metadata/:type,
 *               metadata/:type/new, metadata/:type/:name,
 *               metadata/:type/:name/history
 *   aliases     component/metadata/directory,
 *               component/metadata/resource/*?type=:type
 *
 * Each row asserts the whole redirect chain, so "lands in at most two hops"
 * is read off the chain, not inferred from the endpoint: the canonical routes
 * and both aliases reach Studio in ONE hop (two entries). `?package`, `?scope`
 * and `?review` are carried, and the leg is the one the query names, so the
 * area adds no second hop of its own (pinned on the helper in
 * `views/studio-design/setupMetadataRedirect.test.ts`).
 *
 * The datasource rows are the converse: the area sends every datasource URL
 * back to Setup's Datasources page, so a datasource must stay put here, on the
 * metadata-admin page it always rendered, or the two redirects would loop.
 *
 * One more retired Setup URL redirects here (ADR-0146 D11): a bookmark of
 * Setup › Packaged automation (`component/automation/packaged`) opens Studio's
 * Automations pillar for the package its `?package=` names, or the area's
 * cross-package flow list when it names none.
 *
 * The host's own aliases (`system/objects`, `system/metadata`,
 * `system/{roles,positions,permissions}`) are `apps/console`'s, pinned in
 * `apps/console/src/__tests__/AppContent.legacyRedirects.test.tsx`.
 *
 * Harness: the same stubs as `AppContent.pseudoRouteSegments.test.tsx`
 * (pages and chrome stubbed, routing real), plus a `/studio/*` probe standing
 * in for the Studio app the host mounts beside `/apps/*`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page" />,
  MetadataResourceListPage: () => {
    const { type } = useParams<{ type?: string }>();
    return <div data-testid="metadata-resource-list-page">{type}</div>;
  },
  MetadataResourceEditPage: ({ createMode }: { createMode?: boolean }) => {
    const { type, name } = useParams<{ type?: string; name?: string }>();
    return <div data-testid="metadata-resource-edit-page" data-create={createMode ? 'yes' : 'no'}>{`${type}/${name ?? ''}`}</div>;
  },
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
}));

vi.mock('../marketplace/MarketplacePage', () => ({ MarketplacePage: () => <div data-testid="marketplace-page" /> }));
vi.mock('../marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => <div data-testid="marketplace-package-page" />,
}));
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return <div data-testid="object-view">{objectName}</div>;
  },
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, getAuthConfig: async () => ({ features: {} }), activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));
const dataSourceStub = { onConnectionStateChange: () => () => {}, getConnectionState: () => 'connected' };
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

const APPS = [
  { name: 'crm', label: 'CRM', isDefault: true, navigation: [] },
  { name: 'sales', label: 'Sales', navigation: [] },
];
let metadataApps: unknown[] = APPS;
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: async () => {},
  }),
}));

import { AppContent } from '../AppContent';

function LocationProbe({ sink }: { sink: string[] }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}${location.hash}`;
  if (sink[sink.length - 1] !== here) sink.push(here);
  return null;
}

function renderAt(initialUrl: string) {
  const chain: string[] = [];
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe sink={chain} />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
        <Route path="/studio/*" element={<div data-testid="studio-probe" />} />
        <Route path="/" element={<div data-testid="root-landing" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
  return chain;
}

beforeEach(() => {
  metadataApps = APPS;
});

/** [Setup URL, the Studio URL it lands on in one hop] */
const TO_STUDIO: Array<[string, string]> = [
  // canonical routes
  ['/metadata', '/studio/~all/metadata'],
  ['/metadata/_diagnostics', '/studio/~all/metadata/_diagnostics'],
  ['/metadata/object', '/studio/~all/metadata/object'],
  ['/metadata/object/new', '/studio/~all/metadata/object/new'],
  ['/metadata/object/account', '/studio/~all/metadata/object/account'],
  ['/metadata/permission/admin/history', '/studio/~all/metadata/permission/admin/history'],
  // the query is carried, and names the leg
  ['/metadata/object/account?package=crm', '/studio/crm/metadata/object/account?package=crm'],
  ['/metadata/object?package=all', '/studio/~all/metadata/object?package=all'],
  ['/metadata/position?scope=environment', '/studio/~all/metadata/position?scope=environment'],
  ['/metadata/sharing_rule?scope=environment&package=crm', '/studio/~all/metadata/sharing_rule?scope=environment'],
  ['/metadata/object/account?review=1', '/studio/~all/metadata/object/account?review=1'],
  ['/metadata/object/account?package=crm&review=1', '/studio/crm/metadata/object/account?package=crm&review=1'],
  ['/metadata/object/account#fields', '/studio/~all/metadata/object/account#fields'],
  // the pre-refactor aliases, straight to Studio (not via the canonical route)
  ['/component/metadata/directory', '/studio/~all/metadata'],
  ['/component/metadata/resource?type=object', '/studio/~all/metadata/object'],
  ['/component/metadata/resource/account?type=object', '/studio/~all/metadata/object/account'],
  ['/component/metadata/resource/account?type=object&package=crm', '/studio/crm/metadata/object/account?package=crm'],
  ['/component/metadata/resource?type=position&scope=environment', '/studio/~all/metadata/position?scope=environment'],
];

/** [Setup URL, the page it keeps rendering, where it settles] */
const STAYS: Array<[string, string, string]> = [
  ['/metadata/datasource', 'metadata-resource-list-page', '/metadata/datasource'],
  ['/metadata/datasource?package=crm', 'metadata-resource-list-page', '/metadata/datasource?package=crm'],
  ['/metadata/datasource/new', 'metadata-resource-edit-page', '/metadata/datasource/new'],
  ['/metadata/datasource/main', 'metadata-resource-edit-page', '/metadata/datasource/main'],
  ['/metadata/datasource/main/history', 'metadata-resource-history-page', '/metadata/datasource/main/history'],
  ['/component/metadata/resource?type=datasource', 'metadata-resource-list-page', '/metadata/datasource'],
  ['/component/metadata/resource/main?type=datasource', 'metadata-resource-edit-page', '/metadata/datasource/main'],
];

describe.each([
  ['an active app (setup)', '/apps/setup', APPS],
  ['an active app (crm)', '/apps/crm', APPS],
  ['a zero-app deployment', '/apps/setup', []],
] as const)('Setup metadata routes open Studio — %s (ADR-0146 D1)', (_label, base, apps) => {
  it.each(TO_STUDIO)(`${base}%s → %s, in one hop`, async (from, to) => {
    metadataApps = [...apps];
    const chain = renderAt(`${base}${from}`);

    expect(await screen.findByTestId('studio-probe')).toBeInTheDocument();
    // Two entries: one `<Navigate>`, no stop on Setup's canonical route.
    expect(chain).toEqual([`${base}${from}`, to]);
    expect(screen.queryByTestId('metadata-resource-list-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metadata-resource-edit-page')).not.toBeInTheDocument();
  });

  it.each(STAYS)(`${base}%s stays in Setup on %s`, async (from, testid, settles) => {
    metadataApps = [...apps];
    const chain = renderAt(`${base}${from}`);

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    expect(chain[chain.length - 1]).toBe(`${base}${settles}`);
    expect(chain.length).toBeLessThanOrEqual(2);
    expect(chain.some((entry) => entry.startsWith('/studio'))).toBe(false);
    expect(screen.queryByTestId('studio-probe')).not.toBeInTheDocument();
  });
});

describe('a bookmark of the retired Setup › Packaged automation page opens Studio (ADR-0146 D11)', () => {
  it.each([
    ['/apps/setup/component/automation/packaged?package=crm', '/studio/crm/automations?package=crm'],
    ['/apps/crm/component/automation/packaged?package=crm', '/studio/crm/automations?package=crm'],
    ['/apps/setup/component/automation/packaged', '/studio/~all/metadata/flow'],
  ])('%s → %s, in one hop', async (from, to) => {
    const chain = renderAt(from);

    expect(await screen.findByTestId('studio-probe')).toBeInTheDocument();
    expect(chain).toEqual([from, to]);
  });

  it('control: another component ref still resolves through the component route, not Studio', async () => {
    const chain = renderAt('/apps/setup/component/automation/packaged-actions');
    await screen.findByTestId('console-layout');
    expect(chain).toEqual(['/apps/setup/component/automation/packaged-actions']);
    expect(screen.queryByTestId('studio-probe')).not.toBeInTheDocument();
  });
});

describe('the datasource pages keep their own shape', () => {
  it('a datasource create page renders in create mode', async () => {
    renderAt('/apps/setup/metadata/datasource/new');
    expect(await screen.findByTestId('metadata-resource-edit-page')).toHaveAttribute('data-create', 'yes');
  });

  it('metadata/package/* still opens the developer packages page, not Studio', async () => {
    const chain = renderAt('/apps/setup/metadata/package/acme');
    await screen.findByTestId('console-layout');
    expect(chain[1]).toBe('/apps/setup/component/developer/packages');
  });
});
