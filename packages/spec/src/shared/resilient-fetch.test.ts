// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { resilientFetch } from './resilient-fetch';

/** Minimal Response stand-in — resilientFetch only reads `.status` + `.headers.get`. */
function resp(status: number, headers: Record<string, string> = {}): Response {
    return {
        status,
        ok: status < 400,
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    } as unknown as Response;
}

/** A fetch that returns the scripted statuses in order (last one repeats). */
function scripted(statuses: Array<number | Record<string, string> | [number, Record<string, string>]>) {
    let i = 0;
    return vi.fn(async () => {
        const s = statuses[Math.min(i++, statuses.length - 1)];
        if (Array.isArray(s)) return resp(s[0], s[1]);
        return resp(s as number);
    });
}

const noSleep = async () => {};

/**
 * A sleep spy whose ARGUMENT is typed, so `mock.calls` is a tuple of one number
 * and the delay sequence can be read off it. `vi.fn(noSleep)` cannot: `noSleep`
 * declares no parameter, so its calls type as `[]` and every index read is a
 * type error.
 */
const sleepSpy = () => vi.fn(async (_ms: number): Promise<void> => {});

describe('resilientFetch', () => {
    it('returns a successful response without retrying', async () => {
        const fetchImpl = scripted([200]);
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep });
        expect(res.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('retries a 429 then returns the success', async () => {
        const fetchImpl = scripted([429, 200]);
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 3 });
        expect(res.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('retries a 5xx then returns the success', async () => {
        const fetchImpl = scripted([503, 500, 200]);
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 3 });
        expect(res.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('gives up after `retries` attempts and returns the last response', async () => {
        const fetchImpl = scripted([500, 500, 500]);
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 3 });
        expect(res.status).toBe(500);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry a non-retryable status (4xx other than 429)', async () => {
        const fetchImpl = scripted([404, 200]);
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 3 });
        expect(res.status).toBe(404);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('honours a numeric Retry-After header on a 429', async () => {
        const fetchImpl = scripted([[429, { 'retry-after': '2' }], 200]);
        const sleep = vi.fn(noSleep);
        await resilientFetch('http://x', {}, { fetchImpl, sleep, retries: 3 });
        // One 429 ⇒ exactly ONE backoff. This is a retry path, where a doubled sleep
        // is a real defect and `toHaveBeenCalledWith(2000)` cannot see it (#15607).
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(2000);
    });

    it('times out a hung request and surfaces the error', async () => {
        const fetchImpl = vi.fn(
            (_url: any, init: any) =>
                new Promise<Response>((_, reject) => {
                    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                }),
        );
        await expect(
            resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 1, timeoutMs: 10 }),
        ).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('retries a network error before succeeding', async () => {
        let n = 0;
        const fetchImpl = vi.fn(async () => {
            if (n++ === 0) throw new Error('ECONNRESET');
            return resp(200);
        });
        const res = await resilientFetch('http://x', {}, { fetchImpl, sleep: noSleep, retries: 3 });
        expect(res.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    // ── The policy knobs (#18975) ───────────────────────────────────────────
    // Each one is a key `connector.retryConfig` declares, so each pin asserts a
    // DELAY SEQUENCE or a CALL COUNT — something that changes when the knob is
    // ignored. `sleep` is captured rather than stubbed so the delays are read,
    // not assumed, and `jitter: false` is what makes them exact (the default
    // +[0,100)ms is unassertable by design).

    it('linear_backoff grows the delay by one base per attempt', async () => {
        const fetchImpl = scripted([500, 500, 500, 200]);
        const sleep = sleepSpy();
        await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 4,
            strategy: 'linear_backoff', backoffBaseMs: 100, jitter: false,
        });
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200, 300]);
    });

    it('fixed_delay keeps every delay at the base', async () => {
        const fetchImpl = scripted([500, 500, 200]);
        const sleep = sleepSpy();
        await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 3,
            strategy: 'fixed_delay', backoffBaseMs: 250, jitter: false,
        });
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 250]);
    });

    it('no_retry makes the first attempt the only one, whatever `retries` says', async () => {
        const fetchImpl = scripted([500, 200]);
        const sleep = vi.fn(noSleep);
        const res = await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 5, strategy: 'no_retry',
        });
        expect(res.status).toBe(500);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('backoffMultiplier drives exponential growth (not a hardcoded 2)', async () => {
        const fetchImpl = scripted([500, 500, 500, 200]);
        const sleep = sleepSpy();
        await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 4,
            backoffBaseMs: 100, backoffMultiplier: 3, jitter: false,
        });
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 300, 900]);
    });

    it('maxDelayMs caps the delay — and caps it AFTER jitter, so it is a real maximum', async () => {
        const fetchImpl = scripted([500, 500, 500, 200]);
        const sleep = sleepSpy();
        await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 4,
            backoffBaseMs: 100, backoffMultiplier: 10, maxDelayMs: 500, jitter: true,
        });
        // Jitter is on, so only the ceiling is assertable — which is the point:
        // every delay must be <= the declared maximum, jitter included.
        const delays = sleep.mock.calls.map((c) => c[0]);
        expect(delays).toHaveLength(3);
        for (const d of delays) expect(d).toBeLessThanOrEqual(500);
        expect(delays[2]).toBe(500);
    });

    it('maxDelayMs bounds a Retry-After by STOPPING — it is a maximum, not a suggestion', async () => {
        // The defect this pins: `Retry-After` used to be exempt from the cap,
        // so `maxDelayMs: 1000` against `retry-after: 3600` slept 3600000ms —
        // 3600x the declared ceiling, on the card whose whole point is that a
        // declaration equals its enforcement. The retry loop now ends instead,
        // and the caller gets the real response and its header.
        const fetchImpl = scripted([[429, { 'retry-after': '3600' }], 200]);
        const sleep = sleepSpy();
        const res = await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 3, backoffBaseMs: 100, maxDelayMs: 1000, jitter: false,
        });
        expect(res.status).toBe(429);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('a Retry-After WITHIN the ceiling is still honoured and still retried', async () => {
        // The control for the pin above: the stop is about exceeding the
        // ceiling, not about `Retry-After` being present.
        const fetchImpl = scripted([[429, { 'retry-after': '2' }], 200]);
        const sleep = sleepSpy();
        const res = await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 3, backoffBaseMs: 100, maxDelayMs: 5000, jitter: false,
        });
        expect(res.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000]);
    });

    it('jitter: false makes the delay exactly the computed backoff', async () => {
        const fetchImpl = scripted([500, 200]);
        const sleep = vi.fn(noSleep);
        await resilientFetch('http://x', {}, {
            fetchImpl, sleep, retries: 2, backoffBaseMs: 400, jitter: false,
        });
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(400);
    });

    it('retryOnNetworkError: false surfaces the network error without a second attempt', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
        const sleep = vi.fn(noSleep);
        await expect(
            resilientFetch('http://x', {}, { fetchImpl, sleep, retries: 3, retryOnNetworkError: false }),
        ).rejects.toThrow(/ECONNRESET/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('retryableStatus narrows what is retried — a 500 is final when only 429 is listed', async () => {
        const codes = [429];
        const fetchImpl = scripted([500, 200]);
        const res = await resilientFetch('http://x', {}, {
            fetchImpl, sleep: noSleep, retries: 3,
            retryableStatus: (s) => codes.includes(s),
        });
        expect(res.status).toBe(500);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not retry when the caller aborts', async () => {
        const ac = new AbortController();
        ac.abort();
        const fetchImpl = vi.fn(async (_u: any, init: any) => {
            if (init.signal.aborted) throw new Error('aborted by caller');
            return resp(200);
        });
        await expect(
            resilientFetch('http://x', { signal: ac.signal }, { fetchImpl, sleep: noSleep, retries: 3 }),
        ).rejects.toThrow(/aborted/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
