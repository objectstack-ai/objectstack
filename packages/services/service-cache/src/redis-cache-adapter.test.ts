// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `RedisCacheAdapter` against `ioredis-mock`, the double
 * `@objectstack/service-cluster-redis`'s own contract suite runs on — so this
 * file runs in CI with no Redis server. It certifies the adapter's command
 * shapes and semantics, not a live server: the two-process proof against a real
 * `redis-server` lives in `@objectstack/plugin-auth`
 * (`rate-limit-storage.shared-redis.test.ts`).
 *
 * Two layers:
 *
 *  1. **Parity** — the `ICacheService` behaviours `MemoryCacheAdapter` is pinned
 *     on, run against BOTH adapters from one table, so the Redis adapter cannot
 *     quietly mean something else by `get` / `set` / `ttl` / `delete` / `has` /
 *     `clear` / `stats`.
 *  2. **What a shared store adds** — two clients on one server see one cache;
 *     the namespace partitions keys; values are JSON; the counter envelope the
 *     rate limiters store round-trips; failures surface instead of reading as
 *     misses; `close()` respects who owns the client.
 */

// `ioredis-mock` publishes no type declarations; see the same directive's note
// in `service-cluster-redis/src/redis.contract.test.ts`.
// @ts-expect-error — ioredis-mock has no published types
import RedisMock from 'ioredis-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ICacheService } from '@objectstack/spec/contracts';

import { MemoryCacheAdapter } from './memory-cache-adapter.js';
import { RedisCacheAdapter, type RedisCacheClient } from './redis-cache-adapter.js';

// ioredis-mock shares one keyspace per host:port across instances, so every
// adapter gets its own prefix — and the "shared store" cases share one on
// purpose.
let suffix = 0;
const uniquePrefix = (): string => `t${process.pid}x${++suffix}:`;
const opened: Array<{ quit(): Promise<unknown> }> = [];
function mockClient(): RedisCacheClient {
  const client = new RedisMock() as RedisCacheClient;
  opened.push(client);
  return client;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.quit().catch(() => undefined)));
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Factory = (opts?: { defaultTtl?: number }) => ICacheService;
const ADAPTERS: Array<[string, Factory]> = [
  ['memory', (opts) => new MemoryCacheAdapter(opts)],
  ['redis(mock)', (opts) => new RedisCacheAdapter({ client: mockClient(), keyPrefix: uniquePrefix(), ...opts })],
];

describe.each(ADAPTERS)('ICacheService parity — %s', (_name, make) => {
  it('set then get answers the value; a missing key answers undefined, not null', async () => {
    const cache = make();
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    expect(await cache.get('absent')).toBeUndefined();
  });

  it('round-trips a plain object by value', async () => {
    const cache = make();
    await cache.set('user', { name: 'Alice', roles: ['a', 'b'], n: 3, ok: true, none: null });
    expect(await cache.get('user')).toEqual({ name: 'Alice', roles: ['a', 'b'], n: 3, ok: true, none: null });
  });

  it('delete answers whether the key existed', async () => {
    const cache = make();
    await cache.set('k', 1);
    expect(await cache.delete('k')).toBe(true);
    expect(await cache.get('k')).toBeUndefined();
    expect(await cache.delete('k')).toBe(false);
  });

  it('has() follows set / delete', async () => {
    const cache = make();
    expect(await cache.has('k')).toBe(false);
    await cache.set('k', 'v');
    expect(await cache.has('k')).toBe(true);
    await cache.delete('k');
    expect(await cache.has('k')).toBe(false);
  });

  it('an entry expires after its TTL (seconds, fractions allowed) — for get and has alike', async () => {
    const cache = make();
    await cache.set('short', 'v', 0.001);
    await cache.set('long', 'v', 60);
    await sleep(25);
    expect(await cache.get('short')).toBeUndefined();
    expect(await cache.has('short')).toBe(false);
    expect(await cache.get('long')).toBe('v');
  });

  it('defaultTtl applies when set() names none, and ttl 0 means no expiry', async () => {
    const cache = make({ defaultTtl: 0.001 });
    await cache.set('defaulted', 'v');
    await cache.set('forever', 'v', 0);
    await sleep(25);
    expect(await cache.get('defaulted')).toBeUndefined();
    expect(await cache.get('forever')).toBe('v');
  });

  it('clear() removes every entry', async () => {
    const cache = make();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(await cache.has('a')).toBe(false);
    expect(await cache.has('b')).toBe(false);
    expect((await cache.stats()).keyCount).toBe(0);
  });

  it('stats() counts hits, misses and live keys', async () => {
    const cache = make();
    await cache.set('k', 'v');
    await cache.get('k');
    await cache.get('absent');
    expect(await cache.stats()).toMatchObject({ hits: 1, misses: 1, keyCount: 1 });
  });

  it('stores the rate limiters\' counter envelope (a JSON string) and hands back the same string', async () => {
    // plugin-auth's fixed window and the runtime's token bucket both store
    // `JSON.stringify(envelope)` and accept either a string or an object back.
    const cache = make();
    const envelope = JSON.stringify({ n: 3, exp: 1_700_000_000_000 });
    await cache.set('rl:ip:1.2.3.4', envelope, 60);
    expect(await cache.get('rl:ip:1.2.3.4')).toBe(envelope);
  });
});

describe('RedisCacheAdapter — what a shared store adds', () => {
  it('two clients on one server see ONE cache: a write through either is read through the other', async () => {
    const prefix = uniquePrefix();
    const nodeA = new RedisCacheAdapter({ client: mockClient(), keyPrefix: prefix });
    const nodeB = new RedisCacheAdapter({ client: mockClient(), keyPrefix: prefix });
    await nodeA.set('shared', { n: 1 }, 60);
    expect(await nodeB.get('shared')).toEqual({ n: 1 });
    expect(await nodeB.delete('shared')).toBe(true);
    expect(await nodeA.has('shared')).toBe(false);
  });

  it('stores under `<keyPrefix>cache:` — default prefix `os:` — with a millisecond PX expiry', async () => {
    const client = mockClient();
    const raw = client as unknown as { get(k: string): Promise<string | null>; pttl(k: string): Promise<number> };
    const cache = new RedisCacheAdapter({ client });
    expect(cache.keyNamespace).toBe('os:cache:');
    await cache.set('probe-default-prefix', 'v', 1.5);
    expect(await raw.get('os:cache:probe-default-prefix')).toBe('"v"');
    const pttl = await raw.pttl('os:cache:probe-default-prefix');
    expect(pttl).toBeGreaterThan(1000);
    expect(pttl).toBeLessThanOrEqual(1500);
    await cache.delete('probe-default-prefix');
  });

  it('clear() and stats() touch only this namespace — never the cluster driver\'s keys or another prefix', async () => {
    const prefix = uniquePrefix();
    const client = mockClient();
    const raw = client as unknown as { set(k: string, v: string): Promise<unknown>; get(k: string): Promise<string | null> };
    // The redis cluster driver's own keys under the same deployment prefix.
    await raw.set(`${prefix}kv:leader`, '{"v":1,"ver":"1"}');
    await raw.set(`${prefix}ctr:seq`, '7');
    const other = new RedisCacheAdapter({ client, keyPrefix: `${prefix}other:` });
    await other.set('keep', 1);

    const cache = new RedisCacheAdapter({ client, keyPrefix: prefix });
    await cache.set('a', 1);
    await cache.set('b', 2);
    expect((await cache.stats()).keyCount).toBe(2);
    await cache.clear();

    expect((await cache.stats()).keyCount).toBe(0);
    expect(await raw.get(`${prefix}kv:leader`)).toBe('{"v":1,"ver":"1"}');
    expect(await raw.get(`${prefix}ctr:seq`)).toBe('7');
    expect(await other.get('keep')).toBe(1);
  });

  it('matches a prefix carrying glob metacharacters literally', async () => {
    const base = uniquePrefix();
    const client = mockClient();
    const starred = new RedisCacheAdapter({ client, keyPrefix: `${base}*:` });
    const plain = new RedisCacheAdapter({ client, keyPrefix: `${base}x:` });
    await starred.set('a', 1);
    await plain.set('b', 2);
    // A pattern that read `*` as a wildcard would also select `<base>x:cache:b`.
    expect((await starred.stats()).keyCount).toBe(1);
    await starred.clear();
    expect(await plain.get('b')).toBe(2);
  });

  it('values are JSON: a Date reads back as its ISO string; a value JSON cannot hold is refused, not stored', async () => {
    const cache = new RedisCacheAdapter({ client: mockClient(), keyPrefix: uniquePrefix() });
    const at = new Date('2026-11-08T00:00:00.000Z');
    await cache.set('when', at);
    expect(await cache.get('when')).toBe('2026-11-08T00:00:00.000Z');
    await expect(cache.set('nothing', undefined)).rejects.toThrow(TypeError);
    await expect(cache.set('fn', () => 1)).rejects.toThrow(TypeError);
    expect(await cache.has('nothing')).toBe(false);
    expect(await cache.has('fn')).toBe(false);
  });

  it('a value it did not write (not JSON) reads as a miss, never as raw bytes', async () => {
    const prefix = uniquePrefix();
    const client = mockClient();
    await (client as unknown as { set(k: string, v: string): Promise<unknown> }).set(`${prefix}cache:foreign`, 'not json {');
    const cache = new RedisCacheAdapter({ client, keyPrefix: prefix });
    expect(await cache.get('foreign')).toBeUndefined();
    expect((await cache.stats()).misses).toBe(1);
  });

  it('a Redis failure is thrown to the caller — never answered as a miss', async () => {
    const failing: RedisCacheClient = {
      get: async () => { throw new Error('ECONNREFUSED'); },
      set: async () => { throw new Error('ECONNREFUSED'); },
      del: async () => { throw new Error('ECONNREFUSED'); },
      exists: async () => { throw new Error('ECONNREFUSED'); },
      scan: async () => { throw new Error('ECONNREFUSED'); },
      quit: async () => 'OK',
    };
    const cache = new RedisCacheAdapter({ client: failing });
    await expect(cache.get('k')).rejects.toThrow('ECONNREFUSED');
    await expect(cache.set('k', 1)).rejects.toThrow('ECONNREFUSED');
    await expect(cache.has('k')).rejects.toThrow('ECONNREFUSED');
  });

  it('emits the cache counters with adapter="redis"', async () => {
    const counter = vi.fn();
    const metrics = { counter } as unknown as ConstructorParameters<typeof RedisCacheAdapter>[0]['metrics'];
    const cache = new RedisCacheAdapter({ client: mockClient(), keyPrefix: uniquePrefix(), metrics });
    await cache.set('k', 1);
    await cache.get('k');
    await cache.get('absent');
    await cache.delete('k');
    const calls = counter.mock.calls.map(([name, labels]) => [name, labels]);
    expect(calls).toEqual([
      ['cache_writes_total', { adapter: 'redis', op: 'set' }],
      ['cache_lookups_total', { adapter: 'redis', result: 'hit' }],
      ['cache_lookups_total', { adapter: 'redis', result: 'miss' }],
      ['cache_writes_total', { adapter: 'redis', op: 'delete' }],
    ]);
  });

  it('close() quits the client only when it owns it, and a closed adapter refuses work', async () => {
    const stub = (quit: () => Promise<unknown>): RedisCacheClient => ({
      get: async () => null,
      set: async () => 'OK',
      del: async () => 0,
      exists: async () => 0,
      scan: async () => ['0', []],
      quit,
    });
    const borrowedQuit = vi.fn(async () => 'OK');
    const ownedQuit = vi.fn(async () => 'OK');
    const borrowed = new RedisCacheAdapter({ client: stub(borrowedQuit) });
    const owned = new RedisCacheAdapter({ client: stub(ownedQuit), ownsClient: true });
    await borrowed.close();
    await owned.close();
    await owned.close(); // idempotent
    expect(borrowedQuit).not.toHaveBeenCalled();
    expect(ownedQuit).toHaveBeenCalledTimes(1);
    await expect(owned.get('k')).rejects.toThrow('RedisCacheAdapter is closed');
  });

  it('refuses construction without a client, naming that `url` is not read', () => {
    expect(() => new RedisCacheAdapter({ url: 'redis://localhost:6379' })).toThrow(/`url` is not read/);
    expect(() => new RedisCacheAdapter({})).toThrow(/needs a Redis client/);
  });
});
