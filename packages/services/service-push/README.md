# @objectstack/service-push

The push service: `IPushService` over the APNs (HTTP/2, token-based auth) and FCM (HTTP v1) transports, configured by `PushServiceConfigSchema` from `@objectstack/spec/system`. Each secret, the APNs `.p8` signing key and the FCM service-account JSON, is named by a `credentialRef` and resolved when the transport first signs (in the open tier, the name of an environment variable). `PushServicePlugin` registers the kernel's `push` service, and the `push` channel in `@objectstack/service-messaging` delivers through it to the devices users register under `/api/v1/notifications/devices`.

The direct transport is the one served: `transport: 'direct'` with your own APNs key and Firebase project, for a white-label build. The hosted relay (`transport: 'relay'`, the schema's default, so also an empty config) is refused at init until its sender ships (#29920).

```typescript
import { PushServicePlugin } from '@objectstack/service-push';

kernel.use(new PushServicePlugin({
  config: {
    transport: 'direct',
    apns: { teamId: 'ABCDE12345', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production', credentialRef: 'APNS_SIGNING_KEY' },
    fcm: { projectId: 'example-app', credentialRef: 'FCM_SERVICE_ACCOUNT' },
  },
}));
```
