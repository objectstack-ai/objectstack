// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29147 — below `sm`, every Home launcher link and button meets the
 * 44 px touch target; at `sm` and up each keeps its desktop size.
 *
 * What these cases pin, on the real `HomePage` and the real strip and rail it
 * renders: each target carries its phone class (`max-sm:h-11`, or
 * `max-sm:min-h-11` where the target has no fixed height) beside its unchanged
 * desktop class. A narrow text link also carries `max-sm:min-w-11`, so a short
 * label ("View all") is never a target narrower than 44 px.
 *
 * happy-dom computes no Tailwind media query, so the pin is the class; that the
 * classes reach 44 px in a browser is the PR's 375 / 390 px measurement.
 *
 * `t` echoes the key, so a hardcoded string fails here.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  /** The catalog's answer, once it has answered. */
  agents: [] as Array<{ name: string }>,
  askAgent: false,
  buildAgent: false,
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

// The catalog moves the way the real `useAgents` does: an empty first frame,
// then loading, then the answer.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => {
  const { useEffect, useState } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
    useAgents: () => {
      const [phase, setPhase] = useState<'idle' | 'loading' | 'answered'>('idle');
      useEffect(() => {
        if (phase === 'idle') setPhase('loading');
        else if (phase === 'loading') setPhase('answered');
      }, [phase]);
      return { agents: phase === 'answered' ? state.agents : [], isLoading: phase === 'loading' };
    },
    isAskAgent: () => state.askAgent,
    agentHasCapability: () => state.buildAgent,
  };
});

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: [], dashboards: [], pages: [], reports: [], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
  useCanReadPendingDrafts: () => true,
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));

const now = new Date().toISOString();
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovals: [{ id: 'apr_1', processLabel: 'Discount approval', recordTitle: 'QUO-0007', createdAt: now }],
    pendingApprovalsCount: 1,
    pendingApprovalsStatus: 'ready',
    pendingApprovalsReadable: true,
    notifications: [{ id: 'n1', title: 'Lead assigned', createdAt: now }],
    unreadTopicCount: 1,
    notificationsStatus: 'ready',
    notificationsReadable: true,
    activity: {
      value: [{ id: 'a1', user: 'Ada', description: 'updated a lead', timestamp: now, objectName: 'crm_lead' }],
      status: 'ready',
      readable: true,
    },
  }),
}));
vi.mock('../../../hooks/useRecentItems', () => ({
  useRecentItems: () => ({
    recentItems: [{ id: 'object:crm_lead', type: 'object', name: 'crm_lead', href: '/apps/crm/crm_lead', visitedAt: now }],
  }),
}));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../preview/usePendingDrafts', () => ({
  usePendingDrafts: () => ({ count: 1, entries: [{ name: 'crm_lead', label: 'Lead' }] }),
}));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));
vi.mock('../../../layout/ActivityObjectLabel', () => ({ ActivityObjectLabel: () => null }));

// The deployment notice reads its own state from the server for an administrator
// (objectstack#30120); its fetch, its gate and its copy are pinned in
// `deployment-notice/__tests__/DeploymentNotice.test.tsx`, so it is stubbed here
// like every other source this page reads.
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

import { HomePage } from '../HomePage';

/** Enough apps that the strip folds the rest behind "More". */
const MANY_APPS = [
  { name: 'setup', label: 'Setup', icon: 'Settings' },
  ...Array.from({ length: 21 }, (_, i) => ({ name: `app_${i}`, label: `App ${i}`, icon: 'Box' })),
];

/** Asserts a target keeps its desktop class and takes its phone class. */
function expectPhoneTarget(el: HTMLElement, desktop: string[], phone: string[]) {
  const classes = el.className.split(/\s+/);
  for (const c of desktop) expect(classes, `${el.dataset.testid}: desktop class ${c}`).toContain(c);
  for (const c of phone) expect(classes, `${el.dataset.testid}: phone class ${c}`).toContain(c);
}

beforeEach(() => {
  navigateMock.mockReset();
  state.apps = MANY_APPS;
  state.agents = [];
  state.askAgent = false;
  state.buildAgent = false;
});

afterEach(() => {
  cleanup();
});

describe('the greeting row (objectstack#29147)', () => {
  it('the builder chips are 44 px below sm and 32 px from sm', async () => {
    render(<HomePage />);
    expectPhoneTarget(await screen.findByTestId('home-build-in-studio'), ['h-8'], ['max-sm:h-11']);
    expectPhoneTarget(screen.getByTestId('home-start-template'), ['h-8'], ['max-sm:h-11']);
  });

  it('"Build an app" and "Build with AI" are 44 px below sm and 32 px from sm', async () => {
    state.agents = [{ name: 'builder' }];
    state.buildAgent = true;
    render(<HomePage />);
    expectPhoneTarget(await screen.findByTestId('home-build-app'), ['h-8'], ['max-sm:h-11']);
    expectPhoneTarget(screen.getByTestId('home-build-with-ai'), ['h-8'], ['max-sm:h-11']);
  });

  it('"Ask AI" is 44 px below sm and 32 px from sm', async () => {
    state.agents = [{ name: 'ask' }];
    state.askAgent = true;
    render(<HomePage />);
    expectPhoneTarget(await screen.findByTestId('home-ask-ai'), ['h-8'], ['max-sm:h-11']);
  });

  it('with no app yet, the empty state\'s "Ask AI" is 44 px below sm', async () => {
    state.apps = [];
    state.agents = [{ name: 'ask' }];
    state.askAgent = true;
    render(<HomePage />);
    expectPhoneTarget(await screen.findByTestId('home-ask-ai'), ['h-10'], ['max-sm:h-11']);
  });
});

describe('"Your apps" (objectstack#29147)', () => {
  it('the heading\'s links are 44 px tall below sm', () => {
    render(<HomePage />);
    expectPhoneTarget(screen.getByTestId('browse-marketplace-btn'), ['inline-flex', 'items-center'], ['max-sm:min-h-11']);
    expectPhoneTarget(screen.getByTestId('home-system-settings-link'), ['inline-flex', 'items-center'], ['max-sm:min-h-11']);
  });

  it('"Show less" is a 44 px target below sm', async () => {
    render(<HomePage />);
    await userEvent.setup().click(screen.getByTestId('apps-show-all'));
    expectPhoneTarget(screen.getByTestId('apps-show-less'), ['text-xs'], ['max-sm:min-h-11', 'max-sm:min-w-11']);
  });
});

describe('"My work" (objectstack#29147)', () => {
  it('"Open inbox" and both "View all" links are 44 px targets below sm', () => {
    render(<HomePage />);
    for (const id of ['home-my-work-open-inbox', 'home-my-work-approvals-view-all', 'home-my-work-notifications-view-all']) {
      expectPhoneTarget(screen.getByTestId(id), ['text-xs'], ['max-sm:min-h-11', 'max-sm:min-w-11']);
    }
    // The column header grows with its link, so the link is not clipped.
    const header = screen.getByTestId('home-my-work-approvals-view-all').parentElement as HTMLElement;
    expectPhoneTarget(header, ['h-10'], ['max-sm:h-11']);
  });

  it('a row is 44 px below sm, its 1 px divider outside the button', () => {
    render(<HomePage />);
    for (const id of ['home-my-work-approval-row', 'home-my-work-notification-row']) {
      const row = screen.getByTestId(id);
      expectPhoneTarget(row, ['h-full'], ['max-sm:min-h-11']);
      // A fixed 44 px item would leave the button 43 px under its border-top.
      expectPhoneTarget(row.parentElement as HTMLElement, ['h-10', 'border-t'], ['max-sm:h-auto']);
    }
  });

  it('the pending-drafts row\'s "Publish" is 44 px below sm, in a row tall enough to hold it', () => {
    render(<HomePage />);
    expectPhoneTarget(screen.getByTestId('pending-drafts-publish'), ['h-7'], ['max-sm:h-11']);
    expectPhoneTarget(screen.getByTestId('home-pending-drafts'), ['h-10'], ['max-sm:h-14']);
  });
});

describe('"Recently accessed" and the activity feed (objectstack#29147)', () => {
  it('a recent row is 44 px below sm', () => {
    render(<HomePage />);
    const [row] = within(screen.getByTestId('home-recent')).getAllByTestId('home-recent-row');
    expectPhoneTarget(row, ['h-10'], ['max-sm:h-11']);
  });

  it('"View all activity" is 44 px tall below sm', () => {
    render(<HomePage />);
    expectPhoneTarget(screen.getByTestId('home-activity-view-all'), ['inline-flex', 'items-center'], ['max-sm:min-h-11']);
  });
});
