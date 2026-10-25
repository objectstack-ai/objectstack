// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A page's "Edit in studio" opens the page in Studio, the place every other
 * Studio handle on the same route opens (objectui#12540).
 *
 * On a console page route the app bar's pencil, the app switcher's Studio row
 * and the sidebar's Design (objectui#12520) all open the page's surface in
 * Studio's Interfaces pillar, `/studio/PACKAGE/interfaces?surface=page:NAME`,
 * through `appStudioRoutePath`. The page's own button opened the
 * metadata-admin page instead, so the one handle labelled "Edit in studio" was
 * the one that did not open Studio. It now goes through the same derivation:
 *
 * - its target is `appStudioRoutePath` for the app the route is in and the
 *   page, the app bar pencil's own inputs (the two side by side, in one
 *   session, are pinned in `AppHeader.pageRouteNoAuthoringHandles-12198`);
 * - an app with no owning package Studio can open has no target, so the button
 *   is not drawn, as the pencil is not. ⛔ There is no fallback to the
 *   metadata-admin page.
 *
 * The authoring gate (`manage_metadata` and the workspace-admin role) is
 * pinned in `PageView.editInStudioNeedsAuthoring-10899`, and the package
 * posture in `PageView.editInStudioFollowsPackagePosture-12615`; every case
 * here is a caller who passes the first, on a package the list serves
 * writable.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useParams: () => ({ pageName: 'welcome' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => navigateSpy,
  useHref: () => '/',
  useLocation: () => ({ pathname: '/apps/cloud_control/page/welcome', search: '' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => String(o?.defaultValue ?? k) }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [{ name: 'welcome', type: 'page', label: 'Welcome' }], objects: [] }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

// The page body is not under test — only the chrome around it.
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({}),
  SchemaRenderer: () => <div data-testid="page-body" />,
}));

import { PageView } from '../PageView';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { appStudioRoutePath } from '../../utils/appRoute';

/** A metadata author: holds `manage_metadata`. */
const AUTHOR: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
  objects: {},
  fields: {},
};

const EXPRESSION_USER = {};
const OWNED = { name: 'cloud_control', label: 'Cloud', _packageId: 'com.objectstack.cloud' };

/** The page route, under the app the console resolved for it (`undefined` = none mounted). */
async function mountUnder(app: Record<string, unknown> | undefined) {
  const view = render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      {app ? (
        <ExpressionProvider user={EXPRESSION_USER} app={app}>
          <PageView />
        </ExpressionProvider>
      ) : (
        <PageView />
      )}
    </MePermissionsProvider>,
  );
  // The page body rendered, and the package list's verdict (objectui#12615)
  // settled — so an absent button is a reading.
  expect(await screen.findByTestId('page-body')).toBeInTheDocument();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return view;
}

beforeEach(() => {
  navigateSpy.mockClear();
  // objectui#12615 — the app's package is served writable, so the pencil's
  // package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.objectstack.cloud', name: 'Cloud' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Edit in studio opens the page in Studio, as the app bar pencil does (objectui#12540)', () => {
  it('lands on the page surface in Studio\'s Interfaces pillar — the pencil\'s derivation, for the same app and page', async () => {
    await mountUnder(OWNED);
    fireEvent.click(screen.getByTestId('page-edit-in-studio-button'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const target = navigateSpy.mock.calls[0][0];
    expect(target).toBe('/studio/com.objectstack.cloud/interfaces?surface=page:welcome');
    // The app bar's inputs on this route: the app, the author gate, the route type and name.
    expect(target).toBe(appStudioRoutePath(OWNED, true, { type: 'page', name: 'welcome' }));
  });

  it('an app with no owning package draws no button — there is no metadata-admin fallback', async () => {
    await mountUnder({ name: 'cloud_control', label: 'Cloud' });
    expect(screen.queryByTestId('page-edit-in-studio-button')).not.toBeInTheDocument();
  });

  it('an app whose container is the DB-authored `sys_metadata` pseudo-package draws no button', async () => {
    await mountUnder({ name: 'cloud_control', label: 'Cloud', _packageId: 'sys_metadata' });
    expect(screen.queryByTestId('page-edit-in-studio-button')).not.toBeInTheDocument();
  });

  it('a page rendered with no app resolved draws no button', async () => {
    await mountUnder(undefined);
    expect(screen.queryByTestId('page-edit-in-studio-button')).not.toBeInTheDocument();
  });
});
