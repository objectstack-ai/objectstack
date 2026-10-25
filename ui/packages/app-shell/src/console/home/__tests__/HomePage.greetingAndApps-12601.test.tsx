// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12601 — the Home greeting row and the apps strip, as the artboard
 * "系统首页 · 四段式" draws its sections ① and ②.
 *
 * What these cases pin, on the real `HomePage` with the real `HomeAppsStrip`:
 *
 *   - the line under the greeting sums up what is waiting from the
 *     pending-approvals feed, the count the bell badges, and says nothing is
 *     waiting at zero — only when that count is an answer (`ready`): while
 *     the read is in flight, after it fails or before it is asked, the line
 *     claims nothing. It names approvals only: no source classifies an inbox
 *     row as "assigned to me" yet (the card's fork, reported on the PR);
 *   - the builder entries are two chips at the greeting's right, for an admin
 *     only — a non-admin renders neither;
 *   - a withheld chip explains itself through the objectui#12303 tooltip
 *     wrapper: a tab stop that triggers the tooltip, the wrapper and the
 *     button both described by one visually hidden copy of the reason, which
 *     keeps the `home-authoring-gate-reason` / `home-marketplace-disabled-reason`
 *     test ids;
 *   - Setup is not a tile: it is the strip heading's "System Settings" link,
 *     on the `/setup` alias's own route, and the count pill does not count it;
 *   - a tile shows when its app was last opened, read from the recent-items
 *     store: the newest entry opened inside the app;
 *   - an admin who may install apps gets a trailing "Add app" tile on the
 *     marketplace route, gated exactly as the marketplace shortcut is.
 *
 * `t` echoes the KEY (and the count or time it was handed), so a hardcoded string
 * fails here; that every key exists in all ten packs is
 * `all-locales-key-parity.test.ts`'s and `check:i18n-keys`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  isAdmin: true,
  canAuthorMetadata: true,
  marketplaceEnabled: true,
  pendingApprovalsCount: 0,
  approvalsStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
  apps: [] as Array<Record<string, unknown>>,
  recentItems: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    // The tiles and the settings link are router `Link`s; this harness has no
    // router, so the stand-in renders the anchor `Link` would, minus the basename.
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { count?: number; time?: string }) =>
      `«${key}»` +
      (opts?.count === undefined ? '' : `[count=${opts.count}]`) +
      (opts?.time === undefined ? '' : `[time=${opts.time}]`),
    language: 'en',
  }),
  // Every labeller echoes the label, else the name: the tiles read `appLabel`,
  // and the recent rail beside them labels the store's entries.
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
  useWorkspaceAdminStatus: () => ({ isAdmin: state.isAdmin, isResolved: true }),
}));

// No AI agent: the greeting row holds the builder chips alone.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
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
  useCanAuthorMetadata: () => state.canAuthorMetadata,
}));
// The page's one inbox seam: the approvals count AND whether it is an answer.
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: state.pendingApprovalsCount,
    // objectui#12602: the approvals preview, and whether each source is
    // the caller's to read — the My-work section draws a column per source.
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    pendingApprovalsStatus: state.approvalsStatus,
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => state.marketplaceEnabled,
  isAiStudioEnabled: () => true,
}));

// The tiles' last-opened time reads the recent-items store.
vi.mock('../../../hooks/useRecentItems', () => ({
  useRecentItems: () => ({ recentItems: state.recentItems }),
}));

// --- surfaces these cases do not read ---------------------------------------
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../preview/usePendingDrafts', () => ({ usePendingDrafts: () => ({ count: 0 }) }));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));

import { HomePage } from '../HomePage';

const CRM = { name: 'crm', label: 'CRM', icon: 'Building2' };
const SETUP = { name: 'setup', label: 'Setup', icon: 'Settings', _packageId: 'com.objectstack.setup' };

/** Every URL the page handed the global `fetch` — none is expected. */
let fetchCalls: string[] = [];

beforeEach(() => {
  navigateMock.mockReset();
  state.isAdmin = true;
  state.canAuthorMetadata = true;
  state.marketplaceEnabled = true;
  state.pendingApprovalsCount = 0;
  state.approvalsStatus = 'ready';
  state.apps = [CRM, SETUP];
  state.recentItems = [];
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      fetchCalls.push(String(input));
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  expect(fetchCalls).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

describe('the line under the greeting (objectui#12601)', () => {
  it('reads the approvals count the bell badges', () => {
    state.pendingApprovalsCount = 2;
    render(<HomePage />);
    expect(screen.getByTestId('home-work-summary')).toHaveTextContent('«home.summary.approvals»[count=2]');
  });

  it('says nothing is waiting at zero', () => {
    state.pendingApprovalsCount = 0;
    render(<HomePage />);
    expect(screen.getByTestId('home-work-summary')).toHaveTextContent('«home.summary.none»');
  });

  it.each([
    ['in flight', 'loading', 0],
    ['failed', 'error', 0],
    ['not asked', 'idle', 0],
    // A count kept from an earlier read is not vouched for once a re-read fails.
    ['failed after an earlier answer', 'error', 3],
  ] as const)('claims nothing while the approvals read is %s', (_when, status, count) => {
    state.approvalsStatus = status;
    state.pendingApprovalsCount = count;
    render(<HomePage />);
    const line = screen.getByTestId('home-work-summary');
    // The page did render; the line holds its place and says nothing.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(line).toBeEmptyDOMElement();
    expect(screen.queryByText(/home\.summary\./)).toBeNull();
  });
});

describe('the builder chips (objectui#12601)', () => {
  it('a non-admin renders no builder chips', () => {
    state.isAdmin = false;
    render(<HomePage />);
    // The page did render: the greeting row's summary is there.
    expect(screen.getByTestId('home-work-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('home-build-app')).toBeNull();
    expect(screen.queryByTestId('home-start-template')).toBeNull();
  });

  it('CONTROL — an admin gets both chips, live, beside the greeting', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const build = screen.getByTestId('home-build-app');
    const template = screen.getByTestId('home-start-template');
    expect(build).toBeEnabled();
    expect(template).toBeEnabled();
    expect(build).toHaveTextContent('«home.build.title»');
    expect(template).toHaveTextContent('«home.template.title»');
    // One row: the chips share the summary's section, with no cover card.
    const section = screen.getByTestId('home-work-summary').closest('section')!;
    expect(section).toContainElement(build);
    expect(section).toContainElement(template);
    expect(screen.queryByTestId('home-authoring-gate-reason')).toBeNull();

    await user.click(build);
    expect(navigateMock).toHaveBeenCalledWith('/studio');
    await user.click(template);
    expect(navigateMock).toHaveBeenCalledWith('/apps/setup/system/marketplace');
  });

  it('a chip withheld for want of the capability explains itself through the tooltip wrapper', async () => {
    const user = userEvent.setup();
    state.canAuthorMetadata = false;
    render(<HomePage />);

    const reason = screen.getByTestId('home-authoring-gate-reason');
    expect(reason).toHaveTextContent('«home.build.noCapability»');
    expect(reason).toHaveClass('sr-only');
    expect(reason.id).not.toBe('');

    for (const testId of ['home-build-app', 'home-start-template']) {
      const chip = screen.getByTestId(testId);
      expect(chip).toBeDisabled();
      // The button and its wrapper are both described by the one reason.
      expect(chip).toHaveAttribute('aria-describedby', reason.id);
      const wrapper = chip.parentElement!;
      expect(wrapper.tagName).toBe('SPAN');
      expect(wrapper).toHaveAttribute('tabindex', '0');
      expect(wrapper).toHaveAttribute('data-disabled-reason');
      expect(wrapper).toHaveAttribute('aria-describedby', reason.id);
    }

    await user.hover(screen.getByTestId('home-build-app').parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('«home.build.noCapability»');

    // Withheld means inert: a click reaches no route.
    await user.click(screen.getByTestId('home-build-app'));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('on a runtime with no marketplace only the template chip is withheld, with its own reason', async () => {
    const user = userEvent.setup();
    state.marketplaceEnabled = false;
    render(<HomePage />);

    expect(screen.getByTestId('home-build-app')).toBeEnabled();
    const template = screen.getByTestId('home-start-template');
    expect(template).toBeDisabled();
    const reason = screen.getByTestId('home-marketplace-disabled-reason');
    expect(reason).toHaveTextContent('«home.template.marketplaceDisabled»');
    expect(template).toHaveAttribute('aria-describedby', reason.id);
    expect(template.parentElement).toHaveAttribute('tabindex', '0');
    expect(screen.queryByTestId('home-authoring-gate-reason')).toBeNull();

    template.parentElement!.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('«home.template.marketplaceDisabled»');
    await user.click(template);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('the apps strip (objectui#12601)', () => {
  it('Setup is not among the tiles: it is the heading’s System Settings link, on the /setup alias’s route', () => {
    render(<HomePage />);
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.queryByTestId('app-tile-setup')).toBeNull();

    const link = screen.getByTestId('home-system-settings-link');
    expect(link).toHaveTextContent('«home.systemSettings»');
    expect(link).toHaveAttribute('href', '/apps/com.objectstack.setup');
    // The count pill counts the tiles, so Setup is not in it.
    expect(screen.getByTestId('home-apps-count')).toHaveTextContent(/^1$/);
  });

  it('CONTROL — with no Setup app among the openable apps there is no settings link', () => {
    state.apps = [CRM, { name: 'ops', label: 'Ops' }];
    render(<HomePage />);
    expect(screen.queryByTestId('home-system-settings-link')).toBeNull();
    expect(screen.getByTestId('home-apps-count')).toHaveTextContent(/^2$/);
  });

  it('an admin gets a trailing Add app tile on the marketplace route', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    const add = screen.getByTestId('home-add-app');
    expect(add.tagName).toBe('BUTTON');
    expect(add).toHaveTextContent('«home.addApp»');
    // Trailing: after the last app tile, in the same row.
    const row = screen.getByTestId('app-tile-crm').parentElement!;
    expect(row.lastElementChild).toBe(add);
    await user.click(add);
    expect(navigateMock).toHaveBeenCalledWith('/apps/setup/system/marketplace');
  });

  it.each([
    ['a non-admin', { isAdmin: false }],
    ['an admin without the capability', { canAuthorMetadata: false }],
    ['an admin on a runtime with no marketplace', { marketplaceEnabled: false }],
  ] as const)('%s gets no Add app tile, as no marketplace shortcut', (_who, override) => {
    Object.assign(state, override);
    render(<HomePage />);
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
    expect(screen.queryByTestId('home-add-app')).toBeNull();
    expect(screen.queryByTestId('browse-marketplace-btn')).toBeNull();
  });

  it('a tile shows when its app was last opened, read from the recent-items store', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    state.apps = [CRM, { name: 'ops', label: 'Ops' }, SETUP];
    state.recentItems = [
      // Newest first, as the store keeps them: CRM's newest entry decides.
      { id: 'object:account', type: 'object', name: 'account', href: '/apps/crm/account', visitedAt: hoursAgo(2) },
      // Setup is not a tile, so its entry draws no line anywhere.
      { id: 'object:sys_user', type: 'object', name: 'sys_user', href: '/apps/com.objectstack.setup/sys_user', visitedAt: hoursAgo(3) },
      { id: 'dashboard:pipeline', type: 'dashboard', name: 'pipeline', href: '/apps/crm/dashboard/pipeline', visitedAt: hoursAgo(5) },
      // An entry with no readable time names nothing: Ops draws no line.
      { id: 'record:ticket:1', type: 'record', label: 'T-1', href: '/apps/ops/ticket/record/1', visitedAt: '' },
    ];
    render(<HomePage />);

    const opened = screen.getByTestId('app-tile-opened-crm');
    expect(screen.getByTestId('app-tile-crm')).toContainElement(opened);
    // The tile's compact form (`TILE_OPENED_TIME_FORMAT`), not the long one.
    expect(opened).toHaveTextContent('«home.appOpened»[time=2 hr. ago]');
    // CONTROL — an app with nothing left in the store draws no line.
    expect(screen.getByTestId('app-tile-ops')).toBeInTheDocument();
    expect(screen.queryByTestId('app-tile-opened-ops')).toBeNull();
    expect(screen.queryByTestId('app-tile-opened-setup')).toBeNull();
  });

  it('the heading names the section and its links sit at its right', () => {
    render(<HomePage />);
    const heading = screen.getByRole('heading', { level: 2, name: '«home.yourApps»' });
    const bar = heading.parentElement!;
    expect(within(bar).getByTestId('browse-marketplace-btn')).toHaveTextContent('«home.browseMarketplace»');
    expect(within(bar).getByTestId('home-system-settings-link')).toBeInTheDocument();
  });
});
