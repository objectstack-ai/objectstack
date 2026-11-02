// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin: the kernel's in-memory `cache` stand-in stays bounded by
 * what is live. Entries whose TTL has passed leave the map without having to
 * be read again, and nothing live is ever evicted to get there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCache } from './memory-cache';

const WAVE = 1_000;
const WAVES = 20;

describe('createMemoryCache — bounded by its live entries', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('many distinct keys that expire unread do not accumulate', async () => {
        const cache = createMemoryCache();
        for (let wave = 0; wave < WAVES; wave++) {
            for (let i = 0; i < WAVE; i++) await cache.set(`wave${wave}:key${i}`, { n: 1 }, 1);
            // Let the whole wave expire; none of its keys is ever read again.
            vi.advanceTimersByTime(2_000);
        }
        const { keyCount } = await cache.stats();
        // Unbounded, the map would hold every key ever written (WAVES × WAVE).
        expect(keyCount).toBeLessThan(3 * WAVE);
    });

    it('never evicts a live entry: no TTL, or a TTL still running, survives every sweep', async () => {
        const cache = createMemoryCache();
        await cache.set('pinned', 'forever');
        await cache.set('long', 'still-live', 3_600);
        for (let wave = 0; wave < WAVES; wave++) {
            for (let i = 0; i < WAVE; i++) await cache.set(`wave${wave}:key${i}`, i, 1);
            vi.advanceTimersByTime(2_000);
        }
        // The last wave was written with time running; write one more, still live.
        for (let i = 0; i < WAVE; i++) await cache.set(`live:key${i}`, i, 60);
        expect(await cache.get('pinned')).toBe('forever');
        expect(await cache.get('long')).toBe('still-live');
        for (let i = 0; i < WAVE; i++) expect(await cache.get(`live:key${i}`)).toBe(i);
    });

    it('an expired entry still reads as absent before any sweep reaches it', async () => {
        const cache = createMemoryCache();
        await cache.set('k', 'v', 1);
        vi.advanceTimersByTime(1_500);
        expect(await cache.get('k')).toBeUndefined();
    });
});
