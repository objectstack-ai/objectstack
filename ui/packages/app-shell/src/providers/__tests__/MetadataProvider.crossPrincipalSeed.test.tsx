// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5198 — the seed cache belongs to ONE principal.
 *
 * ## The invariant
 *
 * User A signs in, their app list is cached, A signs out, user B signs in IN
 * THE SAME TAB: a `useMetadata().apps` read in B's seed window must never
 * return A's list.
 *
 * That is a different boundary from objectui#4486, and org-scoping deliberately
 * does not close it — the two users here are in the SAME organization, so they
 * compute the same org scope. What sits in storage is the PERMISSION-FILTERED
 * list (the server filters `GET /api/v1/meta/:type` per session), so the reader
 * is a different principal seeing what the previous person was allowed to see:
 * a cross-principal disclosure, not staleness. `sessionStorage` is per-TAB, not
 * per-session, and no sign-out call site reloads the page, so nothing evicted
 * it.
 *
 * ## Why the whole stack is rendered here
 *
 * The two halves of the fix live in different packages — the purge in
 * `AuthProvider.signOut` (`@object-ui/auth`) and the principal-scoped key in
 * `MetadataProvider` (`@object-ui/app-shell`) — and `app-shell` depends on
 * `auth`, so the storage prefix cannot be a shared constant without a cycle.
 * Filling the cache by RUNNING the provider and emptying it by signing out
 * through the real provider is what keeps the two spellings from drifting: a
 * prefix that changes on either side fails here rather than purging nothing.
 * Nothing writes `sessionStorage` by hand, so these tests cannot silently agree
 * with a wrong key format.
 *
 * ## The two halves, pinned separately
 *
 * 1. Sign-out purges what it cached (the commissioned fix).
 * 2. An entry that ESCAPES the purge — a tab open across the upgrade, a
 *    session ended by expiry or by another tab — is unreadable anyway, because
 *    the key carries the session fingerprint. The counter-pin below keeps that
 *    from being satisfied by disabling the cache.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import {
  ActiveOrganizationStorage,
  AuthProvider,
  TokenStorage,
  useAuth,
  type AuthClient,
  type AuthContextValue,
} from '@object-ui/auth';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

const ORG = { id: 'org_a', name: 'Acme', slug: 'acme' };

interface AppItem {
  name: string;
}

/**
 * The auth double. It implements the methods the provider reaches, and it
 * reproduces the one side effect that matters here: the REAL client writes the
 * session token to `TokenStorage` on sign-in and clears it on sign-out
 * (`createAuthClient.ts` — `TokenStorage.set(payload.session.token)` and, in
 * `signOut`, `TokenStorage.clear()` before any rethrow).
 */
function authClientFor(user: { id: string; name: string }, token: string): AuthClient {
  const account = { id: user.id, name: user.name, email: `${user.id}@test.com` };
  return {
    getSession: vi.fn().mockResolvedValue({ user: account, session: { token } }),
    signIn: vi.fn().mockImplementation(async () => {
      TokenStorage.set(token);
      return { user: account, session: { token } };
    }),
    signOut: vi.fn().mockImplementation(async () => {
      TokenStorage.clear();
    }),
    // Same org for both people — that is the point of the card.
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    setActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue({
      id: `mem_${user.id}`, organizationId: ORG.id, userId: user.id, role: 'member',
    }),
  } as unknown as AuthClient;
}

/**
 * `apps: 'pending'` returns a promise that never settles — that IS the seed
 * window: the provider has whatever the cache gave it and nothing else.
 *
 * The adapter refuses when no bearer is stored, exactly as the server does
 * (401) for the metadata requests `MetadataProvider` fires after a sign-out.
 * Without that, the double would answer a signed-out fetch and cache a list
 * nobody could have been served — a phantom this file must not create.
 */
function makeAdapter(opts: { apps: AppItem[] | 'pending' }) {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          if (!TokenStorage.get()) return Promise.reject(new Error('401 Unauthorized'));
          if (type !== 'app') return Promise.resolve({ type, items: [] });
          if (opts.apps === 'pending') return new Promise<never>(() => {});
          return Promise.resolve({ type, items: opts.apps });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/**
 * Holder + effect rather than a bare outer assignment during render — the
 * pattern the other provider tests use and what the react-compiler lint rule
 * requires.
 */
const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  const { apps, loading } = useMetadata();
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);
  return (
    <div>
      <span data-testid="apps">{apps.map((a: AppItem) => a.name).join(',')}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

function renderConsole(client: AuthClient, adapter: ReturnType<typeof makeAdapter>) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <MetadataProvider adapter={adapter}>
        <Probe />
      </MetadataProvider>
    </AuthProvider>,
  );
}

/** Let every pending microtask and the provider's `queueMicrotask` bump settle. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Every `objectui:metadata:*` key currently in sessionStorage. */
function metadataKeys(): string[] {
  return Object.keys(sessionStorage).filter((k) => k.startsWith('objectui:metadata:'));
}

/**
 * Put the tab in the state a returning browser is in: a bearer for `token` and
 * an already-known active organization.
 *
 * Seeding `ActiveOrganizationStorage` before the render is not decoration — it
 * is what makes both principals compute the SAME org scope, which is the
 * situation the card is about (`AuthProvider` resolves the active org
 * asynchronously, so a mount that has never seen this browser before would
 * compute the no-org scope and miss for a reason that has nothing to do with
 * identity). Same modelling as `primeCacheFor` in
 * `MetadataProvider.orgScopedCache.test.tsx`.
 */
function enterTabAs(token: string): void {
  ActiveOrganizationStorage.set(ORG.id);
  TokenStorage.set(token);
}

/**
 * Sign `user` in and let the console cache their app list — by running the real
 * provider until its fetch lands, never by writing storage by hand.
 */
async function signInAndCache(
  user: { id: string; name: string },
  token: string,
  apps: AppItem[],
): Promise<void> {
  enterTabAs(token);
  const view = renderConsole(authClientFor(user, token), makeAdapter({ apps }));
  await waitFor(() =>
    expect(view.getByTestId('apps').textContent).toBe(apps.map((a) => a.name).join(',')),
  );
  view.unmount();
}

beforeEach(() => {
  authRef.current = null;
  sessionStorage.clear();
  localStorage.clear();
  TokenStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MetadataProvider seed cache is per-principal (objectui#5198)', () => {
  it('does not seed user B from user A’s list after A signs out in the same tab', async () => {
    // A signs in and the console caches the list the server filtered for A.
    enterTabAs('tok-alice');
    const view = renderConsole(
      authClientFor({ id: 'u_alice', name: 'Alice' }, 'tok-alice'),
      makeAdapter({ apps: [{ name: 'setup' }, { name: 'crm' }] }),
    );
    await waitFor(() => expect(view.getByTestId('apps').textContent).toBe('setup,crm'));
    expect(metadataKeys()).not.toEqual([]);
    expect(ActiveOrganizationStorage.get()).toBe('org_a');

    // A signs out — no page reload, exactly like every sign-out call site.
    await act(async () => {
      await authRef.current!.signOut();
    });

    // The commissioned fix, measured against the REAL writer's keys: both
    // stores are empty, so the prefix the purge sweeps and the prefix the
    // cache writes cannot have drifted apart.
    expect(metadataKeys()).toEqual([]);
    expect(ActiveOrganizationStorage.get()).toBeNull();
    view.unmount();

    // B signs in in the SAME tab. Same organization, so #4486's org scope is
    // identical; the fetch never lands, so anything rendered came from cache.
    TokenStorage.set('tok-bob');
    const bob = renderConsole(
      authClientFor({ id: 'u_bob', name: 'Bob' }, 'tok-bob'),
      makeAdapter({ apps: 'pending' }),
    );
    await settle();

    // The invariant. Before the fix this read 'setup,crm' — Alice's
    // permission-filtered list, rendered for Bob.
    expect(bob.getByTestId('apps').textContent).toBe('');
    // And the honest posture while B's own list is in flight is "still
    // loading", not "this user has no apps".
    expect(bob.getByTestId('loading').textContent).toBe('true');
  });

  it('is unreadable by the next principal even when the purge never ran', async () => {
    // The half that does not depend on remembering the cleanup: a tab that was
    // open across the upgrade, a session ended by expiry, or a sign-out
    // performed in another tab all leave the entry in place.
    await signInAndCache({ id: 'u_alice', name: 'Alice' }, 'tok-alice', [
      { name: 'setup' },
      { name: 'crm' },
    ]);
    expect(metadataKeys()).not.toEqual([]);

    // No signOut() anywhere — Bob's session simply replaces Alice's. The org
    // id is untouched, so both consoles resolve the SAME org scope: what makes
    // the seed miss below is the identity, not objectui#4486's tenant key.
    expect(ActiveOrganizationStorage.get()).toBe(ORG.id);
    TokenStorage.set('tok-bob');
    const bob = renderConsole(
      authClientFor({ id: 'u_bob', name: 'Bob' }, 'tok-bob'),
      makeAdapter({ apps: 'pending' }),
    );
    await settle();

    expect(bob.getByTestId('apps').textContent).toBe('');
    expect(bob.getByTestId('loading').textContent).toBe('true');
    // Inert is not enough — it is another person's app list sitting in storage,
    // so it is deleted the first time a different principal's console looks.
    expect(metadataKeys()).toEqual([]);
  });

  it('still seeds instantly for the SAME principal (the cache is not just disabled)', async () => {
    // The counter-pin: deleting or disabling the cache would satisfy both tests
    // above and destroy the optimization the cache exists for.
    await signInAndCache({ id: 'u_alice', name: 'Alice' }, 'tok-alice', [
      { name: 'setup' },
      { name: 'crm' },
    ]);

    // Same person, same tab, fresh mount, a fetch that never lands: everything
    // shown here came from the seed.
    enterTabAs('tok-alice');
    const again = renderConsole(
      authClientFor({ id: 'u_alice', name: 'Alice' }, 'tok-alice'),
      makeAdapter({ apps: 'pending' }),
    );

    await waitFor(() => expect(again.getByTestId('apps').textContent).toBe('setup,crm'));
    expect(again.getByTestId('loading').textContent).toBe('false');
  });
});
