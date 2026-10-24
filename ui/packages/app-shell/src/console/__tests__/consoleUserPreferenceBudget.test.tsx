/**
 * objectui#12187 — one `sys_user_preference` read per console load.
 *
 * ## The budget, and why it changed
 *
 * `ConnectedShell`'s `UserStateBridge` attaches three user-state adapters, one
 * per slot (`ui.favorites`, `ui.recent`, `ui.flow.palette.recents`), and each
 * slot is its own `(user, key)` row. objectui#5544 and objectui#11797 counted
 * that as three reads per load, one per key, and this file used to pin three.
 * objectui#12187 rules the budget at ONE: the adapters share one read of the
 * user's rows for the load, and each takes its own key from it.
 *
 * The hazard objectui#5544 named still stands: a dedup that serves one key's
 * answer to all three consumers makes the count look right and starves two of
 * them. So the count is pinned together with the payloads: every consumer
 * must still receive its own row.
 *
 * objectui#12418 adds a fourth consumer to the same read: every object's list
 * state, one row per object (`ui.list.<object>`), a key FAMILY the console
 * cannot name at load time. It rides the read as a key prefix, so the budget
 * stays ONE read, and the read asks for the three keys and the `ui.list.`
 * prefix.
 *
 * ## The tree
 *
 * The real `ConsoleShell` providers and the real `ConnectedShell`: its
 * `AdapterProvider` builds the real `ObjectStackAdapter` and client, and its
 * `UserStateBridge` builds the three adapters and the list-state family. The
 * network is the fake framework of `preferenceFramework.ts` on the global
 * `fetch`, which answers preference reads the way the server does, by
 * `user_id` and by `key` (`=`, `in`, `startswith`), and refuses any other
 * filter operator loudly. Only the session is stood in.
 *
 * ## The pins
 *
 *   1. One boot puts ONE `sys_user_preference` GET on the wire, and it asks
 *      for the three keys and the list-state prefix.
 *   2. Every consumer receives its own row from that one answer, the list
 *      state of an object included.
 *   3. Each adapter still writes its own row, and only its own; the list state
 *      writes its object's row.
 *   4. Signing in as another user reads again, for that user, and every
 *      consumer ends on that user's rows.
 *   5. Two loads of one key at once are still one request.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { session } = vi.hoisted(() => ({
  /** The signed-in user the mocked `useAuth` reports; switched per test. */
  session: { userId: 'u1' },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
    dismiss: vi.fn(), custom: vi.fn(), loading: vi.fn(), promise: vi.fn(),
  }),
  Toaster: () => null,
}));
// The ADR-0069 remediation gate needs an AuthProvider above it; not under test.
vi.mock('../RemediationOverlay', () => ({ RemediationOverlay: () => null }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    user: { id: session.userId, email: `${session.userId}@example.com` },
    session: null,
    isAuthEnabled: true,
    error: null,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: async () => ({}),
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

import { ObjectStackAdapter, createObjectStackUserStateAdapter } from '@object-ui/data-objectstack';
import { ConsoleShell, ConnectedShell } from '../ConsoleShell';
import { useFavorites } from '../../context/FavoritesProvider';
import { useRecentItems } from '../../context/RecentItemsProvider';
import { useFlowPaletteRecents } from '../../context/FlowPaletteRecentsProvider';
import { useObjectListPreferences, type ObjectListPreference } from '../../context/ListPreferencesProvider';
import { createPreferenceFramework, preferenceRowId as rowId, type PreferenceFramework } from './preferenceFramework';

const FAVORITES_KEY = 'ui.favorites';
const RECENT_KEY = 'ui.recent';
const FLOW_KEY = 'ui.flow.palette.recents';
const BRIDGE_KEYS = [FAVORITES_KEY, RECENT_KEY, FLOW_KEY];
/** objectui#12418 — the list-state family, and one object's row of it. */
const LIST_PREFIX = 'ui.list.';
const LIST_KEY = 'ui.list.account';

/** Each user's stored rows, one distinct payload per key, so a starved consumer shows up. */
const STORE: Record<string, Record<string, unknown>> = {
  u1: {
    [FAVORITES_KEY]: [{ id: 'object:contact', label: 'Contact', href: '/contact', type: 'object' }],
    [RECENT_KEY]: [{ id: 'object:lead', type: 'object', name: 'lead', href: '/lead', visitedAt: '2026-10-01T00:00:00.000Z' }],
    [FLOW_KEY]: ['flow_step_alpha'],
    [LIST_KEY]: { viewOrder: ['account.mine', 'account.all'] },
  },
  u2: {
    [FAVORITES_KEY]: [{ id: 'object:invoice', label: 'Invoice', href: '/invoice', type: 'object' }],
    [RECENT_KEY]: [{ id: 'object:quote', type: 'object', name: 'quote', href: '/quote', visitedAt: '2026-10-02T00:00:00.000Z' }],
    [FLOW_KEY]: ['flow_step_omega'],
    [LIST_KEY]: { viewOrder: ['account.all', 'account.closed'] },
  },
};

/** The fake framework of this file's tests; rebuilt per test so its wire starts empty. */
let fake: PreferenceFramework = createPreferenceFramework(STORE);
/** Every preference request the console made, read off the wire. */
const wire = () => fake.wire;
const framework: PreferenceFramework['fetch'] = (input, init) => fake.fetch(input, init);

interface Seen {
  favorites: string[];
  recent: string[];
  flow: string[];
  /** The `account` list state's tab order (objectui#12418). */
  listOrder: string[];
}

/**
 * Module-scope holders, written from an effect and never from the render phase
 * — the same shape `MetadataProvider.requestBudget.test.tsx` uses. Not props,
 * because writing through a prop is what the react-compiler rule refuses.
 */
const EMPTY_SEEN: Seen = { favorites: [], recent: [], flow: [], listOrder: [] };
const latest: { current: Seen } = { current: EMPTY_SEEN };
const actions: {
  current: {
    addFavorite?: ReturnType<typeof useFavorites>['addFavorite'];
    addRecentItem?: ReturnType<typeof useRecentItems>['addRecentItem'];
    recordRecent?: ReturnType<typeof useFlowPaletteRecents>['recordRecent'];
    patchListView?: ReturnType<typeof useObjectListPreferences>['patchView'];
  };
} = { current: {} };

function Consumers() {
  const { favorites, addFavorite } = useFavorites();
  const { recentItems, addRecentItem } = useRecentItems();
  const { recents, recordRecent } = useFlowPaletteRecents();
  const list = useObjectListPreferences('account');
  const listPreference: ObjectListPreference = list.preference;
  const listOrderKey = JSON.stringify(listPreference.viewOrder ?? []);
  const patchListView = list.patchView;
  useEffect(() => {
    latest.current = {
      favorites: favorites.map((f) => f.id),
      recent: recentItems.map((r) => r.id),
      flow: [...recents],
      listOrder: JSON.parse(listOrderKey),
    };
    actions.current = { addFavorite, addRecentItem, recordRecent, patchListView };
  }, [favorites, recentItems, recents, listOrderKey, addFavorite, addRecentItem, recordRecent, patchListView]);
  return <main data-testid="content">content</main>;
}

function Console({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/apps/demo/page/welcome']}>
      <ConsoleShell>
        <ConnectedShell>{children}</ConnectedShell>
      </ConsoleShell>
    </MemoryRouter>
  );
}

function boot() {
  return render(<Console><Consumers /></Console>);
}

/** Let every pending effect, microtask and timer drain, so a LATE extra read is still counted. */
async function settle(ms = 150) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const U1_SEEN: Seen = {
  favorites: ['object:contact'], recent: ['object:lead'], flow: ['flow_step_alpha'],
  listOrder: ['account.mine', 'account.all'],
};
const U2_SEEN: Seen = {
  favorites: ['object:invoice'], recent: ['object:quote'], flow: ['flow_step_omega'],
  listOrder: ['account.all', 'account.closed'],
};

describe('console sys_user_preference request budget (objectui#12187)', () => {
  beforeEach(() => {
    session.userId = 'u1';
    fake = createPreferenceFramework(STORE);
    latest.current = EMPTY_SEEN;
    actions.current = {};
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(framework));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('one boot puts one sys_user_preference read on the wire, asking for the three keys and the list-state prefix', async () => {
    boot();
    await waitFor(() => expect(wire().gets.length).toBeGreaterThan(0));
    await settle();

    expect(wire().gets).toHaveLength(1);
    expect(wire().gets[0].user).toBe('u1');
    expect([...wire().gets[0].keys].sort()).toEqual([...BRIDGE_KEYS].sort());
    // objectui#12418 — every object's list state rides the same read.
    expect(wire().gets[0].prefixes).toEqual([LIST_PREFIX]);
  });

  it('every consumer receives its own row from that one answer', async () => {
    boot();
    // Three distinct payloads, three distinct consumers: an answer handed to
    // the wrong adapter, or to only one of them, fails here.
    await waitFor(() => expect(latest.current).toEqual(U1_SEEN));
    expect(wire().gets).toHaveLength(1);
  });

  it('each adapter still writes its own row, and only its own', async () => {
    boot();
    await waitFor(() => expect(latest.current).toEqual(U1_SEEN));
    await settle();
    expect(wire().writes).toEqual([]);

    act(() => {
      actions.current.addFavorite?.({ id: 'object:account', label: 'Account', href: '/account', type: 'object' });
      actions.current.addRecentItem?.({ id: 'object:deal', type: 'object', name: 'deal', href: '/deal' });
      actions.current.recordRecent?.('flow_step_beta');
      actions.current.patchListView?.('account.all', { sort: [{ field: 'name', order: 'desc' }] });
    });

    // Each provider debounces its write (500 ms); all four land, once each.
    await waitFor(() => expect(wire().writes).toHaveLength(4), { timeout: 3000 });
    await settle();
    expect(wire().writes).toHaveLength(4);

    const byId = new Map(wire().writes.map((w) => [w.id, w]));
    // An update of the row its own load found — no insert, no other row.
    expect(wire().writes.every((w) => w.method === 'PATCH' || w.method === 'PUT')).toBe(true);
    expect([...byId.keys()].sort()).toEqual([...BRIDGE_KEYS, LIST_KEY].map((k) => rowId('u1', k)).sort());
    expect((byId.get(rowId('u1', FAVORITES_KEY))?.value as { id: string }[]).map((f) => f.id)).toContain(
      'object:account',
    );
    expect((byId.get(rowId('u1', RECENT_KEY))?.value as { id: string }[])[0].id).toBe('object:deal');
    expect(byId.get(rowId('u1', FLOW_KEY))?.value).toEqual(['flow_step_beta', 'flow_step_alpha']);
    // The object's row carries what it held and the new sort.
    expect(byId.get(rowId('u1', LIST_KEY))?.value).toEqual({
      viewOrder: ['account.mine', 'account.all'],
      perView: { 'account.all': { sort: [{ field: 'name', order: 'desc' }] } },
    });
    // A write found its row from the load: it asked the server nothing more.
    expect(wire().gets).toHaveLength(1);
  });

  it('signing in as another user reads again, for that user, and ends on that user\'s rows', async () => {
    const { rerender } = boot();
    await waitFor(() => expect(latest.current).toEqual(U1_SEEN));
    await settle();
    const before = wire().gets.length;

    session.userId = 'u2';
    rerender(<Console><Consumers /></Console>);

    await waitFor(() => expect(latest.current).toEqual(U2_SEEN));
    await settle();

    const afterSwitch = wire().gets.slice(before);
    const forU2 = afterSwitch.filter((g) => g.user === 'u2');
    // One read for the new user, asking for all three keys and the prefix.
    expect(forU2).toHaveLength(1);
    expect([...forU2[0].keys].sort()).toEqual([...BRIDGE_KEYS].sort());
    expect(forU2[0].prefixes).toEqual([LIST_PREFIX]);
    // No u2 read was answered with u1's rows: every consumer shows u2's.
    expect(latest.current).toEqual(U2_SEEN);
  });

  it('two loads of one key at once are still one request', async () => {
    const ds = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: framework as typeof fetch, autoReconnect: false });
    await ds.connect();
    const a = createObjectStackUserStateAdapter({ dataSource: ds, userId: 'u1', key: FAVORITES_KEY });
    const b = createObjectStackUserStateAdapter({ dataSource: ds, userId: 'u1', key: FAVORITES_KEY });

    const [first, second] = await Promise.all([a.load(), b.load()]);

    expect(wire().gets).toHaveLength(1);
    expect(wire().gets[0].keys).toEqual([FAVORITES_KEY]);
    expect(first).toEqual(STORE.u1[FAVORITES_KEY]);
    expect(second).toEqual(STORE.u1[FAVORITES_KEY]);
  });
});
