// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37858 — Home's 「Ask AI」 opens the assistant through the same
 * entry as the page's Ask AI button (`useAskAiEntry`), so when opening comes
 * to mean "a new conversation" the two change together. Today it still asks
 * the `ask` agent, as it did.
 *
 * Real subject: `HomePage`, with the stand-ins of
 * `HomePage.phoneTapTargets-29147.test.tsx` (the catalog moves the way the
 * real `useAgents` does); the entry is observed, not run.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  /** The catalog's answer, once it has answered. */
  agents: [] as Array<{ name: string }>,
  askAgent: false,
  buildAgent: false,
  /** Set once the stand-in has drawn the catalog's answer (objectstack#37227). */
  answered: false,
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
      if (phase === 'answered') state.answered = true;
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

// objectstack#37858 — the entry the top bar's Ask AI button opens the drawer
// through, observed: Home's button must reach the drawer by the same door.
const askAiEntry = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../../../layout/AssistantTopBarButton', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAskAiEntry: () => (target?: unknown) => {
    askAiEntry.calls.push(target);
  },
}));

// The deployment notice reads its own state from the server for an administrator
// (objectstack#30120); its fetch, its gate and its copy are pinned in
// `deployment-notice/__tests__/DeploymentNotice.test.tsx`, so it is stubbed here
// like every other source this page reads.
vi.mock('../../deployment-notice/DeploymentNotice', () => ({ DeploymentNotice: () => null }));

// The page reaches `capabilityLint`'s dynamic `@objectstack/lint` import; its
// first load is paid here, at collection, never inside a case's clock
// (`check:test-source-alias`).
import '@objectstack/lint';
import { HomePage } from '../HomePage';

beforeEach(() => {
  navigateMock.mockReset();
  askAiEntry.calls = [];
  state.apps = [{ name: 'crm', label: 'CRM', icon: 'Box' }];
  state.agents = [{ name: 'ask' }];
  state.askAgent = true;
  state.buildAgent = false;
  state.answered = false;
});

afterEach(() => {
  cleanup();
});

describe("Home's Ask AI opens the assistant's one entry (objectstack#37858)", () => {
  it('a click goes through the entry, on the ask agent, and navigates nowhere', async () => {
    render(<HomePage />);
    fireEvent.click(await screen.findByTestId('home-ask-ai'));
    expect(askAiEntry.calls).toEqual([{ agent: 'ask' }]);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
