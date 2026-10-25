/**
 * objectui#5664 — cross-user client-state pollution.
 *
 * ## The defect
 *
 * `auth-active-organization-id` was one un-namespaced `localStorage` key while
 * its siblings were already `:u:<userId>`-scoped. A brand-new user signing in
 * on a browser that had held someone else's session read the PREVIOUS user's
 * organization id: the header workspace chip rendered the previous user's
 * workspace, and the polluted org context suppressed `RequireOrganization`'s
 * routing into the guided "Create your workspace" first-run flow — on a
 * shared or handed-over browser the new-user flow silently never happened.
 *
 * ## What is pinned here
 *
 * Three parts, and the third is the one that closes the CLASS:
 *
 *  1. the key is per-user, and
 *  2. it can no longer be written un-namespaced at all, and
 *  3. **a change of session user drops the previous user's UI state
 *     wholesale** — so the next un-namespaced key, one nobody has written yet,
 *     cannot re-open this.
 *
 * The headline case is deliberately shaped as ZERO A-SCOPED READS rather than
 * "B reads the right thing". Asserting only that B's own reads are correct is
 * green on the buggy code too — B reading `null` for a key nobody wrote proves
 * nothing about A's residue. So the storage layer is instrumented and the
 * assertion is over what the reads ANSWERED while B's session booted, with the
 * instrument's own liveness asserted alongside (a zero hit is a reading only
 * once the instrument is shown to record something).
 *
 * The controls that must SURVIVE the purge carry as much weight as the ones
 * that must die: `auth-session-token` is the INCOMING user's credential, so a
 * purge that took it would sign B out on arrival, and the theme is a device
 * preference belonging to nobody.
 */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { TokenStorage } from '../createAuthClient';
import {
  ActiveOrganizationStorage,
  SessionUserScope,
  purgePreviousUserClientState,
} from '../ActiveOrganizationStorage';
import type { AuthClient } from '../types';
import type { AuthContextValue } from '../AuthContext';

const USER_A = 'u_alice';
const USER_B = 'u_bob';
const ORG_A = { id: 'org_a', name: "Alice's Workspace", slug: 'alice-ws' };

const LEGACY_ACTIVE_ORG_KEY = 'auth-active-organization-id';
const scopedOrgKey = (userId: string) => `${LEGACY_ACTIVE_ORG_KEY}:u:${userId}`;

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * The handful of methods the provider reaches on these paths — same shape and
 * same one-place cast as every other double in this package.
 */
function createClientFor(
  userId: string,
  name: string,
  orgs: Array<{ id: string; name: string; slug: string }>,
): AuthClient {
  const active = orgs[0] ?? null;
  return {
    signIn: vi.fn(),
    signOut: vi.fn().mockImplementation(async () => { TokenStorage.clear(); }),
    getSession: vi.fn().mockResolvedValue({
      user: { id: userId, name, email: `${userId}@test.com` },
      session: { token: `tok-${userId}` },
    }),
    listOrganizations: vi.fn().mockResolvedValue(orgs),
    getActiveOrganization: vi.fn().mockResolvedValue(active),
    setActiveOrganization: vi.fn().mockResolvedValue(active),
    getActiveMember: vi.fn().mockResolvedValue(
      active ? { id: 'mem_1', organizationId: active.id, userId, role: 'owner' } : null,
    ),
  } as unknown as AuthClient;
}

const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  useEffect(() => { authRef.current = auth; }, [auth]);
  return (
    <div>
      <span data-testid="user">{auth.user?.name ?? 'none'}</span>
      <span data-testid="active-org">{auth.activeOrganization?.name ?? 'none'}</span>
    </div>
  );
}

/**
 * Record every `getItem` a store answers, keeping the real store underneath so
 * the code under test still behaves normally. Returns the log.
 */
function recordReads(store: Storage): Array<{ key: string; value: string | null }> {
  const reads: Array<{ key: string; value: string | null }> = [];
  const real = store.getItem.bind(store);
  vi.spyOn(store, 'getItem').mockImplementation((key: string) => {
    const value = real(key);
    reads.push({ key, value });
    return value;
  });
  return reads;
}

beforeEach(() => {
  authRef.current = null;
  localStorage.clear();
  sessionStorage.clear();
  TokenStorage.clear();
  ActiveOrganizationStorage.clear();
  SessionUserScope._resetForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  SessionUserScope._resetForTests();
});

// ---------------------------------------------------------------------------
// (1) the key is per-user, and cannot be written un-namespaced
// ---------------------------------------------------------------------------

describe('the active-org key is per-user (#5664)', () => {
  it('persists under `:u:<userId>` and not under the bare key', () => {
    SessionUserScope.adopt(USER_A);

    ActiveOrganizationStorage.set('org_a');

    expect(localStorage.getItem(scopedOrgKey(USER_A))).toBe('org_a');
    expect(localStorage.getItem(LEGACY_ACTIVE_ORG_KEY)).toBeNull();
    expect(ActiveOrganizationStorage.get()).toBe('org_a');
  });

  it('does not read another user’s scope', () => {
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');

    // Straight to the pointer: the same browser, now owned by B, with A's
    // entry still physically present (the purge is exercised separately —
    // this case isolates the READ).
    SessionUserScope._resetForTests();
    localStorage.setItem('auth-session-user-id', USER_B);
    ActiveOrganizationStorage._memoryValue = null;

    expect(localStorage.getItem(scopedOrgKey(USER_A))).toBe('org_a');
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('writes NOTHING persisted when no session user is known', () => {
    // The un-namespaced fallback `@object-ui/app-shell`'s `scopedKey` uses for
    // "no user id yet" is exactly the defect here, so this path is memory-only.
    ActiveOrganizationStorage.set('org_orphan');

    expect(localStorage.getItem(LEGACY_ACTIVE_ORG_KEY)).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_ACTIVE_ORG_KEY))).toEqual([]);
    // Control on the same instrument: with a user adopted the very same call
    // DOES reach the persisted layer, so the emptiness above is a measurement
    // and not a broken store.
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    expect(Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_ACTIVE_ORG_KEY)))
      .toEqual([scopedOrgKey(USER_A)]);
  });

  it('never resurrects a value sitting under the retired bare key', () => {
    // The state every existing browser is in on the day this ships.
    localStorage.setItem(LEGACY_ACTIVE_ORG_KEY, 'org_a');

    SessionUserScope.adopt(USER_B);

    expect(ActiveOrganizationStorage.get()).toBeNull();
    // Deleted rather than migrated: nothing recorded whose org id it was, and
    // migrating it is the defect (it would hand A's org to B).
    expect(localStorage.getItem(LEGACY_ACTIVE_ORG_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) the invariant: a change of session user drops the previous user's state
// ---------------------------------------------------------------------------

describe('a change of session user drops the previous user’s state wholesale (#5664)', () => {
  it('purges both stores, allowlisting only device-scoped keys', () => {
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    // A's state, in both the namespaced and the un-namespaced shape. The
    // second is the one that matters: it stands in for the NEXT key someone
    // adds without a `:u:` scope, which this invariant has to cover without
    // being told about it.
    localStorage.setItem(`objectui-recent-items:u:${USER_A}`, '[{"id":"acct_1"}]');
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');
    sessionStorage.setItem('objectui:metadata:app:org_a:@anon', '[{"name":"crm"}]');
    sessionStorage.setItem('objectui-ctx-studio-active_package', 'pkg_alice');
    // Device-scoped: the INCOMING session's credential and a preference that
    // belongs to nobody.
    TokenStorage.set('tok-bob');
    localStorage.setItem('vite-ui-theme', 'dark');

    SessionUserScope.adopt(USER_B);

    expect(localStorage.getItem(scopedOrgKey(USER_A))).toBeNull();
    expect(localStorage.getItem(`objectui-recent-items:u:${USER_A}`)).toBeNull();
    expect(localStorage.getItem('objectui-nav-order-crm')).toBeNull();
    expect(sessionStorage.getItem('objectui:metadata:app:org_a:@anon')).toBeNull();
    expect(sessionStorage.getItem('objectui-ctx-studio-active_package')).toBeNull();

    // The controls that must SURVIVE. A purge that took the token would sign
    // the arriving user out at the moment they arrive.
    expect(TokenStorage.get()).toBe('tok-bob');
    expect(localStorage.getItem('vite-ui-theme')).toBe('dark');
    expect(localStorage.getItem('auth-session-user-id')).toBe(USER_B);
  });

  it('purges nothing when the same user is re-adopted', () => {
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');

    SessionUserScope.adopt(USER_A);

    expect(ActiveOrganizationStorage.get()).toBe('org_a');
    expect(localStorage.getItem('objectui-nav-order-crm')).toBe('["accounts"]');
  });

  it('purges nothing on the first sign-in a browser has ever seen', () => {
    localStorage.setItem('vite-ui-theme', 'dark');
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');

    SessionUserScope.adopt(USER_A);

    // No previous owner recorded, so there is no previous owner's state to
    // drop — this must not read as a change.
    expect(localStorage.getItem('objectui-nav-order-crm')).toBe('["accounts"]');
  });

  it('does not purge when the previous owner was never PERSISTED', () => {
    // The asymmetry `adopt()` is built on, pinned so it is not "tidied" back
    // into a `current()` call. `current()` is memory-first because it answers
    // "which key do I use in this tab". The purge decision is storage-only
    // because it answers "is another user's state sitting in this store" — and
    // a browser that persisted nothing (Safari private browsing, a quota-
    // exhausted origin, a store cleared out from under us) has no residue to
    // drop. Purging on an in-memory id there deletes state written FOR the
    // arriving user, not by the previous one.
    SessionUserScope.adopt(USER_A);
    localStorage.clear();
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');
    // Precondition: memory still names A, so a `current()`-based decision
    // would read this as a change. This case is not vacuous.
    expect(SessionUserScope.current()).toBe(USER_A);
    expect(localStorage.getItem('auth-session-user-id')).toBeNull();

    SessionUserScope.adopt(USER_B);

    expect(localStorage.getItem('objectui-nav-order-crm')).toBe('["accounts"]');
    expect(SessionUserScope.current()).toBe(USER_B);
  });

  it('nulls the in-memory org BEFORE it touches storage', () => {
    // The ordering property #5703 made load-bearing, restated for this path.
    // `get()` falls through to `_memoryValue` whenever the persisted read is
    // null — which is exactly the state a purge leaves behind — so an
    // implementation that swept storage first would leave A's org id live in
    // memory for the rest of a page-load, and the SPA sign-out-then-sign-in
    // path never reloads.
    const observed: Array<string | null> = [];
    const realClear = ActiveOrganizationStorage.clear.bind(ActiveOrganizationStorage);
    vi.spyOn(ActiveOrganizationStorage, 'clear').mockImplementation(() => {
      realClear();
      observed.push(ActiveOrganizationStorage._memoryValue);
    });

    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    expect(ActiveOrganizationStorage._memoryValue).toBe('org_a');

    SessionUserScope.adopt(USER_B);

    expect(observed).toEqual([null]);
    expect(ActiveOrganizationStorage._memoryValue).toBeNull();
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('survives a storage layer that is entirely unavailable', () => {
    // SSR / partitioned iframe: the purge must be a no-op, not a throw on the
    // sign-in path.
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);

    expect(() => purgePreviousUserClientState()).not.toThrow();

    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // objectui#5763 — a throwing `removeItem` must cost exactly that key
  // -------------------------------------------------------------------------

  it('sweeps every other non-device-scoped key when one removeItem throws (#5763)', () => {
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    // Keys on BOTH SIDES of the poisoned one in insertion order, so a green
    // run proves the walk continues past the throw rather than stopping at
    // the first non-poisoned key it happens to reach.
    localStorage.setItem(`objectui-recent-items:u:${USER_A}`, '[{"id":"acct_1"}]');
    const POISON_KEY = 'objectui-nav-order-crm';
    localStorage.setItem(POISON_KEY, '["accounts"]');
    localStorage.setItem('objectui-favorites', '["acct_2"]');
    sessionStorage.setItem('objectui:metadata:app:org_a:@anon', '[{"name":"crm"}]');
    // Device-scoped, written for the INCOMING user the same way the passing
    // sibling case above does it.
    TokenStorage.set('tok-bob');
    localStorage.setItem('vite-ui-theme', 'dark');

    const realRemoveItem = localStorage.removeItem.bind(localStorage);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const removeItemSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
      if (key === POISON_KEY) throw new Error('simulated removeItem failure');
      realRemoveItem(key);
    });

    try {
      expect(() => SessionUserScope.adopt(USER_B)).not.toThrow();

      // The poisoned key is the residue the card is about — it survives.
      expect(localStorage.getItem(POISON_KEY)).toBe('["accounts"]');

      // Everything else non-device-scoped is still swept, in BOTH stores —
      // this is the pin: one uncooperative key costs one key, not the rest.
      expect(localStorage.getItem(scopedOrgKey(USER_A))).toBeNull();
      expect(localStorage.getItem(`objectui-recent-items:u:${USER_A}`)).toBeNull();
      expect(localStorage.getItem('objectui-favorites')).toBeNull();
      expect(sessionStorage.getItem('objectui:metadata:app:org_a:@anon')).toBeNull();

      // The device-scoped allowlist is still respected around the failure.
      expect(TokenStorage.get()).toBe('tok-bob');
      expect(localStorage.getItem('vite-ui-theme')).toBe('dark');
      expect(localStorage.getItem('auth-session-user-id')).toBe(USER_B);

      // Discoverable, not silent — the failure is named, not swallowed whole.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain(POISON_KEY);
    } finally {
      // Explicit, not left to `afterEach`'s `restoreAllMocks()`: a spy
      // installed on a jsdom `Storage` instance (rather than a plain object)
      // has been observed to survive `restoreAllMocks()` across tests — the
      // NEXT test in this file measured the mock still active on entry. Left
      // to the shared teardown, this poisoned `removeItem` for every later
      // case in the file that happens to touch the same key name.
      removeItemSpy.mockRestore();
    }
  });

  it('reports nothing when every removal sticks', () => {
    // Control on the case above: the warning is a measurement of an actual
    // failure, not a constant emitted on every purge.
    SessionUserScope.adopt(USER_A);
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    SessionUserScope.adopt(USER_B);

    expect(localStorage.getItem('objectui-nav-order-crm')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The end-to-end shape: user B signs in after user A, through AuthProvider
// ---------------------------------------------------------------------------

describe('user B signing in after user A reads none of A’s state (#5664)', () => {
  it('answers ZERO A-scoped reads, and lands B without an organization', async () => {
    // --- user A's session, through the real provider -----------------------
    const view = render(
      <AuthProvider authUrl="/api/auth" client={createClientFor(USER_A, 'Alice', [ORG_A])}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(view.getByTestId('user').textContent).toBe('Alice'));
    await waitFor(() =>
      expect(view.getByTestId('active-org').textContent).toBe("Alice's Workspace"),
    );
    expect(localStorage.getItem(scopedOrgKey(USER_A))).toBe(ORG_A.id);

    // The rest of A's UI state, as the browser holds it when it is handed over.
    localStorage.setItem(`objectui-recent-items:u:${USER_A}`, '[{"id":"acct_1"}]');
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');
    sessionStorage.setItem('objectui:metadata:app:org_a:@anon', '[{"name":"crm"}]');
    const A_VALUES = new Set([
      ORG_A.id,
      '[{"id":"acct_1"}]',
      '["accounts"]',
      '[{"name":"crm"}]',
    ]);

    cleanup();
    // B arrives with their own credential and a device preference that is
    // nobody's state.
    TokenStorage.set('tok-bob');
    localStorage.setItem('vite-ui-theme', 'dark');
    // A page reload drops the in-memory pointer; the persisted one (A) is what
    // the next boot resolves the scope from, exactly as in the browser.
    SessionUserScope._resetForTests();

    // --- instrument, then boot B ------------------------------------------
    const localReads = recordReads(localStorage);
    const sessionReads = recordReads(sessionStorage);

    const viewB = render(
      <AuthProvider authUrl="/api/auth" client={createClientFor(USER_B, 'Bob', [])}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(viewB.getByTestId('user').textContent).toBe('Bob'));
    await waitFor(() => expect(authRef.current?.isOrganizationsLoading).toBe(false));

    const reads = [...localReads, ...sessionReads];
    // The instrument is live — a zero hit below is a measurement, not a
    // silent no-op. (`auth-session-token` alone guarantees traffic.)
    expect(reads.length).toBeGreaterThan(0);

    // THE PIN: nothing B's session read answered with a value of A's.
    const aScopedReads = reads.filter((r) => r.value !== null && A_VALUES.has(r.value));
    expect(aScopedReads).toEqual([]);

    // ... and nothing keyed to A is left to be read later either.
    const survivingAKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      .filter((k) => k.includes(USER_A) || k.includes(ORG_A.id));
    expect(survivingAKeys).toEqual([]);

    // The consequence the card is actually about: B has no organization
    // context, so `RequireOrganization` routes them into the guided first-run
    // flow instead of a Welcome page furnished for A.
    expect(ActiveOrganizationStorage.get()).toBeNull();
    expect(authRef.current?.activeOrganization).toBeNull();
    expect(authRef.current?.organizations).toEqual([]);
    expect(viewB.getByTestId('active-org').textContent).toBe('none');

    // B is still signed in: the purge took state, not credentials.
    expect(TokenStorage.get()).toBe('tok-bob');
    expect(localStorage.getItem('vite-ui-theme')).toBe('dark');
  });

  it('does not adopt — or purge for — a synthetic preview identity', async () => {
    SessionUserScope.adopt(USER_A);
    ActiveOrganizationStorage.set('org_a');
    localStorage.setItem('objectui-nav-order-crm', '["accounts"]');

    const view = render(
      <AuthProvider authUrl="/api/auth" previewMode={{ simulatedRole: 'admin' }}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(view.getByTestId('user').textContent).not.toBe('none'));

    // A marketplace demo mounts with a fixed `preview-user` id. Treating that
    // as a user change would purge a real signed-in user's state.
    expect(SessionUserScope.current()).toBe(USER_A);
    expect(localStorage.getItem('objectui-nav-order-crm')).toBe('["accounts"]');
    expect(localStorage.getItem(scopedOrgKey(USER_A))).toBe('org_a');
  });
});
