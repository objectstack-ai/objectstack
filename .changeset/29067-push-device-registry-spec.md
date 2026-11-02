---
'@objectstack/spec': patch
---

feat(spec): the push channel's protocol face: the widened device registration request, optional `INotificationService` device members, the push delivery data with its same-server `route`, and the APNs / FCM transport configuration by reference (ADR-0012 §6)

Clause-②: yes (widening)
Metadata-protocol: none

- **`RegisterDeviceRequestSchema`** gains three optional members: `vendor` (`apns` | `fcm`; absent, the server derives it from `platform`, `ios` → `apns` and `android` → `fcm`), `appId` and `locale`. `token`, `platform`, `deviceId` and `name` are unchanged, so every body a client sent before still parses as it did. The describes now say that re-registering a `deviceId` refreshes that device, and that a request without one gets a server-minted id the client keeps. A `vendor` outside `apns` / `fcm` is refused, and since the member is new, no body sent before carries one. `RegisterDeviceResponseSchema` and `UnregisterDevice*` are unchanged.
- **`INotificationService`** gains three optional members: `registerDevice(userId, request)`, `unregisterDevice(userId, deviceId)` and `invalidateDeviceToken(token)`. Their docs state the semantics an implementation owes: one live owner per token (a second user's registration takes it over), unregistering a device the user does not hold answers not found, and an invalidated token keeps its device row, disabled, with the invalidation time. Absence means the capability is unavailable, so every existing implementation stays valid.
- **`PushDeliveryDataSchema`** (new, `api/push-delivery.zod.ts`) is the data a push carries to the shell: `notificationId` and an optional `route`. `PushRouteSchema` admits only a same-server relative path (one leading `/`; no scheme, host, backslash, whitespace or control character). The route is derived, never authored: it is the notification's existing `actionUrl` when that passes the schema, and absent otherwise. No `notify` key is added.
- **`PushServiceConfigSchema`** (new, `system/push-config.zod.ts`, beside the email transport configuration): an `apns` block (token auth: `teamId`, `keyId`, `topic`, `environment: sandbox | production`, the `.p8` key by `keyRef`) and an `fcm` block (HTTP v1: `projectId`, the service-account JSON by `serviceAccountRef`). Secrets are references only (ADR-0143 D3). An inline secret is refused by name under the keys an operator would reach for, and refused as the content of a reference (a PEM block or a JSON document). `PushVendorSchema` names the two vendors. Nothing reads this shape until the push channel plugin lands, and it is not a stack-definition key.

No route row is added: the device routes land with their handlers in the server slice, so `DEFAULT_NOTIFICATION_ROUTES` is unchanged. Nothing an author or a client writes today is refused.
