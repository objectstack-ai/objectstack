// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Stable, framework-free partition hash. The dispatcher uses this to
 * assign webhooks to partitions; the in-memory outbox uses the same hash
 * to filter rows in `claim()`. Both call sites MUST agree, which is why
 * this is a single shared helper.
 *
 * Uses a 32-bit FNV-1a variant — fast, no allocations, deterministic.
 */
export function hashPartition(key: string, count: number): number {
    if (count <= 0) throw new Error('partition count must be > 0');
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return Math.abs(h | 0) % count;
}
