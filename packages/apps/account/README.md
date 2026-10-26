# @objectstack/account

The end-user Account app: the self-service app that navigates the identity objects owned by `@objectstack/plugin-auth`. It is a console navigation-shell app packaged as its own ObjectStack app package (ADR-0048: one app per package), so `/apps/account` resolves to exactly this app. `AccountAppPlugin` registers its manifest with the kernel.

```typescript
import { AccountAppPlugin } from '@objectstack/account';
```

Documentation: [Apps](https://objectstack.ai/docs/ui/apps)
