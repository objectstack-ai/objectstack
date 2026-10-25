/**
 * objectui#5731 — `ActiveOrganizationStorage.clear()` must not swallow a failed
 * removal, because `get()` would then hand the cleared organization back.
 *
 * ## The asymmetry, re-derived on the post-#5664 code
 *
 * `clear()` nulls `_memoryValue` and then removes the persisted key. `get()`
 * prefers a NON-NULL persisted read and only falls through to `_memoryValue`
 * (the objectui#5703 read order). So the two halves of `clear()` are not
 * equally strong: nulling memory is unconditional and always sticks, while the
 * removal was best-effort and its failure was swallowed. A removal that does
 * not stick leaves the key readable, the read order prefers it, and sign-out —
 * one of `clear()`'s five callers — silently does not stick. The org goes back
 * on the wire as `X-Tenant-ID`.
 *
 * ## Why there is no browser repro here, on purpose
 *
 * The filer refused to claim a defect they had not reproduced, and triage
 * graded the card anyway with the reason recorded: *"Acceptance must NOT
 * require reproducing a browser state ... the deliverable is that the failure
 * stops being silent, plus a unit-level pin that a throwing `localStorage` no
 * longer leaves `get()` returning the cleared org."* A `localStorage` double is
 * the instrument, and it is the RIGHT instrument: the invariant under test is a
 * property of this module, not of any particular browser's storage quirk.
 *
 * Two shapes of failing removal are driven, because the fix verifies by
 * READ-BACK rather than by catching the throw and therefore covers both:
 *
 *  - `removeItem` THROWS — the shape the card describes.
 *  - `removeItem` is a SILENT NO-OP — a wrapped or proxied `localStorage`, the
 *    only candidate the filer could name. It never throws, so a throw-based
 *    guard would miss it entirely while leaving identical residue.
 *
 * ## What must NOT be weakened
 *
 * `activeOrgStorageFallback-5703.test.tsx` pins that `clear()` nulls
 * `_memoryValue` BEFORE touching storage and that a non-null persisted read
 * wins; `sessionUserChangePurge-5664.test.tsx` pins the session-user purge.
 * Suppression here is scoped to a key whose removal was MEASURED to have
 * failed, so neither of those properties moves: on every store that can
 * actually delete, the persisted read is still preferred and still authoritative.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedFetch } from '../createAuthenticatedFetch';
import { ActiveOrganizationStorage, SessionUserScope } from '../ActiveOrganizationStorage';
import { TokenStorage } from '../createAuthClient';

const SESSION_USER_ID = 'u_5731';
const SCOPED_ORG_KEY = `auth-active-organization-id:u:${SESSION_USER_ID}`;
const API_URL = 'http://localhost/api/v1/meta/object/account';

/**
 * A `localStorage` double whose `removeItem` fails in a chosen way, keeping the
 * backing Map visible so a case can assert what actually survived.
 *
 * `removal: 'throws'` is the card's shape; `'noop'` is the wrapped-storage
 * shape. `'works'` is the control — the same double with a removal that sticks,
 * so a green case cannot be explained by "the double is broken".
 */
function installLocalStorage(removal: 'works' | 'throws' | 'noop' = 'works') {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => {
      if (removal === 'throws') throw new Error('SecurityError: removeItem is not allowed');
      if (removal === 'noop') return;
      store.delete(k);
    },
  });
  return store;
}

/** Stub the global fetch and capture the Headers it was called with. */
function stubFetch() {
  const calls: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200 });
  }));
  return calls;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Resolve the scope from the in-memory pointer, so it survives every double
  // the cases install below. Without a session user `set()` writes to memory
  // only and every "reached the persisted layer" assertion would be vacuous.
  SessionUserScope._resetForTests();
  SessionUserScope.adopt(SESSION_USER_ID);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(TokenStorage, 'get').mockReturnValue(null);
});

afterEach(() => {
  // Order matters: unstub FIRST so this `clear()` runs against a working store
  // and releases any quarantine the case left on the scoped key, and reset the
  // scope LAST so that `clear()` still resolves the same key.
  vi.unstubAllGlobals();
  ActiveOrganizationStorage.clear();
  vi.restoreAllMocks();
  SessionUserScope._resetForTests();
});

// ---------------------------------------------------------------------------
// (a) the pin triage asked for: an outcome, not a "did it warn"
// ---------------------------------------------------------------------------

describe('a clear() whose removal fails no longer leaves the org readable (#5731)', () => {
  it('answers null after clear(), when removeItem THROWS', () => {
    const persisted = installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');
    // Preconditions, asserted rather than assumed: the value really reached
    // the persisted layer, and `get()` really was answering from it.
    expect(persisted.get(SCOPED_ORG_KEY)).toBe('org-42');
    expect(ActiveOrganizationStorage.get()).toBe('org-42');

    ActiveOrganizationStorage.clear();

    // The premise of the case: the removal did NOT stick. Without this the
    // case would pass against a store that quietly deleted the key, and would
    // be testing nothing.
    expect(persisted.get(SCOPED_ORG_KEY)).toBe('org-42');
    expect(localStorage.getItem(SCOPED_ORG_KEY)).toBe('org-42');

    // THE PIN. Measured as 'org-42' before the fix.
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('answers null after clear(), when removeItem is a SILENT NO-OP', () => {
    // The wrapped/proxied `localStorage` the filer named as the only candidate
    // they could point at. It never throws, so a fix that only caught the
    // throw would leave this one exactly as broken as before.
    const persisted = installLocalStorage('noop');
    ActiveOrganizationStorage.set('org-42');
    expect(ActiveOrganizationStorage.get()).toBe('org-42');

    ActiveOrganizationStorage.clear();

    expect(persisted.get(SCOPED_ORG_KEY)).toBe('org-42');
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });

  it('sends NO tenant header after a clear() whose removal failed', async () => {
    // The same statement one level out, where the consequence actually lands:
    // the header must be ABSENT, per the `X-Tenant-ID` edge contract this
    // package's README documents (objectui#5279).
    installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');
    ActiveOrganizationStorage.clear();

    const calls = stubFetch();
    await createAuthenticatedFetch()(API_URL);

    expect(calls[0].headers.has('X-Tenant-ID')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) the mechanism, pinned directly — the effect is one line from accidental
// ---------------------------------------------------------------------------

describe('the suppression mechanism, not just its effect (#5731)', () => {
  it('quarantines the key whose removal could not be verified', () => {
    installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');
    expect(ActiveOrganizationStorage._unremovedKeys.has(SCOPED_ORG_KEY)).toBe(false);

    ActiveOrganizationStorage.clear();

    // `get()` returning null is achievable by accident — by never reading
    // storage, by returning null unconditionally. This asserts WHICH mechanism
    // produced it, so a later refactor that keeps the outcome by some other
    // means has to say so here.
    expect(ActiveOrganizationStorage._unremovedKeys.has(SCOPED_ORG_KEY)).toBe(true);
  });

  it('RELEASES the quarantine as soon as a removal sticks', () => {
    // The quarantine describes the last attempt, not a permanent verdict on
    // the browser: a store that recovers gets its persisted read back.
    installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');
    ActiveOrganizationStorage.clear();
    expect(ActiveOrganizationStorage._unremovedKeys.has(SCOPED_ORG_KEY)).toBe(true);

    vi.unstubAllGlobals();
    const persisted = installLocalStorage('works');
    ActiveOrganizationStorage.clear();

    expect(ActiveOrganizationStorage._unremovedKeys.has(SCOPED_ORG_KEY)).toBe(false);
    // ... and the persisted layer is authoritative again for that key.
    persisted.set(SCOPED_ORG_KEY, 'org-fresh');
    expect(ActiveOrganizationStorage.get()).toBe('org-fresh');
  });

  it('does not go blind: a set() after a failed clear() is readable again', () => {
    // The case that dies if "suppress the stale read" is ever implemented as
    // "answer null forever". A quarantined key is answered from `_memoryValue`,
    // which is the copy this page-load can trust — so the NEW value comes back
    // whether or not the write reached a store that cannot delete.
    installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');
    ActiveOrganizationStorage.clear();
    expect(ActiveOrganizationStorage.get()).toBeNull();

    ActiveOrganizationStorage.set('org-99');

    expect(ActiveOrganizationStorage.get()).toBe('org-99');
  });
});

// ---------------------------------------------------------------------------
// (c) the failure stops being SILENT — the other half of the deliverable
// ---------------------------------------------------------------------------

describe('a failed clear() is reported (#5731)', () => {
  it('warns once, naming the key it could not remove', () => {
    installLocalStorage('throws');
    ActiveOrganizationStorage.set('org-42');

    ActiveOrganizationStorage.clear();

    // Exactly once: `clear()` also removes the retired bare key, whose removal
    // fails on this same double. That one is deliberately NOT reported —
    // `scopedActiveOrgKey()` never returns the bare spelling, so nothing reads
    // it and its survival cannot resurrect an org through `get()`. A report per
    // failed removeItem would be two lines of noise for one real failure.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(SCOPED_ORG_KEY);
  });

  it('stays quiet when the removal sticks', () => {
    const persisted = installLocalStorage('works');
    ActiveOrganizationStorage.set('org-42');

    ActiveOrganizationStorage.clear();

    expect(persisted.has(SCOPED_ORG_KEY)).toBe(false);
    expect(ActiveOrganizationStorage.get()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet when there is no storage at all', () => {
    // SSR, and the partitioned-iframe browser where every operation throws.
    // Nothing is readable in either, so nothing can be resurrected and both
    // were already safe. A report that fired here would be crying wolf on the
    // two states the card explicitly ruled OUT as the defect.
    vi.stubGlobal('localStorage', undefined);

    expect(() => ActiveOrganizationStorage.clear()).not.toThrow();

    expect(warn).not.toHaveBeenCalled();
    expect(ActiveOrganizationStorage._unremovedKeys.has(SCOPED_ORG_KEY)).toBe(false);
    expect(ActiveOrganizationStorage.get()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) the neighbouring swallow that is DELIBERATE and must survive
// ---------------------------------------------------------------------------

describe('set()’s swallowed write failure is left alone (#5703 design)', () => {
  it('still keeps the value in memory when localStorage rejects writes', () => {
    // `set()` swallows a failing `setItem` too, and that one is correct: the
    // memory copy upholds the postcondition ("what was set reads back"), and
    // `get()`'s fallback is built to consult it. `clear()`'s swallow was the
    // accidental one because nulling memory does NOT uphold ITS postcondition
    // — the surviving persisted value SHADOWS it. That is the test for telling
    // the two apart, and this case pins that the deliberate one is untouched.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: (k: string) => { store.delete(k); },
    });

    ActiveOrganizationStorage.set('org-42');

    expect(store.has(SCOPED_ORG_KEY)).toBe(false);
    expect(ActiveOrganizationStorage.get()).toBe('org-42');
    expect(warn).not.toHaveBeenCalled();
  });
});
