# @objectstack/service-push

The push service: `IPushService` over the hosted push relay and the APNs (HTTP/2, token-based auth) and FCM (HTTP v1) transports, configured by `PushServiceConfigSchema` from `@objectstack/spec/system`. Each secret, the APNs `.p8` signing key and the FCM service-account JSON, is named by a `credentialRef` and resolved when the transport first signs (in the open tier, the name of an environment variable). `PushServicePlugin` registers the kernel's `push` service, and the `push` channel in `@objectstack/service-messaging` delivers through it to the devices users register under `/api/v1/notifications/devices`.

Two transports are served. The hosted relay (`transport: 'relay'`, the schema's default, so also an empty config) sends each push to the cloud's push relay as an ID-only request, authenticated by this server's cloud binding credential, which it reads from the `cloud-binding` service (`@objectstack/cloud-connection`) on every send: an unbound server boots, and pushes once it is bound. A deployment that declared it has no control plane (`OS_CLOUD_URL=off`) refuses the relay at init. The direct transport, `transport: 'direct'` with your own APNs key and Firebase project, is for a white-label build.

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
