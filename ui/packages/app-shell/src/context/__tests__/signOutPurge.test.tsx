// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sign-out clears the per-user list state and list filters the console wrote
 * for the signed-out user, on every sign-out path, and leaves the server-side
 * preference rows alone.
 *
 * The keys are written here by their real writers — `ListPreferencesProvider`
 * (`list-state:USER:OBJECT`) and `listFilterStorage` (`list-filters:USER:OBJECT:VIEW`)
 * — and removed by signing out through the real `AuthProvider`
 * (`@object-ui/auth`). `@object-ui/app-shell` depends on `@object-ui/auth`, so
 * the sweep cannot import these spellings; filling the keys by running their
 * writers is what keeps the two ends from drifting.
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
import type { UserPreferenceFamily } from '@object-ui/data-objectstack';
import {
  ListPreferencesProvider,
  localListStateKey,
  useObjectListPreferences,
  type ObjectListPreference,
} from '../ListPreferencesProvider';
import { UserStateAdaptersProvider, useAttachListStateFamily } from '../UserStateAdapters';
import { buildListFilterKey, writeListFilterState } from '../../views/listFilterStorage';

const ORG = { id: 'org_a', name: 'Acme', slug: 'acme' };
const ALICE = { id: 'u_alice', name: 'Alice', email: 'alice@test.com' };
const OBJECT = 'account';
const VIEW = 'all';
const GROUP = { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'x' }] };

/** The keys this file's writers produce for Alice. */
const LIST_STATE_KEY = localListStateKey(ALICE.id, OBJECT);
const LIST_FILTER_KEY = buildListFilterKey(ALICE.id, OBJECT, VIEW)!;

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

/** The server-side list-state family: one row per object, never asked to change at sign-out. */
function serverFamily(): UserPreferenceFamily<ObjectListPreference> & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    prefix: 'ui.list.',
    load: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

/** Attaches the family while a user is signed in, as the console's bridge does. */
function FamilyBridge({ family }: { family: UserPreferenceFamily<ObjectListPreference> }) {
  const { user } = useAuth();
  const attach = useAttachListStateFamily();
  useEffect(() => {
    if (!user?.id) {
      attach(null);
      return;
    }
    attach(family);
    return () => attach(null);
  }, [user?.id, family, attach]);
  return null;
}

const authRef: { current: AuthContextValue | null } = { current: null };
const prefsRef: { current: ReturnType<typeof useObjectListPreferences> | null } = { current: null };

function Probe() {
  const auth = useAuth();
  const prefs = useObjectListPreferences(OBJECT);
  useEffect(() => {
    authRef.current = auth;
    prefsRef.current = prefs;
  });
  return <span data-testid="user">{auth.user?.name ?? 'none'}</span>;
}

function renderConsole(client: AuthClient, family = serverFamily()) {
  const view = render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <UserStateAdaptersProvider>
        <FamilyBridge family={family} />
        <ListPreferencesProvider>
          <Probe />
        </ListPreferencesProvider>
      </UserStateAdaptersProvider>
    </AuthProvider>,
  );
  return { view, family };
}

/** Sign in, then write a filter group and a search term through the real writers. */
async function signInAndFilter(client: AuthClient) {
  const rendered = renderConsole(client);
  await waitFor(() => expect(rendered.view.getByTestId('user').textContent).toBe('Alice'));
  await waitFor(() => expect(prefsRef.current?.ready).toBe(true));
  act(() => {
    prefsRef.current!.patchView(VIEW, { filters: GROUP });
  });
  writeListFilterState(LIST_FILTER_KEY, { search: 'term' });
  // The search write has landed past its debounce; the list state is written
  // at once, and is what the user's server row holds once its save is sent.
  await waitFor(() => expect(localStorage.getItem(LIST_FILTER_KEY)).not.toBeNull());
  const userState = JSON.parse(localStorage.getItem(LIST_STATE_KEY)!) as ObjectListPreference;
  expect(userState).not.toEqual({});
  return { ...rendered, userState };
}

/**
 * The server-side row is the user's state on every device: whatever is sent
 * to it, before or after the sign-out, is the state the user left, never a
 * cleared one.
 */
function expectServerRowsKept(
  family: ReturnType<typeof serverFamily>,
  userState: ObjectListPreference,
) {
  // Sent by its debounce or by the flush: `signOut()` flushes it before the
  // session ends, and a session that ends any other way flushes it as the
  // family detaches. Sent either way, before the sign-out settles.
  expect(family.save).toHaveBeenCalled();
  for (const [, value] of family.save.mock.calls) expect(value).toEqual(userState);
}

function listKeysLeft(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith('list-state:') || k.startsWith('list-filters:'));
}

beforeEach(() => {
  authRef.current = null;
  prefsRef.current = null;
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sign-out clears the signed-out user’s list state and list filters', () => {
  it('signOut() removes every list-state and list-filters key and keeps the sign-in page language', async () => {
    const client = authClient(async () => ({ user: ALICE, session: { token: 'tok-alice' } }));
    const { family, userState } = await signInAndFilter(client);
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    localStorage.setItem(LOCALE_SEED_STORAGE_KEY, 'de');

    await act(async () => {
      await authRef.current!.signOut();
    });

    expect(listKeysLeft()).toEqual([]);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
    expect(localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBe('de');
    expectServerRowsKept(family, userState);
  });

  it('signOut() saves the last list change under the session, before the session ends', async () => {
    // What happened, in order: the save is sent and settles while the session
    // still exists. Sent after `client.signOut()`, the server would refuse it
    // and the user's last list change would be lost on every device.
    const events: string[] = [];
    const client = authClient(async () => ({ user: ALICE, session: { token: 'tok-alice' } }));
    (client.signOut as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      events.push('session ended');
      TokenStorage.clear();
    });
    const family = serverFamily();
    family.save.mockImplementation(async () => {
      events.push('save sent');
      // A server answer arrives in a later task, never in the same one.
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push('save settled');
    });
    const rendered = renderConsole(client, family);
    await waitFor(() => expect(rendered.view.getByTestId('user').textContent).toBe('Alice'));
    await waitFor(() => expect(prefsRef.current?.ready).toBe(true));
    act(() => {
      prefsRef.current!.patchView(VIEW, { filters: GROUP });
    });
    const userState = JSON.parse(localStorage.getItem(LIST_STATE_KEY)!) as ObjectListPreference;

    await act(async () => {
      await authRef.current!.signOut();
    });

    expect(events).toEqual(['save sent', 'save settled', 'session ended']);
    expect(family.save).toHaveBeenCalledWith(`ui.list.${OBJECT}`, userState);
    expect(listKeysLeft()).toEqual([]);
  });

  it('a session read that answers no session removes them too', async () => {
    let live = true;
    const client = authClient(async () => (live ? { user: ALICE, session: { token: 'tok-alice' } } : null));
    const { view, family, userState } = await signInAndFilter(client);

    live = false;
    await act(async () => {
      await authRef.current!.refreshSession();
    });

    expect(view.getByTestId('user').textContent).toBe('none');
    expect(listKeysLeft()).toEqual([]);
    expectServerRowsKept(family, userState);
  });

  it('a search typed just before sign-out is not written after it', async () => {
    const client = authClient(async () => ({ user: ALICE, session: { token: 'tok-alice' } }));
    await signInAndFilter(client);

    writeListFilterState(LIST_FILTER_KEY, { search: 'typed-at-sign-out' });
    await act(async () => {
      await authRef.current!.signOut();
    });
    // Past the write debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(listKeysLeft()).toEqual([]);
  });

  it('a search typed just before a session read answers no session is not written after it', async () => {
    let live = true;
    const client = authClient(async () => (live ? { user: ALICE, session: { token: 'tok-alice' } } : null));
    await signInAndFilter(client);

    writeListFilterState(LIST_FILTER_KEY, { search: 'typed-at-expiry' });
    live = false;
    await act(async () => {
      await authRef.current!.refreshSession();
    });
    // Past the write debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(listKeysLeft()).toEqual([]);
  });
});
