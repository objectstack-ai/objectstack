// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Generic contract tests for cluster primitives.
 *
 * These are written once and run against any driver. The memory driver
 * suite calls them directly; driver packages (the redis driver today,
 * any future ones)
 * `import { runPubSubContract } from '@objectstack/service-cluster/testing'`
 * to get the same coverage for free.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
    IPubSub,
    ILock,
    IKV,
    ICounter,
} from '@objectstack/spec/contracts';

export interface ContractFactories {
    makePubSub: () => Promise<IPubSub>;
    makeLock: () => Promise<ILock>;
    makeKV: () => Promise<IKV>;
    makeCounter: () => Promise<ICounter>;
}

export function runPubSubContract(name: string, make: () => Promise<IPubSub>) {
    describe(`IPubSub contract — ${name}`, () => {
        it('delivers published messages to subscribers', async () => {
            const bus = await make();
            const received: unknown[] = [];
            bus.subscribe<{ n: number }>('ch', (msg) => {
                received.push(msg.payload);
            });
            await bus.publish('ch', { n: 1 });
            await bus.publish('ch', { n: 2 });
            expect(received).toEqual([{ n: 1 }, { n: 2 }]);
            await bus.close();
        });

        it('does not deliver to other channels', async () => {
            const bus = await make();
            const h = vi.fn();
            bus.subscribe('a', h);
            await bus.publish('b', { x: 1 });
            expect(h).not.toHaveBeenCalled();
            await bus.close();
        });

        it('supports multiple subscribers per channel', async () => {
            const bus = await make();
            const a = vi.fn();
            const b = vi.fn();
            bus.subscribe('ch', a);
            bus.subscribe('ch', b);
            await bus.publish('ch', 'hi');
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
            await bus.close();
        });

        it('unsubscribe stops delivery and is idempotent', async () => {
            const bus = await make();
            const h = vi.fn();
            const off = bus.subscribe('ch', h);
            await bus.publish('ch', 1);
            off();
            off(); // idempotent
            await bus.publish('ch', 2);
            expect(h).toHaveBeenCalledTimes(1);
            await bus.close();
        });

        it('isolates handler errors from siblings', async () => {
            const errors: unknown[] = [];
            const bus = await make();
            // Memory driver allows override via constructor; for the
            // generic contract we just verify no throw leaks to publish().
            bus.subscribe('ch', () => {
                throw new Error('boom');
            });
            const ok = vi.fn();
            bus.subscribe('ch', ok);
            await expect(bus.publish('ch', 1)).resolves.toBeUndefined();
            expect(ok).toHaveBeenCalledTimes(1);
            await bus.close();
            void errors;
        });

        it('close rejects further publishes', async () => {
            const bus = await make();
            await bus.close();
            await expect(bus.publish('ch', 1)).rejects.toThrow(/closed/);
        });
    });
}

export function runLockContract(name: string, make: () => Promise<ILock>) {
    describe(`ILock contract — ${name}`, () => {
        it('acquires and releases a free lock', async () => {
            const l = await make();
            const h = await l.acquire('k');
            expect(h).not.toBeNull();
            expect(h!.isHeld()).toBe(true);
            await h!.release();
            expect(h!.isHeld()).toBe(false);
            await l.close();
        });

        it('fails fast when waitMs=0 and lock is held', async () => {
            const l = await make();
            const h1 = await l.acquire('k');
            expect(h1).not.toBeNull();
            const h2 = await l.acquire('k');
            expect(h2).toBeNull();
            await h1!.release();
            await l.close();
        });

        it('hands off lock to a waiter on release', async () => {
            const l = await make();
            const h1 = await l.acquire('k');
            const waiterP = l.acquire('k', { waitMs: 1000 });
            await new Promise((r) => setTimeout(r, 10));
            await h1!.release();
            const h2 = await waiterP;
            expect(h2).not.toBeNull();
            expect(h2!.isHeld()).toBe(true);
            await h2!.release();
            await l.close();
        });

        it('TTL auto-releases a stuck holder', async () => {
            const l = await make();
            const h1 = await l.acquire('k', { ttlMs: 50 });
            expect(h1).not.toBeNull();
            await new Promise((r) => setTimeout(r, 150));
            expect(h1!.isHeld()).toBe(false);
            const h2 = await l.acquire('k');
            expect(h2).not.toBeNull();
            await h2!.release();
            await l.close();
        });

        it('fencing tokens are monotonically increasing per key', async () => {
            const l = await make();
            const h1 = await l.acquire('k');
            const t1 = h1!.fencingToken;
            await h1!.release();
            const h2 = await l.acquire('k');
            expect(h2!.fencingToken).toBeGreaterThan(t1);
            await h2!.release();
            await l.close();
        });

        it('renew extends the lease', async () => {
            const l = await make();
            const h = await l.acquire('k', { ttlMs: 200 });
            await new Promise((r) => setTimeout(r, 50));
            await h!.renew(400);
            await new Promise((r) => setTimeout(r, 250));
            // total 300ms in, original TTL would have expired at 200ms.
            expect(h!.isHeld()).toBe(true);
            await h!.release();
            await l.close();
        });

        it('renew on a lost lock throws', async () => {
            const l = await make();
            const h = await l.acquire('k', { ttlMs: 50 });
            await new Promise((r) => setTimeout(r, 150));
            await expect(h!.renew()).rejects.toThrow();
            await l.close();
        });

        it('withLock returns fn result and auto-releases', async () => {
            const l = await make();
            const result = await l.withLock('k', async () => 42);
            expect(result).toBe(42);
            // Lock should be free immediately.
            const h = await l.acquire('k');
            expect(h).not.toBeNull();
            await h!.release();
            await l.close();
        });

        it('withLock returns null without calling fn on timeout', async () => {
            const l = await make();
            const h = await l.acquire('k');
            const fn = vi.fn();
            const result = await l.withLock('k', fn, { waitMs: 0 });
            expect(result).toBeNull();
            expect(fn).not.toHaveBeenCalled();
            await h!.release();
            await l.close();
        });

        it('release is idempotent', async () => {
            const l = await make();
            const h = await l.acquire('k');
            await h!.release();
            await expect(h!.release()).resolves.toBeUndefined();
            await l.close();
        });
    });
}

export function runKVContract(name: string, make: () => Promise<IKV>) {
    describe(`IKV contract — ${name}`, () => {
        it('set then get round-trips and increments version', async () => {
            const kv = await make();
            const a = await kv.set('k', { v: 1 });
            expect(a.version).toBe(1n);
            const got = await kv.get<{ v: number }>('k');
            expect(got?.value).toEqual({ v: 1 });
            const b = await kv.set('k', { v: 2 });
            expect(b.version).toBe(2n);
            await kv.close();
        });

        it('get on missing key returns undefined', async () => {
            const kv = await make();
            expect(await kv.get('absent')).toBeUndefined();
            await kv.close();
        });

        it('delete removes the key', async () => {
            const kv = await make();
            await kv.set('k', 1);
            expect(await kv.delete('k')).toBe(true);
            expect(await kv.get('k')).toBeUndefined();
            expect(await kv.delete('k')).toBe(false);
            await kv.close();
        });

        it('ifVersion=0n requires absent key', async () => {
            const kv = await make();
            await kv.set('k', 'first', { ifVersion: 0n });
            await expect(kv.set('k', 'dup', { ifVersion: 0n })).rejects.toThrow(
                /version mismatch/i,
            );
            await kv.close();
        });

        it('cas succeeds on match, fails on mismatch', async () => {
            const kv = await make();
            const e1 = await kv.set('k', 1);
            const e2 = await kv.cas('k', e1.version, 2);
            expect(e2?.value).toBe(2);
            const failed = await kv.cas('k', e1.version, 3);
            expect(failed).toBeUndefined();
            await kv.close();
        });

        it('TTL expires entries', async () => {
            const kv = await make();
            await kv.set('k', 'v', { ttl: 0.03 }); // 30ms
            expect((await kv.get('k'))?.value).toBe('v');
            await new Promise((r) => setTimeout(r, 60));
            expect(await kv.get('k')).toBeUndefined();
            await kv.close();
        });
    });
}

export function runCounterContract(name: string, make: () => Promise<ICounter>) {
    describe(`ICounter contract — ${name}`, () => {
        it('starts at 0, incr returns new value', async () => {
            const c = await make();
            expect(await c.peek('k')).toBe(0n);
            expect(await c.incr('k')).toBe(1n);
            expect(await c.incr('k')).toBe(2n);
            expect(await c.peek('k')).toBe(2n);
            await c.close();
        });

        it('incr by custom delta', async () => {
            const c = await make();
            expect(await c.incr('k', { by: 5 })).toBe(5n);
            expect(await c.incr('k', { by: -2 })).toBe(3n);
            await c.close();
        });

        it('reset', async () => {
            const c = await make();
            await c.incr('k', { by: 10 });
            await c.reset('k', 100n);
            expect(await c.peek('k')).toBe(100n);
            await c.reset('k');
            expect(await c.peek('k')).toBe(0n);
            await c.close();
        });

        it('isolates keys', async () => {
            const c = await make();
            await c.incr('a');
            await c.incr('b', { by: 7 });
            expect(await c.peek('a')).toBe(1n);
            expect(await c.peek('b')).toBe(7n);
            await c.close();
        });
    });
}

export function runFullContract(name: string, f: ContractFactories) {
    runPubSubContract(name, f.makePubSub);
    runLockContract(name, f.makeLock);
    runKVContract(name, f.makeKV);
    runCounterContract(name, f.makeCounter);
}
