# @objectstack/service-cluster

The cluster service: pluggable pub/sub, lock, key-value and counter primitives that let several ObjectStack nodes coordinate. The in-memory driver ships here; the Redis driver ships as `@objectstack/service-cluster-redis`. `ClusterServicePlugin` registers the service with the kernel.

```typescript
import { ClusterServicePlugin } from '@objectstack/service-cluster';
```

Documentation: [Cluster](https://objectstack.ai/docs/kernel/cluster)

`@objectstack/service-cluster/testing` (the pub/sub, lock, KV and counter contract suites) is **ESM-only**: it imports `vitest`, whose own `require()` entry throws, so the subpath declares only an `import` condition. Load it with `import`; `require()` is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

**TypeScript:** use `moduleResolution` `node16`, `nodenext` or `bundler`. The legacy `node10` resolution (`"node"`) ignores `exports`, so it cannot resolve this package's subpath imports and is not supported. See [Module resolution](https://objectstack.ai/docs/plugins/development#module-resolution).
