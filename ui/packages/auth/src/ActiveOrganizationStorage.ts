/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Per-user client state: WHOSE state this browser currently holds
 * ({@link SessionUserScope}), and the active organization id scoped to that
 * user ({@link ActiveOrganizationStorage}).
 *
 * # objectui#5664 — why this file exists
 *
 * `auth-active-organization-id` was a single un-namespaced `localStorage` key,
 * while its siblings in `@object-ui/app-shell` were already user-scoped
 * (`objectui-recent-items:u:<id>`, `objectui-favorites:u:<id>`,
 * `flow-palette-recents:u:<id>`). On a browser handed from one account to
 * another the new session read the PREVIOUS user's organization id: the header
 * workspace chip rendered the previous user's workspace, and — the consequence
 * that is not cosmetic — the polluted org context suppressed
 * `RequireOrganization`'s routing into the guided "Create your workspace"
 * first-run flow. A brand-new user on a shared browser silently never got the
 * new-user flow.
 *
 * The server side was verified clean while the card was written: with the
 * stale id, `get-full-organization` and `set-active` both answer
 * `403 USER_IS_NOT_A_MEMBER` and `sys_environment` lists zero rows. Nothing
 * about row visibility rode on this; the damage was entirely in what the
 * client believed about itself.
 *
 * # The three parts, and which one closes the class
 *
 *  1. The key is namespaced per user (below).
 *  2. `set()` can no longer write the un-namespaced key at all — see
 *     {@link scopedActiveOrgKey}. Namespacing that keeps a bare-key fallback
 *     re-opens the defect the first time a write happens before the user id is
 *     known.
 *  3. {@link SessionUserScope.adopt} drops the previous user's UI state
 *     WHOLESALE when the session user changes. That is the load-bearing part:
 *     (1) and (2) fix one key, while (3) is what keeps the NEXT un-namespaced
 *     key — one nobody has written yet — from re-opening the same class. It is
 *     an allowlist sweep for exactly that reason: a denylist of the keys we
 *     know about today would not cover a key added tomorrow.
 *
 * # Resolving the scope with no `await`
 *
 * The user id is NOT known from React state at the moment this storage is
 * first read. `createAuthenticatedFetch` reads it on every request including
 * the very first `get-session`, and `MetadataProvider` reads it synchronously
 * at mount to scope its seed cache — both before `AuthProvider`'s async
 * session chain has resolved anything. So the scope is resolved from
 * {@link SESSION_USER_STORAGE_KEY}, an ordinary `localStorage` pointer the
 * PREVIOUS page-load wrote: one synchronous read, no await, and correct for
 * every boot of a browser that has held a session before.
 *
 * The window where that pointer is stale — a boot whose cookie session belongs
 * to someone other than the pointer — is bounded by `adopt()` firing as soon
 * as `get-session` answers, and it is the same window the `X-Tenant-ID` edge
 * contract already documents as "the header may be absent or not yet
 * authoritative" (objectui#5279, this package's README). Requests that leave
 * inside it are scoped by the SESSION server-side, not by the header.
 */

/**
 * Pointer to the user whose client state this browser holds. Deliberately NOT
 * user-scoped itself — it is the thing that makes user scoping resolvable, and
 * it is overwritten rather than accumulated, so there is never more than one.
 */
const SESSION_USER_STORAGE_KEY = 'auth-session-user-id';

/** Base name the per-user active-org key is derived from. */
const ACTIVE_ORG_BASE_KEY = 'auth-active-organization-id';

/**
 * The pre-#5664 spelling — the same string, un-suffixed. Every browser that
 * has run an older build still has a value under it, and that value is
 * UNATTRIBUTABLE: nothing recorded whose org id it is. It is therefore deleted
 * rather than migrated. Migrating it is precisely the defect (on a handed-over
 * browser it would hand the previous user's org id to the new one), and
 * keeping it would leave a live bare key for a future reader to find.
 *
 * Dropping it costs a signed-in user nothing durable: `AuthProvider`'s
 * `refreshOrganizations` asks the SERVER for the active organization whenever
 * the list is non-empty and no active org is held, including the ADR-0081
 * single-membership repair. The server is the authority for this value; the
 * client copy is a routing-header cache. One boot re-supplies it.
 */
const LEGACY_ACTIVE_ORG_KEY = ACTIVE_ORG_BASE_KEY;

/**
 * Keys that survive a change of session user, because they describe the DEVICE
 * or the INCOMING session rather than the outgoing user's state.
 *
 * `auth-session-token` is spelled out rather than imported from
 * `createAuthClient.ts` (where it is a module-private constant). The two ends
 * are held together by BEHAVIOUR instead of by a shared symbol — the pin in
 * `__tests__/sessionUserChangePurge-5664.test.tsx` fills it through the real
 * `TokenStorage` and reads it back through `TokenStorage` after a purge, so a
 * spelling that drifts on either side fails there rather than silently signing
 * the incoming user out.
 *
 * `vite-ui-theme` is `@object-ui/app-shell`'s `ThemeProvider` default. An app
 * that passes a custom `storageKey` loses its theme once on a user change and
 * re-picks it on the next toggle — cosmetic and self-healing, which is the
 * right side of an allowlist to err on.
 */
const DEVICE_SCOPED_KEYS: ReadonlySet<string> = new Set([
  'auth-session-token',
  SESSION_USER_STORAGE_KEY,
  'vite-ui-theme',
]);

/**
 * `localStorage` / `sessionStorage`, or `undefined` where they are absent or
 * blocked. Accessing the global itself can throw (partitioned iframes, some
 * privacy modes), so the guard has to be a try/catch and not a `typeof` test
 * alone.
 */
function safeStore(kind: 'local' | 'session'): Storage | undefined {
  try {
    if (kind === 'local') {
      return typeof localStorage !== 'undefined' ? localStorage : undefined;
    }
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

function readPersisted(key: string): string | null {
  try {
    return safeStore('local')?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writePersisted(key: string, value: string): void {
  try {
    safeStore('local')?.setItem(key, value);
  } catch {
    /* SSR / quota / private browsing — the caller keeps a memory copy */
  }
}

/**
 * Remove `key`, and report whether it is gone — `true` when a read-back can no
 * longer produce a value for it.
 *
 * ## Why the verdict is a READ-BACK and not "did `removeItem` throw"
 * (objectui#5731)
 *
 * `get()` can only answer with what `getItem` hands back, so "did this removal
 * stick" is exactly the question "is the key still readable". Deciding it from
 * the throw instead would be both too narrow and too wide:
 *
 *  - TOO NARROW. A wrapped or proxied `localStorage` — an extension, a
 *    polyfill — whose `removeItem` is a silent no-op never throws, and leaves
 *    exactly the residue this guards against. objectui#5731 named the throwing
 *    variant; the no-op variant is the same defect, and a read-back catches
 *    both without having to enumerate them.
 *  - TOO WIDE. In SSR, and in a partitioned iframe where every operation
 *    throws, there is nothing readable to resurrect and the paths are already
 *    safe. A throw-based verdict would report those two states as failures,
 *    which is how a report earns a reputation for crying wolf.
 *
 * The throw is therefore still swallowed here: it is not the verdict.
 */
function removePersisted(key: string): boolean {
  try {
    safeStore('local')?.removeItem(key);
  } catch {
    /* not the verdict — the read-back below is */
  }
  return readPersisted(key) === null;
}

/**
 * Delete every entry in `store` that is not device-scoped.
 *
 * Snapshot the keys first (`Object.keys`) — removing entries during a live
 * index walk shifts the ones behind it and skips half of them. Same idiom as
 * `AuthProvider`'s sign-out purge loop.
 *
 * ## The `try` guards the SNAPSHOT, not the walk (objectui#5763)
 *
 * `Object.keys(store)` can itself throw — partitioned iframes, some privacy
 * modes — and that is the reason a guard exists here at all, so it stays.
 * What it must NOT do is wrap the loop: a `removeItem` that throws on key `n`
 * would abort the walk, leaving keys `n+1..end` unswept, with the failure
 * swallowed so the caller believes the purge completed. This is an ALLOWLIST
 * sweep (see the module doc, part 3) precisely so the next un-namespaced key
 * cannot re-open the cross-user pollution class — a partial sweep is a
 * partial allowlist. So each `removeItem` gets its own `try`: one
 * uncooperative key costs exactly that key.
 *
 * ## Reported, not quarantined — unlike {@link ActiveOrganizationStorage.clear}
 *
 * `clear()` (objectui#5731) judges a removal by READ-BACK and quarantines a
 * key that fails, because it owns every future read of that one key through
 * {@link ActiveOrganizationStorage.get} — the quarantine is what keeps a
 * failed `clear()` from handing the value straight back. `sweepStore` walks
 * keys it does not own reads for (another package's recents cache, a
 * metadata seed) — there is no `get()` here to guard, so there is nothing to
 * quarantine, and adding a read-back verdict for keys this function does not
 * otherwise touch would be exactly the "general storage-error-handling
 * refactor" the card scopes this fix away from. What IS mirrored is the
 * reporting channel: a key whose `removeItem` throws is named in a
 * `console.warn`, same as `clear()`, so a partial sweep is discoverable
 * instead of silent — the caller (`SessionUserScope.adopt`, on the sign-in
 * path) still cannot act on it and must not throw either.
 */
function sweepStore(store: Storage | undefined): void {
  if (!store) return;
  let keys: string[];
  try {
    keys = Object.keys(store);
  } catch {
    return; /* storage unavailable */
  }
  const unswept: string[] = [];
  for (const key of keys) {
    if (DEVICE_SCOPED_KEYS.has(key)) continue;
    try {
      store.removeItem(key);
    } catch {
      unswept.push(key);
    }
  }
  if (unswept.length > 0) {
    console.warn(
      `[purgePreviousUserClientState] could not remove ${unswept.length} key(s) from storage: ` +
        `${unswept.join(', ')}. The previous user's state may still be readable under these keys.`,
    );
  }
}

/**
 * Drop the outgoing user's client state wholesale — part 3 of the fix.
 *
 * Order is load-bearing and mirrors `clear()`'s: the in-memory active org goes
 * FIRST, because `ActiveOrganizationStorage.get()` falls through to
 * `_memoryValue` whenever the persisted read is null, which is exactly the
 * state this function leaves behind (objectui#5703). Sweeping storage first
 * would leave the outgoing user's org id live in memory for the rest of the
 * page-load — the SPA sign-out-then-sign-in path never reloads.
 *
 * Both stores are swept. `sessionStorage` is per-TAB, not per-session, so the
 * previous user's `objectui:metadata:*` seed (their PERMISSION-FILTERED app
 * list) and their `objectui-ctx-*` scope picks survive into whoever signs in
 * next in that tab unless something removes them.
 */
export function purgePreviousUserClientState(): void {
  ActiveOrganizationStorage.clear();
  sweepStore(safeStore('local'));
  sweepStore(safeStore('session'));
}

/**
 * Listeners told that {@link SessionUserScope.adopt} dropped a previous
 * owner's state (objectui#10193).
 */
const ownerChangeListeners = new Set<() => void>();

/**
 * How many times THIS page-load has dropped a previous owner's state.
 *
 * In memory on purpose, and never persisted: the question it answers is "has a
 * purge happened since this code started running", and a storage copy would
 * answer it for a page-load that no longer exists. ⛔ It is not a storage key,
 * and the ruling on objectui#10193 refuses one.
 */
let ownerChangeCount = 0;

/**
 * The number of owner changes {@link SessionUserScope.adopt} has performed in
 * this page-load — `0` until a DIFFERENT user than the one the browser
 * previously held is adopted.
 *
 * ## Why a count and not only an event (objectui#10193)
 *
 * The purge sweeps the previous owner's STORAGE, but state that was already
 * derived from that storage before the purge — the UI language the boot
 * resolved out of the previous owner's language slots, above all — lives in
 * memory and is untouched by it. Whoever owns such state has to re-derive it,
 * and the component that does may mount AFTER the purge happened (the shell
 * mounts behind the session gate, the purge fires as the session resolves). A
 * bare event would be missed by it; a count lets a late reader compare against
 * what it has already handled. Shaped for React's `useSyncExternalStore`
 * together with {@link subscribeSessionOwnerChange}.
 */
export function getSessionOwnerChangeCount(): number {
  return ownerChangeCount;
}

/**
 * Be told each time {@link SessionUserScope.adopt} drops a previous owner's
 * state. Returns the unsubscribe function. A listener that throws is reported
 * and skipped, never allowed to break the sign-in path that called `adopt`.
 */
export function subscribeSessionOwnerChange(listener: () => void): () => void {
  ownerChangeListeners.add(listener);
  return () => {
    ownerChangeListeners.delete(listener);
  };
}

function notifyOwnerChange(): void {
  ownerChangeCount += 1;
  for (const listener of [...ownerChangeListeners]) {
    try {
      listener();
    } catch (err) {
      console.warn('[SessionUserScope] an owner-change listener threw:', err);
    }
  }
}

/**
 * Which user's client state this browser holds, and the transition that drops
 * the previous user's state.
 */
export const SessionUserScope = {
  /**
   * Memory copy of the pointer. Read FIRST by {@link current}: once this
   * page-load has adopted a user, that answer is authoritative for this tab
   * even if another tab has since written a different id, and it is the only
   * copy in a browser whose `localStorage` rejects writes.
   */
  _userId: null as string | null,

  /** The user whose state this browser holds, or `null` if it has never held one. */
  current(): string | null {
    if (this._userId !== null) return this._userId;
    return readPersisted(SESSION_USER_STORAGE_KEY);
  },

  /**
   * Record `userId` as the owner of this browser's client state, dropping the
   * previous owner's state wholesale when it changes.
   *
   * Returns `true` when it dropped a previous owner's state, `false`
   * otherwise (same user, first-ever owner, empty id). A drop is also reported
   * to {@link subscribeSessionOwnerChange} listeners and counted by
   * {@link getSessionOwnerChangeCount} (objectui#10193): the purge clears
   * storage, and anything already derived from that storage in memory is the
   * listener's to re-derive.
   *
   * Idempotent: re-adopting the same user purges nothing. Called from
   * `AuthProvider` for real sessions only — the synthetic `preview-user` /
   * `guest` identities never reach it, so a preview mount cannot purge a real
   * user's state.
   *
   * Because the decision reads the PERSISTED pointer, anything that deletes
   * that pointer without deleting the state it describes would silently retire
   * this invariant. `apps/console/src/lib/auth-preflight.ts` is the one place
   * that sweeps auth keys before render, and it says so in its own comment:
   * it removes every active-org spelling and leaves `auth-session-user-id`
   * alone on purpose.
   */
  adopt(userId: string): boolean {
    if (!userId) return false;
    // Already this page-load's owner. Short-circuits before the storage read
    // below, which matters in a browser that REJECTS WRITES: there the pointer
    // write further down silently fails, so every later call would re-read a
    // stale persisted owner and purge again.
    if (this._userId === userId) return false;
    // WHOSE RESIDUE IS IN THIS STORE — read from storage, deliberately not
    // from {@link current}. The two questions are different and take different
    // authorities. `current()` answers "which key do I use right now", and
    // memory is this tab's truth for that. This answers "is there another
    // user's state PERSISTED here", and the persisted pointer is the only
    // witness to that: a browser that never persisted anything has no residue
    // to drop, and purging on the strength of an in-memory id would delete
    // state that was written for the arriving user.
    const persistedPrevious = readPersisted(SESSION_USER_STORAGE_KEY);
    const ownerChanged = persistedPrevious !== null && persistedPrevious !== userId;
    if (ownerChanged) {
      purgePreviousUserClientState();
    }
    this._userId = userId;
    writePersisted(SESSION_USER_STORAGE_KEY, userId);
    // Unattributable legacy state, cleaned up on any adopt rather than only on
    // a change — see LEGACY_ACTIVE_ORG_KEY.
    removePersisted(LEGACY_ACTIVE_ORG_KEY);
    // Last, so a listener that reads `current()` or the store sees the
    // arriving owner and the swept storage, never a half-adopted state.
    if (ownerChanged) notifyOwnerChange();
    return ownerChanged;
  },

  /**
   * Forget the in-memory pointer. Test seam only — production has no reason to
   * un-know who is signed in, and sign-out deliberately KEEPS the persisted
   * pointer so that the next sign-in by a DIFFERENT user still sees a previous
   * owner to purge.
   */
  _resetForTests(): void {
    this._userId = null;
  },
};

/**
 * The `localStorage` key holding the active org id for the current user, or
 * `null` when no user is known yet.
 *
 * `null` — not the bare base key — is the whole point. `@object-ui/app-shell`'s
 * `scopedKey(base, userId)` falls back to the un-namespaced key for
 * "no user id yet", and that is correct THERE: its callers persist recents and
 * favourites, where a signed-out bucket leaking is cosmetic. Here the bare key
 * IS the defect, so "no user id yet" means "there is no key to persist under"
 * and the value lives in memory for this page-load only. The convention for
 * the scoped half is copied exactly (`${base}:u:${userId}`) — the symbol
 * cannot travel, because `@object-ui/app-shell` depends on `@object-ui/auth`
 * and not the other way round.
 */
function scopedActiveOrgKey(): string | null {
  const userId = SessionUserScope.current();
  return userId ? `${ACTIVE_ORG_BASE_KEY}:u:${userId}` : null;
}

/**
 * Get/set the active organization id that {@link createAuthenticatedFetch}
 * stamps as `X-Tenant-ID`.
 *
 * `AuthProvider` is the only writer, at four moments: `refreshOrganizations`
 * sets it once the `getSession` -> `listOrganizations` ->
 * `getActiveOrganization` chain resolves (including the ADR-0081
 * single-membership repair), `switchOrganization` sets or clears it,
 * `deleteOrganization` / `leaveOrganization` clear it when the active org is
 * the one going away, and sign-out clears it.
 *
 * Because the first of those is asynchronous, this reads EMPTY for the first
 * stretch of a boot, and every request that leaves in that window carries no
 * tenant header at all. That window is a documented part of the header's
 * contract, not an accident to paper over — see the "unstamped-first-request
 * gap" section of this package's README (objectui#5279).
 */
export const ActiveOrganizationStorage = {
  _memoryValue: null as string | null,

  /**
   * Keys whose removal by {@link clear} did not stick — the value was still
   * readable afterwards (objectui#5731).
   *
   * {@link get} refuses to answer from the persisted layer for a key in here,
   * which is the mechanism that keeps a cleared organization cleared. Held in
   * memory, so it lasts exactly one page-load: a browser that starts fresh
   * re-measures rather than inheriting a verdict.
   */
  _unremovedKeys: new Set<string>(),

  /**
   * The active org id for the CURRENT user, or `null`.
   *
   * READ ORDER — a non-null `localStorage` read wins; anything else falls
   * through to `_memoryValue`. Returning the `localStorage` read
   * UNCONDITIONALLY (what this did before objectui#5703) left the fallback
   * reachable only when the read THREW, and there is a real browser state
   * where the read does not throw and the fallback is still the only copy:
   * `localStorage` present and readable but REJECTING WRITES — Safari private
   * browsing, and any quota-exhausted origin, where `setItem` throws
   * `QuotaExceededError`. `set()` swallows that failure into `_memoryValue`
   * (correctly — the fallback is right there), and `get()` then never
   * consulted it: the value was stored and could not be read back, so
   * `X-Tenant-ID` went unstamped for the whole session, not just the early
   * requests.
   *
   * WHY FALLING BACK ON `null` DOES NOT RESURRECT A CLEARED ORG. After
   * `clear()` the `localStorage` read is null by construction, so this
   * fallback fires — and it must answer `null`, because sign-out is one of
   * `clear()`'s callers. It does, because `clear()` nulls `_memoryValue` too.
   * That property is what makes this read order safe rather than an
   * incidental detail of `clear()`'s body, so it is pinned by test
   * (`__tests__/activeOrgStorageFallback-5703.test.tsx`) instead of being
   * re-derived by whoever edits `clear()` next.
   *
   * The same reasoning is why a change of session user purges through
   * {@link purgePreviousUserClientState} rather than by removing keys: the
   * outgoing user's id in `_memoryValue` would otherwise outlive their
   * persisted key on the SPA sign-out-then-sign-in path (objectui#5664).
   */
  get(): string | null {
    const key = scopedActiveOrgKey();
    // A key {@link clear} could not remove is QUARANTINED for the rest of this
    // page-load, and skipping the persisted branch is what stops the cleared
    // org from being handed straight back (objectui#5731). `_memoryValue` then
    // answers, and for that key it is the only copy this page-load can trust:
    // `clear()` nulled it, and a later `set()` refills it with the value that
    // write was meant to persist — so this stays correct in both directions
    // with no release step of its own. What it gives up is cross-tab freshness
    // for one key, in a browser that has just demonstrated it cannot delete
    // from storage. An unstamped `X-Tenant-ID` is a documented state of the
    // edge contract (see `createAuthenticatedFetch`); a re-stamped signed-out
    // org is not.
    if (key && !this._unremovedKeys.has(key)) {
      try {
        const persisted = safeStore('local')?.getItem(key) ?? null;
        if (persisted !== null) return persisted;
      } catch { /* SSR / test */ }
    }
    return this._memoryValue;
  },

  /**
   * With no session user known this writes to memory ONLY. That is not a
   * degraded path to apologise for — it is the fix: a persisted write with no
   * owner is the un-namespaced key this card retired.
   */
  set(orgId: string): void {
    this._memoryValue = orgId;
    const key = scopedActiveOrgKey();
    if (!key) return;
    writePersisted(key, orgId);
  },

  /**
   * Drop the active organization, from memory and from the persisted key.
   *
   * POSTCONDITION: {@link get} answers `null` afterwards. Sign-out is one of
   * the callers, so that is a security-relevant guarantee rather than a
   * convenience — and before objectui#5731 it was not one, because a
   * `removeItem` that failed was swallowed and the surviving key won `get()`'s
   * read order.
   *
   * ## Why a failed removal is neither thrown nor returned (objectui#5731)
   *
   * Every caller arrives here AFTER the transition it is following up on has
   * already happened, and not one of them can act on a storage failure:
   *
   *  - `AuthProvider`'s `purgeSignedOutClientCaches` — the session is already
   *    ended. Sign-out cannot be refused because a key would not delete.
   *  - `switchOrganization` — the server already switched or cleared the
   *    active org; a throw would report a successful switch as a failure and
   *    route the caller into its error branch.
   *  - `deleteOrganization` / `leaveOrganization` — the org is already deleted
   *    or already left.
   *  - {@link purgePreviousUserClientState}, via {@link SessionUserScope.adopt}
   *    — runs on the SIGN-IN path inside an `AuthProvider` effect, where a
   *    throw breaks the boot of the ARRIVING user.
   *
   * A `boolean` return only moves the problem one step: all five call sites
   * would have nothing to write in the failure branch, and a return value that
   * every caller ignores reads as handled when it is not. So the invariant is
   * restored HERE, where it can be, and the failure is reported to the console,
   * where a human can find it.
   *
   * The third shape considered and rejected was re-writing the key with an
   * empty value. That relocates the fix into every consumer's truthiness test
   * (`createAuthenticatedFetch` does `if (activeOrgId)`), which is the lenient
   * consumer AGENTS.md #0.1 forbids, and it leaves a signed-out browser holding
   * a live key.
   */
  clear(): void {
    // Nulling the fallback is SECURITY-RELEVANT, not bookkeeping: `get()`
    // falls through to `_memoryValue` whenever the `localStorage` read comes
    // back null, which is exactly the state this method leaves behind. Drop
    // this line and sign-out's clear stops sticking — the removed key reads
    // null, the fallback fires, and the cleared org goes back on the wire as
    // `X-Tenant-ID`. Pinned by `__tests__/activeOrgStorageFallback-5703.test.tsx`.
    this._memoryValue = null;
    const key = scopedActiveOrgKey();
    if (key) {
      if (removePersisted(key)) {
        // Confirmed gone. Recomputed on every call rather than left alone, so
        // a key quarantined by an earlier failure is RELEASED the moment a
        // removal sticks: the quarantine describes the last attempt, not a
        // permanent verdict on the browser.
        this._unremovedKeys.delete(key);
      } else {
        // The removal did not stick and the value is still readable, so
        // `get()` would hand the signed-out org straight back. Two things
        // happen here and they are deliberately separable: the stale read is
        // SUPPRESSED, which restores the postcondition without any caller's
        // help, and the failure is REPORTED, because "sign-out did not fully
        // stick" is something whoever is reading a console has to be able to
        // find. Neither half substitutes for the other — a report alone leaves
        // the org on the wire, and suppression alone is the same silence this
        // card was filed about, just with a better outcome.
        this._unremovedKeys.add(key);
        console.warn(
          `[ActiveOrganizationStorage] clear() could not remove "${key}" from localStorage — ` +
            'it is still readable. Reads for it are answered from memory for the rest of this ' +
            'page-load, so the cleared organization is not re-stamped as X-Tenant-ID.',
        );
      }
    }
    // Also drop the pre-#5664 bare key, so a `clear()` on a browser upgrading
    // from an older build leaves nothing behind under the retired spelling.
    // Its verdict is deliberately ignored: `scopedActiveOrgKey()` never returns
    // the bare spelling, so nothing reads it and a survival here cannot
    // resurrect an org through `get()`.
    removePersisted(LEGACY_ACTIVE_ORG_KEY);
  },
};
