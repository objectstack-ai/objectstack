// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Global daily SMS send quota — the COST TOTAL gate (#2814).
 *
 * ## What this adds that the per-number guard cannot
 *
 * #2780 gave the OTP endpoints a per-NUMBER budget (60s cooldown + 5 sends per
 * number per hour, `plugin-auth/src/otp-send-guard.ts`). That bounds what one
 * phone number costs. It does not bound what the DEPLOYMENT costs: an attacker
 * rotating through ten thousand distinct numbers keeps every one of them inside
 * its own budget while the daily bill has no ceiling at all — classic SMS
 * pumping / toll fraud. And the per-number guard sits in better-auth's
 * `hooks.before`, so it only ever sees the auth endpoints: `notify(channels:
 * ['sms'])` and the invitation path walk straight past it.
 *
 * This gate is therefore counted at the ONE place every outbound message
 * already funnels through — `SmsService.send()` — so OTP, invitations and the
 * messaging `sms` channel are all charged against the same budget, whatever
 * door they came in by.
 *
 * ## Where it counts (#4790's answer, reused verbatim)
 *
 * A budget is only worth what its store is worth: counted per process, a
 * declared "2000 per day" is really 2000×N across N nodes, and nothing says so
 * (ADR-0049 — declared ≠ enforced). So this counts through the SAME resolution
 * the auth counters use — `createLazyCounterStore` over the kernel `cache`
 * service, resolved at COUNTING time (not at plugin init, the #4772 trap),
 * with a bounded per-process fallback that announces itself. The counting
 * algorithm is `incrementFixedWindow`, imported rather than re-implemented:
 * this repo has exactly one fixed-window counter and #4790 said plainly that a
 * third copy is not wanted.
 *
 * ## The window is a UTC calendar day, twice over
 *
 * "Daily quota" means the calendar day, not "24h from the first send", so the
 * counter key carries the UTC date (`sms-daily-sends:2026-08-06`) AND the
 * window is opened with exactly the seconds remaining until the next UTC
 * midnight. Either mechanism alone would roll the budget over; together they
 * cannot disagree — a clock skew that mis-sizes the TTL still lands on a fresh
 * key at 00:00Z, and a store that ignores TTLs still starts a new key.
 *
 * ## Admission-time counting, and fail-open
 *
 * A unit is consumed when a send is ADMITTED, before the transport runs —
 * exactly like `OtpSendGuard.checkAndRecord` and
 * `createLazyCacheRateLimitStorage.consume`, both of which take the
 * post-increment count and compare it to the cap. Two consequences, stated
 * rather than discovered later: a transport failure still spends a unit (the
 * conservative direction for a COST ceiling, and the alternative is a second
 * store round-trip on every send), and attempts refused by this gate keep
 * incrementing the day's counter, so the number in the log line is "attempts
 * today", not "messages delivered today".
 *
 * Every store interaction is fail-OPEN: a cache outage must not take phone
 * sign-in down with it (#2814 requirement 4). A degraded gate is announced once
 * and then admits.
 *
 * ## What is NOT here
 *
 * The per-tenant dimension (`daily_quota_per_tenant`, keyed by
 * `organizationId`) is deliberately absent: `SendSmsInput`
 * (`@objectstack/spec/contracts/sms-service.ts`) carries no tenant identifier,
 * and inventing a second, service-local spelling of one would be exactly the
 * shadow contract AGENTS.md Prime Directive #12 forbids. See the issue thread
 * on #2814 — the tenant identifier belongs on the spec contract or nowhere.
 */

import {
  InProcessCounterStore,
  incrementFixedWindow,
  type CounterStore,
} from '@objectstack/plugin-auth/rate-limit-storage';

/**
 * The error code a quota-refused send answers with, as the `CODE: message`
 * prefix `SmsService` already uses for `VALIDATION_FAILED`.
 *
 * Deliberately the same code the per-number guard raises in `plugin-auth`
 * (`APIError('TOO_MANY_REQUESTS')`), because #2814 asks the two walls to be
 * indistinguishable from outside: an attacker must not be able to tell which
 * budget they hit, and a legitimate caller needs no more than "not now".
 * The message carries NO remaining-quota detail for the same reason.
 */
export const SMS_QUOTA_EXCEEDED_CODE = 'TOO_MANY_REQUESTS';

/** The refusal text handed back on `SendSmsResult.error`. Contains no counts. */
export const SMS_QUOTA_EXCEEDED_ERROR = `${SMS_QUOTA_EXCEEDED_CODE}: daily SMS quota exhausted`;

/** Key prefix for the day counter. Carries a date only — never a recipient. */
const KEY_PREFIX = 'sms-daily-sends:';

/** Fraction of the quota at which the approaching-ceiling WARN fires. */
const NEAR_LIMIT_RATIO = 0.8;

type LoggerLike = {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
};

export interface SmsDailyQuotaOptions {
  /**
   * Resolve the store the day counter lives in — called on EVERY check, so a
   * shared cache registered after this gate was constructed is picked up on the
   * next send rather than never (#4772/#4790). `SmsServicePlugin` supplies
   * `createLazyCounterStore(...)`; omitted ⇒ a per-process store, silently
   * (the gate constructed standalone, e.g. in tests).
   */
  resolveStore?: () => Promise<CounterStore>;
  /** Diagnostics sink. NEVER receives a message body or a recipient. */
  logger?: LoggerLike;
  /** Clock override for tests. */
  now?: () => number;
}

/** Outcome of one admission check. */
export interface SmsDailyQuotaDecision {
  /** Whether the send may proceed. */
  ok: boolean;
  /**
   * Attempts counted for the current UTC day AFTER this one, when the counter
   * was actually consulted. Absent when the gate is off or degraded.
   */
  count?: number;
  /** The enforced ceiling this decision was measured against (`0` ⇒ off). */
  quota?: number;
}

/** `YYYY-MM-DD` in UTC — the day the counter key is scoped to. */
export function utcDayStamp(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Seconds from `now` to the next UTC midnight, at least 1. This is the window
 * `incrementFixedWindow` opens on the day's first send, so the counter expires
 * with the day it belongs to instead of 24h after whenever it started.
 */
export function secondsUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/**
 * Result of reading an authored quota value: the ceiling actually enforced,
 * plus the offending input when one had to be discarded.
 */
export interface NormalizedDailyQuota {
  /** Enforced ceiling. `0` means unlimited. Always a non-negative integer. */
  limit: number;
  /** Set when the authored value was unusable and `0` was substituted. */
  rejected?: string;
}

/**
 * Clamp an authored `sms.daily_quota` into the value actually enforced.
 *
 * **This lives on the CONSUMER side on purpose (#5932).** `SettingsService`
 * declares `min`/`max` on a manifest specifier but `validatePatch` does not
 * enforce them today, so a `min: 0` declaration is inert: negative, fractional
 * and outright non-numeric values all reach a reader intact. Anything that
 * depends on the manifest having filtered them is declared-but-unenforced
 * (ADR-0049), so the clamp is here, where the value becomes behaviour, and is
 * pinned by tests.
 *
 * The rules, and why each is the safe direction for a paid channel:
 *
 * - **absent / empty string** → `0` (unlimited), quietly. That is "the operator
 *   has not configured a ceiling", which is the shipped default, not an error.
 * - **finite number ≥ 0** → `Math.floor(v)`. A fractional message count is
 *   rounded DOWN, the stricter direction for a cost ceiling, and is not worth a
 *   diagnostic — `100.5` unambiguously means "at most 100 messages".
 * - **negative, NaN, ±Infinity, or a non-numeric type** → `0` (unlimited) plus
 *   a named rejection the caller logs LOUDLY.
 *
 * That last rule is the one worth arguing. Two other readings exist and both
 * are worse here. Refusing to send at all turns one typo in a settings form
 * into a total outage of phone sign-in — the precise failure #2814 requirement
 * 4 rules out ("配额闸不能把登录拖下水"), and the same reasoning `SettingsService`
 * applies when it ignores a rejected `OS_*` override rather than acting on it.
 * Substituting some other default invents a ceiling nobody declared and hides
 * the typo behind plausible behaviour (#5152's lesson, where a typo'd
 * `invite_only` read as `auto` left an operator believing a wall was up).
 * Ignoring the value and SAYING SO leaves the deployment exactly where it was
 * before the bad edit, with a line naming the value to fix.
 */
export function normalizeDailyQuota(raw: unknown): NormalizedDailyQuota {
  if (raw === undefined || raw === null) return { limit: 0 };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { limit: 0 };
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) return { limit: Math.floor(parsed) };
    return { limit: 0, rejected: trimmed };
  }
  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && raw >= 0) return { limit: Math.floor(raw) };
    return { limit: 0, rejected: String(raw) };
  }
  return { limit: 0, rejected: typeof raw === 'object' ? JSON.stringify(raw) : String(raw) };
}

/**
 * The global daily send ceiling, counted once per admitted send.
 *
 * Constructed by `SmsServicePlugin` and handed to `SmsService`; `setQuota` is
 * called on every `sms` settings change so an admin edit takes effect without a
 * restart (same live-swap contract as the transport).
 */
export class SmsDailyQuota {
  private limit = 0;
  private readonly resolveStore: () => Promise<CounterStore>;
  private readonly logger?: LoggerLike;
  private readonly now: () => number;

  /**
   * Per-process fallback used when no resolver was supplied at all (the gate
   * constructed standalone). The SAME bounded store the auth counters degrade
   * to — one fallback implementation across the repo, not a second one that can
   * drift (#4790).
   */
  private readonly fallback = new InProcessCounterStore();

  /** The last authored value reported as unusable — deduped, per value. */
  private reportedRejection?: string;
  /** UTC day stamp the approaching-ceiling WARN has already fired for. */
  private nearLimitWarnedFor?: string;
  /** UTC day stamp the ceiling-reached WARN has already fired for. */
  private exceededWarnedFor?: string;
  /** Store-outage WARN is once per process — see `checkAndRecord`. */
  private degradedWarned = false;

  constructor(options: SmsDailyQuotaOptions = {}) {
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.resolveStore = options.resolveStore ?? (async () => this.fallback);
  }

  /**
   * Apply an authored `sms.daily_quota`. Anything unusable degrades to
   * "unlimited" and is reported once per distinct offending value — see
   * {@link normalizeDailyQuota} for why that is the safe direction.
   */
  setQuota(raw: unknown): void {
    const { limit, rejected } = normalizeDailyQuota(raw);
    this.limit = limit;
    if (rejected !== undefined && rejected !== this.reportedRejection) {
      this.reportedRejection = rejected;
      this.logger?.warn?.(
        `[sms] daily_quota value '${rejected}' is not a usable message count — the daily SMS quota is ` +
          'NOT enforced until it is corrected. Use a non-negative whole number, or 0 for "no limit".',
      );
    }
  }

  /** The ceiling actually in force (`0` ⇒ unlimited). @internal test seam */
  get enforcedQuota(): number {
    return this.limit;
  }

  /**
   * Charge one send against today's budget and answer whether it may proceed.
   *
   * Never throws: a store outage fails OPEN (announced once per process), for
   * the reason in the file header — an SMS cost ceiling that can block sign-in
   * is a worse problem than the one it solves.
   */
  async checkAndRecord(): Promise<SmsDailyQuotaDecision> {
    if (this.limit <= 0) return { ok: true, quota: 0 };
    const now = this.now();
    const day = utcDayStamp(now);
    try {
      const store = await this.resolveStore();
      const { count } = await incrementFixedWindow(
        store,
        KEY_PREFIX + day,
        secondsUntilNextUtcMidnight(now),
        now,
      );

      if (count > this.limit) {
        if (this.exceededWarnedFor !== day) {
          this.exceededWarnedFor = day;
          this.logger?.warn?.(
            `[sms] daily SMS quota reached — further sends are refused until 00:00 UTC.`,
            { day, count, quota: this.limit },
          );
        }
        return { ok: false, count, quota: this.limit };
      }

      if (count >= Math.ceil(this.limit * NEAR_LIMIT_RATIO) && this.nearLimitWarnedFor !== day) {
        this.nearLimitWarnedFor = day;
        this.logger?.warn?.(
          `[sms] daily SMS quota is ${Math.round(NEAR_LIMIT_RATIO * 100)}% consumed.`,
          { day, count, quota: this.limit },
        );
      }
      return { ok: true, count, quota: this.limit };
    } catch (err) {
      if (!this.degradedWarned) {
        this.degradedWarned = true;
        this.logger?.warn?.(
          '[sms] daily SMS quota counter is unreadable (' +
            String((err as Error)?.message ?? err) +
            ') — the gate is FAILING OPEN and today\'s spend is unbounded until the counter store recovers. ' +
            'Sign-in is deliberately not taken down with it (#2814).',
        );
      }
      return { ok: true };
    }
  }
}
