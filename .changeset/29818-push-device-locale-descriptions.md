---
'@objectstack/spec': patch
'@objectstack/service-messaging': patch
---

fix(spec,messaging): a push device's `locale` is described as what it is — stored for the device, and no push renders by it

Clause-②: no
Metadata-protocol: none

- **`@objectstack/spec`**: `UserDeviceSchema.locale` and `RegisterDeviceRequestSchema.locale` no longer say pushes to the device are rendered in its locale. They now say the value is stored for the device and that a push arrives in the recipient's language: `sys_user.locale`, then the deployment default. Description text only; nothing a caller sends is accepted or refused differently.
- **`@objectstack/service-messaging`**: the `sys_user_device.locale` field description says the same, in all four shipped languages. A test now pins it end to end: with the real push channel over the real device registry, a phone registered with a locale other than its user's receives the push in the user's language, on the inline fan-out and on the durable outbox path alike.
