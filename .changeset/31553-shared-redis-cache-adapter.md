---
'@objectstack/service-cache': patch
'@objectstack/service-cluster': patch
'@objectstack/service-cluster-redis': patch
---

feat(service-cache)!: a multi-node deployment on the redis cluster driver shares one Redis cache, so cache-backed limits hold across replicas; a per-process cache there refuses to boot

Clause-②: yes (narrowing) — new exports and options widen the public surface, and one configuration that used to boot is now refused: `CacheServicePlugin({ adapter: 'memory' })` in a deployment that declares multi-node (`OS_EXPECT_MULTI_NODE=true` / `OS_CLUSTER_REPLICAS` > 1) over the `redis` cluster driver.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape: what moves is which cache adapter a plugin option set selects at boot, and the one refusal is a boot-time error that names its own remedy. Nothing at rest records the choice, so there is nothing for a migration to rewrite. -->

**BREAKING** for one configuration only: a host that passes `adapter: 'memory'` explicitly AND declares multi-node over the redis cluster driver. Single-node boots, and every boot that leaves `adapter` unset, are unaffected.

- **Before.** `CacheServicePlugin` registered an in-process `MemoryCacheAdapter` on every node. `RedisCacheAdapter` threw `not yet implemented` from every method, and `adapter: 'redis'` threw at `init`. On N replicas every counter kept in the cache counted per process: better-auth's sign-in limits (through `rateLimit.customStorage`), the inbound API budget, the OTP send budget, the daily SMS quota and the `notify` node's per-address email limit each admitted N times the declared limit, and nothing at boot said so.
- **Now (`@objectstack/service-cache`).** With `adapter` unset, the deployment's topology decides at `init`:
  - single node (no multi-node declaration): `MemoryCacheAdapter`, the same boot as before; the cluster service is not read;
  - multi-node declared over the `redis` cluster driver: `RedisCacheAdapter`, on a connection duplicated from the driver's (same Redis, same key prefix), closed at `kernel:shutdown`. Boot logs `registered redis cache adapter — one cache for every node on this Redis`;
  - multi-node declared over that driver with no shared cache possible (`adapter: 'memory'`, or a driver build that offers no connection): `init` throws, naming the fix;
  - multi-node declared over any other driver, or with no cluster service: `MemoryCacheAdapter` plus one `warn` that cache-backed limits multiply by the replica count.

  `adapter: 'redis'` now works: over `redis.client` (a host-owned ioredis client, never closed by the plugin), else the redis cluster driver's connection, else `init` throws. The plugin declares `com.objectstack.service.cluster` as an optional dependency, so it reads the driver after the driver started, in either registration order.
- **`RedisCacheAdapter`** is implemented. It takes a `client` (constructing none from a URL; `url` is deprecated and refused with a prescription when it is the only thing passed), stores entries at `<keyPrefix>cache:<key>` (default prefix `os:`, the driver's), JSON-encodes values (a `Date` reads back as its ISO string; `undefined`, functions and `bigint` are refused with a `TypeError`), lets Redis expire them (`SET … PX`; `ttl` in seconds, `0` = no expiry), throws Redis failures instead of answering a miss, and confines `clear()` and `stats().keyCount` to its own namespace, so the driver's `kv:` / `ctr:` / lock keys under the same prefix are never touched. `hits` / `misses` stay per process. Counters remain read-modify-write (the contract has no atomic increment): two nodes counting one key in the same instant can both be admitted at a limit's boundary, the bounded imprecision ADR-0069 D2 accepts.
- **New in `@objectstack/service-cache`:** the `redis` option (`CacheServicePluginRedisOptions`: `client`, `keyPrefix`, `defaultTtl`) and the `RedisCacheClient` type. `redisUrl` is deprecated (never read).
- **New in `@objectstack/service-cluster`:** `offerClusterDriverConnection(cluster, { driver, client, keyPrefix })` and `readClusterDriverConnection(cluster, driver)`, the seam a driver offers its connection through. The offer is a non-enumerable property under a `Symbol.for` key, so it never serialises and a second copy of the package reads it too.
- **`@objectstack/service-cluster-redis`** offers its ioredis client and key prefix through that seam. Its own behaviour is unchanged.

Better-auth's `secondaryStorage` stays off: sessions remain in `sys_session`, and the shared cache only carries the rate-limit counters.

**The remedy** for the refused configuration: drop `adapter` (or pass `adapter: 'redis'`) so the cache shares the cluster driver's Redis. A host that deliberately wants per-process caches must also drop the multi-node declaration.
