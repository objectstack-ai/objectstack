# @objectstack/platform-objects

The core platform object schemas: the identity, security, audit, integration, metadata and system objects every ObjectStack environment carries. Each domain is also importable on its own subpath (`@objectstack/platform-objects/identity`, `/security`, …), and `PlatformObjectsPlugin` registers the whole set with the kernel.

```typescript
import { PlatformObjectsPlugin } from '@objectstack/platform-objects';
```

Documentation: [Packages](https://objectstack.ai/docs/plugins/packages)
