/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5719 — does `user.positions` re-resolve across an organization
 * switch, and by WHAT mechanism?
 *
 * ## The card, and what measuring it found
 *
 * #5719 observed that `AuthProvider.switchOrganization` never calls
 * `loadSession()`, while framework `packages/plugins/plugin-auth/src/
 * auth-manager.ts` derives `user.positions[]` inside `customSession` from
 * `session.activeOrganizationId` — so leg 3 of `useWorkspaceAdminStatus`
 * would keep answering for the PREVIOUS organization. Because that hook is
 * `leg1 || leg2 || leg3` AND short-circuits `isResolved` to true the moment
 * any leg says admin, a stale `org_owner` reads as a CONFIRMED admin in the
 * new organization. The card could not close the last step from this repo and
 * was filed as an observation: *if* the server re-issues a bearer token on
 * `POST /organization/set-active`, `TokenStorage.subscribeRotation` already
 * drives `loadSession()` (objectui#4467) and there is no defect at all.
 *
 * It does, and there is not. Measured against better-auth 1.6.28 driven
 * standalone (the version `packages/auth` resolves), with the organization and
 * bearer plugins that framework `auth-manager.ts` always enables:
 *
 *   GET  /get-session          → NO `set-auth-token`; body `session.token` is
 *                                the UNSIGNED value
 *   POST /organization/set-active
 *                              → `set-auth-token` present, and its value is
 *                                the SIGNED `<token>.<signature>` spelling
 *
 * `setActiveOrganization` succeeds through `setSessionCookie(ctx, …)`
 * unconditionally (`plugins/organization/routes/crud-org.mjs`), and
 * `bearer()`'s after-hook emits `set-auth-token` for ANY response that stages
 * a session `Set-Cookie` (`plugins/bearer/index.mjs`). The session row keeps
 * its token — `internalAdapter.updateSession` writes only
 * `activeOrganizationId` — so the switch does not mint a new session.
 *
 * ## The mechanism is a SPELLING difference, not a new session
 *
 * The rotation that saves this is real but accidental, and that is exactly why
 * it is pinned here rather than left to the framework:
 *
 *   - `createAuthClient.getSession()` stores `payload.session.token` — the
 *     UNSIGNED value, which is what `sys_session.token` holds.
 *   - `createBearerFetch` stores whatever arrives in `set-auth-token` — the
 *     SIGNED value.
 *
 * Two spellings of ONE session, and `TokenStorage.set` notifies on a value
 * change. So an org switch flips storage unsigned → signed, that reads as a
 * rotation, `AuthProvider`'s objectui#4467 subscription calls `loadSession()`,
 * and `customSession` recomputes `positions` for the NEW organization. The
 * follow-up `get-session` re-stores the unsigned form, which re-arms the
 * mechanism for the next switch.
 *
 * Nothing declares that contract. Normalise either lane onto one spelling —
 * an entirely reasonable-looking tidy-up — and identity silently stops
 * re-resolving across an org switch, with the over-permissive consequence
 * #5719 described and no test anywhere to catch it. These cases are that test.
 *
 * ## Why no explicit `refreshSession()` was added
 *
 * It would double-fetch. The rotation path ALREADY spends exactly one
 * `get-session` per switch, so an explicit call makes every org switch cost
 * two on the common path — a regression traded for an edge case. The card's
 * own caveat (that `refreshSession` deliberately does not raise `isLoading`,
 * so the console must not blank) is honoured for free by not adding one.
 *
 * ## Update — objectui#5750: the accident does not re-arm between two
 * switches with no session read in between
 *
 * #5750 measured a narrower client-side fact about the SAME mechanism: the
 * signed spelling `bearer()` hands back is deterministic on the RAW session
 * token, not on the organization. Two `set-active` responses with no
 * `get-session` landing in between therefore carry the identical signed
 * value — the SECOND `TokenStorage.set` sees no change from the first and
 * never notifies, so the objectui#4467 rotation never fires for it, and
 * identity is left answering for whichever organization the FIRST switch
 * targeted. Reachable in the console via `OrganizationLayout`'s slug-driven
 * effect (`packages/app-shell/.../manage/OrganizationLayout.tsx`) — reached
 * by the "Manage" link on an org card plus the "Back to organizations"
 * button, both plain client-side navigation with no full-page reload and no
 * debounce guarding repeat switches — unlike `WorkspaceSwitcher` and
 * `OrganizationsPage`'s own card click, which both force
 * `window.location.href` immediately after a successful switch and so
 * self-heal via a fresh `AuthProvider` mount's own authoritative
 * `loadSession()` regardless of how this race resolves.
 *
 * The fix: `switchOrganization` no longer relies on `TokenStorage` noticing a
 * value change at all. It tracks the organization it last resolved to
 * itself, and re-resolves identity explicitly whenever a switch's target
 * differs from that — declared, not accidental — while suppressing the (now
 * redundant) rotation notification for its own `set-active` call so the
 * common path still spends exactly one `get-session` per switch. See
 * `AuthProvider.switchOrganization`'s own docstring for the full mechanism.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useWorkspaceAdminStatus } from '../useWorkspaceAdminStatus';
import { TokenStorage } from '../createAuthClient';
import { ActiveOrganizationStorage, SessionUserScope } from '../ActiveOrganizationStorage';
import type { AuthClient, AuthOrganization, AuthOrganizationMember, AuthUser } from '../types';
import type { AuthContextValue } from '../AuthContext';

/** The UNSIGNED session token — `sys_session.token`, and `session.token` on the wire. */
const RAW_TOKEN = 'sess_5719_raw';
/** The SIGNED spelling `bearer()` hands back in `set-auth-token`. Measured shape. */
const SIGNED_TOKEN = `${RAW_TOKEN}.bvWj0cFhrtUI77i7tjyNuEyta2grAAAWGaeYeB7eY`;

const ORG_A: AuthOrganization = { id: 'org_a', name: 'Alpha', slug: 'alpha' } as AuthOrganization;
const ORG_B: AuthOrganization = { id: 'org_b', name: 'Beta', slug: 'beta' } as AuthOrganization;

/** ADR-0068 D2 — a membership role maps onto a canonical position name. */
function mapMembershipRole(role: string): string {
  return role === 'owner' ? 'org_owner' : role === 'admin' ? 'org_admin' : 'org_member';
}

interface ServerOptions {
  /** `role` in each organization's member row for this user. */
  memberships: Record<string, string>;
  /**
   * What the `set-active` response hands back in `set-auth-token`. Production
   * is `signed`; `same` is the counterfactual the last case below explores.
   */
  rotationSpelling?: 'signed' | 'same';
}

/**
 * A server double that resolves identity the way the real one does: the
 * session row carries `activeOrganizationId`, and `positions[]` is DERIVED
 * from it on every session read (framework `customSession`). Nothing here
 * caches positions, so a stale answer can only come from the client failing to
 * ask again — which is the whole question #5719 raised.
 */
function orgBoundClient(options: ServerOptions) {
  const { memberships, rotationSpelling = 'signed' } = options;
  // The session ROW. `set-active` mutates only this field, exactly as
  // `internalAdapter.updateSession` does.
  const sessionRow = { token: RAW_TOKEN, activeOrganizationId: ORG_A.id as string | null };

  const getSession = vi.fn(async () => {
    const orgId = sessionRow.activeOrganizationId;
    const role = orgId ? memberships[orgId] : undefined;
    const user = {
      id: 'u_5719',
      name: 'Switcher',
      email: 'switcher@example.com',
      // Leg 2 must stay genuinely negative, or the switch is unobservable.
      role: 'user',
      positions: ['user', ...(role ? [mapMembershipRole(role)] : [])],
      isPlatformAdmin: false,
    } as unknown as AuthUser;
    // What `createAuthClient.getSession` really does: store the UNSIGNED
    // `payload.session.token`. This is the half that re-arms the mechanism.
    TokenStorage.set(sessionRow.token);
    return { user, session: { token: sessionRow.token, activeOrganizationId: orgId } };
  });

  const setActiveOrganization = vi.fn(async (orgId: string) => {
    sessionRow.activeOrganizationId = orgId;
    // What `createBearerFetch` really does: adopt `set-auth-token` off the
    // response, BEFORE the call resolves.
    TokenStorage.set(rotationSpelling === 'signed' ? SIGNED_TOKEN : sessionRow.token);
    return orgId === ORG_A.id ? ORG_A : ORG_B;
  });

  const getActiveMember = vi.fn(async () => {
    const orgId = sessionRow.activeOrganizationId;
    const role = orgId ? memberships[orgId] : undefined;
    if (!orgId || !role) return null;
    return { id: `m_${orgId}`, organizationId: orgId, userId: 'u_5719', role } as AuthOrganizationMember;
  });

  const client = {
    getSession,
    listOrganizations: vi.fn(async () => [ORG_A, ORG_B]),
    getActiveOrganization: vi.fn(async () =>
      sessionRow.activeOrganizationId === ORG_A.id ? ORG_A : ORG_B,
    ),
    getActiveMember,
    setActiveOrganization,
  } as unknown as AuthClient;

  return { client, getSession, setActiveOrganization, getActiveMember, sessionRow };
}

/**
 * The live context, captured in an EFFECT rather than during render — a render
 * write is a side effect (`react-hooks/globals`), and here it would also be
 * unreliable: these cases switch organizations from outside React.
 */
const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  const { user, activeOrganization } = auth;
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  useEffect(() => { authRef.current = auth; }, [auth]);
  return (
    <div>
      <span data-testid="org">{activeOrganization?.id ?? 'none'}</span>
      <span data-testid="positions">{(user?.positions ?? []).join(',') || 'none'}</span>
      <span data-testid="verdict">{isAdmin ? 'admin' : 'not-admin'}</span>
      <span data-testid="resolved">{isResolved ? 'resolved' : 'unresolved'}</span>
    </div>
  );
}

/** Mount, and wait until the org pipeline has settled on organization A. */
async function bootOnOrgA(client: AuthClient) {
  render(
    <AuthProvider authUrl="/api/v1/auth" client={client}>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('org').textContent).toBe(ORG_A.id));
  await waitFor(() => expect(screen.getByTestId('resolved').textContent).toBe('resolved'));
}

/** Drive the real `switchOrganization` and let the rotation's fetch settle. */
async function switchToOrgB() {
  await act(async () => {
    await authRef.current!.switchOrganization(ORG_B.id);
    // The rotation listener fires `void loadSession()` — deliberately not
    // awaited by `switchOrganization`. Flush its microtasks.
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  authRef.current = null;
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
  // The console reaches an org switch holding the UNSIGNED token, because the
  // mount `loadSession()` stored `session.token` last. Start there.
  TokenStorage.set(RAW_TOKEN);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  TokenStorage.clear();
  SessionUserScope._resetForTests();
});

describe('#5719/#5750 — identity re-resolves across an organization switch', () => {
  it('an owner of A who is an ordinary member of B stops reading as admin after the switch', async () => {
    const { client, getSession } = orgBoundClient({
      memberships: { [ORG_A.id]: 'owner', [ORG_B.id]: 'member' },
    });

    await bootOnOrgA(client);
    // The premise: in organization A this viewer IS an admin, through leg 3.
    expect(screen.getByTestId('positions').textContent).toBe('user,org_owner');
    expect(screen.getByTestId('verdict').textContent).toBe('admin');
    const sessionReadsBeforeSwitch = getSession.mock.calls.length;

    await switchToOrgB();

    // The re-resolution actually happened — by whatever mechanism provides it.
    await waitFor(() => expect(getSession.mock.calls.length).toBeGreaterThan(sessionReadsBeforeSwitch));
    // …and it carried the NEW organization's answer into leg 3.
    await waitFor(() => expect(screen.getByTestId('positions').textContent).toBe('user,org_member'));
    await waitFor(() => expect(screen.getByTestId('verdict').textContent).toBe('not-admin'));
    expect(screen.getByTestId('resolved').textContent).toBe('resolved');
  });

  it('an owner of BOTH organizations still reads as admin after the switch (the control)', async () => {
    // Without this case the one above would pass on any change that simply
    // stopped reporting admin — including deleting leg 3 outright.
    const { client } = orgBoundClient({
      memberships: { [ORG_A.id]: 'owner', [ORG_B.id]: 'owner' },
    });

    await bootOnOrgA(client);
    expect(screen.getByTestId('verdict').textContent).toBe('admin');

    await switchToOrgB();

    await waitFor(() => expect(screen.getByTestId('org').textContent).toBe(ORG_B.id));
    expect(screen.getByTestId('positions').textContent).toBe('user,org_owner');
    expect(screen.getByTestId('verdict').textContent).toBe('admin');
    expect(screen.getByTestId('resolved').textContent).toBe('resolved');
  });

  it('spends exactly ONE extra session read per switch (an explicit refresh would double it)', async () => {
    const { client, getSession } = orgBoundClient({
      memberships: { [ORG_A.id]: 'owner', [ORG_B.id]: 'member' },
    });

    await bootOnOrgA(client);
    const before = getSession.mock.calls.length;

    await switchToOrgB();
    await waitFor(() => expect(screen.getByTestId('verdict').textContent).toBe('not-admin'));
    // Let any second, later fetch land before counting.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(getSession.mock.calls.length).toBe(before + 1);
  });

  /**
   * The counterfactual — objectui#5750 closed this.
   *
   * Everything above is identical except the spelling the `set-active`
   * response hands back: the token the console ALREADY holds instead of the
   * signed form. Before objectui#5750, `TokenStorage.set` did not notify on
   * an unchanged value (objectui#4467, by design — `get-session` re-stores on
   * every boot), so no rotation fired, `loadSession()` was never called, and
   * leg 3 kept answering for organization A — precisely the defect #5719
   * predicted, and precisely the window #5750 measured: two `set-active`
   * responses carrying the same signed spelling (deterministic on the RAW
   * session token, not on the organization) with no intervening `get-session`
   * to re-arm it.
   *
   * `switchOrganization` no longer depends on that spelling accident at all
   * (objectui#5750) — it explicitly re-resolves identity whenever the active
   * organization actually changed, using its OWN before/after comparison
   * rather than a side effect of `TokenStorage`'s diff-on-write semantics. So
   * this case, which used to pin the ABSENCE of a rotation, now pins its
   * PRESENCE: this scenario is indistinguishable from the ordinary case as
   * far as identity re-resolution is concerned, precisely because it no
   * longer rides the accident.
   */
  it('re-resolves even when the switch response echoes the token already held (objectui#5750)', async () => {
    const { client, getSession } = orgBoundClient({
      memberships: { [ORG_A.id]: 'owner', [ORG_B.id]: 'member' },
      rotationSpelling: 'same',
    });

    await bootOnOrgA(client);
    const before = getSession.mock.calls.length;

    await switchToOrgB();
    await waitFor(() => expect(screen.getByTestId('positions').textContent).toBe('user,org_member'));

    // Re-resolution happened despite the echoed spelling — and it cost
    // exactly the same ONE extra session read as the ordinary case above,
    // not two: `switchOrganization` suppresses the (now redundant) rotation
    // notification for its own `set-active` call rather than stacking an
    // explicit read on top of it.
    expect(getSession.mock.calls.length).toBe(before + 1);
    expect(screen.getByTestId('org').textContent).toBe(ORG_B.id);
    expect(screen.getByTestId('verdict').textContent).toBe('not-admin');
    expect(screen.getByTestId('resolved').textContent).toBe('resolved');
  });

  /**
   * objectui#5750 — the exact scenario the card measured: TWO switches with
   * NO session read landing in between. Before the fix, the second switch's
   * `set-active` response carried the same signed spelling as the first
   * (deterministic on the raw session token), so `TokenStorage.set` saw no
   * value change, no rotation fired, and identity was left answering for
   * organization A — the FIRST switch's target — even though
   * `activeOrganization` already read as organization C.
   *
   * Blocking `getSession` mid-flight (never letting it resolve) is the
   * literal reproduction of "no `get-session` round trip lands between the
   * two switches" — a stronger, deterministic stand-in for the timing race a
   * fast real double-switch would have to win.
   */
  it('the SECOND of two switches with no session read in between still re-resolves', async () => {
    const memberships: Record<string, string> = { [ORG_A.id]: 'owner', [ORG_B.id]: 'member' };
    const { client, getSession, sessionRow } = orgBoundClient({ memberships });

    await bootOnOrgA(client);
    const before = getSession.mock.calls.length;

    // Gate every `getSession` call from here on so NONE lands until
    // released — the literal reproduction of "no `get-session` round trip
    // landed between the two switches" the card measured, stronger than
    // reproducing the timing race a fast real double-switch would have to
    // win. Installed only AFTER boot so mount's own `loadSession()` (which
    // also calls `getSession`) is unaffected.
    // Typed as non-nullable + definite-assignment (`!`) at the call site
    // rather than `(() => void) | null = null`: the Promise executor runs
    // SYNCHRONOUSLY (the JS spec guarantees it), so `release` is genuinely
    // assigned by the time `release!()` runs below — but `tsc` narrows a
    // `let x: T | null = null` reassigned only inside a nested closure back
    // to `null` at the read site regardless (TS does not track assignments
    // through closure boundaries for control-flow narrowing), so `release?.()`
    // type-checks against `never` and fails `tsc -p tsconfig.test.json`
    // (`This expression is not callable. Type 'never' has no call signatures.`)
    // even though the runtime behaviour is correct. Reproduced in isolation
    // outside this file/tsconfig to confirm it is this pattern, not anything
    // about `switchOrganization`'s signature.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    getSession.mockImplementation(async () => {
      const orgId = sessionRow.activeOrganizationId;
      const role = orgId ? memberships[orgId] : undefined;
      const user = {
        id: 'u_5719', name: 'Switcher', email: 'switcher@example.com', role: 'user',
        positions: ['user', ...(role ? [mapMembershipRole(role)] : [])],
        isPlatformAdmin: false,
      } as unknown as AuthUser;
      await gate;
      TokenStorage.set(sessionRow.token);
      return { user, session: { token: sessionRow.token, activeOrganizationId: orgId } };
    });

    // Switch 1: A → B. Not awaited to completion — real callers
    // (`OrganizationLayout`'s effect, `WorkspaceSwitcher`) never await
    // `switchOrganization` either.
    act(() => { void authRef.current!.switchOrganization(ORG_B.id); });
    await waitFor(() => expect(screen.getByTestId('org').textContent).toBe(ORG_B.id));
    await waitFor(() => expect(getSession.mock.calls.length).toBe(before + 1));

    // Switch 2: B → A, fired while switch 1's OWN follow-up `get-session` is
    // still blocked on `gate` — no session read has landed for EITHER switch.
    act(() => { void authRef.current!.switchOrganization(ORG_A.id); });
    await waitFor(() => expect(screen.getByTestId('org').textContent).toBe(ORG_A.id));

    // The crux: switch 2 triggered its OWN `get-session`, independent of
    // switch 1's. Before objectui#5750 this stayed at `before + 1` — switch
    // 2's `set-active` response carries the SAME signed token switch 1's did
    // (same session, same deterministic HMAC), so `TokenStorage.set` saw no
    // value change and the objectui#4467 rotation never fired for it.
    await waitFor(() => expect(getSession.mock.calls.length).toBe(before + 2));

    // Let both blocked reads land. Switch 1's answer (organization B) is
    // subscribed first and settles first, but must be DISCARDED as stale —
    // applying it after switch 2's would silently revert identity to the
    // organization the user already switched away from.
    release();

    await waitFor(() => expect(screen.getByTestId('positions').textContent).toBe('user,org_owner'));
    expect(screen.getByTestId('verdict').textContent).toBe('admin');
    expect(screen.getByTestId('resolved').textContent).toBe('resolved');
  });
});

/**
 * The undeclared asymmetry itself, driven through the REAL client rather than
 * a double — because a double could only restate whichever spelling the author
 * already believed.
 *
 * `createAuthClient.getSession()` runs its request through `createBearerFetch`,
 * which adopts `set-auth-token` (SIGNED) the moment the response lands, and
 * THEN stores `payload.session.token` (UNSIGNED) from the body. Last write
 * wins, so a session read always leaves storage holding the unsigned spelling
 * no matter what the response header said. That is what makes the NEXT
 * `set-active` observable as a rotation.
 *
 * Measured against better-auth 1.6.28: `GET /get-session` carries no
 * `set-auth-token` at all in the common case, so the header is included here
 * deliberately — it is the harder direction, and the one a session-refresh
 * response really does take.
 */
describe('#5719 — the two lanes store two spellings of one session', () => {
  beforeEach(() => {
    TokenStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TokenStorage.clear();
  });

  it('getSession() leaves the UNSIGNED session.token stored, even when the response rotates', async () => {
    const { createAuthClient } = await import('../createAuthClient');
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: { id: 'u_5719', email: 'switcher@example.com', name: 'Switcher' },
          session: { token: RAW_TOKEN },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'set-auth-token': SIGNED_TOKEN } },
      ),
    ) as unknown as typeof fetch;

    const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn });
    const result = await client.getSession();

    expect(result?.session?.token).toBe(RAW_TOKEN);
    // The signed form arrived and was adopted first; the body's unsigned form
    // overwrote it. This ordering is the whole mechanism.
    expect(TokenStorage.get()).toBe(RAW_TOKEN);
    expect(TokenStorage.get()).not.toBe(SIGNED_TOKEN);
  });

  it('the two spellings are different strings, so one replacing the other IS a rotation', () => {
    // Stated here rather than assumed: `bearer()` appends `.<signature>` to the
    // value `sys_session.token` holds, so the signed form can never equal it.
    expect(SIGNED_TOKEN).not.toBe(RAW_TOKEN);
    expect(SIGNED_TOKEN.startsWith(`${RAW_TOKEN}.`)).toBe(true);

    TokenStorage.set(RAW_TOKEN);
    const seen = vi.fn();
    const unsubscribe = TokenStorage.subscribeRotation(seen);
    try {
      TokenStorage.set(SIGNED_TOKEN);
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
