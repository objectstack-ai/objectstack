# @objectstack/studio

The Studio app: the metadata builder, packaged as its own ObjectStack app package (ADR-0048: one app per package). A stock boot does not register it, because the console ships a dedicated Studio surface; a host that wants Studio as a navigable app registers `StudioAppPlugin` itself.

```typescript
import { StudioAppPlugin } from '@objectstack/studio';
```

Documentation: [Apps](https://objectstack.ai/docs/ui/apps)
