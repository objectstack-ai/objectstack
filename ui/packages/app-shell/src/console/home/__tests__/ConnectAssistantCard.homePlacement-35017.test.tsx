// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35017 — where Home draws the "Connect an AI Assistant" card.
 *
 * On the real `HomePage`, with the card itself stood in by a marker (whether
 * it shows is `ConnectAssistantCard-30895.test.tsx`'s, unchanged):
 *
 *  - with apps, the first screen reads greeting, My apps, My work, and only
 *    then the card; with no My work section it still follows the apps;
 *  - with no app yet, it follows the empty state's welcome, not above it.
 *
 * The harness is `HomePage.greetingAndApps-12601.test.tsx`'s: every source the
 * page reads is stubbed, `t` echoes the key.
 */

// HomePage reaches `import('@objectstack/lint')` (usePublishAllDrafts →
// capabilityLint); pay that load at collection, not inside a case's timeout.
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  readable: true,
}));

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
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
  useAgents: () => ({ agents: [{ name: 'custom_helper' }] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: [], dashboards: [], pages: [], reports: [], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
  useCanReadPendingDrafts: () => true,
}));
// `readable: false` on both sources and no drafts row: My work draws nothing.
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    pendingApprovals: [],
    pendingApprovalsReadable: state.readable,
    notificationsReadable: state.readable,
    pendingApprovalsStatus: 'ready',
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
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
vi.mock('../../../preview/usePendingDrafts', () => ({ usePendingDrafts: () => ({ count: 0 }) }));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

// The card stood in by a marker that always draws, so only its place is read.
vi.mock('../ConnectAssistantCard', async () => {
  const { createElement } = await import('react');
  return {
    ConnectAssistantCard: ({ className }: { className?: string }) =>
      createElement('section', { 'data-testid': 'home-connect-assistant', className }),
  };
});

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'CRM', icon: 'Building2' };

beforeEach(() => {
  navigateMock.mockReset();
  state.apps = [CRM];
  state.readable = true;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** `a` comes before `b` in document order. */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('with apps: greeting, My apps, My work, then the card (objectstack#35017)', () => {
  it('draws the card after the greeting, the apps strip and My work', () => {
    render(<HomePage />);
    const greeting = screen.getByRole('heading', { level: 1 });
    const apps = screen.getByTestId('app-tile-crm');
    const work = screen.getByTestId('home-my-work');
    const card = screen.getByTestId('home-connect-assistant');
    expect(before(greeting, apps)).toBe(true);
    expect(before(apps, work)).toBe(true);
    expect(before(work, card)).toBe(true);
  });

  it('with no My work section, the card still follows the greeting and the apps', () => {
    state.readable = false;
    render(<HomePage />);
    expect(screen.queryByTestId('home-my-work')).toBeNull();
    const card = screen.getByTestId('home-connect-assistant');
    expect(before(screen.getByRole('heading', { level: 1 }), card)).toBe(true);
    expect(before(screen.getByTestId('app-tile-crm'), card)).toBe(true);
  });
});

describe('with no app yet: after the welcome (objectstack#35017)', () => {
  it('draws the card after the empty state, not above it', () => {
    state.apps = [];
    render(<HomePage />);
    const welcome = screen.getByText('«home.welcome»');
    const card = screen.getByTestId('home-connect-assistant');
    expect(before(welcome, card)).toBe(true);
  });
});
