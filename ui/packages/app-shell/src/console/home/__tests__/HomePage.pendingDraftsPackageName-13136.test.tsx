// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13136 — Home's pending-drafts row names the package its drafts
 * share by the name Studio shows for it, never by its reverse-domain id.
 *
 * `_drafts` serves each draft's `packageId` and no package name
 * (`ListDraftsResponseSchema`), and the row interpolated that id straight into
 * `home.pendingDrafts.inPackage`: "… waiting to publish in
 * com.default.ux-walk-pkg" beside a Studio top bar reading "UX Walk Pkg". The
 * page now reads the package list Studio reads (`fetchPackages`,
 * `GET /api/v1/packages`) and names the package by its row's `name`.
 *
 * Both reads go over the wire here — the real `usePendingDrafts` and the real
 * `fetchPackages` against a recording `fetch` double — so the case is the
 * card's own path, from the `_drafts` row to the rendered text. The controls:
 * a package that declares no name, one the list does not carry, and a list
 * that cannot be read still read as the id, the way Studio's top bar reads
 * them; drafts spread over several packages name none and ask for no list.
 *
 * `t` echoes the KEY and its arguments, so the package the row was handed is
 * visible as `[package=…]`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => vi.fn(),
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) => createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `«${key}»` +
      ['count', 'names', 'package']
        .filter((k) => opts?.[k] !== undefined)
        .map((k) => `[${k}=${String(opts?.[k])}]`)
        .join(''),
    language: 'en',
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string }) => String(x?.label || x?.name || '');
    return {
      appLabel: label,
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_object: string, _view: string, fallback?: string) => fallback ?? '',
    };
  },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', icon: 'Building2' }],
    objects: [],
    dashboards: [],
    pages: [],
    reports: [],
    loading: false,
  }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovals: [],
    pendingApprovalsCount: 0,
    pendingApprovalsStatus: 'ready',
    pendingApprovalsReadable: true,
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    notificationsReadable: true,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
// The publish is not this card's: the row's button runs whatever it is handed.
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: vi.fn(async () => ({ ok: true })), publishing: false }),
}));

import { HomePage } from '../HomePage';

const DRAFTS_ROUTE = '/api/v1/meta/_drafts';
const PACKAGES_ROUTE = '/api/v1/packages';
const PKG = 'com.default.ux-walk-pkg';

/** A `_drafts` row as the server serves it (`ListDraftsResponseSchema`). */
const draft = (name: string, label: string | null, packageId: string | null) => ({
  type: 'object',
  name,
  label,
  packageId,
  updatedAt: null,
  updatedBy: null,
});

/** Two drafts in one package — the card's walkthrough. */
const DRAFTS_IN_PKG = [draft('visit_created', 'Visit Created', PKG), draft('visit_readers', 'Visit Readers', PKG)];

/** What the double answers on each route. */
let drafts: Array<Record<string, unknown>> = [];
let packagesAnswer: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };
/** Held until resolved, when a case needs the package list still on the wire. */
let packagesGate: Promise<void> | null = null;
let fetchCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

/** The package list as the durable half serves it: `{ manifest, writable }` rows. */
const servePackages = (manifests: Array<Record<string, unknown>>) => {
  packagesAnswer = {
    ok: true,
    status: 200,
    body: { success: true, data: { packages: manifests.map((manifest) => ({ manifest, writable: true })) } },
  };
};

beforeEach(() => {
  drafts = [];
  packagesAnswer = { ok: true, status: 200, body: { success: true, data: { packages: [] } } };
  packagesGate = null;
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      fetchCalls.push(url);
      if (routeOf(url) === DRAFTS_ROUTE) return { ok: true, status: 200, json: async () => ({ drafts }) };
      if (routeOf(url) === PACKAGES_ROUTE) {
        if (packagesGate) await packagesGate;
        const { ok, status, body } = packagesAnswer;
        return { ok, status, json: async () => body };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  // The page reads the two lists this card is about, and nothing else.
  expect(fetchCalls.filter((url) => routeOf(url) !== DRAFTS_ROUTE && routeOf(url) !== PACKAGES_ROUTE)).toEqual([]);
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

const row = () => screen.findByTestId('home-pending-drafts');

describe('the pending-drafts row names the package as Studio does (objectui#13136)', () => {
  it('names drafts in a named package by its name, never its id', async () => {
    drafts = DRAFTS_IN_PKG;
    servePackages([{ id: PKG, name: 'UX Walk Pkg' }]);
    render(<HomePage />);

    const el = await row();
    await waitFor(() => expect(el).toHaveTextContent('[names=Visit Created«home.pendingDrafts.nameSeparator»Visit Readers][package=UX Walk Pkg]'));
    expect(el.textContent).toContain('«home.pendingDrafts.inPackage»');
    expect(el.textContent).not.toContain(PKG);
    expect(fetchCalls.filter((url) => routeOf(url) === PACKAGES_ROUTE)).toEqual([PACKAGES_ROUTE]);
  });

  it('names a package whose row declares no name by its id — the only name it has', async () => {
    drafts = DRAFTS_IN_PKG;
    servePackages([{ id: PKG }]);
    render(<HomePage />);

    const el = await row();
    await waitFor(() => expect(el).toHaveTextContent(`[package=${PKG}]`));
  });

  it('names a package the list does not carry by its id', async () => {
    drafts = DRAFTS_IN_PKG;
    servePackages([{ id: 'com.default.other', name: 'Other' }]);
    render(<HomePage />);

    const el = await row();
    await waitFor(() => expect(el).toHaveTextContent(`[package=${PKG}]`));
    expect(el.textContent).not.toContain('Other');
  });

  it('names the package by its id when the package list cannot be read', async () => {
    drafts = DRAFTS_IN_PKG;
    packagesAnswer = {
      ok: false,
      status: 403,
      body: { success: false, error: { code: 'FORBIDDEN', message: 'Reading packages requires a capability.' } },
    };
    render(<HomePage />);

    const el = await row();
    await waitFor(() => expect(el).toHaveTextContent(`[package=${PKG}]`));
  });

  it('names no package until the list has answered, so the id never shows first', async () => {
    drafts = DRAFTS_IN_PKG;
    servePackages([{ id: PKG, name: 'UX Walk Pkg' }]);
    let release!: () => void;
    packagesGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<HomePage />);

    const el = await row();
    await waitFor(() => expect(fetchCalls.map(routeOf)).toContain(PACKAGES_ROUTE));
    expect(el).toHaveTextContent('«home.pendingDrafts.waiting»');
    expect(el.textContent).not.toContain('[package=');

    release();
    await waitFor(() => expect(el).toHaveTextContent('[package=UX Walk Pkg]'));
  });

  it('asks for no package list when the drafts are spread over several packages', async () => {
    drafts = [draft('visit_created', 'Visit Created', PKG), draft('invoice', 'Invoice', 'com.default.billing')];
    render(<HomePage />);

    const el = await row();
    expect(el).toHaveTextContent('«home.pendingDrafts.waiting»');
    expect(el.textContent).not.toContain('[package=');
    expect(fetchCalls.map(routeOf)).not.toContain(PACKAGES_ROUTE);
  });
});
