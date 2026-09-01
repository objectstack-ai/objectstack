// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ICounter, CounterIncrOptions } from '@objectstack/spec/contracts';

/**
 * In-memory monotonic counter. Single-process only — for cross-node id
 * allocation, use the redis driver.
 */
export class MemoryCounter implements ICounter {
    private readonly counters = new Map<string, bigint>();
    private closed = false;

    async incr(key: string, opts: CounterIncrOptions = {}): Promise<bigint> {
        if (this.closed) throw new Error('MemoryCounter is closed');
        const by = BigInt(opts.by ?? 1);
        const current = this.counters.get(key) ?? 0n;
        const next = current + by;
        this.counters.set(key, next);
        return next;
    }

    async peek(key: string): Promise<bigint> {
        return this.counters.get(key) ?? 0n;
    }

    async reset(key: string, value: bigint = 0n): Promise<void> {
        if (this.closed) throw new Error('MemoryCounter is closed');
        if (value === 0n) this.counters.delete(key);
        else this.counters.set(key, value);
    }

    async close(): Promise<void> {
        this.closed = true;
        this.counters.clear();
    }
}
