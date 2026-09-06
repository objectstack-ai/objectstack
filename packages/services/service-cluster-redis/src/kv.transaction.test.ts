// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the two `RedisKV` limbs the shipped contract suite in
 * `redis.contract.test.ts` does not assert: the WATCH/MULTI abort-retry
 * loop, and the versioned-delete MULTI/DEL branch.
 *
 * ## What was measured before writing these, and how
 *
 * Instrument 1 — a recording `Proxy` around the `makeClient()` of an
 * otherwise byte-identical copy of the shipped suite, run unmodified
 * (28/28 green under instrumentation), dumping every method the driver
 * invoked on the injected client plus every `multi().exec()` return
 * value. Its reading:
 *
 *   - `multi().del` is called ZERO times. The only call site is the
 *     `opts.ifVersion !== undefined` branch of `RedisKV.delete`, and
 *     `runKVContract` only ever calls `kv.delete('k')` with no options,
 *     so the versioned branch is entirely unexecuted. Confirmed.
 *   - `multi().exec()` is called 10 times and returns `null` for 2 of
 *     them. So the `result === null` retry limb is NOT unexecuted — it
 *     runs twice, in `set then get round-trips` and in `cas succeeds on
 *     match, fails on mismatch`. Nothing asserts that it ran, and both
 *     tests pass either way, so it was unpinned rather than unreached.
 *
 * Instrument 2 — a proxy-free replay of the exact client-level sequence
 * `RedisKV.set` issues (WATCH, GET, MULTI/SET, EXEC) against a bare
 * `ioredis-mock`, to rule the Proxy itself out as the cause. It
 * reproduces the two nulls, so the behaviour is the double's.
 *
 * ## The divergence those two nulls come from
 *
 * On `ioredis-mock@8.13.1` a connection that has itself EXECed a write to
 * a key carries a stale dirty flag for it: the NEXT WATCH+EXEC on that
 * same key from that same connection aborts once even though no competing
 * writer exists. Measured, with controls that fire:
 *
 *   - fresh key on a fresh connection, no competing writer: EXEC returns
 *     an array, NOT null (so the probe distinguishes the two outcomes)
 *   - second WATCH+EXEC on the same key from the same connection: null
 *   - third: array again (the abort clears the flag)
 *   - the flag is per-connection: another connection WATCHing a key this
 *     one EXECed on is unaffected
 *   - an explicit UNWATCH between the two clears it
 *
 * A real server would not abort there. That is why every pin below runs
 * the driver's client on a key that client has never EXECed on, seeding
 * and competing from SEPARATE connections over ioredis-mock's shared
 * store: it makes a competing write the only possible cause of an abort.
 *
 * ## What these pins do and do not establish
 *
 * They establish that the driver's retry limb converges, and re-reads
 * rather than merely re-EXECing, when its client reports an aborted
 * transaction; and that the versioned-delete branch reaches MULTI/DEL and
 * reports removal from the reply. They also establish that this double
 * does implement WATCH abort on a genuine competing write, rather than
 * treating `watch()` as a no-op.
 *
 * They do NOT establish that a real Redis server aborts under the same
 * interleaving, nor that this double's WATCH fidelity matches a real
 * server in general — the divergence above is proof that it does not.
 * That remains the open question the card records, and closing it needs a
 * live-Redis path, which this package has none of.
 */

// `ioredis-mock` publishes no type declarations; the shipped suite's
// import carries the full note on what that costs.
// @ts-expect-error — ioredis-mock has no published types
import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';

import { RedisKV, VersionMismatchError } from './kv.js';

// ioredis-mock shares state across instances, so a per-test key prefix is
// what isolates the tests — same device the shipped suite uses.
let suffix = 0;
const uniquePrefix = () => `tx${++suffix}:`;

/** The mock is untyped (see the import note), so its instances are `any`. */
type MockClient = any;

interface Recorder {
    /** `'NULL'` or `'ARRAY'` per `multi().exec()`, in call order. */
    execOutcomes: string[];
    /** Commands queued onto a `multi()` chain, e.g. `'set'`, `'del'`. */
    multiCommands: string[];
    /** Keys passed to `watch()`, in call order. */
    watchedKeys: string[];
}

/**
 * Wraps an ioredis-mock connection so a test can observe what the driver
 * did inside its WATCH/MULTI loop, and can run a competing writer at the
 * one instant that matters: after the driver's GET has resolved and
 * before it calls EXEC.
 *
 * The wrapper adds no Redis semantics of its own — every reply, and the
 * WATCH bookkeeping that decides whether EXEC aborts, still comes from
 * ioredis-mock.
 */
function instrument(
    raw: MockClient,
    onFirstGet?: (rec: Recorder) => Promise<void>,
): { client: MockClient; rec: Recorder } {
    const rec: Recorder = { execOutcomes: [], multiCommands: [], watchedKeys: [] };
    let hookFired = false;

    const wrapMulti = (chain: MockClient): MockClient =>
        new Proxy(chain, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (typeof prop !== 'string' || typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                    if (prop !== 'exec') rec.multiCommands.push(prop);
                    const out = value.apply(target, args);
                    if (prop === 'exec') {
                        return Promise.resolve(out).then((reply: unknown) => {
                            rec.execOutcomes.push(reply === null ? 'NULL' : 'ARRAY');
                            return reply;
                        });
                    }
                    // Keep the chain observable when a command returns `this`.
                    return out === target ? receiver : out;
                };
            },
        });

    const client: MockClient = new Proxy(raw, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof prop !== 'string' || typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                if (prop === 'watch') rec.watchedKeys.push(String(args[0]));
                if (prop === 'multi') return wrapMulti(value.apply(target, args));
                if (prop === 'get' && onFirstGet) {
                    return (async () => {
                        const reply = await value.apply(target, args);
                        if (!hookFired) {
                            hookFired = true;
                            await onFirstGet(rec);
                        }
                        return reply;
                    })();
                }
                return value.apply(target, args);
            };
        },
    });

    return { client, rec };
}

describe('RedisKV — WATCH/MULTI transaction limbs — redis(mock)', () => {
    it('set(): a competing writer between WATCH and EXEC drives the abort-retry limb', async () => {
        const keyPrefix = uniquePrefix();
        // The rival is a separate connection driving the same production
        // class, so the competing write is a real KV write rather than a
        // hand-rolled storage envelope.
        const rival = new RedisKV({ client: new RedisMock(), keyPrefix });
        const { client, rec } = instrument(new RedisMock(), async () => {
            await rival.set('k', 'intruder');
        });
        const kv = new RedisKV({ client, keyPrefix });

        const entry = await kv.set('k', 'mine');

        // Exactly one abort then one commit: the `result === null` limb ran
        // once. Without the competing writer this key is fresh on this
        // connection, so a null here has no other available cause.
        expect(rec.execOutcomes).toEqual(['NULL', 'ARRAY']);
        // v2, not v1. Only a retry that went back through WATCH and GET can
        // have seen the rival's v1 and bumped past it; a retry that merely
        // re-issued EXEC would still be writing v1.
        expect(entry.version).toBe(2n);
        expect(entry.value).toBe('mine');

        const got = await kv.get<string>('k');
        expect(got?.value).toBe('mine');
        expect(got?.version).toBe(2n);

        await kv.close();
    });

    it('delete(key, {ifVersion}): a competing writer drives the abort-retry limb into MULTI/DEL', async () => {
        const keyPrefix = uniquePrefix();
        // Seed from a separate connection so the driver's client has never
        // EXECed on this key (see the header note on the per-connection
        // stale flag) — the abort below can then only be the rival's doing.
        const seeder = new RedisKV({ client: new RedisMock(), keyPrefix });
        expect((await seeder.set('k', 'v0')).version).toBe(1n);

        // The rival rewrites the row's current bytes verbatim. WATCH tracks
        // writes, not value changes, so this aborts the driver's transaction
        // while leaving the version at 1 — which is what lets the retry find
        // a still-matching `ifVersion` and proceed into MULTI/DEL. The
        // physical key is taken from what the driver itself WATCHed, so this
        // test does not encode the key-layout private to RedisKV.
        const rivalClient = new RedisMock();
        const { client, rec } = instrument(new RedisMock(), async (r) => {
            const physical = r.watchedKeys[r.watchedKeys.length - 1];
            await rivalClient.set(physical, await rivalClient.get(physical));
        });
        const kv = new RedisKV({ client, keyPrefix });

        expect(await kv.delete('k', { ifVersion: 1n })).toBe(true);
        expect(rec.execOutcomes).toEqual(['NULL', 'ARRAY']);
        expect(rec.multiCommands).toEqual(['del', 'del']);
        expect(await kv.get('k')).toBeUndefined();

        await kv.close();
    });

    it('delete(key, {ifVersion}) removes through the MULTI/DEL branch and reports it from the reply', async () => {
        const keyPrefix = uniquePrefix();
        const seeder = new RedisKV({ client: new RedisMock(), keyPrefix });
        expect((await seeder.set('k', 'v0')).version).toBe(1n);

        const { client, rec } = instrument(new RedisMock());
        const kv = new RedisKV({ client, keyPrefix });

        expect(await kv.delete('k', { ifVersion: 1n })).toBe(true);
        // The unversioned fast path calls `client.del` and opens no
        // transaction; this asserts the versioned branch was the one taken.
        expect(rec.multiCommands).toEqual(['del']);
        expect(rec.execOutcomes).toEqual(['ARRAY']);
        expect(await kv.get('k')).toBeUndefined();

        await kv.close();
    });

    it('delete(key, {ifVersion}) on an absent key returns false without opening a MULTI', async () => {
        const keyPrefix = uniquePrefix();
        const { client, rec } = instrument(new RedisMock());
        const kv = new RedisKV({ client, keyPrefix });

        expect(await kv.delete('absent', { ifVersion: 1n })).toBe(false);
        expect(rec.multiCommands).toEqual([]);
        expect(rec.execOutcomes).toEqual([]);

        await kv.close();
    });

    it('delete(key, {ifVersion}) rejects a stale version, opens no MULTI, and leaves the row', async () => {
        const keyPrefix = uniquePrefix();
        const seeder = new RedisKV({ client: new RedisMock(), keyPrefix });
        await seeder.set('k', 'v0');

        const { client, rec } = instrument(new RedisMock());
        const kv = new RedisKV({ client, keyPrefix });

        // Assert the error's structured fields, not just that something was
        // thrown: a bare `toThrow()` stays green when the driver throws a
        // plain Error for an unrelated reason.
        const err: unknown = await kv
            .delete('k', { ifVersion: 99n })
            .then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(VersionMismatchError);
        expect((err as VersionMismatchError).key).toBe('k');
        expect((err as VersionMismatchError).expected).toBe(99n);
        expect((err as VersionMismatchError).actual).toBe(1n);

        expect(rec.multiCommands).toEqual([]);
        expect((await kv.get<string>('k'))?.value).toBe('v0');

        await kv.close();
    });
});
