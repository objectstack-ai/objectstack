/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5619 — `useIsWorkspaceAdmin` returned a bare `boolean`, so "not
 * resolved yet" and "resolved: not an admin" were the same answer. This file
 * measures the window at the REAL provider and pins the third state.
 *
 * ## Why the provider, not a mocked `useAuth`
 *
 * The claim is about ORDERING inside `AuthProvider` — that `activeMember`
 * arrives some round trips after `user`. A mocked context can only restate
 * whichever ordering the author already believed. These cases drive the real
 * provider against a client double whose promises are held open by hand, so
 * each frame of the pipeline is observable: the same approach as
 * `workspaceAdminPositions-5389.test.tsx` beside it, with the resolution steps
 * separated so the window itself can be asserted rather than waited out.
 *
 * ## What the measurement found, and how it narrows the filed premise
 *
 * The report says the window hits "an administrator whose adminship comes from
 * the organization member row … i.e. the ordinary tenant case". Measured
 * against the server that feeds these legs, it is narrower than that, and the
 * narrowing is the reason the fix costs admins nothing:
 *
 * framework `packages/plugins/plugin-auth/src/auth-manager.ts` builds
 * `positions[]` in `customSession`, and its org leg reads
 * `session.activeOrganizationId` — `if (!orgId) return []`. So when the session
 * WAS minted with an active organization stamped, the member row is already in
 * `positions` as `org_owner`/`org_admin` and leg 3 answers on the first frame
 * (`an admin the session already identifies…` below). The window belongs to
 * sessions that reach the console WITHOUT that stamp — which is exactly the
 * path `AuthProvider.refreshOrganizations`' ADR-0081 single-membership repair
 * exists to serve, and there the member row is the only leg carrying adminship
 * (`the reported window…` below).
 *
 * That is why `isResolved` is true whenever `isAdmin` is: the viewers who would
 * pay for a resolution gate are precisely the ones who never have to.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useWorkspaceAdminStatus } from '../useWorkspaceAdminStatus';
import type { AuthClient, AuthUser } from '../types';

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/** A promise this test resolves by hand, so a pipeline step can be held open. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((res) => { settle = res; });
  return { promise, settle };
}

/**
 * The card's viewer: adminship lives ONLY in the member row.
 *
 * No `role` scalar (the server stopped overwriting it — ADR-0068 D2) and no
 * `org_*` in `positions` (the session carries no active-organization stamp, so
 * `customSession`'s org leg returned empty). Legs 2 and 3 are therefore both
 * genuinely negative for this user, and leg 1 is the whole signal.
 */
const UNSTAMPED_ORG_OWNER = {
  id: 'u_owner',
  name: 'Org Owner',
  email: 'owner@example.com',
  role: 'user',
  positions: ['user'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

/** The same human, on a session that DOES carry the stamp. */
const STAMPED_ORG_OWNER = {
  id: 'u_owner',
  name: 'Org Owner',
  email: 'owner@example.com',
  role: 'user',
  positions: ['user', 'org_owner'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

const ORDINARY_MEMBER = {
  id: 'u_member',
  name: 'Member',
  email: 'member@example.com',
  role: 'user',
  positions: ['user', 'org_member'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

function AdminProbe() {
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const { user, isMembershipResolved } = useAuth();
  return (
    <div>
      <span data-testid="is-admin">{String(isAdmin)}</span>
      <span data-testid="is-resolved">{String(isResolved)}</span>
      <span data-testid="membership-resolved">{String(isMembershipResolved)}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
    </div>
  );
}

const verdict = () => ({
  isAdmin: screen.getByTestId('is-admin').textContent,
  isResolved: screen.getByTestId('is-resolved').textContent,
});

function mount(client: AuthClient) {
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <AdminProbe />
    </AuthProvider>,
  );
}

const awaitSession = () =>
  waitFor(() => {
    expect(screen.getByTestId('user-id').textContent).not.toBe('none');
  });

describe('useWorkspaceAdminStatus — the unresolved third state (objectui#5619)', () => {
  it('the reported window: an unstamped org owner reads NOT-YET-RESOLVED, never a settled non-admin', async () => {
    const orgs = deferred<unknown[]>();
    const activeOrg = deferred<unknown>();
    const member = deferred<unknown>();
    const getActiveMember = vi.fn().mockReturnValue(member.promise);

    mount({
      getSession: vi.fn().mockResolvedValue({
        user: UNSTAMPED_ORG_OWNER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockReturnValue(orgs.promise),
      getActiveOrganization: vi.fn().mockReturnValue(activeOrg.promise),
      setActiveOrganization: vi.fn().mockResolvedValue(ORG),
      getActiveMember,
    } as unknown as AuthClient);

    await awaitSession();

    // THE FRAME THE CARD IS ABOUT. Pre-fix the hook answered a bare `false`
    // here, and every gate downstream treated it as a verdict: two marketplace
    // surfaces painted `MarketplaceAccessDenied`, and `AppContent` fired a
    // `<Navigate to="/home" replace>` that the flip below cannot undo.
    expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'false' });

    // Still unresolved with the org list in hand — the member row is a further
    // round trip, and it is the one that carries this viewer's adminship.
    orgs.settle([ORG]);
    activeOrg.settle(ORG);
    await waitFor(() => expect(getActiveMember).toHaveBeenCalled());
    expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'false' });

    member.settle({ id: 'mem_1', organizationId: ORG.id, userId: 'u_owner', role: 'owner' });
    await waitFor(() => {
      expect(verdict()).toEqual({ isAdmin: 'true', isResolved: 'true' });
    });
  });

  it('an admin the session already identifies is resolved on the first frame, with the pipeline still open', async () => {
    // The cost measurement for every gate placed on `isResolved`: this viewer
    // never waits, because `positions` already answered. The org pipeline is
    // deliberately left hanging for the whole case.
    const neverSettles = deferred<unknown[]>();
    const getActiveMember = vi.fn().mockReturnValue(deferred<unknown>().promise);

    mount({
      getSession: vi.fn().mockResolvedValue({
        user: STAMPED_ORG_OWNER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockReturnValue(neverSettles.promise),
      getActiveOrganization: vi.fn().mockReturnValue(deferred<unknown>().promise),
      setActiveOrganization: vi.fn().mockResolvedValue(ORG),
      getActiveMember,
    } as unknown as AuthClient);

    await awaitSession();

    expect(verdict()).toEqual({ isAdmin: 'true', isResolved: 'true' });
    // The membership pipeline has NOT finished — the verdict simply does not
    // depend on it for this viewer.
    expect(screen.getByTestId('membership-resolved').textContent).toBe('false');
  });

  it('a single-tenant deployment resolves without ever asking for a member row', async () => {
    // The cost PM asked to measure: on a deployment with no organizations,
    // `getActiveMember()` is never called at all, so a gate that waited for it
    // to "resolve meaningfully" would wait on a request that is never made.
    // What settles the question is the empty org list.
    const getActiveMember = vi.fn().mockResolvedValue(null);

    mount({
      getSession: vi.fn().mockResolvedValue({
        user: ORDINARY_MEMBER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockResolvedValue([]),
      getActiveOrganization: vi.fn().mockResolvedValue(null),
      setActiveOrganization: vi.fn().mockResolvedValue(null),
      getActiveMember,
    } as unknown as AuthClient);

    await awaitSession();
    await waitFor(() => {
      expect(screen.getByTestId('is-resolved').textContent).toBe('true');
    });
    expect(screen.getByTestId('is-admin').textContent).toBe('false');
    expect(getActiveMember).not.toHaveBeenCalled();
  });

  it('a failed getActiveMember still resolves, so no gate can hang on it', async () => {
    mount({
      getSession: vi.fn().mockResolvedValue({
        user: ORDINARY_MEMBER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockResolvedValue([ORG]),
      getActiveOrganization: vi.fn().mockResolvedValue(ORG),
      setActiveOrganization: vi.fn().mockResolvedValue(ORG),
      getActiveMember: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as AuthClient);

    await awaitSession();
    await waitFor(() => {
      expect(screen.getByTestId('is-resolved').textContent).toBe('true');
    });
    expect(screen.getByTestId('is-admin').textContent).toBe('false');
  });

  it('a failed listOrganizations still resolves, so no gate can hang on it either', async () => {
    mount({
      getSession: vi.fn().mockResolvedValue({
        user: ORDINARY_MEMBER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockRejectedValue(new Error('boom')),
      getActiveOrganization: vi.fn().mockResolvedValue(null),
      setActiveOrganization: vi.fn().mockResolvedValue(null),
      getActiveMember: vi.fn().mockResolvedValue(null),
    } as unknown as AuthClient);

    await awaitSession();
    await waitFor(() => {
      expect(screen.getByTestId('is-resolved').textContent).toBe('true');
    });
  });

  it('NOBODY NEW BECOMES AN ADMIN — a settled ordinary member is resolved AND not an admin', async () => {
    // The substitution guard this hook's sibling pin (#5389) establishes: a
    // "fix" that widens detection, or that reports `isResolved: false` forever
    // so every gate holds open, would pass the positive cases above. This is
    // the case that fails for both.
    mount({
      getSession: vi.fn().mockResolvedValue({
        user: ORDINARY_MEMBER,
        session: { token: 'tok-5619' },
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      listOrganizations: vi.fn().mockResolvedValue([ORG]),
      getActiveOrganization: vi.fn().mockResolvedValue(ORG),
      setActiveOrganization: vi.fn().mockResolvedValue(ORG),
      getActiveMember: vi.fn().mockResolvedValue({
        id: 'mem_2', organizationId: ORG.id, userId: 'u_member', role: 'member',
      }),
    } as unknown as AuthClient);

    await awaitSession();
    await waitFor(() => {
      expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'true' });
    });
  });

  it('outside an AuthProvider the answer is resolved, not pending', async () => {
    // `useAuth`'s provider-less default reports `isLoading: false` for the same
    // reason: a bare embed has nothing to wait for, and a gate on `isResolved`
    // must render through rather than hold a blank frame forever.
    render(<AdminProbe />);
    expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'true' });
  });

  it('preview mode still reports a resolved admin', async () => {
    render(
      <AuthProvider authUrl="/api/v1/auth" previewMode={{ simulatedRole: 'admin' }}>
        <AdminProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(verdict()).toEqual({ isAdmin: 'true', isResolved: 'true' });
    });
  });

  it('preview mode as a NON-admin (`simulatedRole: \'user\'`) still reaches a resolved verdict', async () => {
    // The mode runs no organization pipeline at all, so this is the case that
    // would hang if `refreshActiveMember`'s preview branch forgot to close it.
    render(
      <AuthProvider authUrl="/api/v1/auth" previewMode={{ simulatedRole: 'user' }}>
        <AdminProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'true' });
    });
  });
});
