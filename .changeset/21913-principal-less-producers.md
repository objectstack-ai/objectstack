---
"@objectstack/service-settings": minor
"@objectstack/service-messaging": patch
"@objectstack/service-datasource": minor
"@objectstack/plugin-webhooks": patch
---

Platform plumbing in these four packages now passes the explicit system opt-in (`{ isSystem: true }`) on its data-engine calls. Until now it reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.

Clause-②: yes (widening)

- **Why `yes (widening)`:** two exported option types gain an optional `context` that an adapter must forward as-is. They are `SettingsEngine.find` / `.insert` (`@objectstack/service-settings`) and `SecretStoreEngineLike.delete` (`@objectstack/service-datasource`), so both packages take a `minor`. An implementation written against the old types still type-checks, and nothing accepted or refused at any door changes.
- **service-settings:** `SettingsService` reads and writes its own `sys_setting` rows under the opt-in: `loadRows`, plus the existence probe and insert in `upsertRow` (the update already used it). The `sys_setting_audit` writer does too.
- **service-datasource:** the `sys_metadata` helpers behind runtime datasources use the opt-in. They cover boot restore, cluster convergence, and persist and delete behind the admin doors. So do the `sys_secret` binder's `bind`, `unbind` and `resolve`.
- **plugin-webhooks:** the auto-enqueuer's subscription refresh and the redeliver guard's subscription lookup use the opt-in.
- **service-messaging:** two paths use the opt-in. One is the dispatcher's claim path: `claim`, `claimDigest` and the visibility-timeout reap on both outboxes. The other is the emit fan-out: the `sys_notification` row, the recipient's address and locale reads, the preference reads, the inbox row and the delivered receipt.
- **A user reference that names no user is still refused.** The engine skips its dangling-reference check for an `isSystem` write, so each producer that writes a user reference checks it first. The checked references are the `actor_id` of `sys_notification`, `sys_inbox_message` and `sys_setting_audit`, and the `user_id` of a user-scope `sys_setting` row. An unknown id is refused with the engine's own answer: `VALIDATION_FAILED`, one `reference_not_found` finding, and the same message. A write that names no user is unchanged.
- What each call reads and writes is otherwise unchanged. None of the gates the middleware runs before its hand-off applies to these objects.
- ⛔ No new export on any package entry, and no new elevation API.
