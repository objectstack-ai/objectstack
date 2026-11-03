// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): inside one process, a token bucket admits
 * no more than its budget however many requests for one key arrive at once —
 * in a networked cache whose read and write are separate awaited calls, and in
 * the per-process fallback alike. Serialisation is per KEY: other keys keep
 * counting concurrently, and nothing is left behind once a burst has drained.
 *
 * The same `SharedTokenBucketLimiter` backs the server-level inbound limiter
 * and the declarative endpoint limiters, so both are exercised through their
 * public builders.
 */

import { describe, expect, it } from 'vitest';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';

import { createEndpointRateLimiterRegistry } from '../endpoint-policy.js';
import { createInboundRateLimitMiddleware, SharedTokenBucketLimiter } from './inbound-rate-limit.js';
import { serializePerKey, serializedKeysInFlight } from './per-key-serial.js';

const BURST = 20;
const CAPACITY = 3;
/** A slow refill, so no token comes back while a burst is in flight. */
const BUCKET = { capacity: CAPACITY, refillPerSec: 0.001 } as const;
const CLOCK = (): number => 1_000_000;

/** A cache stand-in whose reads and writes each cross a macrotask, as a networked store's do. */
function makeNetworkedCache(): CounterStore & { readonly store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    const hop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    return {
        store,
        async get<T = unknown>(key: string): Promise<T | undefined> {
            await hop();
            return store.get(key) as T | undefined;
        },
        async set<T = unknown>(key: string, value: T): Promise<void> {
            await hop();
            store.set(key, value);
        },
    };
}

async function admittedOfBurst(consume: () => Promise<{ allowed: boolean }>): Promise<number> {
    const decisions = await Promise.all(Array.from({ length: BURST }, consume));
    return decisions.filter((d) => d.allowed).length;
}

describe('concurrent consumes of one key never exceed the budget (one process)', () => {
    it('networked cache: exactly `capacity` of the burst are admitted', async () => {
        const cache = makeNetworkedCache();
        const limiter = new SharedTokenBucketLimiter(BUCKET, async () => cache, CLOCK);
        expect(await admittedOfBurst(() => limiter.consume('principal:burst'))).toBe(CAPACITY);
        // The stored bucket is empty: every admitted request spent its token.
        expect(JSON.parse(cache.store.get('principal:burst') as string)).toMatchObject({ t: 0 });
    });

    it('per-process fallback (no cache service): exactly `capacity` of the burst are admitted', async () => {
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: CAPACITY, windowMs: 3_600_000 },
            resolveCache: async () => undefined,
        })!;
        let passed = 0;
        let refused = 0;
        await Promise.all(Array.from({ length: BURST }, async () => {
            const res: any = {
                status(code: number) { if (code === 429) refused++; return res; },
                header() { return res; },
                json() {},
                send() {},
            };
            const req: any = { method: 'GET', path: '/api/v1/x', headers: {}, query: {}, params: {}, remoteAddress: '10.9.9.9' };
            await middleware(req, res, async () => { passed++; });
        }));
        expect(passed).toBe(CAPACITY);
        expect(refused).toBe(BURST - CAPACITY);
    });

    it('declared endpoint budget: exactly `capacity` of the burst are admitted', async () => {
        const cache = makeNetworkedCache();
        const registry = createEndpointRateLimiterRegistry({ resolveCache: async () => cache, now: CLOCK });
        const limiter = registry.limiterFor({
            name: 'burst_endpoint',
            rateLimit: { enabled: true, maxRequests: CAPACITY, windowMs: 3_600_000 },
        } as never)!;
        expect(await admittedOfBurst(() => limiter.consume('endpoint:burst_endpoint:ip:10.0.0.1'))).toBe(CAPACITY);
    });

    it('serialisation is per key: a burst on one key does not change another key', async () => {
        const cache = makeNetworkedCache();
        const limiter = new SharedTokenBucketLimiter(BUCKET, async () => cache, CLOCK);
        const [a, b] = await Promise.all([
            admittedOfBurst(() => limiter.consume('ip:10.0.0.1')),
            admittedOfBurst(() => limiter.consume('ip:10.0.0.2')),
        ]);
        expect([a, b]).toEqual([CAPACITY, CAPACITY]);
    });

    it('a key parked inside its update does not hold up another key', async () => {
        let release!: () => void;
        const parked = serializePerKey('parked', () => new Promise<void>((resolve) => { release = resolve; }));
        await expect(serializePerKey('other', async () => 'ran')).resolves.toBe('ran');
        release();
        await parked;
    });

    it('a failing update releases the next one, and no key is left behind once a burst drains', async () => {
        const failing = serializePerKey('k', async () => { throw new Error('store down'); });
        const next = serializePerKey('k', async () => 'next');
        await expect(failing).rejects.toThrow('store down');
        await expect(next).resolves.toBe('next');

        const cache = makeNetworkedCache();
        const limiter = new SharedTokenBucketLimiter(BUCKET, async () => cache, CLOCK);
        await admittedOfBurst(() => limiter.consume('principal:drain'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(serializedKeysInFlight()).toBe(0);
    });
});
