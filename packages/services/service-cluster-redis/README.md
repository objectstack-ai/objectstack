# @objectstack/service-cluster-redis

Redis driver for `@objectstack/service-cluster` — implements the cluster
primitives `IPubSub` / `ILock` / `IKV` / `ICounter` against Redis using
[`ioredis`](https://github.com/redis/ioredis).

## Status: community-optional reference driver

This package is the **reference remote driver** that proves the
`registerClusterDriver()` SPI. It is **not** on the ObjectOS Cloud or
ObjectOS EE deployment path — both run **Redis-free** (single-node-affinity
routing + DB-backed queue/coordination). It is maintained as long as the
cluster driver SPI is stable, but it is **not operated or supported by
ObjectStack** as part of the managed/enterprise runtime.

Reach for it only when you self-host **multiple replicas that must share
cluster primitives** with low latency — e.g. sub-second cross-process pub/sub
or high-frequency cross-process locks. For most deployments the default
`memory` driver (single process) or the DB-backed queue is sufficient; see
`@objectstack/service-cluster` for when a remote driver is actually needed.

## Installation

```bash
pnpm add @objectstack/service-cluster @objectstack/service-cluster-redis ioredis
```

## Usage

Importing the package once at process start self-registers the `'redis'`
driver, which `defineCluster({ driver: 'redis' })` then resolves.

```typescript
import { ObjectKernel } from '@objectstack/core';
import { ClusterServicePlugin } from '@objectstack/service-cluster';
import '@objectstack/service-cluster-redis'; // self-registers the 'redis' driver

const kernel = new ObjectKernel();
kernel.use(new ClusterServicePlugin({
  config: {
    driver: 'redis',
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    nodeId: 'web-1',
  },
}));
await kernel.bootstrap();
```

You can also build the service directly with `defineCluster({ driver: 'redis', url, nodeId })`,
or pass a shared ioredis client via `driverOptions.client`.

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/service-cluster](../service-cluster) — primitives, SPI, and the
  default in-process `memory` driver
