// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36732 — the desktop's no-apps empty state, what is left of the
 * retired platform home page. From 768 px up a viewer with no product app (no
 * app but Setup and the platform's own) is drawn 「No applications yet」, and a
 * viewer who may add an app is offered the sidebar's 「Add app」 doors (build
 * with AI, start from a template, the marketplace) as buttons. An administrator
 * without `manage_metadata` is told why there are none (objectstack#8270);
 * anyone else is told their administrator shares apps with them.
 *
 * `t` echoes the KEY, so an assertion on «home.noAppsAddDescription» fails if
 * the copy is ever hardcoded. happy-dom's window is 1024 px wide: the desktop.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => vi.fn(),
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
  useObjectLabel: () => ({ appLabel: (app: any) => String(app?.label ?? app?.name ?? '') }),
}));

const viewer = { isAdmin: true, canAuthor: true, aiEnabled: true };

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Zhang San', email: 'zhangsan@acme-test.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => viewer.canAuthor,
  useCanReadPendingDrafts: () => false,
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [{ name: 'builder' }] }),
  isAskAgent: () => false,
  agentHasCapability: () => true,
}));

let appsFixture: any[] = [];
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: appsFixture, loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    notifications: [],
    unreadTopicCount: 0,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({
  resolveAiApiBase: () => '',
  useAiSurfaceEnabled: () => ({ enabled: viewer.aiEnabled, loading: false }),
}));
vi.mock('../../../views/metadata-admin/useMetadata', () => ({
  useMetadataClient: () => ({ listDrafts: async () => [] }),
}));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));
vi.mock('../ConnectAssistantCard', () => ({ ConnectAssistantCard: () => null }));

// The console's preview code loads `@objectstack/lint` lazily; paid at import,
// not inside a test's clock.
import '@objectstack/lint';
import { HomePage } from '../HomePage';

const SETUP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
const STUDIO = { name: 'studio', label: 'Studio', _packageId: 'com.objectstack.studio' };

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthor = true;
  viewer.aiEnabled = true;
  appsFixture = [SETUP, STUDIO];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ drafts: [] }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HomePage — the desktop no-apps empty state (objectstack#36732)', () => {
  it('offers an admin who may author the 「Add app」 doors, building with AI first', () => {
    render(<HomePage />);
    const empty = screen.getByTestId('home-no-apps');
    expect(empty).toHaveTextContent('«home.noAppsTitle»');
    expect(empty).toHaveTextContent('«home.noAppsAddDescription»');
    const ai = screen.getByTestId('home-no-apps-build-with-ai');
    expect(ai).toHaveAttribute('href', '/studio');
    expect(screen.getByTestId('home-no-apps-template')).toHaveAttribute('href', '/apps/setup/system/marketplace');
    expect(screen.getByTestId('home-no-apps-marketplace')).toHaveAttribute('href', '/apps/setup/system/marketplace');
    // The app tiles the retired page drew are gone: Setup and Studio are no app of the viewer's.
    expect(screen.queryByText('Studio')).not.toBeInTheDocument();
  });

  it('opens Studio on a new package where no AI agent is served', () => {
    viewer.aiEnabled = false;
    render(<HomePage />);
    expect(screen.queryByTestId('home-no-apps-build-with-ai')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-no-apps-new-in-studio')).toBeInTheDocument();
  });

  it('tells an admin without manage_metadata why there is no door', () => {
    viewer.canAuthor = false;
    render(<HomePage />);
    expect(screen.getByTestId('home-no-apps')).toHaveTextContent('«home.noAppsTitle»');
    expect(screen.getByTestId('home-authoring-gate-reason-empty')).toHaveTextContent('«home.build.noCapability»');
    expect(screen.queryByTestId('home-no-apps-build-with-ai')).not.toBeInTheDocument();
  });

  it('tells a member their administrator shares apps with them, and offers no door', () => {
    viewer.isAdmin = false;
    appsFixture = [];
    render(<HomePage />);
    const empty = screen.getByTestId('home-no-apps');
    expect(empty).toHaveTextContent('«home.noAppsDescription»');
    expect(empty).not.toHaveTextContent('«home.noAppsAddDescription»');
    expect(screen.queryByTestId('home-no-apps-template')).not.toBeInTheDocument();
  });

  it('is not drawn once the viewer has a product app', () => {
    appsFixture = [SETUP, { name: 'crm', label: 'CRM', _packageId: 'com.acme.crm' }];
    render(<HomePage />);
    expect(screen.queryByTestId('home-no-apps')).not.toBeInTheDocument();
  });
});
