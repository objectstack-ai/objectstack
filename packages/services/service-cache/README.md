# @objectstack/service-cache

The shipped provider for the kernel's **`cache`** service slot — an in-memory
`ICacheService` implementation with metrics instrumentation.

Slot criticality: `core` (`ServiceRequirementDef` in `@objectstack/spec/system`): the
kernel warns and degrades if the slot is empty, it does not fail to start.

> ⚠️ **The Redis adapter is a skeleton, not a shipped capability.**
> `RedisCacheAdapter` throws `RedisCacheAdapter not yet implemented` from every method,
> and `new CacheServicePlugin({ adapter: 'redis' })` throws during `init` rather than
> falling back. The only working adapter today is `MemoryCacheAdapter`. For a shared
> cache, register your own `ICacheService` implementation under the slot (see
> [Custom implementations](#custom-implementations)).

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

## Plugin options

`CacheServicePluginOptions` has exactly four fields, all optional.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `adapter` | `'memory' \| 'redis'` | `'memory'` | `'redis'` throws at `init` — see the warning above. |
| `memory` | `MemoryCacheAdapterOptions` | `{}` | Forwarded to `MemoryCacheAdapter`. |
| `redisUrl` | `string` | none | Read by nothing today; kept for the unimplemented Redis path. |
| `metrics` | `MetricsRegistry` | resolved from the kernel | Explicit metrics backend; wins over the service-registry lookup. |

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
`memoryUsage` (the contract declares it optional).

## Metrics

`MemoryCacheAdapter` emits the `cache_lookups_total` and `cache_writes_total` counters
(`SEMCONV` in `@objectstack/observability`). The registry is resolved in this order:

1. `options.metrics` (explicit constructor wiring)
2. `ctx.getService('observability:metrics')` — registered by `ObservabilityServicePlugin`
3. `NoopMetricsRegistry` (silent)

## No HTTP surface

This service is kernel-internal: it is consumed in-process via the service registry
(`kernel.getService('cache')`) and mounts **no** REST routes. Discovery advertises no
route for the `cache` slot and reports `handlerReady: false` — for this slot that is
the fact itself, not a proxy for reduced capability (ADR-0076 D12).

## Custom implementations

The slot is multi-provider. To back the cache with Redis, Memcached or anything else,
register an object satisfying `ICacheService` under `'cache'` from your own plugin:

```typescript
import type { ICacheService } from '@objectstack/spec/contracts';

class MyCache implements ICacheService { /* the six members above */ }

// inside your plugin's init(ctx):
ctx.registerService('cache', new MyCache());
```

## Exports

```typescript
import {
  CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter,
} from '@objectstack/service-cache';
```

Types: `CacheServicePluginOptions`, `MemoryCacheAdapterOptions`, `RedisCacheAdapterOptions`.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Cache Service](https://objectstack.ai/docs/kernel/contracts/cache-service)
