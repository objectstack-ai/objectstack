// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Home greeting joins with the locale's punctuation (objectui#11689).
 *
 * Under zh-CN the heading was a translated greeting held together by the
 * ASCII `, ` and `.` the markup spelled in code. The two joiners are now
 * `home.greetingSeparator` and `home.greetingEnd`, in every pack, so zh-CN
 * writes the full-width comma and full stop while en stays byte-identical.
 *
 * Two keys rather than one interpolated sentence: the name keeps its own
 * coloured span, which a single translated string could not carry. The
 * coloured-span assertion below pins that the markup survived.
 *
 * Every case renders the REAL `HomePage` under a REAL `I18nProvider` over the
 * real packs — the surfaces unrelated to the heading are stubbed exactly as
 * the sibling `HomePage.*.test.tsx` files stub them, but translation is not:
 * a stand-in `t` would pass against a heading that never asked the locale.
 * The clock is pinned to 02:30 local time so the greeting is the night one,
 * the case the card measured.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => vi.fn(),
    // objectui#12305: each Home app tile is a router `Link`. This harness has
    // no router, so the stand-in renders the anchor `Link` would, minus the
    // basename. The tile's own pins live in `HomeAppsStrip.tilesAreLinks-12305`.
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

let userFixture: { id: string; name: string; email: string } = {
  id: 'u1',
  name: 'Dev Admin',
  email: 'dev.admin@example.com',
};

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: userFixture }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

// A non-empty app list: with none, Home renders its welcome state, which has
// no greeting heading.
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], loading: false }),
}));

vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));

// --- surfaces unrelated to the heading -------------------------------------
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    // objectui#12602: the approvals preview, and whether each source is
    // the caller's to read — the My-work section draws a column per source.
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    notifications: [],
    unreadTopicCount: 0,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../views/metadata-admin/useMetadata', () => ({
  useMetadataClient: () => ({ listDrafts: async () => [] }),
}));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  // An explicit factory replaces the whole module, so both gates Home reads
  // must be listed; `true` keeps the page on its ordinary shape. The gates
  // themselves are covered by `HomePage.marketplaceDisabled.test.tsx` and
  // `HomePage.aiStudioDisabled.test.tsx`.
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));

import { HomePage } from '../HomePage';

/* ── The `_drafts` double ─────────────────────────────────────────────────────
 * Every render mounts `usePendingDraftsRow`, whose pending-draft count is read
 * with the GLOBAL `fetch` from `GET /api/v1/meta/_drafts`. Answered from the
 * same RECORDING double the sibling files use (copied from
 * `HomePage.notificationDeepLink.test.tsx`): a known-empty ledger, so no banner
 * renders, and `afterEach` fails on any url outside the one route it serves.
 * ─────────────────────────────────────────────────────────────────────────── */

const DRAFTS_ROUTE = '/api/v1/meta/_drafts';
let fetchCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      fetchCalls.push(url);
      if (routeOf(url) !== DRAFTS_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ drafts: [] }) };
    }),
  );
  // Only `Date` is faked: timers stay real for the page's mount effects.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 6, 2, 30, 0));
  userFixture = { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' };
});

afterEach(() => {
  expect(fetchCalls.filter((url) => routeOf(url) !== DRAFTS_ROUTE)).toEqual([]);
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderHome(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <HomePage />
    </I18nProvider>,
  );
}

const heading = () => screen.getByRole('heading', { level: 1 });

describe('the Home greeting joins with the locale punctuation (objectui#11689)', () => {
  it('zh renders the full-width comma and full stop: 夜深了，Dev Admin。', () => {
    renderHome('zh');
    expect(heading().textContent).toBe('夜深了，Dev Admin。');
  });

  it('en is unchanged: Working late, Dev Admin.', () => {
    renderHome('en');
    expect(heading().textContent).toBe('Working late, Dev Admin.');
  });

  it('the name keeps its own coloured span', () => {
    renderHome('zh');
    const name = screen.getByText('Dev Admin');
    expect(name.tagName).toBe('SPAN');
    expect(name).toHaveClass('text-primary');
  });

  it('with no name there is no separator, only the closing mark', () => {
    userFixture = { id: 'u1', name: '', email: '' };
    renderHome('zh');
    expect(heading().textContent).toBe('夜深了。');
    cleanup();
    renderHome('en');
    expect(heading().textContent).toBe('Working late.');
  });
});
