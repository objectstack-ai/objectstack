// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A page's "Edit in studio" pencil follows the owning package's posture
 * (objectui#12615), the rule the app bar's Edit app pencil follows
 * (`AppHeader.editAppFollowsPackagePosture-12615`): it is drawn only when the
 * page's app belongs to a package Studio lists as writable. A read-only
 * package's page gets no pencil, and neither does a page of the console's own
 * system apps: their packages are kernel packages the list leaves out. Absent,
 * never disabled.
 *
 * The package list is served the way `GET /api/v1/packages` serves it, with the
 * server's `writable` verdict on each row (ADR-0070 D2). Each absence is read
 * once the page body has rendered and the list has answered, beside a writable
 * CONTROL read the same way.
 *
 * Harness: the one `PageView.editInStudioOpensStudio-12540` uses. Every case is
 * a caller who passes the authoring gate (`PageView.editInStudioNeedsAuthoring-10899`).
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
  useLocation: () => ({ pathname: '/apps/x/page/welcome', search: '' }),
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
/** The console's own Setup app, in its kernel package (the card's walk). */
const SETUP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
/** A read-only code package's app (the card's walk: HotCRM). */
const HOTCRM = { name: 'crm', label: 'CRM', _packageId: 'app.objectstack.hotcrm' };
/** An app in a Studio-created base, which the server judges writable. */
const BASE_APP = { name: 'my_app', label: 'My app', _packageId: 'com.example.my_base' };
/** An app whose package the list does not name. */
const UNLISTED = { name: 'gone', label: 'Gone', _packageId: 'com.example.unlisted' };

/** `GET /api/v1/packages`: the kernel Setup package, a read-only code package, a writable base. */
const PACKAGES = {
  success: true,
  data: {
    packages: [
      { manifest: { id: 'com.objectstack.setup', name: 'Setup', type: 'app', scope: 'system' }, writable: false },
      { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', type: 'app', scope: 'project' }, writable: false },
      { manifest: { id: 'com.example.my_base', name: 'My Base' }, writable: true },
    ],
  },
};

const BASE_TARGET = '/studio/com.example.my_base/interfaces?surface=page:welcome';

function serve(answer: () => Promise<{ ok: boolean; status: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (!String(url).endsWith('/api/v1/packages')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      const { ok, status, body } = await answer();
      return { ok, status, json: async () => body };
    }),
  );
}

/** One macrotask: every read the stub answers has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The page route under `app`, read once the page body rendered and the list answered. */
async function mountUnder(app: Record<string, unknown>) {
  render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <ExpressionProvider user={EXPRESSION_USER} app={app}>
        <PageView />
      </ExpressionProvider>
    </MePermissionsProvider>,
  );
  expect(await screen.findByTestId('page-body')).toBeInTheDocument();
  await settle();
}

/** Absent, not disabled: no element carries the pencil's test id or its name. */
function expectNoPencil() {
  expect(screen.queryByTestId('page-edit-in-studio-button')).toBeNull();
  expect(screen.queryByLabelText('Edit in studio')).toBeNull();
}

beforeEach(() => {
  navigateSpy.mockClear();
  serve(async () => ({ ok: true, status: 200, body: PACKAGES }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a page\'s Edit in studio follows the owning package\'s posture (objectui#12615)', () => {
  it('no pencil on a page of the Setup app (`com.objectstack.setup`)', async () => {
    await mountUnder(SETUP);
    expectNoPencil();
  });

  it('no pencil on a page of a package whose posture is read-only (HotCRM, `writable: false`)', async () => {
    await mountUnder(HOTCRM);
    expectNoPencil();
  });

  it('no pencil on a page of a package the list does not name', async () => {
    await mountUnder(UNLISTED);
    expectNoPencil();
  });

  it('CONTROL — the pencil on a page of a writable base, opening the page in Studio', async () => {
    await mountUnder(BASE_APP);
    fireEvent.click(screen.getByTestId('page-edit-in-studio-button'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(BASE_TARGET);
  });
});

describe('no verdict, no pencil (objectui#12615)', () => {
  it('absent while the list is being read, drawn once it answers writable', async () => {
    let answer: (value: { ok: boolean; status: number; body: unknown }) => void = () => undefined;
    serve(() => new Promise((resolve) => { answer = resolve; }));
    await mountUnder(BASE_APP);
    expectNoPencil();
    await act(async () => { answer({ ok: true, status: 200, body: PACKAGES }); });
    expect(await screen.findByTestId('page-edit-in-studio-button')).toBeInTheDocument();
  });

  it('a failed list read draws no pencil', async () => {
    serve(async () => ({ ok: false, status: 403, body: { success: false, error: { code: 'FORBIDDEN', message: 'no' } } }));
    await mountUnder(BASE_APP);
    expectNoPencil();
  });
});
