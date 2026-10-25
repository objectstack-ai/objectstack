/**
 * objectui#12698 — after a refused switch the SERVER holds no active
 * organization, and the client must not keep claiming one.
 *
 * better-auth's `POST /organization/set-active` nulls the session's active
 * organization BEFORE it refuses a non-member (`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`),
 * so the refused forge leaves the session with none. On the reload that
 * follows, `refreshOrganizations` asks the server, hears "none", and — before
 * this card — left the previous organization's id in
 * `ActiveOrganizationStorage`, where it kept stamping `X-Tenant-ID` and keying
 * the metadata seed cache for an organization the server does not hold.
 *
 * The auth server is a double held in this file: it remembers its own active
 * organization and answers `set-active` the way the real one does, so every
 * case asserts that what the provider ends up claiming equals what the server
 * holds. Real `AuthProvider`, real `ActiveOrganizationStorage`; no `vi.mock`.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { ActiveOrganizationStorage, SessionUserScope } from '../ActiveOrganizationStorage';
import type { AuthContextValue } from '../AuthContext';
import type { AuthClient, AuthOrganization } from '../types';

const USER = 'u_12698';
const PREV: AuthOrganization = { id: 'org_prev', name: 'Previous Org', slug: 'prev' } as AuthOrganization;
const OTHER: AuthOrganization = { id: 'org_other', name: 'Other Org', slug: 'other' } as AuthOrganization;

/** An auth server that holds its own active organization, like the real one. */
function createServer(memberships: AuthOrganization[], initiallyActive: AuthOrganization | null) {
  let active: AuthOrganization | null = initiallyActive;
  const client = {
    getSession: vi.fn().mockResolvedValue({
      user: { id: USER, name: 'Member', email: 'member@test.com' },
      session: { token: 'tok-12698' },
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn(async () => memberships),
    getActiveOrganization: vi.fn(async () => active),
    setActiveOrganization: vi.fn(async (orgId: string) => {
      const target = memberships.find((o) => o.id === orgId);
      if (!target) {
        active = null; // better-auth clears the session's active org, then refuses
        throw Object.assign(new Error("You're not a member of this organization"), { status: 403 });
      }
      active = target;
      return target;
    }),
    getActiveMember: vi.fn().mockResolvedValue(null),
  };
  return { client: client as unknown as AuthClient & typeof client, serverActive: () => active };
}

const authRef: { current: AuthContextValue | null } = { current: null };

/**
 * Reads what the header reads. `isMembershipResolved` alone answers `true`
 * before the session lands (no user yet), so the probe also waits for the user.
 */
function HeaderProbe() {
  const auth = useAuth();
  useEffect(() => {
    authRef.current = auth;
  });
  return (
    <span data-testid="header-org">
      {auth.user && auth.isMembershipResolved ? (auth.activeOrganization?.name ?? 'NO_ACTIVE_ORGANIZATION') : 'loading'}
    </span>
  );
}

async function boot(client: AuthClient): Promise<string> {
  render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <HeaderProbe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('header-org').textContent).not.toBe('loading'));
  return screen.getByTestId('header-org').textContent ?? '';
}

/** The state the previous page-load left: this user, with PREV stored as active. */
function seedPreviousPageLoad() {
  localStorage.setItem('auth-session-user-id', USER);
  localStorage.setItem(`auth-active-organization-id:u:${USER}`, PREV.id);
}

beforeEach(() => {
  authRef.current = null;
  localStorage.clear();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
  seedPreviousPageLoad();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
});

describe('stale active organization after a refused switch (objectui#12698)', () => {
  it('(a) two memberships, server holds none: no active org is claimed and the stored id is dropped', async () => {
    const { client, serverActive } = createServer([PREV, OTHER], null);

    const header = await boot(client);

    expect(serverActive()).toBeNull();
    expect(header).toBe('NO_ACTIVE_ORGANIZATION');
    expect(ActiveOrganizationStorage.get()).toBeNull();
    expect(localStorage.getItem(`auth-active-organization-id:u:${USER}`)).toBeNull();
    // With two memberships the choice is the user's: no repair call.
    expect(client.setActiveOrganization).not.toHaveBeenCalled();
  });

  it('(a) end to end: a refused forge clears the server, and the next boot agrees with it', async () => {
    const { client, serverActive } = createServer([PREV, OTHER], PREV);
    await expect(client.setActiveOrganization('org_not_a_member')).rejects.toMatchObject({ status: 403 });
    expect(serverActive()).toBeNull();
    client.setActiveOrganization.mockClear();

    const header = await boot(client);

    expect(header).toBe('NO_ACTIVE_ORGANIZATION');
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('(b) one membership: the ADR-0081 repair re-stamps the server once, and the header names what the server confirmed', async () => {
    const { client, serverActive } = createServer([PREV], null);

    await boot(client);
    await waitFor(() => expect(screen.getByTestId('header-org').textContent).toBe(PREV.name));

    expect(client.setActiveOrganization).toHaveBeenCalledTimes(1);
    expect(client.setActiveOrganization).toHaveBeenCalledWith(PREV.id);
    expect(serverActive()?.id).toBe(PREV.id);
    expect(ActiveOrganizationStorage.get()).toBe(PREV.id);
  });

  it('(b) one membership, repair refused: no active org is claimed and the stored id is dropped', async () => {
    const { client } = createServer([PREV], null);
    client.setActiveOrganization.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 403 }));

    const header = await boot(client);

    expect(header).toBe('NO_ACTIVE_ORGANIZATION');
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('(c) control: the server-active org matches storage — it is named, with no extra call', async () => {
    const { client } = createServer([PREV, OTHER], PREV);

    await boot(client);
    await waitFor(() => expect(screen.getByTestId('header-org').textContent).toBe(PREV.name));

    expect(client.getActiveOrganization).toHaveBeenCalledTimes(1);
    expect(client.setActiveOrganization).not.toHaveBeenCalled();
    expect(ActiveOrganizationStorage.get()).toBe(PREV.id);
  });

  it('(d) control: a valid user-initiated switch still works', async () => {
    const { client, serverActive } = createServer([PREV, OTHER], PREV);
    await boot(client);
    await waitFor(() => expect(screen.getByTestId('header-org').textContent).toBe(PREV.name));

    await act(async () => {
      await authRef.current!.switchOrganization(OTHER.id);
    });

    expect(serverActive()?.id).toBe(OTHER.id);
    expect(screen.getByTestId('header-org').textContent).toBe(OTHER.name);
    expect(ActiveOrganizationStorage.get()).toBe(OTHER.id);
  });
});
