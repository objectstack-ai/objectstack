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
 *   - with none it says what it opens, "New blank app", and opens Studio's
 *     new-package flow (`SETUP_NEW_PACKAGE_PATH`, Setup → Packages with New
 *     Package open since objectstack#36908);
 *   - with none, a session that may not author gets no build chip at all,
 *     while the template chip beside it still carries the reason;
 *   - while the catalog has not answered, neither form is drawn, so neither
 *     flashes before the other.
 *
 * objectstack#36969 — the AI form is drawn where the catalog serves the build
 * agent itself (alias-aware), not any agent: where in-app building is closed
 * the catalog keeps `ask` and drops `build`, and the chip takes the "New
 * blank app" form there, as for an empty catalog. So the unchanged-chip cases
 * serve `build`; a catalog of `ask` or of another agent alone is pinned below.
 *
 * objectstack#37227 — the first bullet above no longer holds: the maintainer
 * ruled "Build an app" (to bare `/studio`) off the home page, with "Build with
 * AI". Where the catalog serves the build agent the chip row now draws no build
 * chip of either form; "New in Studio" is unchanged where it does not.
 *
 * The catalog stand-in moves the way the real `useAgents` does: an empty first
 * frame before the request leaves, then loading, then the answer. `t` echoes
 * the key, so a hardcoded string fails here; that every key exists in all ten
 * packs is `all-locales-key-parity.test.ts`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  canAuthorMetadata: true,
  /** The catalog's answer, once it has answered. */
  agents: [] as Array<{ name: string }>,
  /** Holds the catalog in flight. */
  catalogPending: false,
  /** Set once the stand-in has drawn the catalog's answer (objectstack#37227). */
  answered: false,
  /**
   * Whether the session holds the Setup → Packages pair (`setup.access` +
   * `manage_platform_settings`). `'unreported'` stubs nothing: the real
   * provider around the page answers, with no `systemPermissions` at all.
   */
  setupPair: true as boolean | 'unreported',
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
      if (phase === 'answered') state.answered = true;
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
      if (state.setupPair === 'unreported') return real;
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
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

beforeEach(() => {
  navigateMock.mockReset();
  state.canAuthorMetadata = true;
  state.agents = [];
  state.catalogPending = false;
  state.answered = false;
  state.setupPair = true;
});

/**
 * An absence read before the catalog answers would pass on a page that has
 * not yet drawn the chip at all, so the cases that pin one wait for the answer.
 */
async function catalogAnswered(): Promise<void> {
  await waitFor(() => expect(state.answered).toBe(true));
}

afterEach(() => {
  cleanup();
});

describe('with the build agent in the catalog, no build chip is drawn (objectstack#37227)', () => {
  beforeEach(() => {
    state.agents = [{ name: 'build' }, { name: 'custom_helper' }];
  });

  it('neither "Build an app" nor "Build with AI"; the template chip stays', async () => {
    render(<HomePage />);
    expect(await screen.findByTestId('home-start-template')).toBeEnabled();
    await catalogAnswered();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    expect(screen.queryByTestId('home-build-with-ai')).toBeNull();
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
  });

  it('a session that may not author gets none either; the template chip keeps the reason', async () => {
    state.canAuthorMetadata = false;
    render(<HomePage />);
    await catalogAnswered();
    const template = await screen.findByTestId('home-start-template');
    expect(template).toBeDisabled();
    expect(template).toHaveAttribute('aria-describedby', screen.getByTestId('home-authoring-gate-reason').id);
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
  });
});

describe('with no agent in the catalog (objectstack#26614)', () => {
  it('the chip reads "New blank app" and opens Studio\'s new-package flow', async () => {
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

  // objectstack#37565 — the package-less scope: the "All metadata" area across packages it went to is Setup's now.
  it('an author who may enter Studio but not Setup → Packages is sent to the package-less scope, never Setup (objectstack#36908)', async () => {
    state.setupPair = false;
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByTestId('home-build-in-studio'));
    expect(navigateMock).toHaveBeenCalledWith('/studio/~org/metadata/flow?source=runtime');
    expect(navigateMock).not.toHaveBeenCalledWith(SETUP_NEW_PACKAGE_PATH);
  });

  /**
   * objectstack#36908 — the doors fail OPEN where the server never reported
   * the capability set, as their own authoring gate (`useCanAuthorMetadata`)
   * does: the door is only a link, and Setup → Packages and the create route
   * keep their own server-side gates. Nothing is stubbed here: the real
   * provider answers, once with no `systemPermissions` and once (the control)
   * with a reported set that holds neither capability of the pair.
   */
  it.each([
    ['an unreported set (no `systemPermissions`) fails open, to Setup\'s New Package', undefined, SETUP_NEW_PACKAGE_PATH],
    ['control: a reported set without the pair goes to the package-less scope', ['manage_metadata'], '/studio/~org/metadata/flow?source=runtime'],
  ])('%s', async (_case, systemPermissions, to) => {
    state.setupPair = 'unreported';
    const answer: MePermissionsAuthenticatedResponse = {
      authenticated: true,
      userId: 'u1',
      tenantId: 'org_1',
      positions: [],
      hasAnyQueue: false,
      objectsUsingQueues: [],
      permissionSets: ['member'],
      ...(systemPermissions ? { systemPermissions } : {}),
      objects: {},
      fields: {},
    };
    const user = userEvent.setup();
    render(
      <MePermissionsProvider initialPermissions={answer}>
        <HomePage />
      </MePermissionsProvider>,
    );
    await user.click(await screen.findByTestId('home-build-in-studio'));
    expect(navigateMock).toHaveBeenCalledWith(to);
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
  ])('%s: "New blank app", to Studio\'s new-package flow, and no "Build an app"', async (_case, agents) => {
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

  it('regression: the build agent\'s legacy id still counts as the build agent, so no Studio form either', async () => {
    state.agents = [{ name: 'metadata_assistant' }, { name: 'data_chat' }];
    render(<HomePage />);
    expect(await screen.findByTestId('home-start-template')).toBeEnabled();
    await catalogAnswered();
    expect(screen.queryByTestId('home-build-in-studio')).toBeNull();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
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
