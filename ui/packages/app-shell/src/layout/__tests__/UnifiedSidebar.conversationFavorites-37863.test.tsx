// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37863 — favourite conversations in the sidebar's Favorites
 * section.
 *
 * - A conversation favourite is a row of the section, drawn with its stored
 *   label. A click opens the drawer in place on that conversation (the
 *   target a history row opens, ui ADR-0057 Amendment A5 row 5): the page's
 *   address does not change.
 * - Its address (`/ai/AGENT/ID`) is followed only where no drawer takes it:
 *   no drawer host, the app's AI inquiry page (A4), or a click with a
 *   modifier.
 * - The sidebar reads each conversation favourite once: a title the server
 *   gave it since replaces the stored label; a conversation the server
 *   answers is gone (404) or not this user's (403) is drawn unavailable,
 *   opens nothing and is still removed from its ⋯ menu. Any other failed
 *   read marks nothing.
 * - Conversation favourites count against the content cap of 20.
 *
 * Harness: the provider and chrome stand-ins of
 * `UnifiedSidebar.favoritesMenu-12427.test.tsx` (the real `FavoritesProvider`,
 * `NavigationRenderer` and `SidebarItemMenu`), a stand-in drawer handle, and a
 * stubbed `fetch` that answers the conversation reads.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => false }),
}));

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  useHasExpressionScope: () => true,
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

// An icon is drawn as its name, so a row's icon can be read.
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => (props: { className?: string }) => <i data-icon={name ?? ''} className={props.className} />,
}));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { ChatDockControlProvider, type ChatDockControl } from '../chatDockControl';
import { conversationFavoriteItem } from '../conversationFavorites';
import { FavoritesProvider, useFavorites, type FavoriteItem } from '../../context/FavoritesProvider';

const NAVIGATION: NavigationItem[] = [
  { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' } as NavigationItem,
];

const conversationFavorite = (conversationId: string, label: string, agent = 'ask'): FavoriteItem => ({
  ...conversationFavoriteItem({ conversationId, agent, label }),
  favoritedAt: '2026-11-27T00:00:00.000Z',
});
const ACME = conversationFavorite('c-acme', 'Analyse Acme');

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const seed = (favorites: FavoriteItem[]) => localStorage.setItem(STORE_KEY, JSON.stringify(favorites));
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

/** What the server answers for a conversation read, by id: a status and, for 200, the row. */
let conversations: Record<string, { status: number; row?: Record<string, unknown> }>;
const conversationReads: string[] = [];

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderSidebar(dock: ChatDockControl | null) {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION }],
    objects: [],
  };
  const sidebar = (
    <FavoritesProvider>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </FavoritesProvider>
  );
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      {dock ? <ChatDockControlProvider value={dock}>{sidebar}</ChatDockControlProvider> : sidebar}
      <Where />
    </MemoryRouter>,
  );
}

const makeDock = (overrides: Partial<ChatDockControl> = {}): ChatDockControl & { open: ReturnType<typeof vi.fn> } => ({
  expanded: false,
  fullWindow: false,
  toggle: vi.fn(),
  open: vi.fn(),
  ...overrides,
}) as ChatDockControl & { open: ReturnType<typeof vi.fn> };

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const favoritesSection = () =>
  screen.getAllByText('Favorites')[0].closest('[data-sidebar="group"]') as HTMLElement;
const row = (name: RegExp | string) => within(favoritesSection()).getByRole('link', { name });
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  localStorage.clear();
  conversationReads.length = 0;
  conversations = { 'c-acme': { status: 200, row: { id: 'c-acme', title: 'Analyse Acme', agentId: 'ask' } } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const match = /\/api\/v1\/ai\/conversations\/([^/?#]+)$/.exec(String(url));
      if (match) {
        const id = decodeURIComponent(match[1]);
        conversationReads.push(id);
        const answer = conversations[id] ?? { status: 404 };
        if (answer.status === 0) throw new TypeError('Failed to fetch');
        return {
          headers: new Headers(),
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => ({ conversation: answer.row }),
        };
      }
      return { headers: new Headers(), ok: true, status: 200, json: async () => ({ data: [] }) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a favourite conversation opens the drawer in place (objectstack#37863)', () => {
  it('is a row of the Favorites section, with its stored label and the conversation glyph', async () => {
    seed([ACME]);
    renderSidebar(makeDock());
    await tick();
    const link = row('Analyse Acme');
    expect(link).toHaveAttribute('href', '/ai/ask/c-acme');
    expect(link.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'message-circle');
  });

  it('a click opens the drawer on that conversation, and the page stays where it is', async () => {
    seed([ACME]);
    const dock = makeDock();
    renderSidebar(dock);
    await tick();
    fireEvent.click(row('Analyse Acme'));
    expect(dock.open).toHaveBeenCalledTimes(1);
    expect(dock.open).toHaveBeenCalledWith({ agent: 'ask', conversationId: 'c-acme' });
    expect(where()).toBe('/apps/crm');
  });

  it('the agent stored is a route name, so a backend name opens the same target', async () => {
    seed([conversationFavorite('c-ask', 'Backend-named', 'data_chat')]);
    conversations['c-ask'] = { status: 200, row: { id: 'c-ask', title: 'Backend-named' } };
    const dock = makeDock();
    renderSidebar(dock);
    await tick();
    fireEvent.click(row('Backend-named'));
    expect(dock.open).toHaveBeenCalledWith({ agent: 'ask', conversationId: 'c-ask' });
  });

  it('a click with a modifier is left to the link: the drawer does not open', async () => {
    seed([ACME]);
    const dock = makeDock();
    renderSidebar(dock);
    await tick();
    fireEvent.click(row('Analyse Acme'), { ctrlKey: true });
    fireEvent.click(row('Analyse Acme'), { metaKey: true });
    expect(dock.open).not.toHaveBeenCalled();
  });

  it('with no drawer host, the row follows the conversation address', async () => {
    seed([ACME]);
    renderSidebar(null);
    await tick();
    fireEvent.click(row('Analyse Acme'));
    expect(where()).toBe('/ai/ask/c-acme');
  });

  it("on the app's AI inquiry page (A4), the row follows the address instead of opening the drawer", async () => {
    seed([ACME]);
    const dock = makeDock({ askPageActive: true });
    renderSidebar(dock);
    await tick();
    fireEvent.click(row('Analyse Acme'));
    expect(dock.open).not.toHaveBeenCalled();
    expect(where()).toBe('/ai/ask/c-acme');
  });

  it('other favourites keep their plain link', async () => {
    seed([
      ACME,
      { id: 'record:account:1', label: 'Acme Corp', href: '/apps/crm/account/record/1', type: 'record', favoritedAt: '2026-11-26T00:00:00.000Z' },
    ]);
    const dock = makeDock();
    renderSidebar(dock);
    await tick();
    fireEvent.click(row('Acme Corp'));
    expect(dock.open).not.toHaveBeenCalled();
    expect(where()).toBe('/apps/crm/account/record/1');
  });
});

describe('a favourite conversation follows the conversation (objectstack#37863)', () => {
  it('a title the server gave the conversation since replaces the stored label, once', async () => {
    seed([conversationFavorite('c-acme', 'analyse this company')]);
    renderSidebar(makeDock());
    await waitFor(() => expect(row('Analyse Acme')).toBeInTheDocument());
    expect(stored().find((f) => f.id === 'conversation:c-acme')?.label).toBe('Analyse Acme');
    await tick();
    expect(conversationReads).toEqual(['c-acme']);
  });

  it('with no title, the label is the latest message the user wrote, as its history row reads', async () => {
    seed([conversationFavorite('c-acme', 'old')]);
    conversations['c-acme'] = {
      status: 200,
      row: { id: 'c-acme', title: 'New conversation', messages: [{ role: 'user', content: 'who owns Acme?' }] },
    };
    renderSidebar(makeDock());
    await waitFor(() => expect(row('who owns Acme?')).toBeInTheDocument());
  });

  it.each([
    [404, 'gone'],
    [403, 'not this user\'s'],
  ])('a conversation the server answers %s (%s) is drawn unavailable and opens nothing', async (status) => {
    seed([ACME]);
    conversations['c-acme'] = { status };
    const dock = makeDock();
    renderSidebar(dock);
    await waitFor(() => expect(row(/Analyse Acme/)).toHaveAttribute('data-unavailable', 'true'));
    const link = row(/Analyse Acme/);
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAccessibleName('Analyse Acme (This conversation is no longer available)');
    fireEvent.click(link);
    expect(dock.open).not.toHaveBeenCalled();
    expect(where()).toBe('/apps/crm');
    // The stored entry is untouched: the mark is this mount's reading.
    expect(stored().map((f) => f.id)).toEqual(['conversation:c-acme']);
  });

  it('an unavailable conversation is removed from its ⋯ menu', async () => {
    seed([ACME]);
    conversations['c-acme'] = { status: 404 };
    renderSidebar(makeDock());
    await waitFor(() => expect(row(/Analyse Acme/)).toHaveAttribute('data-unavailable', 'true'));
    fireEvent.keyDown(within(favoritesSection()).getByRole('button', { name: 'More actions for Analyse Acme' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from favorites' }));
    await waitFor(() => expect(stored()).toEqual([]));
  });

  it.each([
    [500, 'a server error'],
    [0, 'a network failure'],
  ])('a read that fails with %s (%s) marks nothing and keeps the label', async (status) => {
    seed([ACME]);
    conversations['c-acme'] = { status };
    const dock = makeDock();
    renderSidebar(dock);
    await waitFor(() => expect(conversationReads).toEqual(['c-acme']));
    await tick();
    const link = row('Analyse Acme');
    expect(link).not.toHaveAttribute('data-unavailable');
    fireEvent.click(link);
    expect(dock.open).toHaveBeenCalledWith({ agent: 'ask', conversationId: 'c-acme' });
  });
});

describe('conversation favourites count against the content cap (objectstack#37863)', () => {
  function Probe({ onReady }: { onReady: (api: ReturnType<typeof useFavorites>) => void }) {
    const api = useFavorites();
    onReady(api);
    return null;
  }

  it('the 21st content favourite rolls the oldest off, a conversation among them', async () => {
    const records: FavoriteItem[] = Array.from({ length: 19 }, (_, i) => ({
      id: `record:account:${i}`,
      label: `Account ${i}`,
      href: `/apps/crm/account/record/${i}`,
      type: 'record',
      favoritedAt: `2026-11-${String(26 - Math.floor(i / 10)).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    seed([...records, ACME]);
    let api: ReturnType<typeof useFavorites> | undefined;
    render(
      <FavoritesProvider>
        <Probe onReady={(next) => { api = next; }} />
      </FavoritesProvider>,
    );
    expect(api!.favorites).toHaveLength(20);
    act(() => {
      api!.addFavorite({ ...conversationFavoriteItem({ conversationId: 'c-new', agent: 'ask', label: 'New one' }) });
    });
    expect(api!.favorites).toHaveLength(20);
    expect(api!.favorites[0].id).toBe('conversation:c-new');
    expect(api!.favorites.some((f) => f.id === 'conversation:c-acme')).toBe(false);
  });
});
