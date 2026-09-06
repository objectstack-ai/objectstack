// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Driver contract tests for the Redis cluster driver, run against
 * `ioredis-mock` so they execute without a real Redis instance in CI.
 * There is no live-Redis path in this file: every suite below runs on the
 * mock. (An earlier version of this header promised `RUN_REAL_REDIS=1` +
 * `REDIS_URL` and "conditional `describe.skipIf` blocks at the bottom" —
 * no such blocks were ever here. Scanning the whole package, not just
 * `src/`: `RUN_REAL_REDIS` and `skipIf` occur nowhere outside that
 * sentence, so the escape hatch never existed. `REDIS_URL` does occur, at
 * `README.md:42` — but as the env var a caller feeds to
 * `createRedisClient()`, which is unrelated to any test path.)
 *
 * ## The double is one major version behind the client it doubles
 *
 * This package depends on `ioredis@^6`, while `ioredis-mock@8.13.1`
 * declares `peerDependencies: { ioredis: "^5" }` — so a resolving
 * `pnpm install` prints an unmet-peer warning for it (a frozen re-link
 * prints nothing). That gap is real, and it is
 * declared here rather than closed, because it was measured to be inert
 * on the surface these suites actually drive. Measured against ioredis
 * 5.11.1 (newest release satisfying the mock's `^5` peer) and 6.0.0 (the
 * version resolved in this workspace):
 *
 *   - Every Redis command issued by this package's `src/*.ts` — get, set,
 *     del, incr, incrby, pttl, watch, unwatch, exec, publish, subscribe,
 *     unsubscribe, quit, eval — carries all of its v5 overloads verbatim
 *     into v6's `RedisCommander.d.ts`. `set` is a strict superset there
 *     (v6 adds the IFEQ/IFNE/IFDEQ/IFDNE tokens); nothing used here was
 *     removed or re-shaped.
 *   - `multi()` is deliberately not in that list: it is declared on
 *     `Transaction` (`transaction.d.ts`) and appears in
 *     `RedisCommander.d.ts` in neither version. Measured separately, it
 *     DID change — all four overloads went from returning
 *     `ChainableCommander` to `ChainableCommander` parameterised by a
 *     mapping. It is inert here because the parameter defaults to "resp2"
 *     and a client built without `replyMapping` reaches it as such: the
 *     class defaults to "legacy" and extends `Transaction` at "resp2".
 *     So this package's `multi()` resolves to the non-RESP3 instantiation,
 *     and `exec()`'s own declaration is byte-identical across the pair.
 *   - v6's one substantive change reachable from the surface these suites
 *     drive is RESP3 reply mapping, and it is opt-in: the class is
 *     declared with a `ReplyMapping` parameter defaulting to "legacy",
 *     `ChainableCommander` defaults to "resp2", and `duplicate()` with no
 *     override inherits the caller's mapping. This package never passes
 *     `replyMapping`, so every reply shape these suites see is the v5 one.
 *     ⚠️ Scoped deliberately: v6 also changes connection defaults that are
 *     NOT opt-in — `protocol: 3` (no such option in v5) and `keepAlive`
 *     0 -> 30000. Those are reached in production through
 *     `createRedisClient()`, which no suite here calls (see below), so
 *     they are changed-but-unexercised rather than absent.
 *   - The three `RedisOptions` keys client.ts sets — lazyConnect,
 *     maxRetriesPerRequest, enableAutoPipelining — are declared
 *     identically in both versions.
 *
 * That named set is the whole basis for the claim; it is not a statement
 * about ioredis 5 vs 6 in general. If the `ioredis` or `ioredis-mock`
 * range in package.json moves — OR if the version either one RESOLVES to
 * moves under an unchanged caret range, which a lockfile bump alone will
 * do — this paragraph expires and the diff has to be re-taken.
 *
 * ## What these suites therefore do NOT certify
 *
 * They reach the mock only through the injected `client` and the
 * `client.duplicate()` the pub/sub adapter makes. They never call
 * `createRedisClient()`, so `new Redis(url, options)` — this package's
 * only contact with ioredis's constructor and connection surface, and the
 * area v6 changed most — is exercised by nothing in this file. That is
 * why the version gap is inert here, and it is not a reason to trust the
 * double: the mock is simply never asked to stand in for the surface on
 * which the two majors differ.
 *
 * Two `RedisKV` limbs this file drives but does not assert are pinned in
 * the sibling `kv.transaction.test.ts`: the WATCH/MULTI abort-retry loop,
 * and the versioned-delete MULTI/DEL branch. Measured here rather than
 * assumed: `multi().del` is called zero times by these suites, while
 * `multi().exec()` DOES return null twice — not because a competing
 * writer exists, but because of a per-connection stale-watch divergence
 * in the double. The sibling file carries that measurement and its
 * controls.
 */

// `ioredis-mock` publishes no type declarations of its own — no `types`
// field in its manifest and no `.d.ts` in the tarball — so this import
// raises TS7016 ("could not find a declaration file ... implicitly has an
// 'any' type") and the directive below is what silences it. Note the
// second cost, beyond the missing types: with the module untyped
// `RedisMock` is `any`, so every `client:` argument constructed from it
// satisfies ioredis's `Redis` type without ever being checked against it.
// That is the other reason a v5-vs-v6 divergence could not surface here.
// `@types/ioredis-mock` exists and would type this seam, but it only
// *asserts* `new(): ioredis.Redis` rather than describing the mock, so
// adopting it would trade an honest `any` for an unearned certainty —
// that trade has not been made, deliberately.
// @ts-expect-error — ioredis-mock has no published types
import RedisMock from 'ioredis-mock';
import { describe, expect, it, vi } from 'vitest';
import {
    runLockContract,
    runKVContract,
    runCounterContract,
} from '@objectstack/service-cluster/testing';
// Load the driver entrypoint at module eval — importing it registers the
// 'redis' cluster driver as a side-effect, which `defineCluster({ driver:
// 'redis' })` then resolves. Doing this here (not via `await import()` inside
// the timed test bodies) keeps the one-time cold module-load cost out of the
// per-test 5s timeout — the wiring tests below were flaky on slow CI for
// exactly that reason (the first test paid the full import cost and timed out).
import './index.js';
import { defineCluster } from '@objectstack/service-cluster';

import { RedisPubSub } from './pubsub.js';
import { RedisLock } from './lock.js';
import { RedisKV } from './kv.js';
import { RedisCounter } from './counter.js';

// ioredis-mock shares state across instances by default, so each
// primitive gets a unique key-prefix per test to ensure isolation.
let suffix = 0;
const uniquePrefix = () => `t${++suffix}:`;
const makeClient = () => new RedisMock();

runLockContract('redis(mock)', async () =>
    new RedisLock({ client: makeClient(), keyPrefix: uniquePrefix() }),
);
runKVContract('redis(mock)', async () =>
    new RedisKV({ client: makeClient(), keyPrefix: uniquePrefix() }),
);
runCounterContract('redis(mock)', async () =>
    new RedisCounter({ client: makeClient(), keyPrefix: uniquePrefix() }),
);

// PubSub: Redis delivery is async (network roundtrip even for mock), so
// we can't reuse the synchronous contract suite. Cover the same surface
// here with explicit waits.
describe('IPubSub contract — redis(mock)', () => {
    const flush = () => new Promise<void>((r) => setTimeout(r, 10));

    it('delivers published messages to subscribers', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        const received: unknown[] = [];
        bus.subscribe<{ n: number }>('ch', (msg) => { received.push(msg.payload); });
        await flush();                                         // let SUBSCRIBE register
        await bus.publish('ch', { n: 1 });
        await bus.publish('ch', { n: 2 });
        await flush();
        expect(received).toEqual([{ n: 1 }, { n: 2 }]);
        await bus.close();
    });

    it('does not deliver to other channels', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        const h = vi.fn();
        bus.subscribe('a', h);
        await flush();
        await bus.publish('b', { x: 1 });
        await flush();
        expect(h).not.toHaveBeenCalled();
        await bus.close();
    });

    it('supports multiple subscribers per channel', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        const a = vi.fn();
        const b = vi.fn();
        bus.subscribe('ch', a);
        bus.subscribe('ch', b);
        await flush();
        await bus.publish('ch', 'hi');
        await flush();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
        await bus.close();
    });

    it('unsubscribe stops delivery and is idempotent', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        const h = vi.fn();
        const off = bus.subscribe('ch', h);
        await flush();
        await bus.publish('ch', 1);
        await flush();
        off();
        off();
        await bus.publish('ch', 2);
        await flush();
        expect(h).toHaveBeenCalledTimes(1);
        await bus.close();
    });

    it('isolates handler errors from siblings', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        bus.subscribe('ch', () => { throw new Error('boom'); });
        const ok = vi.fn();
        bus.subscribe('ch', ok);
        await flush();
        await expect(bus.publish('ch', 1)).resolves.toBeUndefined();
        await flush();
        expect(ok).toHaveBeenCalledTimes(1);
        await bus.close();
    });

    it('close rejects further publishes', async () => {
        const bus = new RedisPubSub({ client: makeClient(), keyPrefix: uniquePrefix() });
        await bus.close();
        await expect(bus.publish('ch', 1)).rejects.toThrow(/closed/);
    });
});

describe('Redis driver — wiring', () => {
    it('exports a registerable driver and defineCluster picks it up', async () => {
        const client = makeClient();
        const cluster = defineCluster({
            driver: 'redis',
            nodeId: 'mock-node',
            driverOptions: { client, keyPrefix: uniquePrefix() },
        });
        expect(cluster.driver).toBe('redis');
        expect(cluster.nodeId).toBe('mock-node');

        expect(await cluster.counter.incr('seq')).toBe(1n);
        expect(await cluster.counter.incr('seq')).toBe(2n);

        await cluster.kv.set('k', { hello: 'world' });
        const got = await cluster.kv.get<{ hello: string }>('k');
        expect(got?.value).toEqual({ hello: 'world' });

        const handle = await cluster.lock.acquire('foo');
        expect(handle).not.toBeNull();
        expect(handle!.fencingToken).toBeGreaterThan(0n);
        await handle!.release();

        await cluster.close();
    });

    it('does NOT quit caller-owned client on close', async () => {
        const client = makeClient();
        const cluster = defineCluster({
            driver: 'redis',
            nodeId: 'mock-node-2',
            driverOptions: { client, keyPrefix: uniquePrefix() },
        });
        await cluster.close();
        await expect(client.set('post-close', '1')).resolves.toBe('OK');
    });
});
