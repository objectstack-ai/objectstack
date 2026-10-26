# @objectstack/setup

The Setup app: the platform administration app, plus the baseline Setup navigation that other packages extend. It is a console navigation-shell app packaged as its own ObjectStack app package (ADR-0048: one app per package), so `/apps/setup` resolves to exactly this app. `SetupAppPlugin` registers its manifest with the kernel.

```typescript
import { SetupAppPlugin } from '@objectstack/setup';
```

Documentation: [The Setup app](https://objectstack.ai/docs/ui/setup-app)
