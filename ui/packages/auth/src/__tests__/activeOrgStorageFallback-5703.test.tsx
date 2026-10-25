/**
 * `ActiveOrganizationStorage`: the in-memory fallback must be REACHABLE in the
 * browser state it was written for — `localStorage` present, reads fine,
 * rejects writes (objectui#5703).
 *
 * Safari private browsing and any quota-exhausted origin present exactly that
 * shape: `getItem` works, `setItem` throws `QuotaExceededError`. `set()`
 * already swallows the write failure into `_memoryValue`; before this fix
 * `get()` returned the `localStorage` read UNCONDITIONALLY, so it answered
 * `null` and the value that had just been stored could never be read back. The
 * cost was silent and lasted the whole session: `createAuthenticatedFetch`
 * reads `get()`, so `X-Tenant-ID` was never stamped on any request.
 *
 * ## The constraint these cases exist to PIN
 *
 * The repair is "prefer a non-null `localStorage` read, else fall back to
 * `_memoryValue`" — and the half that matters is the one that must NOT happen:
 * **sign-out's `clear()` must not be resurrected by that fallback.** A fallback
 * keyed on "the read came back null" is, on its own, exactly the shape that
 * re-stamps a cleared org — after `clear()` the `localStorage` read is null by
 * construction, so the fallback fires, and whatever `_memoryValue` still held
 * goes back on the wire. What makes it safe here is a property of `clear()`,
 * not of `get()`: `clear()` nulls `_memoryValue` BEFORE it touches
 * `localStorage`. That property is load-bearing for a security-relevant path,
 * so these cases pin it directly (`_memoryValue` asserted null after `clear()`,
 * not merely `get()`), rather than reading it off the current source and
 * trusting it to stay. If someone later makes `clear()` only remove the
 * persisted key, `clear-then-get` below goes red instead of silently
 * resurrecting the org.
 *
 * Lives as `.test.tsx` so it runs under happy-dom alongside
 * `createAuthenticatedFetch.test.tsx` — the wire-level cases need `fetch`,
 * `Headers` and a `window.location` for the same-origin check.
 *
 * ## What objectui#5664 changed here, and what it did NOT
 *
 * The persisted key is now per-user (`...:u:<userId>`), so these cases adopt a
 * session user before they touch storage and assert against the scoped
 * spelling. That is a SPELLING change: every property this file exists to pin
 * — a non-null persisted read wins, the memory fallback is reachable when
 * `localStorage` rejects writes, `clear()` nulls `_memoryValue` before it
 * touches storage, and a cleared org never goes back on the wire — is asserted
 * unchanged. Without the adopt the cases would still be green and would mean
 * nothing: with no session user `set()` writes to memory only, so every
 * "reached the persisted layer" assertion below would be vacuously testing an
 * empty store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedFetch, ActiveOrganizationStorage } from '../createAuthenticatedFetch';
import { SessionUserScope } from '../ActiveOrganizationStorage';
import { TokenStorage } from '../createAuthClient';

const SESSION_USER_ID = 'u_5703';
const ACTIVE_ORG_STORAGE_KEY = `auth-active-organization-id:u:${SESSION_USER_ID}`;
const API_URL = 'http://localhost/api/v1/meta/object/account';

/**
 * Install a `localStorage` double and return the Map backing it, so a case can
 * assert what did (or did not) reach the persisted layer.
 *
 * `reject` names which operations throw. The card's probe is
 * `{ setItem: true }`: present, readable, unwritable.
 */
function installLocalStorage(reject: { getItem?: boolean; setItem?: boolean } = {}) {
  const store = new Map<string, string>();
  const quota = () => {
    // The card's probe threw exactly this.
    throw new Error('QuotaExceededError');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (reject.getItem ? quota() : store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (reject.setItem) quota();
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

/** Stub the global fetch and capture the Headers it was called with. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

describe('ActiveOrganizationStorage — the in-memory fallback (#5703)', () => {
  beforeEach(() => {
    ActiveOrganizationStorage.clear();
    // objectui#5664 — the persisted key is per-user. `current()` reads the
    // in-memory pointer first, so this survives the `localStorage` doubles the
    // cases install below and the scope is the same in every case.
    SessionUserScope._resetForTests();
    SessionUserScope.adopt(SESSION_USER_ID);
    vi.spyOn(TokenStorage, 'get').mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ActiveOrganizationStorage.clear();
    SessionUserScope._resetForTests();
  });

  // ── (a) read-succeeds / write-fails: the card's probe ──────────────────

  it('reads back a value it could not persist, when localStorage rejects writes', () => {
    const persisted = installLocalStorage({ setItem: true });

    ActiveOrganizationStorage.set('org-42');

    // The premise of the case, asserted rather than assumed: the write really
    // did fail, so this is the read-succeeds/write-fails state and not a
    // working localStorage wearing a costume.
    expect(persisted.has(ACTIVE_ORG_STORAGE_KEY)).toBe(false);
    expect(localStorage.getItem(ACTIVE_ORG_STORAGE_KEY)).toBeNull();
    expect(ActiveOrganizationStorage._memoryValue).toBe('org-42');

    // The defect: measured as `null` before the fix.
    expect(ActiveOrganizationStorage.get()).toBe('org-42');
  });

  it('stamps X-Tenant-ID for the whole session when localStorage rejects writes', async () => {
    installLocalStorage({ setItem: true });
    ActiveOrganizationStorage.set('org-42');

    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);
    await createAuthenticatedFetch()(API_URL);

    // Before the fix both requests left unstamped — not just the early ones.
    expect(calls[0].headers.get('X-Tenant-ID')).toBe('org-42');
    expect(calls[1].headers.get('X-Tenant-ID')).toBe('org-42');
  });

  // ── (b) clear-then-get stays null: the security-relevant half ──────────

  it('does NOT resurrect a cleared org through the fallback', () => {
    installLocalStorage({ setItem: true });
    ActiveOrganizationStorage.set('org-42');
    // Precondition: the fallback is live and holding the org, so the case
    // below is a real test of `clear()` and not a vacuous one.
    expect(ActiveOrganizationStorage.get()).toBe('org-42');

    ActiveOrganizationStorage.clear();

    // The property that makes "fall back when the read is null" safe. Pinned
    // directly: a `clear()` that only removed the persisted key would leave
    // `_memoryValue` set, the null read would fall through to it, and the
    // cleared org would go straight back on the wire.
    expect(ActiveOrganizationStorage._memoryValue).toBeNull();
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('sends NO tenant header after sign-out clears the org, in the same browser', async () => {
    // The same statement one level out, on the wire — the header must be
    // ABSENT, not present-and-empty, per the edge contract this package's
    // README documents (objectui#5279).
    installLocalStorage({ setItem: true });
    ActiveOrganizationStorage.set('org-42');
    ActiveOrganizationStorage.clear();

    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);

    expect(calls[0].headers.has('X-Tenant-ID')).toBe(false);
  });

  it('does not resurrect a cleared org when localStorage works normally either', () => {
    const persisted = installLocalStorage();
    ActiveOrganizationStorage.set('org-42');
    expect(persisted.get(ACTIVE_ORG_STORAGE_KEY)).toBe('org-42');

    ActiveOrganizationStorage.clear();

    expect(persisted.has(ACTIVE_ORG_STORAGE_KEY)).toBe(false);
    expect(ActiveOrganizationStorage._memoryValue).toBeNull();
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  // ── (c) plain working localStorage: unchanged ──────────────────────────

  it('keeps the persisted value authoritative when localStorage works', () => {
    const persisted = installLocalStorage();

    ActiveOrganizationStorage.set('org-42');

    expect(persisted.get(ACTIVE_ORG_STORAGE_KEY)).toBe('org-42');
    expect(ActiveOrganizationStorage.get()).toBe('org-42');
  });

  it('prefers what localStorage holds over a stale memory value', () => {
    // The ordering the repair keeps: a non-null persisted read WINS. Another
    // tab (or a page that outlived a memory value) is the authority, so the
    // fallback must never override a value that is actually there.
    installLocalStorage();
    ActiveOrganizationStorage.set('org-stale');
    // Simulate the persisted layer moving on underneath this tab.
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, 'org-fresh');

    expect(ActiveOrganizationStorage._memoryValue).toBe('org-stale');
    expect(ActiveOrganizationStorage.get()).toBe('org-fresh');
  });

  it('reads null when nothing was ever set and localStorage works', () => {
    installLocalStorage();
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  // ── (d) the path the fallback was originally written for ───────────────

  it('still falls back to memory when the localStorage READ itself throws', () => {
    // The `catch` branch, which was the only way `_memoryValue` was ever
    // reachable before this fix. Pinned so the repair does not quietly cost
    // the case it already handled.
    installLocalStorage({ getItem: true, setItem: true });

    ActiveOrganizationStorage.set('org-42');

    expect(ActiveOrganizationStorage.get()).toBe('org-42');
  });
});
