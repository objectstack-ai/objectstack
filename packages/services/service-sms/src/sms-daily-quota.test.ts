// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  SmsDailyQuota,
  SMS_QUOTA_EXCEEDED_CODE,
  normalizeDailyQuota,
  secondsUntilNextUtcMidnight,
  utcDayStamp,
} from './sms-daily-quota.js';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';

/** A memory counter store with the same tolerance the cache adapters have. */
function memoryStore(): CounterStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return entries.get(key) as T | undefined;
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      entries.set(key, value);
    },
  };
}

function logger() {
  return { info: vi.fn(), warn: vi.fn() };
}

/** 2026-08-06T12:00:00Z — midday, so the day boundary is unambiguous. */
const NOON = Date.UTC(2026, 7, 6, 12, 0, 0);

describe('normalizeDailyQuota — the clamp lives on the CONSUMER side (#5932)', () => {
  it('reads a whole number as the ceiling', () => {
    expect(normalizeDailyQuota(2000)).toEqual({ limit: 2000 });
  });

  it('treats an unset / cleared value as "no limit", quietly', () => {
    expect(normalizeDailyQuota(undefined)).toEqual({ limit: 0 });
    expect(normalizeDailyQuota(null)).toEqual({ limit: 0 });
    expect(normalizeDailyQuota('')).toEqual({ limit: 0 });
    expect(normalizeDailyQuota('   ')).toEqual({ limit: 0 });
  });

  it('treats 0 as "no limit" (the documented disable value)', () => {
    expect(normalizeDailyQuota(0)).toEqual({ limit: 0 });
  });

  it('floors a fractional count — the stricter direction, no diagnostic', () => {
    expect(normalizeDailyQuota(100.9)).toEqual({ limit: 100 });
    expect(normalizeDailyQuota('7.5')).toEqual({ limit: 7 });
  });

  it('coerces a numeric string (an env override arrives before coercion in some hosts)', () => {
    expect(normalizeDailyQuota('250')).toEqual({ limit: 250 });
  });

  it('rejects garbage to "no limit" and NAMES the offending value', () => {
    // #5932 has closed the producer half — `daily_quota: -1` is now refused at
    // `PUT /api/settings/sms` — but every value below can still reach this
    // reader: the window check judges only comparable NUMBERS (a shape verdict
    // belongs to `invalid_type`), and it runs under the TOUCH gate, so rows
    // stored before the gate survive. Each stays pinned rather than assumed
    // impossible.
    expect(normalizeDailyQuota(-1)).toEqual({ limit: 0, rejected: '-1' });
    expect(normalizeDailyQuota(Number.NaN)).toEqual({ limit: 0, rejected: 'NaN' });
    expect(normalizeDailyQuota(Number.POSITIVE_INFINITY)).toEqual({ limit: 0, rejected: 'Infinity' });
    expect(normalizeDailyQuota('unlimited')).toEqual({ limit: 0, rejected: 'unlimited' });
    expect(normalizeDailyQuota(true)).toEqual({ limit: 0, rejected: 'true' });
    expect(normalizeDailyQuota({ n: 5 })).toEqual({ limit: 0, rejected: '{"n":5}' });
  });
});

describe('SmsDailyQuota — the day window', () => {
  it('stamps the key with the UTC calendar day', () => {
    expect(utcDayStamp(NOON)).toBe('2026-08-06');
    expect(utcDayStamp(Date.UTC(2026, 7, 6, 23, 59, 59, 999))).toBe('2026-08-06');
    expect(utcDayStamp(Date.UTC(2026, 7, 7, 0, 0, 0))).toBe('2026-08-07');
  });

  it('opens the window with exactly the seconds left until the next UTC midnight', () => {
    expect(secondsUntilNextUtcMidnight(NOON)).toBe(12 * 3600);
    expect(secondsUntilNextUtcMidnight(Date.UTC(2026, 7, 6, 23, 59, 59))).toBe(1);
    // Never zero — `incrementFixedWindow` floors a TTL at 1s.
    expect(secondsUntilNextUtcMidnight(Date.UTC(2026, 7, 6, 0, 0, 0))).toBe(24 * 3600);
  });

  it('rolls the counter over at 00:00 UTC — a fresh day starts at 1', async () => {
    const store = memoryStore();
    let now = Date.UTC(2026, 7, 6, 23, 59, 0);
    const quota = new SmsDailyQuota({ resolveStore: async () => store, now: () => now });
    quota.setQuota(2);

    expect(await quota.checkAndRecord()).toMatchObject({ ok: true, count: 1 });
    expect(await quota.checkAndRecord()).toMatchObject({ ok: true, count: 2 });
    expect(await quota.checkAndRecord()).toMatchObject({ ok: false, count: 3 });

    // One minute later it is a new UTC day: a different key, a fresh budget.
    now = Date.UTC(2026, 7, 7, 0, 0, 30);
    expect(await quota.checkAndRecord()).toMatchObject({ ok: true, count: 1 });
    expect([...store.entries.keys()]).toEqual([
      'sms-daily-sends:2026-08-06',
      'sms-daily-sends:2026-08-07',
    ]);
  });

  it('keeps the window pinned to midnight rather than sliding forward per send', async () => {
    const store = memoryStore();
    let now = Date.UTC(2026, 7, 6, 22, 0, 0);
    const quota = new SmsDailyQuota({ resolveStore: async () => store, now: () => now });
    quota.setQuota(10);
    await quota.checkAndRecord();
    const envelope = JSON.parse(String(store.entries.get('sms-daily-sends:2026-08-06')));
    expect(envelope.exp).toBe(Date.UTC(2026, 7, 7, 0, 0, 0));

    now = Date.UTC(2026, 7, 6, 23, 0, 0);
    await quota.checkAndRecord();
    const after = JSON.parse(String(store.entries.get('sms-daily-sends:2026-08-06')));
    expect(after.exp).toBe(envelope.exp); // NOT extended by the second send
    expect(after.n).toBe(2);
  });
});

describe('SmsDailyQuota — enforcement', () => {
  it('0 means unlimited: the counter is never even consulted', async () => {
    const store = memoryStore();
    const quota = new SmsDailyQuota({ resolveStore: async () => store, now: () => NOON });
    quota.setQuota(0);
    for (let i = 0; i < 50; i++) expect((await quota.checkAndRecord()).ok).toBe(true);
    expect(store.entries.size).toBe(0);
  });

  it('admits exactly `limit` sends and refuses the next', async () => {
    const store = memoryStore();
    const quota = new SmsDailyQuota({ resolveStore: async () => store, now: () => NOON });
    quota.setQuota(3);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect(await quota.checkAndRecord()).toMatchObject({ ok: false, count: 4, quota: 3 });
  });

  it('a live setQuota change takes effect on the next send (no restart)', async () => {
    const store = memoryStore();
    const quota = new SmsDailyQuota({ resolveStore: async () => store, now: () => NOON });
    quota.setQuota(1);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect((await quota.checkAndRecord()).ok).toBe(false);
    quota.setQuota(10); // admin raises the ceiling
    expect((await quota.checkAndRecord()).ok).toBe(true);
    quota.setQuota(0); // …and then removes it entirely
    expect((await quota.checkAndRecord()).ok).toBe(true);
  });

  it('counts through ONE store, so two service instances share the budget', async () => {
    const store = memoryStore();
    const a = new SmsDailyQuota({ resolveStore: async () => store, now: () => NOON });
    const b = new SmsDailyQuota({ resolveStore: async () => store, now: () => NOON });
    a.setQuota(2);
    b.setQuota(2);
    expect((await a.checkAndRecord()).ok).toBe(true);
    expect((await b.checkAndRecord()).ok).toBe(true);
    expect((await a.checkAndRecord()).ok).toBe(false);
  });

  it('falls back to a bounded per-process store when no resolver is supplied', async () => {
    const quota = new SmsDailyQuota({ now: () => NOON });
    quota.setQuota(1);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect((await quota.checkAndRecord()).ok).toBe(false);
  });
});

describe('SmsDailyQuota — observability (#5573: no key/token/secret/password field names)', () => {
  const SENSITIVE = /key|token|secret|password/i;

  it('WARNs once per day at 80% consumption, with the count and no body', async () => {
    const log = logger();
    const store = memoryStore();
    const quota = new SmsDailyQuota({ resolveStore: async () => store, logger: log, now: () => NOON });
    quota.setQuota(5);
    for (let i = 0; i < 3; i++) await quota.checkAndRecord();
    expect(log.warn).not.toHaveBeenCalled();

    await quota.checkAndRecord(); // 4/5 = 80%
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [msg, meta] = log.warn.mock.calls[0]!;
    expect(String(msg)).toMatch(/80% consumed/);
    expect(meta).toEqual({ day: '2026-08-06', count: 4, quota: 5 });
    for (const field of Object.keys(meta as object)) expect(field).not.toMatch(SENSITIVE);

    await quota.checkAndRecord(); // 5/5 — still under the ceiling, no second line
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('WARNs once per day on the refusal, carrying the count and never a recipient/body', async () => {
    const log = logger();
    const store = memoryStore();
    const quota = new SmsDailyQuota({ resolveStore: async () => store, logger: log, now: () => NOON });
    quota.setQuota(1);
    await quota.checkAndRecord(); // 1/1 → also the 80% line
    log.warn.mockClear();

    await quota.checkAndRecord();
    await quota.checkAndRecord();
    await quota.checkAndRecord();
    expect(log.warn).toHaveBeenCalledTimes(1); // deduped, not a firehose
    const [msg, meta] = log.warn.mock.calls[0]!;
    expect(String(msg)).toMatch(/daily SMS quota reached/);
    expect(meta).toMatchObject({ day: '2026-08-06', quota: 1 });
    for (const field of Object.keys(meta as object)) expect(field).not.toMatch(SENSITIVE);
  });

  it('reports a rejected quota value once per distinct value', () => {
    const log = logger();
    const quota = new SmsDailyQuota({ logger: log });
    quota.setQuota(-5);
    quota.setQuota(-5);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toContain("'-5'");
    quota.setQuota('nope');
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(quota.enforcedQuota).toBe(0); // degraded to "no limit", not to a block
  });
});

describe('SmsDailyQuota — fail-open (an SMS ceiling must not take sign-in down)', () => {
  it('admits and WARNs once when the counter store is unreadable', async () => {
    const log = logger();
    const broken: CounterStore = {
      async get() { throw new Error('redis connection refused'); },
      async set() { throw new Error('redis connection refused'); },
    };
    const quota = new SmsDailyQuota({ resolveStore: async () => broken, logger: log, now: () => NOON });
    quota.setQuota(1);

    for (let i = 0; i < 5; i++) {
      const d = await quota.checkAndRecord();
      expect(d.ok).toBe(true); // fail OPEN, every time
      expect(d.count).toBeUndefined(); // no count is claimed when none was read
    }
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![0])).toMatch(/FAILING OPEN/);
    expect(String(log.warn.mock.calls[0]![0])).toContain('redis connection refused');
  });

  it('admits when the store resolver itself explodes', async () => {
    const quota = new SmsDailyQuota({
      resolveStore: async () => { throw new Error('no cache service'); },
      now: () => NOON,
    });
    quota.setQuota(1);
    expect((await quota.checkAndRecord()).ok).toBe(true);
    expect((await quota.checkAndRecord()).ok).toBe(true);
  });
});

describe('SMS_QUOTA_EXCEEDED_CODE', () => {
  it('is the same code the per-number OTP guard raises — the two walls look alike from outside', () => {
    // plugin-auth's `assertPhoneOtpSendAllowed` throws
    // `APIError('TOO_MANY_REQUESTS')`; #2814 asks the total-cost gate to be
    // indistinguishable so an attacker cannot probe which budget they hit.
    expect(SMS_QUOTA_EXCEEDED_CODE).toBe('TOO_MANY_REQUESTS');
  });
});
