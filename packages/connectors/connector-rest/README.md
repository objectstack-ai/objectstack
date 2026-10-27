# @objectstack/connector-rest

The generic REST connector: the reference concrete connector, which registers a `request` action on the automation engine's connector registry (ADR-0018 §Addendum) so a flow can call an HTTP endpoint.

```typescript
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
```

Documentation: [Connectors](https://objectstack.ai/docs/automation/connectors)
