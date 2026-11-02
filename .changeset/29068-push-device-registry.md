---
'@objectstack/service-messaging': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
'@objectstack/spec': patch
---

feat(notifications): the push device registry is served: `sys_user_device`, `POST /api/v1/notifications/devices` and `DELETE /api/v1/notifications/devices/:deviceId`, and the client's `notifications.registerDevice` / `unregisterDevice` (ADR-0012 §6)

Clause-②: yes (widening)
Metadata-protocol: none

Nothing a client or an operator sends today is refused, and no metadata an author writes changes: the routes and the client methods are new, and the spec change is two catalog rows and description text.

- **`@objectstack/service-messaging`** registers `sys_user_device` (one row per user and app install: `device_id`, `user_id`, `vendor`, `token`, `platform`, `app_id`, `locale`, `name`, `enabled`, `invalidated_at`, `last_seen_at`) and implements `INotificationService`'s four device members on `MessagingService`. The table is system-owned: the generic data API neither reads nor writes it (`apiEnabled: false`), and it has no organization column, because a device belongs to its user. `registerDevice` refreshes a device id the user already holds, mints one when the request carries none, and moves a token another device holds to the registering device (the previous holder's row is removed, so a push meant for a phone's previous user never reaches its new one). A token has one holder: a unique index on `token` refuses a second one, and a registration that loses a race re-reads and moves the token. `invalidateDeviceToken` keeps the row with `enabled: false` and `invalidated_at`, and the device's next registration re-enables it. A `web` registration without `vendor` is refused `400 VALIDATION_FAILED`.
- **`@objectstack/runtime`** serves `POST /api/v1/notifications/devices` (body: `RegisterDeviceRequestSchema`; answers `{ deviceId, success }`) and `DELETE /api/v1/notifications/devices/:deviceId` (the caller's own device; another user's or an unknown id answers `404 NOT_FOUND` and nothing is removed), behind the domain's anonymous floor (`401 UNAUTHENTICATED`). A notification service without the device members answers `501`. The standalone server mounts both, with the other verbs on the two paths mounted refusal-only like the inbox faces.
- **`@objectstack/client`**: `client.notifications.registerDevice(request)` and `client.notifications.unregisterDevice(deviceId)`, removed earlier because no server served them, are back.
- **`@objectstack/spec`**: `DEFAULT_NOTIFICATION_ROUTES` lists the two device routes again, and the `[PLANNED — not yet served]` markers come off the four device registration schemas and `UserDeviceSchema`.
