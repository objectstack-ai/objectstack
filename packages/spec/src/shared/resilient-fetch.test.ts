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
