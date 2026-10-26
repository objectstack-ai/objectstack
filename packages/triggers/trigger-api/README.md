# @objectstack/trigger-api

The inbound HTTP flow trigger (ADR-0041): a per-flow endpoint that verifies an HMAC signature and hands the request to a queue, so an external system can start a flow by webhook. `ApiTriggerPlugin` mounts the endpoints.

```typescript
import { ApiTriggerPlugin } from '@objectstack/trigger-api';
```

Documentation: [Flows](https://objectstack.ai/docs/automation/flows)
