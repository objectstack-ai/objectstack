// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sign-out keeps the list layout this browser holds for the signed-out person,
 * on every sign-out path, and a different person signing in clears it
 * (objectstack#36110, maintainer ruling on objectstack#35955 point 1). The keys
 * an earlier Console wrote list state under go at every sign-out.
 *
 * Both kept families are written here by their REAL writers and removed (or
 * not) by the real `AuthProvider` (`@object-ui/auth`):
 *
 *  - `list-layout:USER:OBJECT` by `useObjectListLayout` (objectstack#35955):
 *    tab order, column widths, row height;
 *  - `grid-columns-OBJECT[-VIEW]` by `ObjectGrid` (`@object-ui/plugin-grid`):
 *    its own browser copy of column widths and order.
 *
 * `@object-ui/auth` depends on neither package, so its purge spells both
 * prefixes out, and keeps an entry only while its value holds layout and
 * nothing more. Filling the keys by running their writers is what holds the
 * two ends together: a spelling that drifts on either side, or a writer that
 * starts storing a part the purge does not accept, fails the "kept" cases
 * below. The retired spellings (`list-state:USER:OBJECT`, `list-filters:…`)
 * have no writer left, so they are planted by hand.
 *
 * The sign-in page language stays: the two keys are imported from
 * `@object-ui/i18n` here, so a spelling that changes there fails this file
 * rather than silently dropping the language at every sign-out.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup, fireEvent, screen } from '@testing-library/react';
import {
  AuthProvider,
  TokenStorage,
  createAuthenticatedFetch,
  useAuth,
  type AuthClient,
  type AuthContextValue,
} from '@object-ui/auth';
import { ROW_HEIGHT_TO_DENSITY_MODE, type RowHeight } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { LOCALE_SEED_STORAGE_KEY, LOCALE_STORAGE_KEY } from '@object-ui/i18n';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ActionProvider } from '@object-ui/react';
import { listLayoutStorageKey, resetListLayoutStoreForTests, useObjectListLayout } from '../../views/listLayoutStore';
import { pinnedListViewScope } from '../../views/pinnedListView';
import { LIST_PINNED_VIEW_PREFERENCE, workspacePreferenceStorageKey } from '../../utils/workspacePreference';
import { scopedKey } from '../UserStateAdapters';

registerAllFields();

const ORG = { id: 'org_a', name: 'Acme', slug: 'acme' };
const ALICE = { id: 'u_alice', name: 'Alice', email: 'alice@test.com' };
const BOB = { id: 'u_bob', name: 'Bob', email: 'bob@test.com' };
const OBJECT = 'account';
const VIEW = 'account.all';
const OTHER_VIEW = 'account.mine';

/** The key this file's writer produces for Alice. */
const LAYOUT_KEY = listLayoutStorageKey(ALICE.id, OBJECT)!;

/** Who the server says holds the session: switched by each case. */
let sessionUser: typeof ALICE | null = ALICE;

/** The real client clears `TokenStorage` on sign-out; this double does too. */
function authClient(): AuthClient {
  return {
    getSession: vi.fn().mockImplementation(async () =>
      sessionUser ? { user: sessionUser, session: { token: `tok-${sessionUser.id}` } } : null,
    ),
    signOut: vi.fn().mockImplementation(async () => {
      TokenStorage.clear();
    }),
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    setActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockImplementation(async () => ({
      id: `mem_${sessionUser?.id}`, organizationId: ORG.id, userId: sessionUser?.id, role: 'member',
    })),
  } as unknown as AuthClient;
}

/** What one committed render showed: the session, and the layout it offered. */
interface Committed {
  auth: AuthContextValue;
  layout: ReturnType<typeof useObjectListLayout>;
}

/** The last committed render's view, written as one object so its two halves never come from two renders. */
const committed: { current: Committed | null } = { current: null };

function Probe() {
  const auth = useAuth();
  const layout = useObjectListLayout(OBJECT);
  useEffect(() => {
    committed.current = { auth, layout };
  });
  return <span data-testid="user">{auth.user?.name ?? 'none'}</span>;
}

function auth(): AuthContextValue {
  return committed.current!.auth;
}

/** Wait for a committed render that holds `who`'s session (or none), and return its layout handle. */
async function committedFor(who: typeof ALICE | null) {
  return waitFor(() => {
    const seen = committed.current;
    expect(seen?.auth.user?.id ?? null).toBe(who?.id ?? null);
    return seen!.layout;
  });
}

/** Sign in, and return the layout handle of a committed render that holds Alice's session. */
async function signIn(client: AuthClient) {
  sessionUser = ALICE;
  const view = render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <Probe />
    </AuthProvider>,
  );
  const layout = await committedFor(ALICE);
  expect(view.getByTestId('user').textContent).toBe('Alice');
  return { view, layout };
}

/** The layout Alice arranges through the real writer. */
const ARRANGED = {
  viewOrder: [OTHER_VIEW, VIEW],
  perView: { [VIEW]: { widths: { name: 240 }, rowHeight: 'compact' } },
};

/** Sign in, arrange the list through the real writer, and plant the keys an earlier Console left. */
async function signInAndArrange(client: AuthClient) {
  const signedIn = await signIn(client);
  act(() => signedIn.layout.patchView(VIEW, { widths: { name: 240 }, rowHeight: 'compact' }));
  act(() => committed.current!.layout.setViewOrder([OTHER_VIEW, VIEW]));
  expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!)).toEqual(ARRANGED);
  localStorage.setItem(`list-state:${ALICE.id}:${OBJECT}`, JSON.stringify({ viewOrder: [VIEW] }));
  localStorage.setItem(`list-filters:${ALICE.id}:${OBJECT}:${VIEW}`, JSON.stringify({ search: 'term' }));
  return signedIn;
}

function listKeysLeft(): string[] {
  return Object.keys(localStorage)
    .filter((k) => /^(list-layout|list-state|list-filters):/.test(k))
    .sort();
}

/** The same browser, now a sign-in as `who`: the server answers their session and the provider re-reads it. */
async function signInAgainAs(who: typeof ALICE) {
  sessionUser = who;
  await act(async () => {
    await auth().refreshSession();
  });
  return committedFor(who);
}

beforeEach(() => {
  committed.current = null;
  sessionUser = ALICE;
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  resetListLayoutStoreForTests();
  // `SessionUserScope` keeps this page-load's owner in memory, and this file is
  // one page-load: after the first case it already holds Alice, so a re-adopt
  // of Alice writes nothing. A real browser holding Alice also holds her
  // persisted pointer (`@object-ui/auth`'s `auth-session-user-id`), which is
  // what a change of user is decided from; keep it in step after the clear.
  localStorage.setItem('auth-session-user-id', ALICE.id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sign-out keeps the list layout for the same person (objectstack#36110)', () => {
  it('signOut() keeps the list-layout key as written, removes the retired list-state and list-filters keys, and keeps the sign-in page language', async () => {
    const client = authClient();
    await signInAndArrange(client);
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'de');
    const written = localStorage.getItem(LAYOUT_KEY);

    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);

    expect(listKeysLeft()).toEqual([LAYOUT_KEY]);
    expect(localStorage.getItem(LAYOUT_KEY)).toBe(written);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
    expect(localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('de');
  });

  it('the same person signing back in on this browser gets the layout back', async () => {
    const client = authClient();
    await signInAndArrange(client);
    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);

    const layout = await signInAgainAs(ALICE);

    expect(layout.layout).toEqual(ARRANGED);
  });

  it('a session read that answers no session (a session that ended on its own) keeps it too', async () => {
    const client = authClient();
    const { view } = await signInAndArrange(client);

    sessionUser = null;
    await act(async () => {
      await auth().refreshSession();
    });

    expect(view.getByTestId('user').textContent).toBe('none');
    expect(listKeysLeft()).toEqual([LAYOUT_KEY]);
  });

  it('a 401 whose session re-check answers no session keeps it too', async () => {
    const client = authClient();
    await signInAndArrange(client);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    sessionUser = null;
    await act(async () => {
      await createAuthenticatedFetch()('/api/v1/data/account');
    });

    await committedFor(null);
    expect(listKeysLeft()).toEqual([LAYOUT_KEY]);
  });

  it('keeps every row height the list offers, written through the real writer', async () => {
    const client = authClient();
    const { layout } = await signIn(client);
    const rowHeights = Object.keys(ROW_HEIGHT_TO_DENSITY_MODE) as RowHeight[];
    rowHeights.forEach((rowHeight, i) => {
      act(() => committed.current!.layout.patchView(`view_${i}`, { rowHeight }));
    });
    expect(layout).toBeDefined();
    const written = localStorage.getItem(LAYOUT_KEY);
    expect(Object.keys(JSON.parse(written!).perView)).toHaveLength(rowHeights.length);

    await act(async () => {
      await auth().signOut();
    });

    expect(localStorage.getItem(LAYOUT_KEY)).toBe(written);
  });

  it('a different person signing in on this browser clears it: their list opens at the view\u2019s own layout', async () => {
    const client = authClient();
    await signInAndArrange(client);
    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);
    expect(listKeysLeft()).toEqual([LAYOUT_KEY]);

    const layout = await signInAgainAs(BOB);

    await waitFor(() => expect(listKeysLeft()).toEqual([]));
    expect(layout.layout).toEqual({});
  });

  it('with nobody signed in, a layout change writes nothing back', async () => {
    const client = authClient();
    await signInAndArrange(client);
    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);
    const kept = localStorage.getItem(LAYOUT_KEY);

    act(() => committed.current!.layout.patchView(VIEW, { widths: { name: 300 } }));
    act(() => committed.current!.layout.setViewOrder([VIEW]));

    expect(listKeysLeft()).toEqual([LAYOUT_KEY]);
    expect(localStorage.getItem(LAYOUT_KEY)).toBe(kept);
  });
});

describe("sign-out keeps the grid's own column widths and order for the same person (objectstack#36110)", () => {
  const GRID_KEY = `grid-columns-${OBJECT}-related-contacts`;

  function renderGrid() {
    const schema: any = {
      type: 'object-grid',
      id: 'related-contacts',
      objectName: OBJECT,
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
      reorderableColumns: true,
      data: { provider: 'value', items: [{ id: '1', name: 'Acme', amount: 100 }] },
    };
    return render(
      <ActionProvider>
        <ObjectGrid schema={schema} />
      </ActionProvider>,
    );
  }

  /** Drag a width and reorder the columns through the grid's real writer. */
  async function arrangeGrid() {
    // The grid's record-level explain probe falls back to the global fetch; an
    // empty answer fails open, and no request leaves for the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const grid = renderGrid();
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
    const nameTh = screen.getByText('Name').closest('th') as HTMLElement;
    const handle = nameTh.querySelector('.cursor-col-resize') as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 260 });
    fireEvent.mouseUp(document);
    const amountTh = screen.getByText('Amount').closest('th') as HTMLElement;
    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByText('Name').closest('th') as HTMLElement, { dataTransfer });
    fireEvent.dragOver(amountTh, { dataTransfer });
    fireEvent.drop(amountTh, { dataTransfer });
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(GRID_KEY) ?? '{}');
      expect(stored.order).toEqual(['amount', 'name']);
      expect(stored.widths?.name).toBeGreaterThan(0);
    });
    grid.unmount();
    vi.unstubAllGlobals();
    return localStorage.getItem(GRID_KEY);
  }

  it('signOut() keeps the entry the grid wrote, as written', async () => {
    const client = authClient();
    await signIn(client);
    const written = await arrangeGrid();

    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);

    expect(localStorage.getItem(GRID_KEY)).toBe(written);
  });

  it('a different person signing in on this browser clears it', async () => {
    const client = authClient();
    await signIn(client);
    await arrangeGrid();
    await act(async () => {
      await auth().signOut();
    });
    await committedFor(null);
    expect(localStorage.getItem(GRID_KEY)).not.toBeNull();

    await signInAgainAs(BOB);

    await waitFor(() => expect(localStorage.getItem(GRID_KEY)).toBeNull());
  });
});

describe('sign-out clears the per-organization browser copies too (objectstack#36244)', () => {
  it("signOut() removes the organization's copies of favorites, recents, last app, palette recents and the pinned view", async () => {
    const client = authClient();
    await signIn(client);
    // Spelled by the key builders the providers write through, so a spelling
    // that moves there moves here.
    const keys = [
      scopedKey('objectui-favorites', ALICE.id, ORG.id),
      scopedKey('objectui-recent-items', ALICE.id, ORG.id),
      scopedKey('ui.app.last', ALICE.id, ORG.id),
      scopedKey('flow-palette-recents', ALICE.id, ORG.id),
      workspacePreferenceStorageKey(LIST_PINNED_VIEW_PREFERENCE, pinnedListViewScope(OBJECT, ORG.id)),
    ];
    for (const key of keys) localStorage.setItem(key, '[]');

    await act(async () => {
      await auth().signOut();
    });

    expect(keys.filter((key) => localStorage.getItem(key) !== null)).toEqual([]);
  });
});
