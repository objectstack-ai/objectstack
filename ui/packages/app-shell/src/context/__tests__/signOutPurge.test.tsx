// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sign-out clears the list layout this browser keeps for the signed-out user,
 * on every sign-out path, and the keys an earlier Console wrote list state
 * under with it.
 *
 * The layout key is written here by its real writer — `useObjectListLayout`
 * (`list-layout:USER:OBJECT`, objectstack#35955) — and removed by signing out
 * through the real `AuthProvider` (`@object-ui/auth`). `@object-ui/app-shell`
 * depends on `@object-ui/auth`, so the sweep cannot import this spelling;
 * filling the key by running its writer is what keeps the two ends from
 * drifting. The retired spellings (`list-state:USER:OBJECT`, the cache of the
 * retired server row `ui.list.<object>`, and `list-filters:USER:OBJECT:VIEW`)
 * have no writer left, so they are planted by hand.
 *
 * The sign-in page language stays: the two keys are imported from
 * `@object-ui/i18n` here, so a spelling that changes there fails this file
 * rather than silently dropping the language at every sign-out.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import {
  AuthProvider,
  TokenStorage,
  useAuth,
  type AuthClient,
  type AuthContextValue,
} from '@object-ui/auth';
import { LOCALE_SEED_STORAGE_KEY, LOCALE_STORAGE_KEY } from '@object-ui/i18n';
import { listLayoutStorageKey, resetListLayoutStoreForTests, useObjectListLayout } from '../../views/listLayoutStore';

const ORG = { id: 'org_a', name: 'Acme', slug: 'acme' };
const ALICE = { id: 'u_alice', name: 'Alice', email: 'alice@test.com' };
const OBJECT = 'account';
const VIEW = 'account.all';

/** The key this file's writer produces for Alice. */
const LAYOUT_KEY = listLayoutStorageKey(ALICE.id, OBJECT)!;

/** The real client clears `TokenStorage` on sign-out; this double does too. */
function authClient(getSession: () => Promise<unknown>): AuthClient {
  return {
    getSession: vi.fn().mockImplementation(getSession),
    signOut: vi.fn().mockImplementation(async () => {
      TokenStorage.clear();
    }),
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    setActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue({
      id: 'mem_alice', organizationId: ORG.id, userId: ALICE.id, role: 'member',
    }),
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

/** Sign in, and return the layout handle of a committed render that holds Alice's session. */
async function signIn(client: AuthClient) {
  const view = render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <Probe />
    </AuthProvider>,
  );
  const layout = await waitFor(() => {
    const seen = committed.current;
    expect(seen?.auth.user?.id).toBe(ALICE.id);
    return seen!.layout;
  });
  expect(view.getByTestId('user').textContent).toBe('Alice');
  return { view, layout };
}

/** Sign in, drag a width through the real writer, and plant the keys an earlier Console left. */
async function signInAndArrange(client: AuthClient) {
  const signedIn = await signIn(client);
  act(() => signedIn.layout.patchView(VIEW, { widths: { name: 240 } }));
  expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!)).toEqual({ perView: { [VIEW]: { widths: { name: 240 } } } });
  localStorage.setItem(`list-state:${ALICE.id}:${OBJECT}`, JSON.stringify({ viewOrder: [VIEW] }));
  localStorage.setItem(`list-filters:${ALICE.id}:${OBJECT}:${VIEW}`, JSON.stringify({ search: 'term' }));
  return signedIn;
}

function listKeysLeft(): string[] {
  return Object.keys(localStorage).filter((k) => /^(list-layout|list-state|list-filters):/.test(k));
}

beforeEach(() => {
  committed.current = null;
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  resetListLayoutStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sign-out clears the list layout this browser keeps for the signed-out user (objectstack#35955)', () => {
  it('signOut() removes every list-layout key, and the retired list-state and list-filters keys, and keeps the sign-in page language', async () => {
    const client = authClient(async () => ({ user: ALICE, session: { token: 'tok-alice' } }));
    await signInAndArrange(client);
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'de');
    expect(listKeysLeft().sort()).toEqual([
      `list-filters:${ALICE.id}:${OBJECT}:${VIEW}`,
      LAYOUT_KEY,
      `list-state:${ALICE.id}:${OBJECT}`,
    ]);

    await act(async () => {
      await auth().signOut();
    });

    expect(listKeysLeft()).toEqual([]);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
    expect(localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('de');
  });

  it('a session read that answers no session removes them too', async () => {
    let live = true;
    const client = authClient(async () => (live ? { user: ALICE, session: { token: 'tok-alice' } } : null));
    const { view } = await signInAndArrange(client);

    live = false;
    await act(async () => {
      await auth().refreshSession();
    });

    expect(view.getByTestId('user').textContent).toBe('none');
    expect(listKeysLeft()).toEqual([]);
  });

  it('with nobody signed in, a layout change writes nothing back', async () => {
    const client = authClient(async () => ({ user: ALICE, session: { token: 'tok-alice' } }));
    await signInAndArrange(client);
    await act(async () => {
      await auth().signOut();
    });
    await waitFor(() => expect(committed.current?.auth.user ?? null).toBeNull());

    act(() => committed.current!.layout.patchView(VIEW, { widths: { name: 300 } }));
    act(() => committed.current!.layout.setViewOrder([VIEW]));

    expect(listKeysLeft()).toEqual([]);
  });
});
