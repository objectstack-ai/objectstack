/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6757 — a page that declares `global:search` or `global:notifications`
 * renders a WORKING block, not the "Component Placeholder" scaffold.
 *
 * ## Why "not the placeholder" is not the assertion
 *
 * An empty render is also not the placeholder, and so is a red unknown-type
 * panel with the wrong text. Each case below therefore asserts CONTENT that
 * only the real renderer can produce, and content that had to travel through
 * the block's data path to get there:
 *
 *   - `global:search` — the search box exists AND a record hit returned by the
 *     adapter's `searchAll` (`GET /api/v1/search`, via `useRecordSearch`) is on
 *     screen, linking to that record's page.
 *   - `global:notifications` — the bell exists AND its badge carries the unread
 *     TOPIC count folded from `sys_inbox_message` joined with
 *     `sys_notification_receipt` (ADR-0030), which is the number the header
 *     bell shows for the same rows.
 *
 * The placeholder assertion is kept as a second, weaker line in each case,
 * because it is the literal symptom the card reported.
 *
 * ## Ablation (per member)
 *
 * Comment out the `ComponentRegistry.register(...)` call in the renderer under
 * test and the matching case goes red:
 *   - `global:search` falls back to the eager palette placeholder registered by
 *     `@object-ui/components` (`PALETTE_PLACEHOLDER_BLOCKS`), so the DOM carries
 *     "Component Placeholder" and no search box;
 *   - `global:notifications` has no placeholder at all (it is not in that eager
 *     set), so `SchemaRenderer` draws its red unknown-type panel.
 *
 * ## Harness notes
 *
 * Real `@object-ui/components`, real `SchemaRenderer`, real registry — the
 * ORDER this file's imports produce is the production order (app-shell depends
 * on components, so `placeholders.tsx` registers before these two overwrite
 * it), and asserting through `SchemaRenderer` is what makes this a page-render
 * test rather than a component unit test. Only `useAuth` is stubbed: the shared
 * inbox feed is keyed on the signed-in user, and there is no exported auth
 * context to provide.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    activeOrganization: null,
    isAuthenticated: true,
  }),
}));

// Module scope, never a `beforeAll`: the cold transform of these graphs is
// billed to the import phase, which has no test/hook timeout (AGENTS.md
// §测试纪律, objectui#3010).
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx, MetadataCtx } from '@object-ui/react';
import '../global-search-renderer';
import '../global-notifications-renderer';
import { __resetSharedUserFeeds } from '../../hooks/sharedUserFeeds';

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** One cross-object hit, in `MetadataProtocol.searchAll`'s wire shape. */
const SEARCH_RESPONSE = {
  hits: [
    {
      object: 'crm_account',
      id: 'a1',
      title: 'Wayne Enterprises',
      snippet: 'ACC-000005',
      record: { id: 'a1', name: 'Wayne Enterprises' },
    },
  ],
};

/** Two unread messages on two distinct topics ⇒ the bell folds them to "2". */
const INBOX_ROWS = [
  {
    id: 'ibx_1',
    user_id: 'u1',
    notification_id: 'ntf_1',
    topic: 'crm.lead.assigned',
    title: 'Lead assigned: Wayne Enterprises',
    action_url: '/apps/crm/crm_lead/record/l1',
    created_at: '2026-08-11T04:00:00Z',
  },
  {
    id: 'ibx_2',
    user_id: 'u1',
    notification_id: 'ntf_2',
    topic: 'approval.reminder',
    title: 'Approval reminder: INV-1008',
    action_url: '/apps/crm/sys_approval_request/record/a1',
    created_at: '2026-08-11T03:00:00Z',
  },
];

const RECEIPT_ROWS = INBOX_ROWS.map((r, i) => ({
  id: `rcp_${i + 1}`,
  notification_id: r.notification_id,
  user_id: 'u1',
  channel: 'inbox',
  state: 'delivered', // NOT read
}));

const searchCalls: Array<{ query: string; options: unknown }> = [];

const fakeAdapter = {
  searchAll: (query: string, options?: unknown) => {
    searchCalls.push({ query, options });
    return Promise.resolve(SEARCH_RESPONSE);
  },
  find: (object: string) => {
    if (object === 'sys_inbox_message') return Promise.resolve({ data: INBOX_ROWS });
    if (object === 'sys_notification_receipt') return Promise.resolve({ data: RECEIPT_ROWS });
    return Promise.resolve({ data: [] });
  },
  getClient: () => undefined,
};

/**
 * Stable module-level value: `MetadataCtx` consumers list the context value in
 * effect deps, and a fresh object per render re-runs them forever.
 */
const METADATA = {
  apps: [],
  objects: [{ name: 'crm_account', label: 'Account', icon: 'Building2' }],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

/** A page that DECLARES the member, rendered through the normal recursion. */
const page = (type: string) => ({
  type: 'page:section',
  id: 'section_1',
  children: [{ type, id: `blk_${type}` }],
});

function renderPage(type: string) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <AdapterCtx.Provider value={fakeAdapter as never}>
        <MetadataCtx.Provider value={METADATA as never}>
          <Routes>
            <Route path="/apps/:appName" element={<SchemaRenderer schema={page(type) as never} />} />
          </Routes>
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  searchCalls.length = 0;
  __resetSharedUserFeeds();
  // The approvals count is a REST read, not an adapter one. 404 is the
  // "plugin not installed" answer the feed degrades to 0 on and retires the
  // poll for, which keeps the badge equal to the unread topic fold alone.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSharedUserFeeds();
});

/* ── The two members ──────────────────────────────────────────────────────── */

describe('objectui#6757 — spec `PageComponentType` members that had no renderer', () => {
  it('registers both members under the `global:` namespace, not the bare names', () => {
    // A registration under the bare `search` / `notifications` key would shadow
    // far more generic tags; `skipFallback: true` is what prevents it.
    expect(ComponentRegistry.get('global:search')).toBeTruthy();
    expect(ComponentRegistry.get('global:notifications')).toBeTruthy();
    expect(ComponentRegistry.get('search')).toBeFalsy();
    expect(ComponentRegistry.get('notifications')).toBeFalsy();
  });

  it('publishes NO `inputs` for either — both spec shapes are empty', () => {
    // `ComponentPropsMap['global:search'|'global:notifications']` declare no
    // props at all. Declaring one here would advertise an authoring key the
    // contract rejects by name.
    expect(ComponentRegistry.getConfig('global:search')?.inputs ?? []).toEqual([]);
    expect(ComponentRegistry.getConfig('global:notifications')?.inputs ?? []).toEqual([]);
  });

  describe('global:search', () => {
    it('renders a working search box and puts a `searchAll` hit on the page', async () => {
      renderPage('global:search');

      // 1. Real content: the search control itself, with its accessible name.
      const box = screen.getByRole('searchbox', {
        name: 'Search objects, dashboards, pages, reports',
      });
      expect(box).toBeInTheDocument();

      // 2. Real content that had to travel the data path: type, and the hit the
      //    adapter's `searchAll` returned reaches the DOM as a record link.
      //    `useRecordSearch` debounces 250ms before it fires, hence the explicit
      //    window — this is a deliberate debounce, not a module-load race.
      fireEvent.change(box, { target: { value: 'wayne' } });
      const hit = await screen.findByText('Wayne Enterprises', {}, { timeout: 4000 });
      expect(hit).toBeInTheDocument();
      expect(screen.getByText('ACC-000005')).toBeInTheDocument();
      expect(hit.closest('a')).toHaveAttribute('href', '/apps/crm/crm_account/record/a1');

      // The block asked the platform's unified endpoint, not the per-object
      // fanout: `searchAll` is `GET /api/v1/search`.
      expect(searchCalls.map((c) => c.query)).toEqual(['wayne']);

      // 3. The literal symptom the card reported.
      expect(screen.queryByText('Component Placeholder')).toBeNull();
    });
  });

  describe('global:notifications', () => {
    it('renders the bell and badges the unread topics from the inbox feed', async () => {
      renderPage('global:notifications');

      // 1. Real content: the bell control, with its accessible name.
      const bell = await screen.findByRole('button', { name: 'Open inbox' });
      expect(bell).toBeInTheDocument();

      // 2. Real content that had to travel the data path: two unread rows on
      //    two topics, joined against their (unread) receipts, fold to "2".
      await waitFor(() => {
        expect(bell).toHaveTextContent('2');
      });

      // 3. The literal symptom the card reported, plus the OTHER failure shape:
      //    with no registration at all this block draws SchemaRenderer's red
      //    unknown-type panel rather than the placeholder.
      expect(screen.queryByText('Component Placeholder')).toBeNull();
      expect(screen.queryByText(/Unknown component type/i)).toBeNull();
    });

    it('opens the inbox and lists the rows the feed returned', async () => {
      renderPage('global:notifications');
      const bell = await screen.findByRole('button', { name: 'Open inbox' });
      await waitFor(() => expect(bell).toHaveTextContent('2'));

      fireEvent.click(bell);

      expect(
        await screen.findByText('Lead assigned: Wayne Enterprises'),
      ).toBeInTheDocument();
      expect(screen.getByText('Approval reminder: INV-1008')).toBeInTheDocument();
    });
  });
});
