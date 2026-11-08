# @objectstack/service-cache

The shipped provider for the kernel's **`cache`** service slot — an `ICacheService`
implementation with metrics instrumentation, in memory by default and on Redis when a
multi-node deployment shares one.

Slot criticality: `core` (`ServiceRequirementDef` in `@objectstack/spec/system`): the
kernel warns and degrades if the slot is empty, it does not fail to start.

## Installation

```bash
pnpm add @objectstack/service-cache
```

## Usage

```typescript
import { ObjectKernel } from '@objectstack/core';
import type { ICacheService } from '@objectstack/spec/contracts';
import { CacheServicePlugin } from '@objectstack/service-cache';

const kernel = new ObjectKernel();
await kernel.use(new CacheServicePlugin({ memory: { maxSize: 1000, defaultTtl: 300 } }));
await kernel.bootstrap();

const cache = kernel.getService<ICacheService>('cache');
await cache.set('user:123', { name: 'Alice' }, 60);   // ttl in SECONDS, positional
const user = await cache.get<{ name: string }>('user:123');
```

## Which adapter

Leave `adapter` unset and the deployment's topology decides, at `init`:

| Deployment | Cache |
|:---|:---|
| Single node — no multi-node declaration | `MemoryCacheAdapter`. Nothing else is read; the boot is the one it always was. |
| Multi-node declared (`OS_EXPECT_MULTI_NODE=true` or `OS_CLUSTER_REPLICAS` > 1) over the `redis` cluster driver | `RedisCacheAdapter`, on a connection duplicated from the driver's — the same Redis, the same key prefix, every node one cache. |
| Multi-node declared over that driver, but no shared cache is possible (`adapter: 'memory'`, or a driver build that offers no connection) | **Boot is refused** with an error that names the fix. |
| Multi-node declared over any other driver, or with no cluster service | `MemoryCacheAdapter`, plus one `warn` line saying cache-backed limits multiply by the replica count. |

Why it matters: a counter kept in the cache — better-auth's sign-in rate limits through
`rateLimit.customStorage`, the inbound API budget, the OTP send budget — is one counter
per cache. On a per-process cache, N replicas each count alone and admit N times the
declared limit.

The Redis connection comes from `@objectstack/service-cluster-redis`, which `os serve`
mounts for `OS_CLUSTER_DRIVER=redis` + `OS_REDIS_URL`. The cache plugin declares the
cluster plugin as an optional dependency, so it reads the driver after it started,
whatever order the two were registered in.

## Plugin options

`CacheServicePluginOptions` — every field optional.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `adapter` | `'memory' \| 'redis'` | unset (topology decides) | `'redis'` forces Redis: over `redis.client`, else the redis cluster driver's connection, else boot is refused. `'memory'` forces memory, except in a declared multi-node redis deployment, where it is refused. |
| `memory` | `MemoryCacheAdapterOptions` | `{}` | Forwarded to `MemoryCacheAdapter`. |
| `redis` | `CacheServicePluginRedisOptions` | `{}` | Read whenever the adapter is Redis. |
| `redisUrl` | `string` | none | **Deprecated, never read.** The plugin builds no client from a URL; the Redis is the cluster driver's, or `redis.client`. |
| `metrics` | `MetricsRegistry` | resolved from the kernel | Explicit metrics backend; wins over the service-registry lookup. |

`CacheServicePluginRedisOptions`:

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `client` | `RedisCacheClient` (an ioredis client) | the cluster driver's connection | A client you own. Wins over the driver's connection; the plugin never closes it. |
| `keyPrefix` | `string` | the driver's (`'os:'`) | Entries live at `<keyPrefix>cache:<key>`. |
| `defaultTtl` | `number` | `0` (no expiry) | Default TTL in seconds. |

`MemoryCacheAdapterOptions`:

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `maxSize` | `number` | `0` (unlimited) | Entry cap. At the cap a `set` of a NEW key evicts the oldest-inserted entry (Map insertion order — reads do not refresh position). |
| `defaultTtl` | `number` | `0` (no expiry) | Default TTL in seconds. |
| `metrics` | `MetricsRegistry` | `NoopMetricsRegistry` | Instrumentation sink. |

Note the spelling: `defaultTtl`, not `defaultTTL`.

## Service API

`ICacheService` (from `@objectstack/spec/contracts`) is deliberately small — six
members, all required:

```typescript
import type { ICacheService, CacheStats } from '@objectstack/spec/contracts';

// get<T>(key)              -> Promise<T | undefined>   (undefined, not null, on a miss)
// set<T>(key, value, ttl?) -> Promise<void>            (ttl in seconds, positional)
// delete(key)              -> Promise<boolean>         (true when the key existed)
// has(key)                 -> Promise<boolean>
// clear()                  -> Promise<void>
// stats()                  -> Promise<CacheStats>
```

There is no `mget` / `mset`, no `del`, no pattern deletion, no `namespace()`, no
`ttl()` / `expire()` / `persist()`, no `incr` / `decr`, no `getOrSet`, and no tagging.
Compose those on top of the six members above if you need them.

```typescript
// cache-aside, written against the real surface
async function getUser(id: string): Promise<User> {
  const cached = await cache.get<User>(`user:${id}`);
  if (cached !== undefined) return cached;

  const user = await loadUser(id);
  await cache.set(`user:${id}`, user, 600);
  return user;
}
```

### Statistics

`CacheStats` has four fields — note `keyCount`, and that there is no `hitRate`
(compute it from `hits` and `misses`):

```typescript
const s = await cache.stats();
// { hits: number, misses: number, keyCount: number, memoryUsage?: number }
```

`MemoryCacheAdapter` returns `hits`, `misses` and `keyCount`; it does not report
`memoryUsage` (the contract declares it optional). `RedisCacheAdapter` returns the same
three, in two scopes: `hits` / `misses` count this process's lookups, `keyCount` counts
the shared `<keyPrefix>cache:` namespace on the server.

### What the Redis adapter does differently

- **Values are JSON.** They cross a process boundary, so a value is stored as
  `JSON.stringify(value)`: objects, arrays, strings, numbers, booleans and `null`
  round-trip, a `Date` comes back as its ISO string, and a value JSON cannot represent
  (`undefined`, a function, a `bigint`) is refused with a `TypeError`.
- **A Redis failure is thrown, never answered as a miss.** An outage read as "not found"
  would silently reset every counter kept in the cache. Each consumer decides what a
  failure means: the inbound limiter lets the request through; better-auth's sign-in
  limiter fails the request.
- **`clear()` touches only `<keyPrefix>cache:`** — never the cluster driver's own
  `kv:` / `ctr:` / lock keys under the same prefix.
- **Counters stay read-modify-write.** `ICacheService` has no atomic increment, so two
  nodes counting one key in the same instant can both be admitted at a limit's
  boundary — the bounded imprecision ADR-0069 D2 accepts in exchange for one shared
  count.

## Metrics

Both adapters emit the `cache_lookups_total` and `cache_writes_total` counters
(`SEMCONV` in `@objectstack/observability`), labelled `adapter="memory"` or
`adapter="redis"`. The registry is resolved in this order:

1. `options.metrics` (explicit constructor wiring)
2. `ctx.getService('observability:metrics')` — registered by `ObservabilityServicePlugin`
3. `NoopMetricsRegistry` (silent)

## No HTTP surface

This service is kernel-internal: it is consumed in-process via the service registry
(`kernel.getService('cache')`) and mounts **no** REST routes. Discovery advertises no
route for the `cache` slot and reports `handlerReady: false` — for this slot that is
the fact itself, not a proxy for reduced capability (ADR-0076 D12).

## Custom implementations

The slot is multi-provider. To back the cache with Memcached or anything else this
package does not ship, register an object satisfying `ICacheService` under `'cache'`
from your own plugin:

```typescript
import type { CacheStats, ICacheService } from '@objectstack/spec/contracts';

class MyCache implements ICacheService {
  async get<T = unknown>(key: string): Promise<T | undefined> { /* … */ return undefined; }
  async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> { /* … */ }
  async delete(key: string): Promise<boolean> { /* … */ return false; }
  async has(key: string): Promise<boolean> { /* … */ return false; }
  async clear(): Promise<void> { /* … */ }
  async stats(): Promise<CacheStats> { return { hits: 0, misses: 0, keyCount: 0 }; }
}

// inside your plugin's init(ctx):
ctx.registerService('cache', new MyCache());
```

## Exports

```typescript
import {
  CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter,
} from '@objectstack/service-cache';
```

Types: `CacheServicePluginOptions`, `CacheServicePluginRedisOptions`,
`MemoryCacheAdapterOptions`, `RedisCacheAdapterOptions`, `RedisCacheClient`.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Cache Service](https://objectstack.ai/docs/kernel/contracts/cache-service)
