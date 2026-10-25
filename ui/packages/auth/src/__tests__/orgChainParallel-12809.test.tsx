/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12809 — the organization chain on console open is no longer serial.
 *
 * Before: `organization/list`, then `get-full-organization` (to learn the
 * active organization), then `get-active-member` (only once the active
 * organization had landed): three round trips one after another on every boot.
 *
 * Now, when the `get-session` answer carries the organization plugin's
 * `activeOrganizationId`:
 *  - the active organization is named from that id and the list answer, so
 *    `get-full-organization` is not asked at all;
 *  - the member row is asked for at the same time as the list, not after it.
 *
 * The server below is a double whose list answer is held open by the test, so
 * "asked before the list answered" is an observation, not an inference.
 * CONTROLs: a switch still asks for the new organization's member row; a
 * session answer without the key takes the old path; the stale-id clear
 * (objectui#12698) and the single-membership repair (ADR-0081) hold on the new
 * path too.
 */

import React, { StrictMode, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { ActiveOrganizationStorage, SessionUserScope } from '../ActiveOrganizationStorage';
import type { AuthContextValue } from '../AuthContext';
import type { AuthClient, AuthOrganization, AuthOrganizationMember } from '../types';

const USER = 'u_12809';
const ORG_A: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };
const ORG_B: AuthOrganization = { id: 'org_b', name: 'Org B', slug: 'b' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function memberOf(orgId: string): AuthOrganizationMember {
  return { id: `m_${orgId}`, organizationId: orgId, userId: USER, role: 'org_admin' };
}

/**
 * A server that holds its own active organization. `sessionKey: false` answers
 * `get-session` the way a server without the organization plugin does.
 */
function createServer(
  memberships: AuthOrganization[],
  initiallyActive: string | null,
  { sessionKey = true }: { sessionKey?: boolean } = {},
) {
  let active: string | null = initiallyActive;
  const list = deferred<AuthOrganization[]>();
  const client = {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com' },
      session: sessionKey ? { token: 'tok-12809', activeOrganizationId: active } : { token: 'tok-12809' },
    })),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn(() => list.promise),
    getActiveOrganization: vi.fn(async () => memberships.find((o) => o.id === active) ?? null),
    setActiveOrganization: vi.fn(async (orgId: string) => {
      const target = memberships.find((o) => o.id === orgId);
      if (!target) {
        active = null;
        throw Object.assign(new Error('not a member'), { status: 403 });
      }
      active = target.id;
      return target;
    }),
    getActiveMember: vi.fn(async () => (active && memberships.some((o) => o.id === active) ? memberOf(active) : null)),
  };
  return {
    client: client as unknown as AuthClient & typeof client,
    answerList: () => act(async () => { list.resolve(memberships); }),
  };
}

const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    authRef.current = auth;
  });
  return null;
}

function boot(client: AuthClient, { strict = false } = {}) {
  const tree = (
    <AuthProvider authUrl="/api/auth" client={client}>
      <Probe />
    </AuthProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  authRef.current = null;
  localStorage.clear();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
});

describe('the organization chain on console open (objectui#12809)', () => {
  it('asks for the member row while organization/list is still in flight, and never for the full organization', async () => {
    const { client, answerList } = createServer([ORG_A, ORG_B], ORG_A.id);
    boot(client);

    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalledTimes(1));
    // The list has not answered, and the member row is already asked for.
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);

    await answerList();
    await waitFor(() => expect(authRef.current?.isMembershipResolved).toBe(true));

    // Named from session.activeOrganizationId plus the list answer.
    expect(authRef.current?.activeOrganization).toBe(ORG_A);
    expect(authRef.current?.activeMember).toEqual(memberOf(ORG_A.id));
    expect(ActiveOrganizationStorage.get()).toBe(ORG_A.id);
    expect(client.getActiveOrganization).not.toHaveBeenCalled();
    // The early answer is the one used: no second member read.
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);
  });

  it('a StrictMode effect replay does not ask for the member row twice', async () => {
    const { client, answerList } = createServer([ORG_A, ORG_B], ORG_A.id);
    boot(client, { strict: true });

    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalled());
    await answerList();
    await waitFor(() => expect(authRef.current?.isMembershipResolved).toBe(true));

    expect(authRef.current?.activeMember).toEqual(memberOf(ORG_A.id));
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);
    expect(client.getActiveOrganization).not.toHaveBeenCalled();
  });

  it('CONTROL: a switch asks for the NEW organization\'s member row', async () => {
    const { client, answerList } = createServer([ORG_A, ORG_B], ORG_A.id);
    boot(client);
    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalled());
    await answerList();
    await waitFor(() => expect(authRef.current?.activeMember).toEqual(memberOf(ORG_A.id)));
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);

    await act(async () => {
      await authRef.current!.switchOrganization(ORG_B.id);
    });
    await waitFor(() => expect(authRef.current?.activeMember).toEqual(memberOf(ORG_B.id)));

    expect(authRef.current?.activeOrganization).toBe(ORG_B);
    expect(client.getActiveMember).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: a session answer without the key asks the server for the active organization, as before', async () => {
    const { client, answerList } = createServer([ORG_A, ORG_B], ORG_A.id, { sessionKey: false });
    boot(client);
    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalled());
    // Nothing is asked ahead of the list on this path.
    expect(client.getActiveMember).not.toHaveBeenCalled();

    await answerList();
    await waitFor(() => expect(authRef.current?.activeMember).toEqual(memberOf(ORG_A.id)));

    expect(client.getActiveOrganization).toHaveBeenCalledTimes(1);
    expect(authRef.current?.activeOrganization?.id).toBe(ORG_A.id);
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);
  });

  it('CONTROL (objectui#12698): an active id the list does not carry names no organization and clears the stored id', async () => {
    localStorage.setItem('auth-session-user-id', USER);
    localStorage.setItem(`auth-active-organization-id:u:${USER}`, 'org_gone');
    const { client, answerList } = createServer([ORG_A, ORG_B], 'org_gone');
    boot(client);
    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalled());
    await answerList();
    await waitFor(() => expect(authRef.current?.isMembershipResolved).toBe(true));

    expect(authRef.current?.activeOrganization).toBeNull();
    expect(authRef.current?.activeMember).toBeNull();
    expect(ActiveOrganizationStorage.get()).toBeNull();
    expect(client.setActiveOrganization).not.toHaveBeenCalled();
    expect(client.getActiveOrganization).not.toHaveBeenCalled();
  });

  it('CONTROL (ADR-0081): one membership and no active id is repaired once, then its member row is read', async () => {
    const { client, answerList } = createServer([ORG_A], null);
    boot(client);
    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalled());
    expect(client.getActiveMember).not.toHaveBeenCalled();
    await answerList();
    await waitFor(() => expect(authRef.current?.activeMember).toEqual(memberOf(ORG_A.id)));

    expect(client.setActiveOrganization).toHaveBeenCalledTimes(1);
    expect(client.setActiveOrganization).toHaveBeenCalledWith(ORG_A.id);
    expect(authRef.current?.activeOrganization).toBe(ORG_A);
    expect(client.getActiveOrganization).not.toHaveBeenCalled();
  });
});
