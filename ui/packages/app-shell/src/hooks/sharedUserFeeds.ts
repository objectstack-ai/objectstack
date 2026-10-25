/**
 * sharedUserFeeds — ONE fetch per user-scoped feed, however many consumers mount
 *
 * Two console surfaces read the same two user-scoped streams:
 *
 *   | feed                     | producer                                   | consumers                          |
 *   | ------------------------ | ------------------------------------------ | ---------------------------------- |
 *   | pending approvals count  | `GET /api/v1/approvals/requests?status=…`, | AppHeader bell badge + Approvals   |
 *   | (+ the first rows)       | one page of `APPROVALS_PAGE_ROWS` + `total`| tab; Home's To-do card             |
 *   | recent activity          | `find('sys_activity', top 20, desc)`,      | AppHeader bell Activity tab;       |
 *   |                          | asked only with the caller's read grant,   | Home's activity card               |
 *   |                          | filtered to the app object roster          |                                    |
 *   | inbox messages           | `find('sys_inbox_message', top 20, desc)`  | AppHeader bell Notifications tab   |
 *   |                          | ⋈ `find('sys_notification_receipt')`       | + badge; Home's action centre      |
 *
 * Both consumers live in this package and, on `/home`, mount in the same tree
 * (`HomeLayout` renders the bell, `HomePage` renders the cards) — so each of
 * them owning its own effect meant the same read went out twice per page. That
 * is exactly the trade-off #4197 refused to accept as the price of un-gating
 * the bell: the fix is one fetch feeding both, not two fetches agreeing.
 *
 * The inbox feed joined them last (#4225). #4197 had left it out because the
 * two consumers asked genuinely different questions of the same object — and
 * #4316 measured what that cost: `useHomeInbox` never read the receipts, so
 * Home's "Needs your attention" counted messages the user had already read
 * while the bell two hundred pixels above correctly showed zero. Two panels,
 * one page load, disagreeing about the same rows. Deriving both from ONE feed
 * is what makes that disagreement structurally impossible rather than merely
 * fixed: there is no second read left to drift.
 *
 * Neither feed is app-scoped, so neither is gated on the header's `isApp`
 * flag. `isApp` still means something — it hides genuinely app-shell chrome
 * (presence avatars, the connection dot) — but the approvals inbox and the
 * activity feed are scoped to the *user* and the *tenant*, not to whichever
 * app happens to be in the URL. Gating them there is what left the bell's
 * Approvals and Activity tabs permanently empty on Home / Organizations / the
 * full-page AI screen, and what made the badge (`unread + approvals`) read a
 * different number on Home than inside an app for the same user.
 *
 * Why a module-scoped store rather than a context provider: both consumers are
 * already inside `@object-ui/app-shell`, so sharing needs no new dependency
 * edge — and a store needs no provider mounted above every call site, so the
 * one-fetch guarantee holds no matter where a consumer is rendered (the bell
 * is mounted by four different layouts). The dedupe is structural: consumers
 * cannot opt out of it by mounting somewhere unexpected.
 *
 * ## A forgotten tab goes quiet (objectui#12439)
 *
 * A backgrounded tab polls at `HIDDEN_POLL_MS`, but only for a while: once it
 * has been hidden continuously for `HIDDEN_POLL_STOP_MS` (10 minutes), every
 * feed here stops arming its timer, and a tick that comes due after that point
 * sends nothing. The reason is the backend, not the browser: wherever the
 * server scales to zero, a poll inside its idle window keeps it awake, and a
 * 60 s poll is always inside it — one tab left open on a console page kept two
 * staging containers running around the clock. Coming back to the tab is
 * unchanged: `onVisibilityChange` refetches each feed once, immediately, and
 * the foreground cadence resumes from there.
 *
 * The clock is not this module's: it lives in `hiddenTabPollStop.ts`, which
 * every timer poller that reads the tab's visibility consults, so there is one
 * definition of "hidden for too long" rather than one per poller. The cost is
 * the inbox's desktop notification — see `useInboxArrivalNotifier`.
 *
 * ## Nothing here is read before the console's first paint (objectui#12980)
 *
 * None of these feeds is what a page draws first: the badge is chrome, and the
 * popover tabs open on a click. They used to start in the chrome's mount
 * effects, beside the page's own reads, on every console open. Each feed now
 * attaches only once {@link useAfterFirstPaint} answers `true` — the boot splash
 * is gone and a frame has painted — and the Activity feed, which no badge
 * reads, only once its consumer asks for it (the bell's open intent). Until
 * then a consumer is handed the `idle` snapshot, the honest "not asked yet":
 * the badge draws nothing, exactly as it does while a read is in flight, and
 * never a `0` it did not read.
 *
 * @module
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import { errorCodeIs } from '@object-ui/types';
// The refused-read verdict the record activity panel reads (objectui#11195),
// so a refused `sys_activity` read means the same thing on Home (objectui#12843).
import { isRefusedFeedRead } from '@object-ui/plugin-detail';
// Re-exported from `@object-ui/react` — import it through the provider module
// so a consumer that stubs the provider stubs this too.
import { useAdapter } from '../providers/AdapterProvider.js';
import type { NavigationItem } from '@object-ui/types';
// Through the provider module, as `useNavMemberGates` reads it: one app list.
import { useMetadata } from '../providers/MetadataProvider.js';
import { metadataTypeSettled, useObjectPresence } from './useObjectPresence.js';
import { navEntriesShownToMember, useNavMemberGates, type NavMemberGates } from './useNavMemberGates.js';
import { filterActiveApps } from '../utils/appRoute.js';
import { bearerAuthHeaders } from '../utils/authToken.js';
import { __resetHiddenTabClock, isPollingSuspended } from './hiddenTabPollStop.js';
import type { ActivityItem } from '../layout/ActivityFeed.js';
import { activityRowToActivityItem } from '../layout/activityItemType.js';
import type { InboxNotification } from '../layout/inboxGrouping.js';

/** Approvals poll cadence — the bell's original 30s (M11.C15). */
const APPROVALS_POLL_MS = 30_000;
/** Inbox poll cadence — the bell's original 10s (ADR-0030 L5, #4110). */
const INBOX_POLL_MS = 10_000;
/**
 * Cadence while the tab is backgrounded. The bell's own poller carried this
 * (60s hidden against 10s foregrounded) plus an immediate refetch when the
 * user comes back, and consolidating the poll into the store had to bring
 * both along — a shared feed that polled a hidden tab at its foreground rate
 * would have been a regression riding in on a de-duplication fix (#4225).
 *
 * It holds only for the first `HIDDEN_POLL_STOP_MS` of a continuous hide
 * (`hiddenTabPollStop.ts`, objectui#12439): after that the feeds stop arming
 * their timers altogether, so a forgotten tab stops keeping a scale-to-zero
 * backend awake. The immediate refetch on return is what makes that cheap.
 */
const HIDDEN_POLL_MS = 60_000;
/**
 * Ceiling for the failure backoff, likewise lifted from the bell's poller and
 * now applied to every feed: a feed whose read keeps failing must not keep
 * hammering the server at its foreground cadence.
 */
const MAX_BACKOFF_MS = 120_000;
/**
 * How long a fetched value stays authoritative. It is the dedupe window: a
 * second consumer mounting inside it is served the cached value instead of
 * issuing its own read, which covers the common case where the header mounts
 * a beat before the page body does.
 */
const FRESH_MS = 30_000;
/**
 * How many times a RETIRED feed re-probes before it is retired for good, and
 * how long it waits between those probes (#4289).
 *
 * `markUnavailable()` used to be a one-way door: `unavailable` was set, and
 * `refresh`, `schedule` and `onVisibilityChange` all returned early on it, so
 * only a key change (a different user or adapter) or a page reload could revive
 * the feed. That is sound for the case it was written for — a deployment
 * without the approvals plugin / `sys_activity` / the messaging pipeline will
 * answer 404 forever, and re-asking is pure noise — but `isMissingResource` is
 * STATUS-shaped, not code-shaped: `httpStatus === 404` alone qualifies, and the
 * ObjectStack client stamps `httpStatus` from `res.status` on every non-ok
 * response before it looks at the body. So a 404 from anywhere in the transport
 * (an edge router mid-deploy, a host's catch-all before the API is mounted)
 * enters this door wearing the same clothes as the registry's considered
 * `OBJECT_NOT_FOUND` — and used to cost the page its inbox until reload, on
 * BOTH surfaces at once now that the bell and Home read one feed (#4225).
 *
 * A bounded re-probe separates them without giving either the wrong answer: the
 * lost race is recovered within a probe cadence, and the genuinely-absent
 * object costs `UNAVAILABLE_PROBE_LIMIT` extra reads over the page's whole
 * lifetime and is then silent — against the ~360/hour an un-retired 10s poll
 * would have issued. Nothing about the retired STATE changes: the status stays
 * `ready`, the value stays empty, and the affirmative empty copy stays earned
 * (#4315). Exported because the pins assert the ceiling, and a ceiling whose
 * number lives only in the test is not the same ceiling as the code's.
 */
export const UNAVAILABLE_PROBE_LIMIT = 3;
/** @see UNAVAILABLE_PROBE_LIMIT */
export const UNAVAILABLE_PROBE_MS = 60_000;

/**
 * Stable empty value — `useSyncExternalStore` re-renders in a loop if
 * `getSnapshot` hands back a fresh reference each call, so the "nothing yet"
 * value must be one shared array (cf. `EMPTY_PRESENCE_USERS` in AppHeader).
 */
const NO_ACTIVITIES: ActivityItem[] = [];
/** The same stable-empty rule, for the inbox feed. */
const NO_MESSAGES: InboxNotification[] = [];

/**
 * Whether a feed's value is an ANSWER — one dialect for every feed here.
 *
 *  - `idle`    — nothing asked yet (no adapter, no signed-in user, post-reset).
 *  - `loading` — asked, still in flight, no prior answer to show.
 *  - `ready`   — the read answered. Only here does an empty value mean the
 *                feed is genuinely empty. A MISSING resource (404 /
 *                `OBJECT_NOT_FOUND`) is `ready` too: this deployment has no
 *                such object, so nothing is waiting — that is an answer.
 *  - `error`   — the read failed (denied, unreachable, malformed). The value
 *                is the last one known, or empty; either way it is not an
 *                answer to the question being asked now.
 *
 * The same four words as `MetadataTypeStatus` (`providers/MetadataProvider`)
 * and `HomeInboxStatus` (`useHomeInbox`), deliberately: #4300 ruled one status
 * dialect for this exact question, and #4235 applied it to the inbox. The
 * store used to have none — every failure was swallowed into "keep the last
 * value", which is indistinguishable from a successful re-read returning the
 * same thing. #4225 filled that gap for ALL feeds at once rather than adding a
 * second, inbox-only dialect beside it.
 */
export type SharedFeedStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A feed's value together with whether that value is an answer. */
export interface SharedFeedSnapshot<T> {
  value: T;
  status: SharedFeedStatus;
  /**
   * Present, and `true`, only on an `error` snapshot whose read the server
   * REFUSED (objectui#12843) — the verdict is plugin-detail's
   * `isRefusedFeedRead`, the one the record activity panel reads
   * (objectui#11195). Absent on every other snapshot, so a feed whose runner
   * never calls `markRefused` publishes exactly the shape it always did.
   */
  refused?: boolean;
}

/**
 * The runner produces the feed's next value, or `undefined` to leave the last
 * one in place. Which of the two "no value" cases it is has to be said out
 * loud, because the store can no longer guess:
 *
 *  - `markUnavailable()` retires the feed for the rest of the page — the
 *    deployment does not have the approvals plugin / the `sys_activity`
 *    object / the messaging pipeline, so retrying is pure noise. That is an
 *    ANSWER (`ready`).
 *  - `markFailed()` reports a read that should have worked and did not. The
 *    last value stays on screen, the status goes `error`, and the next poll
 *    backs off. A thrown error is equivalent — the runner may just let it fly.
 *  - `markRefused()` is `markFailed()` for a read the server REFUSED
 *    (objectui#12843): the same `error` state and backoff, with `refused` on
 *    the snapshot so a consumer can say "no permission" instead of "something
 *    went wrong". The runner decides which with the shared verdict; the store
 *    classifies nothing itself.
 */
type FeedRunner<T> = (ctx: {
  markUnavailable: () => void;
  markFailed: () => void;
  markRefused: () => void;
}) => Promise<T | undefined>;

/**
 * One feed's shared state. Consumers `attach` (from an effect) and read via
 * `useSyncExternalStore`; the first one in starts the fetch and the poll, the
 * last one out stops it.
 */
class SharedFeed<T> {
  /**
   * The published snapshot. Cached as ONE object and replaced only when the
   * value or the status actually changes: `useSyncExternalStore` re-renders in
   * a loop if `getSnapshot` hands back a fresh reference each call, so pairing
   * the value with its status must not mean building a new pair per read.
   */
  private snapshot: SharedFeedSnapshot<T>;
  private key: string | null = null;
  private readonly listeners = new Set<() => void>();
  private runner: FeedRunner<T> | null = null;
  private consumers = 0;
  private inFlight = false;
  private unavailable = false;
  /** When the feed last retired or spent a probe — gates the probe cadence. */
  private retiredAt = 0;
  /** Re-probes left before the retirement becomes permanent (#4289). */
  private probesLeft = UNAVAILABLE_PROBE_LIMIT;
  private fetchedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Current inter-poll delay: `pollMs`, doubled per failure, capped. */
  private backoffMs: number;
  private visibilityBound = false;

  constructor(
    private readonly empty: T,
    /** Re-fetch cadence while at least one consumer is mounted; 0 = fetch once. */
    private readonly pollMs: number,
  ) {
    this.snapshot = { value: empty, status: 'idle' };
    this.idleSnapshot = this.snapshot;
    this.backoffMs = pollMs;
  }

  subscribe = (onStoreChange: () => void): (() => void) => {
    this.listeners.add(onStoreChange);
    return () => {
      this.listeners.delete(onStoreChange);
    };
  };

  getSnapshot = (): SharedFeedSnapshot<T> => this.snapshot;

  /**
   * What a consumer that is not driving a fetch reads: nothing, not asked.
   * A cached `ready` belongs to the key that earned it — a signed-out session
   * must not inherit the previous user's answer, nor their rows. One frozen
   * object so it is snapshot-stable like any other published value.
   */
  readonly idleSnapshot: SharedFeedSnapshot<T>;

  /**
   * Register a consumer. `key` identifies *whose* feed this is (the approver
   * identity list / the adapter instance); a different key means the previous
   * value belongs to someone else and is dropped rather than shown.
   *
   * Every consumer of a given feed derives its key from the same auth/adapter
   * context, so concurrent consumers always agree on it.
   */
  attach(key: string, runner: FeedRunner<T>): () => void {
    if (key !== this.key) {
      this.key = key;
      this.unavailable = false;
      this.retiredAt = 0;
      this.probesLeft = UNAVAILABLE_PROBE_LIMIT;
      this.fetchedAt = 0;
      this.backoffMs = this.pollMs;
      // A different key means the cached value belongs to someone else, and
      // so does the fact that it was an answer — back to `idle`, not `ready`.
      this.publish(this.empty, 'idle');
    }
    // Freshest closure wins — it holds the current adapter / identities.
    this.runner = runner;
    this.consumers += 1;
    if (this.consumers === 1) {
      this.bindVisibility();
      this.schedule();
    }
    void this.refresh();
    return () => {
      this.consumers = Math.max(0, this.consumers - 1);
      if (this.consumers === 0) {
        this.stopPolling();
        this.unbindVisibility();
      }
    };
  }

  /**
   * `force` is the poll tick: it bypasses the freshness window (which exists
   * to collapse mounts, not to defeat the cadence). Concurrent callers are
   * collapsed by `inFlight`, which is set synchronously before the first
   * `await` — so two consumers attaching in the same commit issue one read.
   */
  private async refresh(force = false): Promise<void> {
    const runner = this.runner;
    if (!runner || this.inFlight) return;
    // A retired feed is not dead, it is quiet: it still re-probes, a bounded
    // number of times and no faster than the probe cadence (#4289).
    const probing = this.unavailable;
    if (probing && !this.mayProbe()) return;
    if (!force && !probing && this.fetchedAt && Date.now() - this.fetchedAt < FRESH_MS) return;
    this.inFlight = true;
    // Only announce "loading" when there is no prior answer to show. A poll
    // tick over a `ready` feed must not flash its consumers back through the
    // loading state ten times a minute.
    if (this.snapshot.status === 'idle') this.publish(this.snapshot.value, 'loading');
    let failed = false;
    let refused = false;
    try {
      const next = await runner({
        // Already retired ⇒ this WAS a probe, and it came back missing again.
        // Spend it and stay exactly as we were; the status must not move.
        markUnavailable: () => (probing ? this.spendProbe() : this.retire()),
        markFailed: () => {
          failed = true;
        },
        markRefused: () => {
          failed = true;
          refused = true;
        },
      });
      if (next !== undefined) {
        // An answer with a value: the feed is alive, whatever it was before.
        // This is the ONLY way out of retirement, and it restores the full
        // budget — a feed that has answered once has earned the next lost race.
        this.unavailable = false;
        this.probesLeft = UNAVAILABLE_PROBE_LIMIT;
        this.fetchedAt = Date.now();
        this.backoffMs = this.pollMs;
        this.publish(next, 'ready');
      } else if (failed) {
        // A probe that fails for some OTHER reason is still not an answer, and
        // it does not get to drag a retired feed into `error`: the surface has
        // been showing the earned empty state and a 404-then-500 sequence is no
        // reason to start telling a community build its inbox is broken. Spend
        // the probe, keep the state, let the next one decide (#4315).
        if (probing) this.spendProbe();
        else this.fail(refused);
      }
    } catch {
      // Not swallowed into "keep the last value and say nothing": the value
      // stays, but consumers are told it is no longer an answer (#4225).
      if (probing) this.spendProbe();
      else this.fail();
    } finally {
      this.inFlight = false;
      // Re-arm from one place. `schedule` is a no-op while a timer is pending,
      // so the poll tick's own re-arm below is unaffected; what this adds is
      // the probe timer for a feed that has just retired (and for a
      // non-polled feed, whose only other scheduling point is attach).
      if (this.consumers > 0) this.schedule();
    }
  }

  /** Whether a retired feed is due another probe. */
  private mayProbe(): boolean {
    return this.probesLeft > 0 && Date.now() - this.retiredAt >= UNAVAILABLE_PROBE_MS;
  }

  /**
   * The resource is missing — an answer, so `ready` and the poll stops. What
   * used to be a one-way door now leaves the probe budget standing.
   */
  private retire(): void {
    this.unavailable = true;
    this.retiredAt = Date.now();
    // A missing resource IS an answer: this deployment has none, so nothing is
    // waiting. Degrading to empty and calling it `ready` is the split
    // `useHomeInbox` already applied to its own read (#4235).
    this.fetchedAt = Date.now();
    this.stopPolling();
    this.publish(this.snapshot.value, 'ready');
  }

  /** A probe that did not answer: spend one, publish nothing, stay retired. */
  private spendProbe(): void {
    this.probesLeft = Math.max(0, this.probesLeft - 1);
    this.retiredAt = Date.now();
    this.fetchedAt = Date.now();
    this.stopPolling();
  }

  /**
   * A read that should have worked did not — report it and back the poll off.
   * `refused` marks the `error` snapshot as a refusal (objectui#12843).
   */
  private fail(refused = false): void {
    this.backoffMs = Math.min(Math.max(this.backoffMs, this.pollMs) * 2, MAX_BACKOFF_MS);
    this.publish(this.snapshot.value, 'error', refused);
  }

  private schedule(): void {
    if (this.timer) return;
    // A tab hidden for too long arms nothing — poll or probe alike — and the
    // return to the tab re-arms through `onVisibilityChange` (objectui#12439).
    if (isPollingSuspended()) return;
    // A retired feed schedules PROBES, not polls — including a feed whose
    // `pollMs` is 0 (`sys_activity` fetches once), whose only other re-read
    // point is a consumer attaching and which the retirement therefore used to
    // silence just as permanently.
    if (this.unavailable) {
      if (this.probesLeft <= 0) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (isPollingSuspended()) return;
        void this.refresh(true);
      }, UNAVAILABLE_PROBE_MS);
      return;
    }
    if (this.pollMs <= 0) return;
    // Backgrounded tabs poll at the slower cadence — but never FASTER than the
    // current backoff, so a failing feed stays backed off either way.
    const hidden = typeof document !== 'undefined' && document.hidden;
    const delay = hidden ? Math.max(HIDDEN_POLL_MS, this.backoffMs) : this.backoffMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      // A tick armed before the cut-off can come due after it; it sends
      // nothing and arms nothing, so the last request a hidden tab makes is
      // inside the window (objectui#12439).
      if (isPollingSuspended()) return;
      // `refresh` re-arms in its own `finally`, for the poll tick and the probe
      // tick alike — one re-arm point, so a feed that changes state mid-read
      // (a poll that retires, a probe that revives) cannot end up scheduling
      // the cadence it just left.
      void this.refresh(true);
    }, delay);
  }

  /**
   * Coming back to the tab refetches immediately rather than waiting out a
   * hidden-cadence tick, so the bell is current within a beat of the user
   * looking at it — the behaviour its own poller had before #4225 moved it.
   *
   * It is also the ONLY way out of a hidden-tab suspension (objectui#12439):
   * a tab hidden past `HIDDEN_POLL_STOP_MS` has no timer left to wake it, so
   * this read is the one immediate request per feed, and the `schedule` in its
   * `finally` re-arms the foreground cadence.
   */
  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined' || document.hidden) return;
    if (this.consumers === 0) return;
    // Returning to a tab is exactly when a bell should be current, so a retired
    // feed re-probes here too — but under the same cadence gate as the timer,
    // or a user switching tabs would spend the whole budget in three seconds
    // and turn a bounded recovery into a request storm (#4289).
    if (this.unavailable && !this.mayProbe()) return;
    this.stopPolling();
    if (!this.unavailable) this.backoffMs = this.pollMs;
    void this.refresh(true);
  };

  private bindVisibility(): void {
    if (this.pollMs <= 0 || this.visibilityBound) return;
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityBound = true;
  }

  private unbindVisibility(): void {
    if (!this.visibilityBound || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityBound = false;
  }

  private stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publish(next: T, status: SharedFeedStatus, refused = false): void {
    if (
      Object.is(next, this.snapshot.value) &&
      status === this.snapshot.status &&
      refused === (this.snapshot.refused === true)
    ) {
      return;
    }
    // `refused` is written only when true, so every snapshot that is not a
    // refusal keeps the two-key shape it always had.
    this.snapshot = refused ? { value: next, status, refused: true } : { value: next, status };
    for (const listener of [...this.listeners]) listener();
  }

  /** Test seam — drop all cached state between cases. Listeners are left alone. */
  reset(): void {
    this.stopPolling();
    this.unbindVisibility();
    this.snapshot = { value: this.empty, status: 'idle' };
    this.key = null;
    this.runner = null;
    this.consumers = 0;
    this.inFlight = false;
    this.unavailable = false;
    this.retiredAt = 0;
    this.probesLeft = UNAVAILABLE_PROBE_LIMIT;
    this.fetchedAt = 0;
    this.backoffMs = this.pollMs;
  }
}

// ── After the console's first paint (objectui#12980) ─────────────────────────

/**
 * The console's boot splash: `LoadingScreen`'s language-independent marker,
 * and the pre-JS splash `apps/console/index.html` draws until React commits.
 */
const BOOT_SPLASH_SELECTOR = '[data-boot-splash], #boot-splash';

let firstPainted = false;
let firstPaintWatched = false;
/** Bumped by the test seam, so a frame armed before a reset settles nothing. */
let firstPaintGeneration = 0;
let splashObserver: MutationObserver | null = null;
const firstPaintListeners = new Set<() => void>();

function bootSplashShown(): boolean {
  return typeof document !== 'undefined' && document.querySelector(BOOT_SPLASH_SELECTOR) !== null;
}

/** Run `fn` once the next frame has painted: a frame, then a task after it. */
function afterNextPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(fn, 0));
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * Start watching for the first paint past the boot splash. Idempotent: the
 * first consumer to mount starts it, and the answer is module-wide and
 * one-way, so a header that remounts on a layout switch reads `true` at once
 * instead of hiding its badge for a frame.
 *
 * A splash still up when the frame lands is waited out (a `MutationObserver`
 * on the document), then one more frame is: so a consumer that mounts under
 * the splash — the shell's own hooks do — reads after the PAGE paints, not
 * after the splash does. A tab opened in the background paints no frame, so
 * its reads wait until it is first shown.
 */
function watchFirstPaint(): void {
  if (firstPainted || firstPaintWatched) return;
  firstPaintWatched = true;
  const generation = firstPaintGeneration;
  const settle = (): void => {
    if (generation !== firstPaintGeneration || firstPainted) return;
    if (bootSplashShown() && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (bootSplashShown()) return;
        observer.disconnect();
        if (splashObserver === observer) splashObserver = null;
        afterNextPaint(settle);
      });
      splashObserver = observer;
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }
    firstPainted = true;
    for (const listener of [...firstPaintListeners]) listener();
  };
  afterNextPaint(settle);
}

function subscribeFirstPaint(listener: () => void): () => void {
  firstPaintListeners.add(listener);
  return () => {
    firstPaintListeners.delete(listener);
  };
}

function readFirstPaint(): boolean {
  return firstPainted;
}

/**
 * `true` once the console has painted past its boot splash — the moment a read
 * that no first-paint surface needs may start (objectui#12980). `false` before
 * it, and on the server.
 *
 * Package-internal: not exported from `./index.ts` or the package entry.
 */
export function useAfterFirstPaint(): boolean {
  const painted = useSyncExternalStore(subscribeFirstPaint, readFirstPaint, readFirstPaint);
  useEffect(() => {
    watchFirstPaint();
  }, []);
  return painted;
}

/**
 * Test seam: start a case past the first paint — for a case about something
 * else, which would otherwise have to wait out a frame its fake clock never
 * paints.
 */
export function __markFirstPainted(): void {
  firstPaintGeneration += 1;
  firstPaintWatched = true;
  firstPainted = true;
  for (const listener of [...firstPaintListeners]) listener();
}

/** Test seam: forget the first paint, so a case can watch for it again. */
export function __resetFirstPaint(): void {
  firstPaintGeneration += 1;
  firstPainted = false;
  firstPaintWatched = false;
  splashObserver?.disconnect();
  splashObserver = null;
}

/**
 * Subscribe to a shared feed. A `null` key means "nothing to fetch yet" (no
 * signed-in user, no adapter) — the consumer still reads the snapshot, it just
 * does not drive a fetch. No feed attaches before the console's first paint
 * (objectui#12980): until then the key is withheld, so the consumer is handed
 * the `idle` snapshot.
 */
function useSharedFeed<T>(
  feed: SharedFeed<T>,
  ownKey: string | null,
  runner: FeedRunner<T>,
): SharedFeedSnapshot<T> {
  const painted = useAfterFirstPaint();
  const key = painted ? ownKey : null;
  const value = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  // Latest-ref: the runner closes over values that change every render, but
  // only `key` may re-drive the attach effect. Declared first so it lands
  // before the attach effect on every commit.
  const runnerRef = useRef(runner);
  useEffect(() => {
    runnerRef.current = runner;
  });
  useEffect(() => {
    if (!key) return;
    return feed.attach(key, (ctx) => runnerRef.current(ctx));
  }, [feed, key]);
  // No key ⇒ this consumer has asked nothing, so it is told nothing — never
  // the cached answer to a question somebody else asked (#4235's `idle`).
  return key ? value : feed.idleSnapshot;
}

// ── Pending approvals ────────────────────────────────────────────────────────

/**
 * One approval request waiting on the signed-in user, as Home's approvals
 * column lists it (objectui#12602): the row the count is the size of.
 *
 * The display fields are the service's own enrichment
 * (`process_label` / `record_title`, the contract's `ApprovalRequest`), copied
 * as served. Package-internal, like the feed.
 */
export interface PendingApprovalRequest {
  id: string;
  /** The flow's human label, when the service resolved one. */
  processLabel?: string;
  /** The target record's display name, when the service resolved one. */
  recordTitle?: string;
  /** The flow's machine name, as served. */
  processName?: string;
  createdAt?: string;
}

/**
 * How many approval requests the one shared read asks for (objectui#13027).
 *
 * The rows are drawn by one surface only — Home's approvals column, which
 * previews at most `useHomeInbox`'s default `limit` (5) of them — while the
 * COUNT is drawn on every console page (the bell badge's second addend, the
 * tab strip, Home's count). So the read is one PAGE of this many rows plus the
 * route's exact `total` (`countRequests`, answered whenever `limit` is sent),
 * instead of the unpaged legacy window of up to 500 enriched rows it used to
 * pull on every console open. ⚠️ Keep it at least Home's row cap: a smaller
 * page would shorten Home's preview, while the count would stay right.
 */
const APPROVALS_PAGE_ROWS = 5;

/**
 * One answer of the approvals feed: the first page of requests, and how many
 * are waiting in all. `total` is the server's count, not `requests.length` —
 * the page is a preview of it.
 */
type PendingApprovalPage = { requests: PendingApprovalRequest[]; total: number };

const NO_APPROVALS: PendingApprovalPage = { requests: [], total: 0 };

/**
 * The approval requests themselves, not only how many (objectui#12602): Home's
 * approvals column lists the first of them, and the count every surface shows
 * is the same answer's `total` — one request, one answer, so the column and
 * the bell cannot disagree about how many are waiting (objectui#13027 moved
 * the count from the list's length to the page's `total`, still one read).
 */
const approvalsFeed = new SharedFeed<PendingApprovalPage>(NO_APPROVALS, APPROVALS_POLL_MS);

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * The identities the endpoint matches a pending approver against: the user id,
 * their email, and `position:<p>` for each POSITION the session carries. Sent
 * as one comma-separated `approverId` so this is ONE request rather than one
 * per identity.
 *
 * `position:<p>` is the spelling the SERVER stores: a `pending_approvers` slot
 * routed to a position nobody held when the request opened keeps the literal
 * `position:<p>` (the `type:value` fallback of plugin-approvals'
 * `resolveApproverSpec`). `role:<p>` is the framework ADR-0090 D3 deprecated
 * spelling of the same address, which the server keeps only for 15.x-era
 * slots; its `approver-address.ts` names `position:` the canonical prefix.
 * Deciding needs the stored spelling — an approve that names `role:<p>` on a
 * `position:<p>` slot is refused — so the console sends the canonical one
 * (objectui#11455).
 *
 * ⛔ No `role:<p>` is sent beside it as a fallback: the console names the
 * position once, in the spelling the server stores, and the server retires
 * its `role:` arm once a console that does this is pinned (objectstack#21387).
 *
 * The names come from `positions`. This read was `user.roles` until
 * objectui#5424, and the protocol-17 session face emits no `roles` key at all
 * (framework ADR-0090 D3 renamed it to `positions` with no deprecation window;
 * measured on a live 17.1.0 server in objectui#5389). So the loop ran over an
 * always-empty array and NO position identity was ever sent: approvals
 * addressed to a position rather than to a person vanished from the bell
 * badge, the Approvals tab and Home's To-do card, with no error anywhere.
 * Business position names (`manager`, and every other name an approval can be
 * addressed to) survive only in `positions`.
 *
 * Deliberately NOT paired with `roles` as a fallback — reviving the retired
 * spelling as an alias is what ADR-0090 D3 forbids, and `packages/auth/src/
 * types.ts` says so on the declaration itself.
 */
function approverIdentities(user: unknown): string[] {
  const u = user as { id?: string; email?: string; positions?: string[] } | null | undefined;
  const identities: string[] = [];
  if (u?.id) identities.push(u.id);
  if (u?.email) identities.push(u.email);
  for (const position of u?.positions ?? []) if (position) identities.push(`position:${position}`);
  return identities;
}

/**
 * Count of approval requests waiting on the signed-in user.
 *
 * Feeds the bell's badge (second addend of `unread + approvals`) and its
 * Approvals tab, and Home's To-do card — from one polled request. Degrades to
 * 0 on 404 (approvals plugin not installed) and retires the poll.
 *
 * The count alone: whether it is an answer is {@link useSharedPendingApprovals}.
 */
export function useSharedPendingApprovalsCount(): number {
  return useSharedPendingApprovals().value;
}

/**
 * The pending-approvals feed with its status — the count AND whether it is an
 * answer (objectui#12601), the store's `SharedFeedSnapshot` that
 * {@link useSharedPendingApprovalsCount} reads `.value` off. Same feed, same one
 * request, same vocabulary as every other feed here (#4225): `ready` is an
 * answer (a missing approvals plugin included — that is `markUnavailable`, and
 * nothing is waiting there), `idle` / `loading` / `error` are not, and the
 * value under `error` is the last answer, kept but no longer vouched for.
 *
 * Read where a surface states the count as a fact — `useHomeInbox` passes the
 * status on, and Home's line under the greeting says "Nothing is waiting for
 * you today" only on `ready`, so an in-flight or failed read is not reported
 * as good news.
 *
 * Package-internal: not exported from `./index.ts` or the package entry.
 */
export function useSharedPendingApprovals(): SharedFeedSnapshot<number> {
  const { value, status } = useSharedPendingApprovalRequests();
  return { value: value.total, status };
}

/**
 * The pending approval requests themselves, with the feed's status — the first
 * page of the requests {@link useSharedPendingApprovals} counts (objectui#12602)
 * and the count itself. Same feed, same one request: Home's approvals column
 * lists `requests`, and its count is `total`, which is the bell's.
 *
 * ## One page and its total, not every row (objectui#13027)
 *
 * The read sends `limit` = `APPROVALS_PAGE_ROWS`, and the route answers that
 * page with `total` — the exact count over the same filter. What a surface
 * calls "how many are waiting" is that `total`, never the page's length.
 *
 * An answer without a numeric `total` is read as exactly one thing: a page
 * with no rows on it. That is the route's own answer on a deployment with no
 * approvals service (`{ data: [] }`, sent instead of a 501), and an empty first
 * page is an exact zero. A non-empty page without `total` cannot say how many
 * are waiting, so it is a failed read (`error`), never its own length.
 *
 * Package-internal: not exported from `./index.ts` or the package entry.
 */
export function useSharedPendingApprovalRequests(): SharedFeedSnapshot<{
  requests: PendingApprovalRequest[];
  total: number;
}> {
  const { user } = useAuth();
  const identities = approverIdentities(user);
  // `user?.id` is the sign-in gate; identities is what the query needs.
  const key = user?.id && identities.length > 0 ? identities.join(',') : null;

  return useSharedFeed(approvalsFeed, key, async ({ markUnavailable, markFailed }) => {
    const serverUrl = (import.meta.env?.VITE_SERVER_URL || '').replace(/\/$/, '');
    const qs = new URLSearchParams({
      status: 'pending',
      approverId: identities.join(','),
      limit: String(APPROVALS_PAGE_ROWS),
    });
    const res = await fetch(`${serverUrl}/api/v1/approvals/requests?${qs}`, {
      credentials: 'include',
      // Bearer too — see utils/authToken (#2548 split-origin fix).
      headers: bearerAuthHeaders(),
    });
    if (res.status === 404) {
      markUnavailable();
      return undefined;
    }
    if (!res.ok) {
      markFailed();
      return undefined;
    }
    const payload = await res.json().catch(() => null);
    const rows = (Array.isArray(payload?.data) ? payload.data : []) as Record<string, unknown>[];
    const served = payload?.total;
    let total: number;
    if (typeof served === 'number' && Number.isFinite(served) && served >= 0) total = served;
    else if (rows.length === 0) total = 0; // the empty first page — an exact zero
    else {
      // A page of rows with no count: how many are waiting is unknown.
      markFailed();
      return undefined;
    }
    // One entry per request id on the page.
    const seen = new Set<string>();
    const requests: PendingApprovalRequest[] = [];
    for (const row of rows) {
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      requests.push({
        id,
        processLabel: str(row.process_label),
        recordTitle: str(row.record_title),
        processName: str(row.process_name),
        createdAt: str(row.created_at),
      });
    }
    return { requests, total };
  });
}

// ── Recent activity ──────────────────────────────────────────────────────────

const activityFeed = new SharedFeed<ActivityItem[]>(NO_ACTIVITIES, 0);

/**
 * Stable string id per adapter instance, so swapping the adapter (tenant
 * switch) drops the previous tenant's rows instead of serving them from cache.
 * Feed-neutral: each feed composes it with whatever else scopes its rows (the
 * inbox adds the signed-in user id, since its query is `mine`; the activity
 * feed adds it too, since the server narrows its rows per caller).
 */
const adapterKeys = new WeakMap<object, string>();
let adapterSeq = 0;
function adapterKey(adapter: unknown): string | null {
  if (!adapter || typeof adapter !== 'object') return null;
  let key = adapterKeys.get(adapter as object);
  if (!key) {
    key = `adapter@${++adapterSeq}`;
    adapterKeys.set(adapter as object, key);
  }
  return key;
}

/**
 * Raw `sys_activity` rows -> `ActivityItem`s: rows that name an action and say
 * something. Home narrows it further (human actors only) at its own call site.
 *
 * The reading itself moved to `layout/activityItemType.ts` (objectui#6730).
 * What lived here was the THIRD hand-written reading of `sys_activity.type` in
 * this repo — objectui#5878 shared the table between the `record:activity`
 * block and `RecordDetailView`, objectui#5896 shared the constructor around it,
 * and this copy survived both — plus its own copy of the `"NOW()"` timestamp
 * quirk whose two others #5896 folded into one.
 *
 * ⛔ It did NOT become a call to `activityRowToFeedItem`, and the module it
 * moved to explains at length why not: the target types CROSS. `FeedItem`
 * collapses create/update/delete into one `field_change`, and drops
 * `commented` / `mentioned` outright — so routing this surface through the
 * shared constructor would cost the bell every comment row and every
 * distinction between a create and a delete. What is shared instead is a PIN,
 * not an import: `activityItemType-6730.test.ts` reads plugin-detail's real
 * table (devDependency, no runtime edge) and fails when the column's declared
 * vocabulary grows an entry this side has not read.
 */
function mapActivityRows(rows: unknown[]): ActivityItem[] {
  return rows
    .filter((row) => !isLoginStampRow(row))
    .map((row) => activityRowToActivityItem(row))
    .filter((item): item is ActivityItem => item !== null);
}

/**
 * The `sys_user` columns a successful sign-in stamps, and nothing else
 * (objectstack's `AuthManager.stampLastLogin`, ADR-0069 D7).
 */
const LOGIN_STAMP_FIELDS: ReadonlySet<string> = new Set(['last_login_at', 'last_login_ip']);

/**
 * Whether a `sys_activity` row is the sign-in stamp (objectui#12530): an
 * `updated` row on `sys_user` whose change (`metadata.new`, the writer's diff)
 * names only the sign-in columns. Every login writes one, so on a roster that
 * lists `sys_user` (an admin's Setup app) they would fill the feed — and a
 * sign-in is never feed material, whatever the roster says.
 *
 * Precise on purpose: an edit to a user record that changes anything else is
 * a row like any other, kept or dropped by the roster alone. A row whose
 * `metadata` is absent or unreadable is not claimed to be a sign-in.
 *
 * This is the one cut the feed makes after the read. The columns a query can
 * name (`object_name`, `record_id`, `actor_id`, `type`) do not tell a sign-in
 * from a profile edit; only the change does, and it lives in a JSON text
 * column the server redacts per reader. So it is judged here, and it can only
 * shorten a page on a roster that lists `sys_user`.
 */
export function isLoginStampRow(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (r.object_name !== 'sys_user' || r.type !== 'updated') return false;
  let metadata: unknown = r.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return false;
    }
  }
  const next = (metadata as { new?: unknown } | null | undefined)?.new;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  const keys = Object.keys(next);
  return keys.length > 0 && keys.every((k) => LOGIN_STAMP_FIELDS.has(k));
}

/** The parts of an app the roster reads: its state and its navigation trees. */
type RosterApp = {
  name?: unknown;
  _packageId?: unknown;
  active?: unknown;
  hidden?: unknown;
  navigation?: NavigationItem[];
  areas?: Array<{ navigation?: NavigationItem[] }>;
} & Record<string, unknown>;

/**
 * The business-object roster the user-facing activity feeds read
 * (objectui#12530): every object a `type: 'object'` navigation entry names, in
 * every app the user can open, as the member is shown that entry. Sorted and
 * de-duplicated, so the same roster is always the same list.
 *
 * Derived, not declared: "an app the user can open" is `filterActiveApps`
 * (the launcher's own predicate), and "an entry the member is shown" is
 * `navEntriesShownToMember` with the sidebar's own gates (the object-read
 * prune, `visible`, `requiredPermissions`, the runtime-capability gate). No
 * object name and no name prefix is written here. The platform's `sys_*`
 * objects drop out because no app the user opens lists them; where one does
 * (an admin's Setup app lists `sys_user`), its rows are business activity for
 * that user, save the sign-in stamp ({@link isLoginStampRow}).
 */
export function activityObjectRoster(
  apps: readonly RosterApp[] | null | undefined,
  gates: NavMemberGates,
): string[] {
  const names = new Set<string>();
  const walk = (items: readonly NavigationItem[]): void => {
    for (const item of items) {
      if (item?.type === 'object' && typeof item.objectName === 'string' && item.objectName !== '') {
        names.add(item.objectName);
      }
      const children = item?.type === 'separator' ? undefined : item?.children;
      if (Array.isArray(children) && children.length > 0) walk(children);
    }
  };
  for (const app of filterActiveApps(apps)) {
    const trees = [...(app.areas ?? []).map((area) => area?.navigation ?? []), app.navigation ?? []];
    for (const tree of trees) walk(navEntriesShownToMember(tree, gates));
  }
  return [...names].sort();
}

/**
 * A missing OBJECT, as opposed to a failed read of a present one — the split
 * that decides whether an empty result is an answer. The ObjectStack client
 * throws `httpStatus` (not `status`) with an error code.
 *
 * Exported because all three inbox-surface readers need exactly this predicate
 * and used to carry a copy each — `sharedUserFeeds`, `AppHeader`'s poller and
 * `useHomeInbox` (#4225). Three copies of a predicate whose two branches mean
 * "degrade quietly" and "say the read failed" is three chances to drift on the
 * distinction #4235 exists to protect.
 */
export function isMissingResource(err: unknown): boolean {
  const e = err as { httpStatus?: number; status?: number } | null;
  return e?.httpStatus === 404 || e?.status === 404 || errorCodeIs(err, 'OBJECT_NOT_FOUND');
}

/**
 * The activity feed as its consumers read it (objectui#12081): the shared
 * snapshot — the rows, and whether they are an ANSWER — plus whether this
 * caller may read `sys_activity` at all.
 *
 * `readable` is a separate bit rather than a fifth status word because it is a
 * different question: the status dialect is the one #4300 ruled ("is this
 * value an answer?") and every feed here speaks it; `readable` says whether
 * there is a widget to put an answer in. A consumer checks it FIRST — `false`
 * renders no widget at all — and only then reads `status`, where an empty
 * `value` means "no recent activity" in `ready` and nothing else.
 */
export interface ActivityFeedReading extends SharedFeedSnapshot<ActivityItem[]> {
  /**
   * `false` only when the caller's LOADED permissions refuse read on
   * `sys_activity`: no read was issued, and the consumer renders nothing.
   * See {@link useSharedActivityFeed} for why unknown permissions read `true`.
   */
  readable: boolean;
  /**
   * `true` only when `status` is `error` because the server REFUSED the read
   * (objectui#12843) — a refusal by `isRefusedFeedRead`, the verdict the
   * record activity panel reads (objectui#11195). A consumer that shows a
   * failure shows the permission copy instead; every other failure leaves it
   * unset and keeps the generic one. Optional so a consumer that builds a
   * reading of its own is unchanged.
   */
  refused?: boolean;
}

const ACTIVITY_OBJECT = 'sys_activity';

/**
 * The 20 most recent activity rows THIS caller may read on the objects their
 * apps list (see "Business activity only" below), mapped onto
 * `ActivityItem`, with whether they are an answer and whether the caller may
 * read the feed at all ({@link ActivityFeedReading}).
 *
 * Not polled — it is a landing-surface feed on both consumers, and the bell
 * never polled it either. Degrades to empty when `sys_activity` is absent
 * (no plugin-audit) and retires the feed for the rest of the page.
 *
 * ## Not asking, rather than asking and being told no (objectui#7476)
 *
 * A tenant environment has no `sys_activity`, so this read 404'd on every page
 * load. The 404 was already handled correctly at four layers — the adapter
 * memoizes the missing collection, its quiet logger demotes it to `debug`, the
 * feed retires as an ANSWER (`ready`, empty), and the panel renders its earned
 * 「暂无最近动态」 — but it was still one doomed request per load, and
 * `data-objectstack` states the rule for exactly this shape: the cure for a
 * doomed request is not issuing it.
 *
 * So the object registry (which the shell loads for the nav either way)
 * decides. It is a THREE-valued answer and only one value skips the read:
 *
 *   - not settled yet → no key, so nothing is asked and nothing is claimed.
 *     `useSharedFeed` hands a consumer the `idle` snapshot in that window,
 *     which is the honest one: this feed has not asked anything;
 *   - `absent` → `markUnavailable()` WITHOUT a request. Same terminal state the
 *     404 produced — `ready`, empty, poll stopped — so every consumer of this
 *     feed and the affirmative empty copy (#4315) are byte-for-byte unchanged;
 *   - `present` / `unknown` → the read, exactly as before. Every uncertainty
 *     lands here on purpose (see {@link useObjectPresence}): a registry with no
 *     provider, still loading, errored, or listing nothing is not evidence of
 *     absence, and a wrong `absent` would cost a real deployment its feed.
 *
 * ## Nor asking a caller the server will refuse (objectui#12081)
 *
 * The same rule, for the other doomed request. objectstack's `member_default`
 * permission set names `sys_activity` deliberately NOT — it has no `user_id`
 * to scope by — so on a deployment whose app sets do not grant it, every
 * non-admin's read was answered `403` on every page load. That `403` is
 * object-level: the server already narrows an ADMITTED read to the rows whose
 * record the caller can open, so no narrower query passes it, and the record
 * Discussion tab's own `sys_activity` read is refused for that caller too.
 * What made it visible was the hook below handing its consumers `.value`
 * alone: the `403` reached them as the empty array and they said "No recent
 * activity" — a denial wearing the shape of an answer, the #4235 defect on
 * another feed. Both halves close here:
 *
 *   - the caller's object grant decides BEFORE asking, read from the
 *     permission context every console surface already reads
 *     (`usePermissions().can(object, 'read')`, the same read gate the route
 *     and the navigation apply). It is three-valued too, and again only one
 *     value skips the read: permissions not loaded (no provider mounted — a
 *     standalone embed, a designer preview — or a provider whose refetch
 *     failed) are unknown, and unknown READS, exactly as before; a loaded
 *     grant reads; only a loaded refusal sends nothing, and the consumers
 *     render no widget ({@link ActivityFeedReading.readable});
 *   - the snapshot reaches the consumers WITH its status, so a read that is
 *     refused anyway (a stale grant), or fails for any other reason, reads as
 *     `error` and never as an empty feed.
 *
 * The key carries the signed-in user beside the adapter, as the inbox's does:
 * the server's narrowing makes these rows the caller's own, and a sign-out
 * keeps the SPA (and this store) running, so an adapter-only key served the
 * previous user's rows to the next one in the tab. The user is a KEY part,
 * not a gate: the query names no user, so a host without auth still reads.
 *
 * ## Business activity only (objectui#12530)
 *
 * These are the bell's Activity tab and Home's activity card, read by every
 * business user — so they read the activity of the objects the user's apps
 * list ({@link activityObjectRoster}), not the platform's own writes (JWKS
 * keys, data migrations, owner backfills, every sign-in). The roster is an
 * `object_name` `$in` filter IN THE QUERY, so `$top` counts business rows
 * rather than a page the client then empties. The Setup / audit surfaces read
 * `sys_activity` through their own object views, unfiltered; nothing here
 * touches them.
 *
 *   - the app list not settled yet → no key, nothing asked: an unfiltered read
 *     is never the stand-in for a roster that has not arrived;
 *   - an empty roster (a user who can open no app object) → an empty feed,
 *     answered without a request — never an unfiltered one;
 *   - the roster is part of the key, so a roster that changes (an app
 *     installed, a grant loaded) re-reads under the new filter.
 *
 * ## Asked for, not read on open (objectui#12980)
 *
 * No badge reads this feed: the bell's Activity tab is drawn only once the
 * popover opens. So the bell passes `enabled: false` until its open intent
 * (a pointer over it, focus, a click), and the read starts then, not on every
 * console open. `readable` is answered either way — it is the caller's grant,
 * not the read — so the tab strip is the same before and after.
 */
export function useSharedActivityFeed(options: { enabled?: boolean } = {}): ActivityFeedReading {
  const enabled = options.enabled !== false;
  const dataSource = useAdapter();
  const { user } = useAuth();
  // Not asked for ⇒ not even its presence is asked (objectui#12980): inside an
  // app the presence answer is its own by-name read (`meta/object/NAME`
  // through the app's object scope), which went out in the chrome's render on
  // every open. An empty name asks the scope nothing; the verdict it yields is
  // never read, because the key below is withheld while `enabled` is false.
  const activity = useObjectPresence(enabled ? ACTIVITY_OBJECT : '');
  const perms = usePermissions();
  // Unknown (not loaded) reads: a wrong refusal would cost a caller who CAN
  // read their feed, with no error anywhere — the one-sided risk #7476 named.
  const readable = !perms.isLoaded || perms.can(ACTIVITY_OBJECT, 'read');
  const adapter = adapterKey(dataSource);
  const { apps, getTypeStatus } = useMetadata();
  const { evaluateVisibility, checkPermission, checkCapability, can } = useNavMemberGates();
  const appsSettled = metadataTypeSettled(getTypeStatus?.('app'));
  // Memoised for cost only: the feed keys on the joined STRING below, never
  // on this array's identity (AGENTS.md #10).
  const roster = useMemo(
    () =>
      activityObjectRoster(apps as RosterApp[] | undefined, {
        evaluateVisibility,
        checkPermission,
        checkCapability,
        can,
      }),
    [apps, evaluateVisibility, checkPermission, checkCapability, can],
  );
  const rosterKey = roster.join(',');

  const snapshot = useSharedFeed(
    activityFeed,
    // The presence verdict is part of the key so the feed re-attaches (and
    // re-decides) when the registry finally answers — it is `null` until then,
    // which is what keeps the doomed request from going out in that window.
    // A refused grant keeps it `null` for good: nothing is asked, and the
    // consumer is handed the `idle` snapshot under `readable: false`. The app
    // list gates it the same way, and the roster it yields is part of it.
    // Not asked for yet (objectui#12980) withholds it the same way.
    enabled && activity.settled && appsSettled && readable && adapter
      ? `${adapter}:${user?.id ?? ''}:${rosterKey}`
      : null,
    async ({ markUnavailable, markFailed, markRefused }) => {
      if (!dataSource) return undefined;
      if (activity.presence === 'absent') {
        // This deployment declares no `sys_activity`. That IS the answer the
        // 404 used to carry, arrived at without the round trip.
        markUnavailable();
        return undefined;
      }
      // No app object to read activity for ⇒ the feed is empty, and that is
      // an answer. Not asking is what keeps it from being an unfiltered read.
      if (roster.length === 0) return NO_ACTIVITIES;
      const res = await Promise.resolve(
        dataSource.find(ACTIVITY_OBJECT, {
          $filter: { object_name: { $in: roster } },
          $orderby: { timestamp: 'desc' },
          $top: 20,
        }) as Promise<{
          data?: unknown[];
        }>,
      ).catch((err: unknown) => {
        // No `sys_activity` object ⇒ this deployment has no audit plugin, which
        // is an answer. Anything else is a read that failed and must say so —
        // and a REFUSED one says which, by the record panel's own verdict
        // (objectui#12843), so its consumers can show the permission copy.
        if (isMissingResource(err)) markUnavailable();
        else if (isRefusedFeedRead(err)) markRefused();
        else markFailed();
        return null;
      });
      if (!res) return undefined;
      return mapActivityRows(Array.isArray(res.data) ? res.data : []);
    },
  );
  return {
    value: snapshot.value,
    status: snapshot.status,
    readable,
    refused: snapshot.status === 'error' && snapshot.refused === true,
  };
}

/**
 * Home's narrower cut of the same rows: real human actions only — drop the
 * `sys_*` / `ai_*` system churn (actor "System", UUID titles) that the bell's
 * full feed still shows — capped at `limit`. The status and the grant are the
 * shared feed's, unchanged: a cut of the rows is not a different answer.
 */
export function useHumanActivityFeed(limit: number): ActivityFeedReading {
  const { value: all, status, readable, refused } = useSharedActivityFeed();
  const human = useMemo(() => {
    const kept = all.filter((a) => {
      const actor = a.user.trim();
      return actor.length > 0 && actor.toLowerCase() !== 'system';
    });
    return kept.slice(0, limit);
  }, [all, limit]);
  return { value: human, status, readable, refused };
}

// ── Inbox messages ───────────────────────────────────────────────────────────

const inboxFeed = new SharedFeed<InboxNotification[]>(NO_MESSAGES, INBOX_POLL_MS);

/**
 * Receipt states that count as READ (ADR-0030). `delivered` is not one of them
 * — a message can carry a receipt and still be unread, which is the whole
 * reason read-state cannot be inferred from the receipt's mere existence.
 */
const READ_STATES = new Set(['read', 'clicked', 'dismissed']);

/**
 * Join the `mine` inbox rows to their read-state receipts — the merge the
 * bell's poller did inline, now the shared feed's single definition of what a
 * message IS. `useHomeInbox` never had this join at all (#4316), which is why
 * Home counted already-read messages as needing attention.
 */
function mergeInboxRows(rows: unknown[], receipts: unknown[]): InboxNotification[] {
  // notification_id → { id, state } (most-advanced receipt wins).
  const receiptByNotif = new Map<string, { id: string; state: string }>();
  for (const raw of receipts) {
    const r = raw as Record<string, unknown> | null;
    const nid = r?.notification_id != null ? String(r.notification_id) : '';
    if (!nid) continue;
    const state = String(r?.state ?? '');
    const prev = receiptByNotif.get(nid);
    // Prefer a read/clicked/dismissed receipt over a plain delivered one.
    if (!prev || (!READ_STATES.has(prev.state) && READ_STATES.has(state))) {
      receiptByNotif.set(nid, { id: String(r?.id), state });
    }
  }
  return rows.map((raw) => {
    const m = raw as Record<string, unknown>;
    const nid = m?.notification_id != null ? String(m.notification_id) : null;
    const rec = nid ? receiptByNotif.get(nid) : undefined;
    return {
      id: String(m.id),
      notification_id: nid,
      receipt_id: rec?.id ?? null,
      type: (m.topic as string) ?? 'notification',
      title: (m.title as string) ?? '',
      body: (m.body_md as string) ?? null,
      action_url: (m.action_url as string) ?? null,
      is_read: rec ? READ_STATES.has(rec.state) : false,
      created_at: m.created_at as string | undefined,
      // A bare `sys_user` id (objectui#8667). The column is a lookup, and a
      // lookup arrives as the referenced RECORD only when the read asks for it
      // with `$expand`; the `sys_inbox_message` read in `useSharedInboxFeed`
      // passes none, so what arrives is the id the inbox channel stored, or
      // `null` on a digest row (a collapsed group has no single actor). Only a
      // string is an id, the same test the upstream dispatcher applies before
      // it lets an actor through. A server older than the column
      // (objectstack#16974) sends no key at all, and that maps to `null` too:
      // "no known actor", which announces exactly as it did before.
      actor_id: typeof m.actor_id === 'string' ? m.actor_id : null,
    } satisfies InboxNotification;
  });
}

/**
 * The notification ids of the listed messages — the only receipts this feed
 * can USE, which is why they are the only ones it now asks for (objectui#7392).
 *
 * {@link mergeInboxRows} maps over the MESSAGE rows and looks each one's
 * receipt up by `notification_id`; a receipt belonging to anything else is
 * fetched and dropped on the floor. Asking for exactly these ids narrows the
 * PAYLOAD, not the answer.
 *
 * De-duplicated, because the ids are a query comparand rather than a count.
 * Rows with a blank or absent `notification_id` are skipped: read-state is
 * keyed by that id, so such a row can never be receipted and is always unread
 * — the same rule the merge applies on the other side of the join.
 */
function listedNotificationIds(rows: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const raw of rows) {
    const nid = (raw as Record<string, unknown> | null)?.notification_id;
    if (nid == null) continue;
    const id = String(nid);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * The signed-in user's 20 most recent in-app inbox messages, joined with their
 * read-state receipts (ADR-0030 L5, the `mine` materialization).
 *
 * Two scoped reads, joined client-side, polled at 10s while the tab is
 * foregrounded — the bell's cadence, now the store's:
 *   - `sys_inbox_message` filtered by `user_id`, newest first, `$top: 20`.
 *   - `sys_notification_receipt` filtered by `user_id` + `channel:'inbox'`,
 *     narrowed to the notification ids that message read just listed
 *     (objectui#7392). Best-effort: if receipts are unavailable the inbox
 *     still renders (everything shows unread) rather than erroring.
 *
 * The receipt read used to ask for `$top: 200` of the user's receipts whatever
 * was listed, and `mergeInboxRows` then dropped every row that did not belong
 * to one of the 20 — a steady-state payload two orders of magnitude wider than
 * the answer it decorated, re-fetched in full at the 10s foreground cadence.
 * Its `$top` is now the id count, and that bound is EXACT rather than a guess:
 * `sys_notification_receipt` declares its key `{ fields: ['notification_id',
 * 'user_id', 'channel'], unique: true }`, so this filter can match at most one
 * row per id it names.
 *
 * ⚠️ The two reads are SEQUENTIAL where they used to be a `Promise.all`: the
 * receipt query cannot be written until the message read says which
 * notifications are in the window. That is one extra round trip per tick, on a
 * background poll, against ~200 rows saved on each of them.
 *
 * ⛔ What this does NOT change is the bell's unread number, and that is the
 * one thing a narrowing here could have broken silently. The badge is
 * `unreadTopics + pendingApprovalsCount` (`InboxPopover`), and `unreadTopics`
 * folds THIS feed's rows — which are `mergeInboxRows`' output, one per
 * `sys_inbox_message` row. So the inbox addend has been "unread within the
 * `$top: 20` window" since #4225 gave the two surfaces one feed; the receipt
 * set never contributed a row to it, only a read-state to rows the message
 * query had already chosen. Home's `unreadTopicCount` folds the same rows the
 * same way (#4329). A receipt outside the window changed no number before this
 * change and changes none after it.
 *
 * This is the SUPERSET both consumers cut from. The bell lists all 20 and
 * badges the unread topics; Home's action centre takes the unread ones, newest
 * first, capped at its own smaller limit. Neither issues a read of its own, so
 * the two cannot disagree about a row's read-state — the #4316 defect is not
 * merely fixed here, it is unreachable.
 *
 * Degrades to empty when the messaging pipeline is absent (404 /
 * `OBJECT_NOT_FOUND`) and retires the poll; every other failure is reported as
 * `error` so a denial cannot reach a consumer wearing the shape of an empty
 * inbox (#4235, objectstack#7344).
 */
export function useSharedInboxFeed(): SharedFeedSnapshot<InboxNotification[]> {
  const dataSource = useAdapter();
  const { user } = useAuth();
  const userId = user?.id;
  // Scoped by adapter AND user: the query is `mine`, so another user's rows
  // must never be served from cache after a session switch.
  const adapter = adapterKey(dataSource);
  const key = adapter && userId ? `${adapter}:${userId}` : null;

  return useSharedFeed(inboxFeed, key, async ({ markUnavailable, markFailed }) => {
    if (!dataSource || !userId) return undefined;
    try {
      const inboxRes = await Promise.resolve(
        dataSource.find('sys_inbox_message', {
          $filter: { user_id: userId },
          $orderby: { created_at: 'desc' },
          $top: 20,
        }) as Promise<{ data?: unknown[] }>,
      );
      const rows = Array.isArray(inboxRes?.data) ? inboxRes.data : [];
      const notificationIds = listedNotificationIds(rows);
      // Nothing in this window can carry a receipt ⇒ no receipt read at all.
      // Every row the old query would have returned here is one the merge
      // discards, so the cheapest correct request is the one not sent.
      const receiptRes =
        notificationIds.length === 0
          ? { data: [] as unknown[] }
          : await Promise.resolve(
              dataSource.find('sys_notification_receipt', {
                $filter: {
                  user_id: userId,
                  channel: 'inbox',
                  notification_id: { $in: notificationIds },
                },
                $top: notificationIds.length,
              }) as Promise<{ data?: unknown[] }>,
            ).catch(() => ({ data: [] as unknown[] }));
      return mergeInboxRows(rows, Array.isArray(receiptRes?.data) ? receiptRes.data : []);
    } catch (err: unknown) {
      // No inbox object ⇒ no messaging pipeline in this deployment, so nothing
      // is waiting: an answer. A denial / outage / malformed reply is not.
      if (isMissingResource(err)) markUnavailable();
      else markFailed();
      return undefined;
    }
  });
}

/**
 * Test seam: drop every shared feed's cached value, key and in-flight state so
 * cases do not inherit each other's reads. Not part of the public surface.
 */
export function __resetSharedUserFeeds(): void {
  // The first paint is deliberately NOT forgotten here: it is a page-load fact,
  // not a feed's state. A case that needs to watch for it again calls
  // `__resetFirstPaint`.
  __resetHiddenTabClock();
  approvalsFeed.reset();
  activityFeed.reset();
  inboxFeed.reset();
}
