---
"@objectstack/service-settings": patch
"@objectstack/service-messaging": patch
"@objectstack/service-datasource": patch
"@objectstack/plugin-webhooks": patch
---

Platform plumbing in these four packages now passes the explicit system opt-in (`{ isSystem: true }`) on its data-engine calls. Until now it reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.

Clause-②: no

- **service-settings:** `SettingsService` reads and writes its own `sys_setting` rows under the opt-in: `loadRows`, plus the existence probe and insert in `upsertRow` (the update already used it). The `sys_setting_audit` writer does too. `SettingsEngine.find` and `.insert` now declare the `context` they are handed, and an adapter must forward it as-is, the same rule `update` already had.
- **service-datasource:** the `sys_metadata` helpers behind runtime datasources use the opt-in. They cover boot restore, cluster convergence, and persist and delete behind the admin doors. So do the `sys_secret` binder's `bind`, `unbind` and `resolve`. `SecretStoreEngineLike.delete` now declares that `context`.
- **plugin-webhooks:** the auto-enqueuer's subscription refresh and the redeliver guard's subscription lookup use the opt-in.
- **service-messaging:** two paths use the opt-in. One is the dispatcher's claim path: `claim`, `claimDigest` and the visibility-timeout reap on both outboxes. The other is the emit fan-out: the `sys_notification` row, the recipient's address and locale reads, the preference reads, the inbox row and the delivered receipt.
- What each call reads and writes is unchanged. None of the gates the middleware runs before its hand-off applies to these objects. One engine branch keyed on the flag stops running: the dangling-reference check on the `actor_id` of `sys_notification`, `sys_inbox_message` and `sys_setting_audit`. It passed on every measured call.
- ⛔ No new export on any package entry, no new elevation API, and no change to what any door authorizes or to any accept set.
