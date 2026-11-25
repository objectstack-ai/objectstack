// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26614 — Home's build chip reads the runtime's AI capability.
 *
 * On a deployment whose agent catalog (`GET /api/v1/ai/agents`) is empty or
 * absent, "Build an app" promised a build nothing there could start. What
 * these cases pin, on the real `HomePage`, for an admin on a runtime that
 * offers authoring:
 *
 *   - with an agent in the catalog the chip is unchanged: "Build an app", to
 *     `/studio`, dimmed with its reason for a session that may not author;
 *   - with none it says what it opens, "New in Studio", and opens Studio's
 *     new-package flow (`SETUP_NEW_PACKAGE_PATH`, Setup → Packages with New
 *     Package open since objectstack#36908);
 *   - with none, a session that may not author gets no build chip at all,
 *     while the template chip beside it still carries the reason;
 *   - while the catalog has not answered, neither form is drawn, so neither
 *     flashes before the other.
 *
 * objectstack#36969 — the AI form is drawn where the catalog serves the build
 * agent itself (alias-aware), not any agent: where in-app building is closed
 * the catalog keeps `ask` and drops `build`, and the chip takes the "New in
 * Studio" form there, as for an empty catalog. So the unchanged-chip cases
 * serve `build`; a catalog of `ask` or of another agent alone is pinned below.
 *
 * The catalog stand-in moves the way the real `useAgents` does: an empty first
 * frame before the request leaves, then loading, then the answer. `t` echoes
 * the key, so a hardcoded string fails here; that every key exists in all ten
 * packs is `all-locales-key-parity.test.ts`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  canAuthorMetadata: true,
  /** The catalog's answer, once it has answered. */
  agents: [] as Array<{ name: string }>,
  /** Holds the catalog in flight. */
  catalogPending: false,
  /** Whether the session holds the Setup → Packages pair (`setup.access` + `manage_platform_settings`). */
  setupPair: true,
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

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => {
  const { useEffect, useState } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
    useAgents: () => {
      const [phase, setPhase] = useState<'idle' | 'loading' | 'answered'>('idle');
      useEffect(() => {
        if (phase === 'idle') setPhase('loading');
        else if (phase === 'loading' && !state.catalogPending) setPhase('answered');
      }, [phase]);
      return { agents: phase === 'answered' ? state.agents : [], isLoading: phase === 'loading' };
    },
    // A custom agent: AI is on, and no ask or build CTA joins the row.
    isAskAgent: () => false,
    agentHasCapability: () => false,
  };
});

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
  useNavigationContext: () => ({ currentAppName: undefined }),
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return {
        ...real,
        hasCapabilities: (required: string[]) =>
          required.includes('setup.access') || required.includes('manage_platform_settings')
            ? state.setupPair
            : real.hasCapabilities(required),
      };
    },
  };
});
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => state.canAuthorMetadata,
  useCanReadPendingDrafts: () => true,
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));

// --- surfaces these cases do not read ---------------------------------------
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    pendingApprovalsStatus: 'ready',
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../preview/usePendingDrafts', () => ({ usePendingDrafts: () => ({ count: 0 }) }));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));

// Home marks an opened notification read through the bell's own write
// (`useInboxBell`); this harness serves no inbox feed, so the write is stubbed.
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));

// The deployment notice reads its own state from the server for an administrator
// (objectstack#30120); its fetch, its gate and its copy are pinned in
// `deployment-notice/__tests__/DeploymentNotice.test.tsx`, so it is stubbed here
// like every other source this page reads.
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

// The console's preview code loads `@objectstack/lint` lazily; paid at import,
// not inside a test's clock.
import '@objectstack/lint';
import { HomePage } from '../HomePage';
import { SETUP_NEW_PACKAGE_PATH } from '../../../views/metadata-admin/packageSource';

beforeEach(() => {
  navigateMock.mockReset();
  state.canAuthorMetadata = true;
  state.agents = [];
  state.catalogPending = false;
  state.setupPair = true;
});

afterEach(() => {
  cleanup();
});

describe('with the build agent in the catalog, the build chip is unchanged (objectstack#26614)', () => {
  beforeEach(() => {
    state.agents = [{ name: 'build' }, { name: 'custom_helper' }];
  });

  it('"Build an app" opens Studio', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const build = await screen.findByTestId('home-build-app');
    expect(build).toBeEnabled();
    expect(build).toHaveTextContent('«home.build.title»');
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
    await user.click(build);
    expect(navigateMock).toHaveBeenCalledWith('/studio');
  });

  it('a session that may not author still gets it dimmed, with its reason', async () => {
    state.canAuthorMetadata = false;
    render(<HomePage />);
    const build = await screen.findByTestId('home-build-app');
    expect(build).toBeDisabled();
    expect(build).toHaveAttribute('aria-describedby', screen.getByTestId('home-authoring-gate-reason').id);
  });
});

describe('with no agent in the catalog (objectstack#26614)', () => {
  it('the chip reads "New in Studio" and opens Studio\'s new-package flow', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const chip = await screen.findByTestId('home-build-in-studio');
    expect(chip).toBeEnabled();
    expect(chip).toHaveTextContent('«home.build.inStudio»');
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    await user.click(chip);
    expect(navigateMock).toHaveBeenCalledWith(SETUP_NEW_PACKAGE_PATH);
    expect(SETUP_NEW_PACKAGE_PATH).toBe('/apps/setup/component/developer/packages?face=admin&new=package');
  });

  it('an author who may enter Studio but not Setup → Packages is sent to the "All metadata" area, never Setup (objectstack#36908)', async () => {
    state.setupPair = false;
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByTestId('home-build-in-studio'));
    expect(navigateMock).toHaveBeenCalledWith('/studio/~all/metadata');
    expect(navigateMock).not.toHaveBeenCalledWith(SETUP_NEW_PACKAGE_PATH);
  });

  it('a session that may not author gets no build chip; the template chip keeps the reason', async () => {
    state.canAuthorMetadata = false;
    render(<HomePage />);
    const template = await screen.findByTestId('home-start-template');
    expect(template).toBeDisabled();
    expect(template).toHaveAttribute('aria-describedby', screen.getByTestId('home-authoring-gate-reason').id);
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
  });
});

describe('without the build agent in the catalog, the chip takes its Studio form (objectstack#36969)', () => {
  it.each([
    ['in-app building closed: `ask` served, `build` not', [{ name: 'ask' }]],
    ['another agent only', [{ name: 'custom_helper' }]],
  ])('%s: "New in Studio", to Studio\'s new-package flow, and no "Build an app"', async (_case, agents) => {
    state.agents = agents;
    const user = userEvent.setup();
    render(<HomePage />);
    const chip = await screen.findByTestId('home-build-in-studio');
    expect(chip).toBeEnabled();
    expect(chip).toHaveTextContent('«home.build.inStudio»');
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    await user.click(chip);
    expect(navigateMock).toHaveBeenCalledWith(SETUP_NEW_PACKAGE_PATH);
  });

  it('a session that may not author gets no build chip there', async () => {
    state.agents = [{ name: 'ask' }];
    state.canAuthorMetadata = false;
    render(<HomePage />);
    expect(await screen.findByTestId('home-start-template')).toBeDisabled();
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
  });

  it('regression: the build agent\'s legacy id keeps "Build an app", to /studio', async () => {
    state.agents = [{ name: 'metadata_assistant' }, { name: 'data_chat' }];
    const user = userEvent.setup();
    render(<HomePage />);
    const build = await screen.findByTestId('home-build-app');
    expect(build).toHaveTextContent('«home.build.title»');
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
    await user.click(build);
    expect(navigateMock).toHaveBeenCalledWith('/studio');
  });
});

describe('while the catalog has not answered (objectstack#26614)', () => {
  it('neither form of the build chip is drawn', async () => {
    state.catalogPending = true;
    state.agents = [{ name: 'custom_helper' }];
    render(<HomePage />);
    // The row itself is there: the template chip does not wait on the catalog.
    expect(await screen.findByTestId('home-start-template')).toBeEnabled();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
  });
});
