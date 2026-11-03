---
'@objectstack/service-push': patch
'@objectstack/service-messaging': patch
'@objectstack/spec': patch
---

feat(notifications): the `push` channel — a `notify` node naming `push` reaches the recipient's phones through APNs and FCM

Clause-②: yes (widening)
Metadata-protocol: none

- **New package `@objectstack/service-push`.** `PushServicePlugin` registers the kernel's `push` service: APNs over HTTP/2 with token-based auth (an ES256 provider token signed with the `.p8` key, reused for fifty minutes) and FCM over the HTTP v1 API (an OAuth access token from the service account). It reads `PushServiceConfigSchema` from its `config` option and refuses an inline secret at boot with the schema's guidance. Each secret is named by `credentialRef` and resolved when the transport first signs; in the open tier the reference is the name of an environment variable (ADR-0143 D3).
- **`@objectstack/service-messaging`: the `push` channel.** Mounted while a `push` service is registered, as the sms channel is while an `sms` service is. One delivery reaches every enabled device the recipient registered, on each vendor the push service has a transport for. The push carries the notification id and, when it is a same-server path (`PushRouteSchema`), the notification's `actionUrl` as `route`; any other `actionUrl` is left out and the delivery still goes. Each device's push also carries the origin stored on its row (`PushDeliveryDataSchema.origin`) when the row holds one; the registry does not store it yet, so today none does. A token the vendor reports dead (APNs `BadDeviceToken` / `Unregistered`, FCM `UNREGISTERED`) is retired through `invalidateDeviceToken`: the device row is kept, disabled, and the user's other devices still get the push. A recipient with no enabled device, or whose every device was reported dead, is graded `invalid_recipient`; no push service is refused `transport_not_configured`, as the sms and email channels refuse it.
- **`@objectstack/spec`: description and comment text only.** The `[PLANNED]` markers come off `PushServiceConfigSchema`, `ApnsTransportConfigSchema`, `FcmTransportConfigSchema` and `PushDeliveryDataSchema`, which now have their reader and producer. `NotificationChannelSchema`'s JSDoc lists `push` among the registered channels, the docblocks name `@objectstack/service-push` where they named `plugin-notification-push`, and the `NOT_FOUND` synonym waiver's reason names service-messaging's own provenance row. No key, schema shape or export changes.
