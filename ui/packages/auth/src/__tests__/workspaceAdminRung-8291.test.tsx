/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8291 — `useWorkspaceAdminStatus` may not read platform authority
 * out of a NAME in `user.positions[]`.
 *
 * ## What changed under the hook
 *
 * Framework objectstack#15948 (declared BREAKING) redefined `positions[]`. It
 * used to be the `sys_user.role` scalar split on commas; it is now built by
 * `resolveUserAuthzGrants` and carries ADR-0057 D4 `sys_user_position`
 * assignments. That table is `apiEnabled` with unconstrained `position`
 * values, so a caller holding tenant-administration authority can mint a row
 * spelling `platform_admin` for one of their own users, and the name lands on
 * the session payload verbatim.
 *
 * The server's posture rung did NOT move with it: `customSession` sets
 * `isPlatformAdmin` from `grants.posture === 'PLATFORM_ADMIN'`, which derives
 * from an unscoped `admin_full_access` grant and nothing else. So the flag and
 * the array can now disagree, and `resolve-authz-context.ts` says which one
 * wins at `hasPlatformAdminStanding`: read the RUNG, never
 * `positions.includes('platform_admin')`. The framework moved four server-side
 * sites onto that rule; this file pins the client-side one.
 *
 * ## What each half of this file is for
 *
 * The FIRST describe is the defect: a payload that is exactly what a minted
 * row produces — the name present, the rung false — must not yield
 * `isAdmin: true`. It fails against the pre-#8291 hook.
 *
 * The SECOND and THIRD describes are the substitution guards, and they matter
 * as much. The obvious "fix" for this card is to delete the array leg, which
 * would regress objectui#5389 (a platform administrator on a single-tenant
 * deployment has no member row and no admin scalar) and objectui#5619 (a
 * tenant administrator whose session carries the org stamp resolves on the
 * first frame instead of waiting for the member pipeline). Those two are
 * pinned in their own files; what is pinned HERE is the narrower claim that
 * distinguishes the real fix from the deletion — that the verdict for a
 * platform administrator now comes from the FLAG, and that the two
 * tenant-scoped names survive.
 *
 * The FOURTH describe walks the names that were dropped from the array
 * vocabulary one at a time, because the decision was made name by name and a
 * later reader is owed the record of it rather than a single set literal.
 *
 * These render the REAL `AuthProvider` against a client double, in the manner
 * of `workspaceAdminPositions-5389.test.tsx`. A mocked `useAuth` could only
 * restate the fixture; going through the provider measures the path the
 * console actually takes from wire payload to boolean.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useWorkspaceAdminStatus } from '../useWorkspaceAdminStatus';
import type { AuthClient, AuthUser } from '../types';

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/**
 * THE DEFECT'S PAYLOAD.
 *
 * An ordinary member of a tenant, for whom a `sys_user_position` row spelling
 * `platform_admin` has been minted. Every field is what the server really
 * emits for that principal:
 *
 *   - `positions` carries the minted name, because `resolveUserAuthzGrants`
 *     pushes `sys_user_position.position` values through verbatim;
 *   - `isPlatformAdmin` is FALSE, because the posture rung reads the unscoped
 *     `admin_full_access` grant and this principal holds none;
 *   - `role` stays better-auth's default, because the server no longer
 *     overwrites it.
 *
 * Note what the array does NOT let a client see: `resolveUserAuthzGrants`
 * pushes the built-in `platform_admin` only when it is not already present, so
 * a genuine administrator and this principal produce a byte-identical
 * `positions`. The array cannot answer this question; only the flag can.
 */
const TENANT_MINTED_PLATFORM_ADMIN = {
  name: 'Minted Admin',
  email: 'minted@tenant.example.com',
  emailVerified: true,
  image: null,
  role: 'user',
  id: 'u_minted',
  positions: ['user', 'everyone', 'org_member', 'platform_admin'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

/**
 * The genuine article, for contrast: the same shape with the rung set. This is
 * the objectui#5389 deployment (single-tenant, adminship from the
 * `admin_full_access` permission set) and its `isPlatformAdmin: true` is
 * verbatim from the payload captured live there.
 */
const GENUINE_PLATFORM_ADMIN = {
  name: 'PermSet Admin',
  email: 'psadmin@example.com',
  emailVerified: false,
  image: null,
  role: 'user',
  id: 'u_genuine',
  positions: ['user', 'platform_admin'],
  isPlatformAdmin: true,
} as unknown as AuthUser;

function createMockClient(user: AuthUser, overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ user, session: { token: 'tok-8291' } }),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue([]),
    getActiveOrganization: vi.fn().mockResolvedValue(null),
    setActiveOrganization: vi.fn().mockResolvedValue(null),
    getActiveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as AuthClient;
}

/** The tenant the minted row lives in: an org whose member row says `member`. */
function withOrdinaryMembership(userId: string): Partial<AuthClient> {
  return {
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue({
      id: 'mem_8291',
      organizationId: ORG.id,
      userId,
      role: 'member',
    }),
  } as unknown as Partial<AuthClient>;
}

function AdminProbe() {
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const { user, activeMember, isMembershipResolved } = useAuth();
  return (
    <div>
      <span data-testid="is-admin">{String(isAdmin)}</span>
      <span data-testid="is-resolved">{String(isResolved)}</span>
      <span data-testid="membership-resolved">{String(isMembershipResolved)}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="member-role">{activeMember?.role ?? 'none'}</span>
    </div>
  );
}

const verdict = () => ({
  isAdmin: screen.getByTestId('is-admin').textContent,
  isResolved: screen.getByTestId('is-resolved').textContent,
});

/**
 * Mount, wait for the session to have LANDED, and return the verdict.
 *
 * The wait is on the session's `user` arriving, never on the verdict itself:
 * waiting for the verdict would make every negative case pass instantly
 * against the pre-session state, where `user` is null and the answer is
 * `false` for a reason that has nothing to do with what is being asserted.
 */
async function mountAndRead(
  client: AuthClient,
  opts: { expectMember?: string } = {},
): Promise<string> {
  render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <AdminProbe />
    </AuthProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('user-id').textContent).not.toBe('none');
  });
  if (opts.expectMember) {
    await waitFor(() => {
      expect(screen.getByTestId('member-role').textContent).toBe(opts.expectMember);
    });
  }
  return screen.getByTestId('is-admin').textContent ?? '';
}

/** A session carrying exactly one extra `positions` entry and no other change. */
function memberWithMintedPosition(position: string): AuthUser {
  return {
    name: 'Minted',
    email: 'minted@tenant.example.com',
    role: 'user',
    id: `u_${position}`,
    positions: ['user', 'everyone', 'org_member', position],
    isPlatformAdmin: false,
  } as unknown as AuthUser;
}

describe('useWorkspaceAdminStatus — a NAME in positions[] is not platform authority (#8291)', () => {
  describe('the defect', () => {
    it('a tenant-minted `platform_admin` with no `admin_full_access` grant does NOT confer admin', async () => {
      const client = createMockClient(
        TENANT_MINTED_PLATFORM_ADMIN,
        withOrdinaryMembership('u_minted'),
      );

      expect(await mountAndRead(client, { expectMember: 'member' })).toBe('false');
    });

    it('the same payload on an org-less session does NOT confer admin either', async () => {
      // Leg 1 cannot even be consulted here, so this isolates the array read
      // from the membership row entirely.
      expect(await mountAndRead(createMockClient(TENANT_MINTED_PLATFORM_ADMIN))).toBe('false');
    });

    it('the fixture really is the contradiction it claims to be', () => {
      // Guards the fixture: if someone "tidies" it so the name and the flag
      // agree, the two cases above stop measuring anything at all.
      expect(TENANT_MINTED_PLATFORM_ADMIN.positions).toContain('platform_admin');
      expect(TENANT_MINTED_PLATFORM_ADMIN.isPlatformAdmin).toBe(false);
    });
  });

  describe('the replacement signal is the posture rung, not the name', () => {
    it('a genuine platform administrator (rung set) still reads as admin', async () => {
      // objectui#5389's viewer: no member row, `role` left at `user`. This is
      // the case the naive "just delete the array leg" fix regresses.
      expect(await mountAndRead(createMockClient(GENUINE_PLATFORM_ADMIN))).toBe('true');
    });

    it('the verdict follows the FLAG when the flag and the array disagree', async () => {
      // The discrimination probe, and deliberately synthetic: today's server
      // pushes the built-in name onto the array whenever the rung is set, so
      // this exact payload is not one a shipping server emits. It is here
      // because it is the only shape that can tell "read the flag" apart from
      // "read the name" — the two agree on every other input, including both
      // fixtures above.
      const rungOnly = {
        name: 'Rung Only',
        email: 'rung@example.com',
        role: 'user',
        id: 'u_rung',
        positions: ['user', 'everyone'],
        isPlatformAdmin: true,
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(rungOnly))).toBe('true');
    });

    it('a session that publishes no `isPlatformAdmin` key at all admits nobody', async () => {
      // Fail closed: the read is `=== true`, so an absent flag is "no platform
      // standing" rather than a truthy unknown.
      const noFlag = {
        name: 'Old Server',
        email: 'old@example.com',
        role: 'user',
        id: 'u_noflag',
        positions: ['user', 'everyone'],
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(noFlag))).toBe('false');
    });
  });

  describe('the tenant-scoped names survive — leg 3b was narrowed, not deleted', () => {
    // These two are what `resolveUserAuthzGrants` derives from the ACTIVE
    // organization's `sys_member.role` via `mapMembershipRole`. They are the
    // reason objectui#5619's stamped tenant administrator resolves on the
    // first frame, and a fix that deleted the array read would silently take
    // that away — leaving them to wait on the member pipeline.
    for (const position of ['org_owner', 'org_admin']) {
      it(`\`${position}\` in positions still confers admin with the org pipeline still open`, async () => {
        const stamped = {
          name: 'Stamped Owner',
          email: 'owner@example.com',
          role: 'user',
          id: `u_${position}`,
          positions: ['user', 'everyone', position],
          isPlatformAdmin: false,
        } as unknown as AuthUser;

        // `listOrganizations` never settles: if the verdict needed leg 1 this
        // would hang at `false`.
        const client = createMockClient(stamped, {
          listOrganizations: vi.fn().mockReturnValue(new Promise(() => {})),
          getActiveOrganization: vi.fn().mockReturnValue(new Promise(() => {})),
        } as unknown as Partial<AuthClient>);

        expect(await mountAndRead(client)).toBe('true');
        expect(verdict()).toEqual({ isAdmin: 'true', isResolved: 'true' });
        expect(screen.getByTestId('membership-resolved').textContent).toBe('false');
      });
    }
  });

  describe('the names dropped from the array vocabulary, one at a time', () => {
    // Each of these was in `ADMIN_ROLES` and was honoured wherever it appeared
    // in `positions[]`. None of them is emitted into that array by any server
    // derivation: the membership leg normalizes `owner`/`admin` to `org_*`
    // first, and `super_admin` / `superadmin` / `system_admin` are not
    // built-in identity names in any framework vocabulary. So a hit could only
    // ever have been a `sys_user_position` row — all exposure, no signal.
    //
    // They remain valid for legs 1 and 2, where they are the raw membership
    // role and the stored `user.role` scalar; the case below each proves the
    // narrowing did not reach those legs.
    for (const position of ['platform_admin', 'super_admin', 'superadmin', 'system_admin', 'owner', 'admin']) {
      it(`a minted \`${position}\` in positions does NOT confer admin`, async () => {
        expect(await mountAndRead(createMockClient(memberWithMintedPosition(position)))).toBe('false');
      });
    }

    it('but the same names on the MEMBER ROW (leg 1) still confer admin', async () => {
      const plain = {
        id: 'u_leg1', name: 'Leg One', email: 'leg1@example.com',
        role: 'user', positions: ['user', 'everyone'], isPlatformAdmin: false,
      } as unknown as AuthUser;
      const client = createMockClient(plain, {
        listOrganizations: vi.fn().mockResolvedValue([ORG]),
        getActiveOrganization: vi.fn().mockResolvedValue(ORG),
        getActiveMember: vi.fn().mockResolvedValue({
          id: 'mem_leg1', organizationId: ORG.id, userId: 'u_leg1', role: 'owner',
        }),
      } as unknown as Partial<AuthClient>);

      expect(await mountAndRead(client, { expectMember: 'owner' })).toBe('true');
    });

    it('and the same names on the `user.role` SCALAR (leg 2) still confer admin', async () => {
      const scalarAdmin = {
        id: 'u_leg2', name: 'Leg Two', email: 'leg2@example.com',
        role: 'admin', positions: ['user', 'everyone'], isPlatformAdmin: false,
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(scalarAdmin))).toBe('true');
    });
  });

  describe('objectui#5619 `isResolved` semantics are untouched', () => {
    it('the minted principal settles to resolved-and-not-admin, never a permanent pending', async () => {
      // The other way to make the defect case green is to answer
      // `isResolved: false` forever, which holds every gate open instead of
      // closing it. That reads as "still loading" to every caller and is not a
      // fix; this is the case that fails for it.
      const client = createMockClient(
        TENANT_MINTED_PLATFORM_ADMIN,
        withOrdinaryMembership('u_minted'),
      );

      render(
        <AuthProvider authUrl="/api/v1/auth" client={client}>
          <AdminProbe />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(verdict()).toEqual({ isAdmin: 'false', isResolved: 'true' });
      });
    });

    it('a genuine platform administrator is resolved on the first frame, pipeline still open', async () => {
      // The cost measurement objectui#5619 records for leg 3, carried over to
      // the rung: this viewer never waits on the membership pipeline.
      const client = createMockClient(GENUINE_PLATFORM_ADMIN, {
        listOrganizations: vi.fn().mockReturnValue(new Promise(() => {})),
        getActiveOrganization: vi.fn().mockReturnValue(new Promise(() => {})),
      } as unknown as Partial<AuthClient>);

      expect(await mountAndRead(client)).toBe('true');
      expect(verdict()).toEqual({ isAdmin: 'true', isResolved: 'true' });
      expect(screen.getByTestId('membership-resolved').textContent).toBe('false');
    });
  });
});
