# @objectstack/service-sms

The SMS service: `ISmsService` with transport-pluggable outbound delivery (Aliyun, Twilio, or a log transport for development). `SmsServicePlugin` registers the service with the kernel.

```typescript
import { SmsServicePlugin } from '@objectstack/service-sms';
```

Documentation: [SMS service](https://objectstack.ai/docs/kernel/runtime-services/sms-service)
