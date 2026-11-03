---
'@objectstack/spec': minor
---

feat(spec): push delivery data names the server that sent it — `RegisterDeviceRequest`, `UserDevice` and `PushDeliveryData` each gain an optional `origin`

Clause-②: yes (widening)
Metadata-protocol: added

APNs and FCM tell a mobile shell nothing about who sent a push, and every server the shell has saved registers the same vendor token, so a shell with several saved servers opened a tap from server B on server A. The push now names its server, round-tripped from the device registration:

- **`RegisterDeviceRequestSchema.origin`** (the `POST /api/v1/notifications/devices` body): the origin the Console was loaded from (`window.location.origin`), which is the address the shell saved for that server. The Console writes it.
- **`UserDeviceSchema.origin`** (the stored device row): the registration's value, kept on the device.
- **`PushDeliveryDataSchema.origin`** (the data a push carries to the shell): the push channel copies it from the device the push goes to, and the shell opens the tap on the saved server with that origin.

All three are optional and share one rule: `http://` or `https://`, a lowercase host (a DNS name or a bracketed IPv6 address) and an optional port, with no path (not even a trailing `/`), query, fragment or user info. That is exactly the form `window.location.origin` answers, so the shell can compare it with a saved server byte for byte. A path, another scheme or a bare host is refused with the same message in all three schemas, and the rule is a pattern, so the published JSON Schema carries it too.

The device-side members carry a `[PLANNED — not yet stored]` marker: the server parses `origin` on a registration from this release, and refuses a malformed one, but the device registry does not keep it and the push channel does not send it yet. A registration body without `origin` parses exactly as before.
