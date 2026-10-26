/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5389 — `useWorkspaceAdminStatus` decides platform-admin, and with it
 * Setup app + Studio visibility, App Marketplace gating and the "Build an app"
 * CTAs. Its third leg read `user.roles`, a key the protocol-17 session face no
 * longer emits (framework ADR-0090 D3 renamed it to `positions`). This file is
 * the measurement, kept as a pin.
 *
 * ## The payload these cases are built from is MEASURED, not imagined
 *
 * `V17_PERMISSION_SET_ADMIN` below is the verbatim `user` object returned by
 * `GET /api/v1/auth/get-session` on a real single-tenant server — published
 * `@objectstack/cli` / `@objectstack/plugin-auth` 17.1.0, `Tenancy: single`,
 * booted with `objectstack dev --seed-admin --fresh`. The account is the exact
 * deployment shape the card names: adminship derived from the
 * `admin_full_access` permission set (a `sys_user_permission_set` row with
 * `organization_id = NULL`, what `bootstrapPlatformAdmin` seeds), no
 * `sys_member` row, and `sys_user.role` left at better-auth's default `'user'`
 * rather than overwritten to `'admin'`.
 *
 * What the wire actually carried, and what each leg of the hook made of it:
 *
 *   - `session.activeOrganizationId: null`, and `organization/get-active-member`
 *     answered `400 NO_ACTIVE_ORGANIZATION` -> `activeMember` is null.  LEG 1: no.
 *   - `user.role: "user"` -> not an admin role.                          LEG 2: no.
 *   - `user.roles`: THE KEY IS ABSENT (`hasOwnProperty` -> false).       LEG 3: no.
 *   - `user.positions: ["user", "platform_admin"]` and
 *     `user.isPlatformAdmin: true` -> read by nothing.
 *
 * So the hook returned `false` for a platform administrator. That is the
 * defect, and `permission-set-derived platform admin` below fails without the
 * fix.
 *
 * ## Why this file also pins the NEGATIVES
 *
 * This hook is an authorization-adjacent read. A "fix" that returns `true` more
 * often makes the positive case green too, so the positive case alone cannot
 * tell a restored detection from a widened one. The four negative cases exist
 * to make that substitution fail: an ordinary member must still read as NOT
 * admin through every leg, an empty `positions` must not admit anyone, a
 * session predating the key must not either, and the RETIRED `roles` spelling
 * must not be quietly honoured as a second dialect (framework ADR-0090 D3 bans
 * resurrecting it; objectui AGENTS.md commandment #0.1 bans the tolerant
 * consumer-side alias generally).
 *
 * The two legs that were never broken get cases of their own for the same
 * reason: a fix that swaps one dead read for one live read must not be able to
 * disturb them unnoticed.
 *
 * These render the REAL `AuthProvider` against a client double, in the manner
 * of `singleMembershipActiveOrg-5287.test.tsx`. A mocked `useAuth` could only
 * restate the fixture; going through the provider measures the path the console
 * actually takes from wire payload to boolean.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useWorkspaceAdminStatus } from '../useWorkspaceAdminStatus';
import type { AuthClient, AuthUser } from '../types';

/**
 * Verbatim from the captured `get-session` payload described in the header.
 * Kept whole — including the better-auth bookkeeping columns — so that what is
 * asserted is a real session face and not a hand-picked subset of one. Note
 * what is NOT here: `roles`.
 */
const V17_PERMISSION_SET_ADMIN = {
  name: 'PermSet Admin',
  email: 'psadmin@example.com',
  emailVerified: false,
  image: null,
  createdAt: '2026-08-20T16:25:18.056Z',
  updatedAt: '2026-08-20T16:26:10.016Z',
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  id: 'gwDZFnqdUQGFnOUh3IRWdWqykCw33eVl',
  positions: ['user', 'platform_admin'],
  isPlatformAdmin: true,
} as unknown as AuthUser;

/** The same server, same shape, for an account holding no admin grant at all. */
const V17_ORDINARY_MEMBER = {
  name: 'Ordinary Member',
  email: 'member@example.com',
  emailVerified: false,
  image: null,
  role: 'user',
  id: 'u_ordinary',
  positions: ['user', 'org_member'],
  isPlatformAdmin: false,
} as unknown as AuthUser;

const ORG = { id: 'org_1', name: 'Acme', slug: 'acme' };

/**
 * Implements only the methods the provider reaches on these paths, with the
 * same one-place cast every other double in this package uses.
 *
 * The default wiring is the ORG-LESS deployment: `listOrganizations` answers
 * empty, so `activeOrganization` stays null and the provider never asks for an
 * active member — which is how the real server behaved above (400
 * NO_ACTIVE_ORGANIZATION). Cases that need leg 1 pass an org and a member row.
 */
function createMockClient(user: AuthUser, overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ user, session: { token: 'tok-5389' } }),
    signOut: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue([]),
    getActiveOrganization: vi.fn().mockResolvedValue(null),
    setActiveOrganization: vi.fn().mockResolvedValue(null),
    getActiveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as AuthClient;
}

/**
 * Renders exactly what every gated console surface renders, plus the two
 * provider-state markers the waits below need. `user-id` and `member-role` are
 * not assertions of their own; they exist so a case can wait for the input it
 * supplies to have ARRIVED before reading the verdict.
 */
function AdminProbe() {
  const { isAdmin } = useWorkspaceAdminStatus();
  const { user, activeMember } = useAuth();
  return (
    <div>
      <span data-testid="is-admin">{String(isAdmin)}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="member-role">{activeMember?.role ?? 'none'}</span>
    </div>
  );
}

/**
 * Mount, wait for the session to have LANDED, and return the verdict.
 *
 * The wait is on the session's `user` arriving, never on the verdict itself:
 * waiting for the verdict would make every negative case pass instantly against
 * the pre-session state, where `user` is null and the answer is `false` for a
 * reason that has nothing to do with what is being asserted.
 *
 * `expectMember` additionally waits for the active-member row, for the cases
 * that supply one: `activeMember` lands one effect later than `user`, so a leg-1
 * case read without this would be measuring the moment before its own input
 * exists.
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

describe('useWorkspaceAdminStatus — the v17 session face publishes `positions` (#5389)', () => {
  describe('the reported defect', () => {
    it('detects a permission-set-derived platform admin with no member row and no admin scalar', async () => {
      const client = createMockClient(V17_PERMISSION_SET_ADMIN);

      expect(await mountAndRead(client)).toBe('true');
    });

    it('the captured payload really does lack the retired `roles` key', () => {
      // Guards the fixture itself: if someone "helpfully" adds `roles` back to
      // the constant above, the case above would start passing through a leg
      // that no server feeds, and would stop measuring anything.
      expect(
        Object.prototype.hasOwnProperty.call(V17_PERMISSION_SET_ADMIN, 'roles'),
      ).toBe(false);
      expect((V17_PERMISSION_SET_ADMIN as { positions?: string[] }).positions)
        .toEqual(['user', 'platform_admin']);
    });
  });

  describe('the legs that already worked must keep working', () => {
    it('leg 1 — an active organization member row with an admin role still detects', async () => {
      // No `positions` at all on this user: the verdict has to come from the
      // member row, exactly as it did before this change.
      const orgAdmin = {
        id: 'u_orgowner',
        name: 'Org Owner',
        email: 'owner@example.com',
      } as unknown as AuthUser;
      const client = createMockClient(orgAdmin, {
        listOrganizations: vi.fn().mockResolvedValue([ORG]),
        getActiveOrganization: vi.fn().mockResolvedValue(ORG),
        getActiveMember: vi.fn().mockResolvedValue({
          id: 'mem_1',
          organizationId: ORG.id,
          userId: 'u_orgowner',
          role: 'owner',
        }),
      });

      expect(await mountAndRead(client, { expectMember: 'owner' })).toBe('true');
    });

    it('leg 2 — a stored `user.role` admin scalar still detects', async () => {
      const scalarAdmin = {
        id: 'u_scalar',
        name: 'Scalar Admin',
        email: 'scalar@example.com',
        role: 'admin',
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(scalarAdmin))).toBe('true');
    });

    it('preview mode still seeds an admin', async () => {
      render(
        <AuthProvider authUrl="/api/v1/auth" previewMode={{ simulatedRole: 'admin' }}>
          <AdminProbe />
        </AuthProvider>,
      );
      await waitFor(() => {
        expect(screen.getByTestId('is-admin').textContent).toBe('true');
      });
    });
  });

  describe('nobody new becomes an admin', () => {
    it('an ordinary member reads as NOT admin through every leg', async () => {
      const client = createMockClient(V17_ORDINARY_MEMBER, {
        listOrganizations: vi.fn().mockResolvedValue([ORG]),
        getActiveOrganization: vi.fn().mockResolvedValue(ORG),
        getActiveMember: vi.fn().mockResolvedValue({
          id: 'mem_2',
          organizationId: ORG.id,
          userId: 'u_ordinary',
          role: 'member',
        }),
      });

      expect(await mountAndRead(client, { expectMember: 'member' })).toBe('false');
    });

    it('an empty `positions` array admits nobody', async () => {
      const noPositions = {
        id: 'u_empty',
        name: 'Empty',
        email: 'empty@example.com',
        role: 'user',
        positions: [],
        isPlatformAdmin: false,
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(noPositions))).toBe('false');
    });

    it('a session carrying no `positions` key at all admits nobody', async () => {
      const preAdr0090 = {
        id: 'u_old',
        name: 'Old Server',
        email: 'old@example.com',
        role: 'user',
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(preAdr0090))).toBe('false');
    });

    it('the retired `roles` spelling alone does NOT confer admin', async () => {
      // framework ADR-0090 D3 renamed `roles` to `positions` with no
      // deprecation window, and its declaration bans resurrecting `roles` as a
      // fallback. `positions` is the one published spelling; a consumer that
      // honoured both would fossilize a second dialect for one fact and let the
      // two disagree. If someone ever adds `roles ?? positions`, this fails.
      const deadSpellingOnly = {
        id: 'u_dead',
        name: 'Dead Spelling',
        email: 'dead@example.com',
        role: 'user',
        roles: ['platform_admin', 'org_owner'],
      } as unknown as AuthUser;

      expect(await mountAndRead(createMockClient(deadSpellingOnly))).toBe('false');
    });
  });
});
