/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5424 — `AuthGuard`'s `requiredRoles` gate reads `user.positions`
 * (maintainer ruling 2026-08-22, Option A), keeping the `user.role` scalar
 * fallback for identities that lack the key entirely.
 *
 * ## What was broken, in both directions at once
 *
 * The gate read `user.roles ?? (user.role ? [user.role] : [])`, and the
 * protocol-17 session face emits NO `roles` key at all (framework ADR-0090 D3
 * renamed it to `positions` with no deprecation window — measured live in
 * objectui#5389, whose captured payload this file reuses). So on every real
 * deployment the left operand was always `undefined` and the gate decided on
 * the coarse scalar alone:
 *
 *  - UNDER-admission: `requiredRoles={['finance_approver']}` refused everyone
 *    holding `finance_approver` as a position — the only place protocol 17
 *    puts it.
 *  - OVER-admission: `role: 'admin'` passed a gate meant for an `admin`
 *    position the user does not hold.
 *
 * ## Why this file pins NEGATIVES, not just the restored admissions
 *
 * This is an access-control gate. A "fix" that admits more often makes the
 * positive cases green too, so positives alone cannot tell a restored
 * detection from a widened one (same argument as
 * `workspaceAdminPositions-5389.test.tsx`). Every refusal case below exists to
 * make a specific over-admission fail loudly:
 *
 *  - a user with neither the position nor a matching scalar stays refused;
 *  - a PRESENT `positions` array is authoritative, empty included — the
 *    scalar fallback applies only when the key is absent, otherwise
 *    `role: 'admin'` would re-open the over-admission the ruling closes;
 *  - the retired `roles` spelling is not honoured as a second dialect
 *    (ADR-0090 D3 bans resurrecting it; AGENTS.md commandment #0.1 bans the
 *    tolerant consumer-side alias generally).
 *
 * ## Preview mode is half of this card
 *
 * `AuthProvider`'s preview mode was the LAST producer of the retired key
 * (`roles: [role]`, no `positions`). Had the gate moved to `positions` alone
 * with preview left as it was, every preview user would have been refused at
 * every `requiredRoles` gate and every demo surface built on preview mode
 * would go dark. Preview now emits `positions: [role]` (same batch, same
 * ruling), so a preview identity is shaped like a protocol-17 session for
 * EVERY `positions` consumer, not just this gate. The cases below pin both the
 * continuity (preview admin still passes an `admin` gate, preview viewer is
 * still refused) and the producer retirement itself (`hasOwnProperty('roles')`
 * is false on the preview identity).
 *
 * These render the REAL `AuthProvider` against a client double, in the manner
 * of `workspaceAdminPositions-5389.test.tsx`: a mocked `useAuth` could only
 * restate the fixture; going through the provider measures the path a console
 * actually takes from wire payload (or preview config) to admit/refuse.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { AuthGuard } from '../AuthGuard';
import { useAuth } from '../useAuth';
import type { AuthClient, AuthUser } from '../types';

function createClientDouble(user: Record<string, unknown>): AuthClient {
  return {
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue({ user, session: { token: 'tok' } }),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    updateUser: vi.fn(),
    // `AuthClient` declares ~38 methods; this double implements what the
    // provider reaches on the session path — the same shape and the same
    // one-seam assertion as `AuthProvider.test.tsx` in this package.
  } as unknown as AuthClient;
}

/** Renders the gate and resolves to which side of it we landed on. */
async function renderGate(
  user: Record<string, unknown>,
  requiredRoles: string[],
): Promise<'admitted' | 'refused'> {
  const utils = render(
    <AuthProvider authUrl="/api/auth" client={createClientDouble(user)}>
      <AuthGuard requiredRoles={requiredRoles} fallback={<span>REFUSED</span>}>
        <span>ADMITTED</span>
      </AuthGuard>
    </AuthProvider>,
  );
  const marker = await waitFor(() => {
    const found = screen.queryByText('ADMITTED') ?? screen.queryByText('REFUSED');
    expect(found).toBeTruthy();
    return found!;
  });
  const verdict = marker.textContent === 'ADMITTED' ? 'admitted' : 'refused';
  utils.unmount();
  return verdict;
}

/**
 * The deployment shape the card measured (objectui#5389's captured
 * `get-session` payload, business position added): adminship and business
 * positions live in `positions`, `role` stays at better-auth's default
 * `'user'`.
 */
const V17_POSITION_HOLDER = {
  id: 'u1',
  email: 'psadmin@example.com',
  name: 'PermSet Admin',
  role: 'user',
  positions: ['user', 'finance_approver'],
  isPlatformAdmin: false,
};

describe('AuthGuard requiredRoles reads positions (objectui#5424)', () => {
  it('admits a position-holder the retired read refused (the defect)', async () => {
    // Before the fix: `roles` absent -> scalar ['user'] -> refused, even
    // though the server says the user holds `finance_approver`.
    expect(await renderGate(V17_POSITION_HOLDER, ['finance_approver'])).toBe('admitted');
  });

  it('refuses the coarse scalar when positions is present (over-admission closed)', async () => {
    // Before the fix: `roles` absent -> scalar ['admin'] -> ADMITTED to a
    // gate meant for an `admin` position the server says the user lacks.
    const user = { ...V17_POSITION_HOLDER, role: 'admin', positions: ['user'] };
    expect(await renderGate(user, ['admin'])).toBe('refused');
  });

  it('still refuses a user with neither the position nor a matching scalar', async () => {
    // Green before AND after — a fix that widens admission breaks it.
    const user = { ...V17_POSITION_HOLDER, positions: ['user'] };
    expect(await renderGate(user, ['finance_approver'])).toBe('refused');
  });

  it('treats a PRESENT-but-empty positions array as authoritative', async () => {
    // Same stance as workspaceAdminPositions-5389: an empty `positions` is
    // the server's answer, not an invitation to fall back to the scalar.
    const user = { ...V17_POSITION_HOLDER, role: 'admin', positions: [] as string[] };
    expect(await renderGate(user, ['admin'])).toBe('refused');
  });

  it('keeps the scalar fallback for sessions without the positions key', async () => {
    // The guest identity (`enabled={false}`) and pre-positions deployments
    // carry only the scalar — the ruling keeps them admitted.
    const user = { id: 'guest', email: 'guest@local', name: 'Guest', role: 'admin' };
    expect(await renderGate(user, ['admin'])).toBe('admitted');
  });

  it('does NOT honour the retired `roles` spelling as a second dialect', async () => {
    // Before the fix this fixture was ADMITTED (the gate read `user.roles`
    // first). ADR-0090 D3 bans resurrecting the spelling; if someone ever
    // adds `roles` back into the chain, this fails before any real gate
    // widens.
    const user = { id: 'u2', email: 'relic@example.com', name: 'Relic', role: 'user', roles: ['admin'] };
    expect(await renderGate(user, ['admin'])).toBe('refused');
  });
});

describe('preview mode across the same gate (objectui#5424)', () => {
  function PreviewProbe() {
    const { user } = useAuth();
    if (!user) return <span>NO-USER</span>;
    return (
      <div>
        <span data-testid="positions">{JSON.stringify((user as AuthUser).positions ?? null)}</span>
        <span data-testid="has-retired-roles">
          {String(Object.prototype.hasOwnProperty.call(user, 'roles'))}
        </span>
      </div>
    );
  }

  it('a preview admin passes an admin gate exactly as before the fix', async () => {
    render(
      <AuthProvider
        authUrl="/api/auth"
        client={createClientDouble({})}
        previewMode={{ autoLogin: true, simulatedRole: 'admin' }}
      >
        <AuthGuard requiredRoles={['admin']} fallback={<span>REFUSED</span>}>
          <span>ADMITTED</span>
        </AuthGuard>
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('ADMITTED')).toBeTruthy();
    });
  });

  it('a preview viewer is still refused at an admin gate — nobody new passes', async () => {
    render(
      <AuthProvider
        authUrl="/api/auth"
        client={createClientDouble({})}
        previewMode={{ autoLogin: true, simulatedRole: 'viewer' }}
      >
        <AuthGuard requiredRoles={['admin']} fallback={<span>REFUSED</span>}>
          <span>ADMITTED</span>
        </AuthGuard>
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('REFUSED')).toBeTruthy();
    });
  });

  it('the preview identity emits positions and has retired the roles key', async () => {
    // The producer half of the card: preview mode was the LAST source still
    // writing `roles`. `positions: [role]` keeps preview aligned with the
    // protocol-17 shape for every consumer; `hasOwnProperty('roles')` false
    // pins that the retired key is gone rather than merely shadowed.
    render(
      <AuthProvider
        authUrl="/api/auth"
        client={createClientDouble({})}
        previewMode={{ autoLogin: true, simulatedRole: 'viewer' }}
      >
        <PreviewProbe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('positions').textContent).toBe(JSON.stringify(['viewer']));
      expect(screen.getByTestId('has-retired-roles').textContent).toBe('false');
    });
  });
});
