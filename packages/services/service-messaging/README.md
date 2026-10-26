# @objectstack/service-messaging

The messaging service for outbound notifications (ADR-0012): the `MessagingChannel` registry, the `emit()` fan-out and the always-on inbox channel. Other channels (email, webhook, push, IM) plug into the same registry. `MessagingServicePlugin` registers the service with the kernel.

```typescript
import { MessagingServicePlugin } from '@objectstack/service-messaging';
```

Documentation: [Runtime services](https://objectstack.ai/docs/kernel/runtime-services)
