// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Opening a notification from Home's "My work → Notifications" card marks it
 * read, exactly as opening it from the top-bar bell does.
 *
 * ## The defect
 *
 * The bell's row click marked the message read and then followed its link.
 * Home's row click only followed the link. Nothing else ever marks a message
 * read, so a notification opened from Home stayed unread on the server: no
 * `POST /api/v1/notifications/read` went out, `unreadCount` did not move, and
 * the bell kept its badge after a reload.
 *
 * Both doors now call `openInboxNotification`, and Home hands it the bell's own
 * write (`useInboxBell().markRead`) — so the request below is the bell's
 * request by construction, not a second copy of it.
 *
 * ## What this drives
 *
 * The REAL `HomePage`, the real `useHomeInbox` and `useInboxBell`, and the real
 * shared inbox feed, over one fake data adapter (the inbox rows and their
 * receipts) and one recording `fetch` double that plays the server: a
 * `POST /api/v1/notifications/read` writes `read` receipts for the ids it
 * names, so the next feed read answers with them. What is asserted is the
 * request on the wire — method, path and body — its order against the
 * navigation, and the card's unread count after the feed re-reads.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Every observable step, in the order it happened: requests and navigations. */
let timeline: string[] = [];

const navigateMock = vi.fn((to: string) => {
  timeline.push(`navigate ${to}`);
});

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    // The bell wiring's arrival announcer reads the route's app segment.
    useParams: () => ({}),
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'crm' }], loading: false }),
}));

vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));

vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
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

// ── The server's side of the inbox: messages, and receipts keyed by event id ──

/** Two unread messages, so the count has somewhere to drop to. */
const INBOX = [
  {
    id: 'ibx_1',
    user_id: 'u1',
    notification_id: 'ntf_1',
    topic: 'task.assigned',
    title: 'Task T-1 was assigned to you',
    action_url: '/showcase_task/t_1',
    created_at: '2026-10-29T09:00:00Z',
  },
  {
    id: 'ibx_2',
    user_id: 'u1',
    notification_id: 'ntf_2',
    topic: 'task.mention',
    title: 'You were mentioned in Task T-2',
    action_url: '/showcase_task/t_2',
    created_at: '2026-10-29T08:00:00Z',
  },
];

/** Event ids the server holds a `read` receipt for. */
let readIds = new Set<string>();

const fakeAdapter = {
  find: (object: string) => {
    if (object === 'sys_inbox_message') return Promise.resolve({ data: INBOX });
    if (object === 'sys_notification_receipt') {
      return Promise.resolve({
        data: INBOX.map((r, i) => ({
          id: `rcp_${i + 1}`,
          notification_id: r.notification_id,
          user_id: 'u1',
          channel: 'inbox',
          state: readIds.has(r.notification_id) ? 'read' : 'delivered',
        })),
      });
    }
    return Promise.resolve({ data: [] });
  },
  getClient: () => undefined,
};

vi.mock('../../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

/** The bodies of every mark-read request, in order. */
let markReadBodies: unknown[] = [];
/** Every URL the global `fetch` was handed that this double does not serve. */
let unserved: string[] = [];

const routeOf = (url: string) => new URL(url, 'http://localhost').pathname;

function installServerDouble() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = routeOf(url);
      if (method === 'POST' && path === '/api/v1/notifications/read') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { ids?: string[] };
        timeline.push(`POST ${path}`);
        markReadBodies.push(body);
        for (const id of body.ids ?? []) readIds.add(id);
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (method === 'GET' && path === '/api/v1/meta/_drafts') {
        return { ok: true, status: 200, json: async () => ({ drafts: [] }) };
      }
      if (method === 'GET' && path === '/api/v1/approvals/requests') {
        return { ok: true, status: 200, json: async () => ({ data: [], total: 0 }) };
      }
      unserved.push(`${method} ${url}`);
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
}

import { HomePage } from '../HomePage';
import { __resetSharedUserFeeds } from '../../../hooks/sharedUserFeeds';

beforeEach(() => {
  timeline = [];
  markReadBodies = [];
  unserved = [];
  readIds = new Set();
  navigateMock.mockClear();
  __resetSharedUserFeeds();
  installServerDouble();
});

afterEach(() => {
  // A router, not a sink: a request to anything this double does not serve
  // fails here instead of vanishing into a best-effort `catch`.
  expect(unserved).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
  __resetSharedUserFeeds();
});

const notificationsCard = () => screen.getByTestId('home-my-work-notifications');
const unreadPill = () => within(notificationsCard()).queryByTestId('home-my-work-notifications-count');

describe('Home "My work → Notifications": opening a notification marks it read', () => {
  it('sends the bell mark-read request for the opened row, before following its link', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByText('Task T-1 was assigned to you');

    await user.click(screen.getByText('Task T-1 was assigned to you'));

    // The request the bell sends: one POST, keyed by the notification EVENT
    // id (`notification_id`), not the inbox row id.
    expect(markReadBodies).toEqual([{ ids: ['ntf_1'] }]);
    // Spent first, then followed — the bell's order.
    expect(timeline).toEqual([
      'POST /api/v1/notifications/read',
      'navigate /apps/crm/showcase_task/t_1',
    ]);
  });

  it('drops the unread count once the feed re-reads the receipt the request wrote', async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByText('Task T-1 was assigned to you');
    expect(unreadPill()).toHaveTextContent('2');

    await user.click(screen.getByText('Task T-1 was assigned to you'));

    // Returning to the tab re-reads the shared feed at once — the same read
    // the bell's badge is cut from.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(unreadPill()).toHaveTextContent('1'));
    expect(screen.queryByText('Task T-1 was assigned to you')).not.toBeInTheDocument();
    expect(screen.getByText('You were mentioned in Task T-2')).toBeInTheDocument();
  });

  it('marks a linkless notification read too, then opens the inbox', async () => {
    const original = INBOX[0].action_url;
    (INBOX[0] as { action_url?: string }).action_url = undefined;
    try {
      const user = userEvent.setup();
      render(<HomePage />);
      await screen.findByText('Task T-1 was assigned to you');

      await user.click(screen.getByText('Task T-1 was assigned to you'));

      expect(markReadBodies).toEqual([{ ids: ['ntf_1'] }]);
      expect(timeline).toEqual([
        'POST /api/v1/notifications/read',
        'navigate /apps/crm/sys_inbox_message?view=mine',
      ]);
    } finally {
      INBOX[0].action_url = original;
    }
  });
});
