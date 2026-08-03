// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-phone-number OTP send guard (#2780).
 *
 * SMS is a *paid* channel: every `/phone-number/send-otp` call costs real
 * money and better-auth sends to ANY number (the endpoint also serves the
 * change-phone verification flow), so an attacker can pump SMS to arbitrary
 * numbers ("SMS pumping" / toll fraud). better-auth's per-IP rate limit
 * doesn't survive IP rotation — this guard adds the missing per-NUMBER
 * dimension, independent of caller IP:
 *
 *  - **Cooldown**: at most one send per number per `cooldownSeconds`.
 *  - **Hourly cap**: at most `maxPerHour` sends per number per rolling hour.
 *
 * ## How long the history is kept (#4808)
 *
 * The two dimensions above need DIFFERENT windows, and conflating them is how
 * a declared cooldown stopped being the enforced one: the history was pruned —
 * and stored with a TTL — at a flat one hour, which is the hourly cap's window,
 * not the cooldown's. A `cooldownSeconds` above 3600 was therefore accepted,
 * then silently served as one hour: the record the cooldown is measured from
 * had already been dropped. Declared ≠ enforced, with no signal at all
 * (ADR-0049).
 *
 * History is now retained for `max(1 hour, cooldownSeconds)` — long enough for
 * whichever dimension still needs it — while the hourly cap keeps counting over
 * its own rolling hour ({@link HOUR_MS}), so a long cooldown does not quietly
 * make `maxPerHour` stricter than declared either.
 *
 * The retention that buys is bounded by {@link MAX_COOLDOWN_SECONDS}: a
 * cooldown above it is **rejected** at config time
 * ({@link assertOtpCooldownSeconds}), never truncated. A ceiling matters more
 * once the TTL follows the config than it did before: a nonsense value used to
 * degrade quietly to one hour, and would now be honoured for as long as it
 * says. Rejecting it says so at boot instead.
 *
 * ## Where the budget is counted (#4790)
 *
 * A budget is only worth what its STORE is worth: counted per process, a
 * declared "5 sends per number per hour" is really 5×N in an N-node
 * deployment, and nothing says so (ADR-0049 — declared ≠ enforced). The store
 * is therefore resolved through {@link CounterStore}, lazily, at the moment a
 * send is checked:
 *
 *  - the kernel `cache` service when one is registered — shared across nodes
 *    iff the cache is (Redis via `@objectstack/service-cache`);
 *  - a host-supplied better-auth `secondaryStorage`, when the host wired one
 *    deliberately (adapted by {@link counterStoreFromKv});
 *  - otherwise a bounded per-process store — still enforced, per node, and
 *    announced loudly by the resolver (`createLazyCounterStore`).
 *
 * Lazy on purpose: `AuthPlugin.init()` runs BEFORE `CacheServicePlugin`
 * registers `cache`, so anything resolved at init freezes a "no shared store"
 * answer for the life of the process — the #4772 defect, of which this guard
 * was the second instance.
 *
 * Counting stays best-effort (read-modify-write, no cross-node atomicity),
 * which is fine for an anti-abuse throttle — the budget is small either way,
 * and a shared store that occasionally admits one extra is still bounded,
 * unlike N independent budgets.
 *
 * Keys carry only the phone number and timestamps — never OTP codes.
 */

import { InProcessCounterStore, type CounterStore } from './rate-limit-storage.js';

/**
 * Subset of better-auth's SecondaryStorage the guard needs. Return types are
 * deliberately loose (`unknown`) to stay assignable from better-auth's own
 * interface across versions; {@link parseHistory} type-checks what comes back.
 */
export interface OtpGuardStorage {
  get(key: string): unknown;
  set(key: string, value: string, ttl?: number): unknown;
}

/**
 * Adapt a string-valued KV (better-auth `secondaryStorage`) to the
 * {@link CounterStore} the guard counts in, so there is ONE store abstraction
 * inside the guard instead of a branch per backing store.
 */
export function counterStoreFromKv(kv: OtpGuardStorage): CounterStore {
  return {
    get: async <T = unknown>(key: string): Promise<T | undefined> => {
      const raw = await kv.get(key);
      return (raw ?? undefined) as T | undefined;
    },
    set: async <T = unknown>(key: string, value: T, ttl?: number): Promise<void> => {
      await kv.set(key, typeof value === 'string' ? value : JSON.stringify(value), ttl);
    },
  };
}

export interface OtpSendGuardOptions {
  /**
   * Seconds a number must wait between two sends. Default 60. `0` disables.
   * Enforced at the declared value — including above one hour, which the
   * history retention now follows (#4808). Must be a finite, non-negative
   * number no greater than {@link MAX_COOLDOWN_SECONDS}; anything else throws
   * from the constructor rather than being clamped into something else.
   */
  cooldownSeconds?: number;
  /** Max sends per number per rolling hour. Default 5. `0` disables. */
  maxPerHour?: number;
  /**
   * Resolve the store the budget is counted in — called on EVERY check, so a
   * shared cache that registers after this guard was constructed is picked up
   * on the next send rather than never (#4790). `AuthPlugin` supplies
   * `createLazyCounterStore(...)` (rate-limit-storage.ts), which memoises the
   * handle, falls back to a bounded per-process store and says which of the
   * two it got. Omitted → per-process, silently (the guard used standalone).
   */
  resolveStore?: () => Promise<CounterStore>;
  /**
   * Host-supplied cross-node KV (better-auth `secondaryStorage`). Adapted to a
   * {@link CounterStore}; ignored when {@link resolveStore} is given.
   */
  storage?: OtpGuardStorage;
  /** Clock override for tests. */
  now?: () => number;
}

export interface OtpSendDecision {
  ok: boolean;
  /** Seconds until the next send is allowed (set when `ok` is false). */
  retryAfterSeconds?: number;
}

const KEY_PREFIX = 'phone-otp-sends:';
/** The hourly cap's window. Belongs to `maxPerHour` ONLY — see the file doc. */
const HOUR_MS = 3_600_000;

/**
 * Upper bound on `cooldownSeconds`, in seconds (24 hours).
 *
 * Not a truncation point — a configured cooldown above this is **rejected**
 * ({@link assertOtpCooldownSeconds}); moving the silent truncation to a higher
 * number would just be the #4808 defect one order of magnitude further out.
 *
 * Why a ceiling exists at all, now that retention follows the cooldown: the
 * history for one number is pinned in the shared cache for the whole cooldown,
 * and a cooldown beyond a day is not an anti-abuse throttle any more — it is an
 * account-level lockout, which is a different mechanism with different controls.
 * It also catches `cooldownSeconds` handed over in MILLISECONDS — the common
 * authoring slip — for any intended cooldown from five minutes up (`300000`
 * → rejected), which is where the mistake stops being self-evident.
 */
export const MAX_COOLDOWN_SECONDS = 86_400;

/**
 * Validate a configured OTP send cooldown, throwing with the offending value,
 * the bound and the fix. Exported so the value is rejected where it is
 * CONFIGURED (`AuthManager`'s constructor, i.e. `AuthPlugin.init()` → boot)
 * as well as where it becomes behaviour (the guard constructor) — one message,
 * both seams, no second copy of the rule.
 *
 * Accepts `undefined` (use the default) and `0` (documented: disables the
 * cooldown). Fractional seconds are floored by the guard — sub-second
 * precision on an SMS throttle is not a discrepancy worth a boot failure.
 */
export function assertOtpCooldownSeconds(seconds: number | undefined): void {
  if (seconds === undefined) return;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `phoneOtp.cooldownSeconds must be a finite, non-negative number of seconds (got ${String(seconds)}). ` +
        'Use 0 to disable the per-number cooldown.',
    );
  }
  if (seconds > MAX_COOLDOWN_SECONDS) {
    throw new RangeError(
      `phoneOtp.cooldownSeconds ${seconds} exceeds the supported maximum of ${MAX_COOLDOWN_SECONDS} seconds (24 hours). ` +
        'The per-number OTP send history is retained for the whole cooldown, so the cooldown is bounded rather than ' +
        'silently truncated (#4808). If the value is in milliseconds, divide by 1000; a longer block than 24 hours is ' +
        'an account lockout, not a send throttle.',
    );
  }
}

/**
 * Read back a send history. Cache adapters differ on whether a stored value
 * comes back as the JSON string (Redis) or as the original array (memory), so
 * both are accepted — the same tolerance `parseCounter` applies to the
 * rate-limit envelope. Anything else (absent, foreign, unparseable) counts as
 * an empty history: a budget that throws on a junk key would take sign-in down
 * with it, which is the opposite of the trade this guard makes.
 */
function parseHistory(raw: unknown): number[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length === 0) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((t): t is number => typeof t === 'number') : [];
}

export class OtpSendGuard {
  private readonly cooldownMs: number;
  private readonly maxPerHour: number;
  /**
   * How long a send stays in the history — `max(1 hour, cooldownMs)` (#4808).
   * The hourly cap still counts over {@link HOUR_MS}; this is only about how
   * long the record has to SURVIVE for the longer of the two dimensions to be
   * measurable at all.
   */
  private readonly retentionMs: number;
  private readonly now: () => number;
  /**
   * Per-process fallback, used only when no store was supplied at all (the
   * guard constructed standalone). The SAME `InProcessCounterStore` the
   * rate-limit counters degrade to — one bounded fallback implementation, not
   * two (#4790).
   */
  private readonly fallback = new InProcessCounterStore();
  /** Resolves the store this guard counts in, per check — see the options doc. */
  private readonly resolveStore: () => Promise<CounterStore>;

  constructor(options: OtpSendGuardOptions = {}) {
    assertOtpCooldownSeconds(options.cooldownSeconds);
    this.cooldownMs = Math.max(0, Math.floor(options.cooldownSeconds ?? 60)) * 1000;
    this.maxPerHour = Math.max(0, Math.floor(options.maxPerHour ?? 5));
    this.retentionMs = Math.max(HOUR_MS, this.cooldownMs);
    this.now = options.now ?? Date.now;
    const hostKv = options.storage ? counterStoreFromKv(options.storage) : undefined;
    this.resolveStore =
      options.resolveStore ??
      (hostKv ? async () => hostKv : async () => this.fallback);
  }

  /**
   * Check whether `phoneNumber` may receive another OTP now and, if so,
   * record the send. Never throws — a broken store fails OPEN (an SMS
   * throttle must not take sign-in down with it).
   */
  async checkAndRecord(phoneNumber: string): Promise<OtpSendDecision> {
    if (this.cooldownMs === 0 && this.maxPerHour === 0) return { ok: true };
    const now = this.now();
    try {
      const store = await this.resolveStore();
      const key = KEY_PREFIX + phoneNumber;
      // Retained for the LONGER of the two windows (#4808) …
      const history = parseHistory(await store.get(key)).filter((t) => now - t < this.retentionMs);
      // … but the hourly cap counts only its own rolling hour, so a cooldown
      // above an hour can never make `maxPerHour` stricter than it was
      // declared. Belt and braces today (a history entry inside the wider
      // retention window is also inside the cooldown, which returns below
      // before the cap is consulted) — stated explicitly so the cap's window
      // does not silently become "whatever the cooldown retains" the next time
      // either window moves.
      const withinHour = history.filter((t) => now - t < HOUR_MS);

      const last = history.length ? Math.max(...history) : undefined;
      if (this.cooldownMs > 0 && last !== undefined && now - last < this.cooldownMs) {
        return { ok: false, retryAfterSeconds: Math.ceil((this.cooldownMs - (now - last)) / 1000) };
      }
      if (this.maxPerHour > 0 && withinHour.length >= this.maxPerHour) {
        const oldest = Math.min(...withinHour);
        return { ok: false, retryAfterSeconds: Math.ceil((HOUR_MS - (now - oldest)) / 1000) };
      }

      history.push(now);
      // TTL = the retention window, so the entry outlives the cooldown it is
      // measured against and self-expires once no dimension can still need it.
      await store.set(key, JSON.stringify(history), Math.ceil(this.retentionMs / 1000));
      return { ok: true };
    } catch {
      return { ok: true }; // fail open — see doc comment
    }
  }
}
