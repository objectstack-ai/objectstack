---
'@objectstack/spec': patch
---

docs(spec): the push vendor docblocks read ADR-0012 §6.1 as amended

Clause-②: no
Metadata-protocol: none

The `PushVendorSchema` docblock and the push transport and stored device docblocks (`system/push-config.zod.ts`, `system/push-device.zod.ts`) no longer say the domestic Android vendors plug in as alternate channel plugins. They now say what ADR-0012 §6.1 decides: `vendor` is the token type the hosted relay routes on, core ships `apns` and `fcm`, and phase 2 adds HMS / Honor, Xiaomi, OPPO and vivo behind the same relay, with no per-vendor plugin and no per-vendor channel. A new `PushVendorSchema` value is still a spec change made together with the relay's routing for that vendor. Comment text only: no schema, `.describe()`, export or default changes, and `PushVendorSchema` stays `apns | fcm`.
