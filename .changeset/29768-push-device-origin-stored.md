---
'@objectstack/service-messaging': patch
'@objectstack/spec': patch
---

feat(messaging,spec): a push device's `origin` is stored at registration and every push to the device carries it back

Clause-②: no
Metadata-protocol: none

- **`@objectstack/service-messaging`**: `sys_user_device` gains an optional `origin` column. `POST /api/v1/notifications/devices` stores the registration's `origin` on the device row (`null` when the registration names none, and a refresh replaces it as it does `appId` and `locale`); `listDevices` answers it; and the push channel, which already copied a device's `origin` into the push data, now finds one to copy. A mobile shell with several saved servers can therefore open a tapped push on the server that sent it. Registrations without `origin` behave exactly as before.
- **`@objectstack/spec`**: `RegisterDeviceRequestSchema.origin` and `UserDeviceSchema.origin` drop their `[PLANNED — not yet stored]` prefix, since the server now stores the value. The push server origin docblock names where its pattern is knowingly narrower than a URL origin (an underscore in a label, a trailing-dot host) and looser (a written-out default port, a leading zero or an out-of-range port, any bracketed run of hex digits, colons and dots), and that a dotted IPv4 host is accepted. Description and docblock text only; nothing a caller sends is accepted or refused differently.
