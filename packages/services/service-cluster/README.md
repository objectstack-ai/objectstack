# @objectstack/service-cluster

The cluster service: pluggable pub/sub, lock, key-value and counter primitives that let several ObjectStack nodes coordinate. The in-memory driver ships here; the Redis driver ships as `@objectstack/service-cluster-redis`. `ClusterServicePlugin` registers the service with the kernel.

```typescript
import { ClusterServicePlugin } from '@objectstack/service-cluster';
```

Documentation: [Cluster](https://objectstack.ai/docs/kernel/cluster)
