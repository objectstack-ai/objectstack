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
  /** Seconds a number must wait between two sends. Default 60. `0` disables. */
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
const HOUR_MS = 3_600_000;

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
    this.cooldownMs = Math.max(0, Math.floor(options.cooldownSeconds ?? 60)) * 1000;
    this.maxPerHour = Math.max(0, Math.floor(options.maxPerHour ?? 5));
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
      const history = parseHistory(await store.get(key)).filter((t) => now - t < HOUR_MS);

      const last = history.length ? Math.max(...history) : undefined;
      if (this.cooldownMs > 0 && last !== undefined && now - last < this.cooldownMs) {
        return { ok: false, retryAfterSeconds: Math.ceil((this.cooldownMs - (now - last)) / 1000) };
      }
      if (this.maxPerHour > 0 && history.length >= this.maxPerHour) {
        const oldest = Math.min(...history);
        return { ok: false, retryAfterSeconds: Math.ceil((HOUR_MS - (now - oldest)) / 1000) };
      }

      history.push(now);
      // TTL = the rolling window; the entry self-expires once irrelevant.
      await store.set(key, JSON.stringify(history), Math.ceil(HOUR_MS / 1000));
      return { ok: true };
    } catch {
      return { ok: true }; // fail open — see doc comment
    }
  }
}
