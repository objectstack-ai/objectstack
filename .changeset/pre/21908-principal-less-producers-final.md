---
"@objectstack/service-messaging": patch
"@objectstack/service-storage": patch
"@objectstack/service-settings": patch
"@objectstack/metadata-protocol": patch
---

The remaining platform producers in these four packages now pass the explicit system opt-in (`{ isSystem: true }`) on their data-engine calls. Until now they reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.

Clause-②: no

- **service-messaging, the inbox read state.** `listInbox` (and its unread total), the receipt read behind it, and mark-read / mark-all-read take the opt-in inside the service. Their scope is unchanged: every read of a user's rows is keyed on the user id the door derived from the session, the receipt a mark-read inserts is stamped with it, and the receipt it updates is one a user-keyed read returned.
- **service-messaging, `owner_of:` audiences.** The record read takes the opt-in, the same posture as the email lookup beside it. It reads only `id` and the owner fields, and only the owner id leaves the resolver. An `owner_of:` audience on an object whose sharing model is `private` now resolves its owner; before, it resolved to nobody.
- **service-messaging, the rest of the fan-out and the outboxes.** The `role:` and `team:` membership reads, the email and SMS recipient reads, the notification template read, the dedup lookup in `emit()`, and both outboxes' enqueue, ack and list.
- **service-storage.** `StorageMetadataStore.createFile` and `createSession` insert under the opt-in. The organization still reaches the driver beside it, so the stored organization is unchanged, and the file's `owner_id` is still the uploading user.
- **service-settings.** The `sys_secret` store the plugin builds (insert, get, update), and the read that verifies a rotation before the old secret is reaped. A store `update` now writes the `ciphertext` it is given; without a context the engine's read-only strip dropped it. No caller in this repository uses `update`.
- **metadata-protocol.** `SysMetadataRepository.getByHash`, `list`, `history` and the history replay of `watch()`.
- None of the gates the middleware runs before its hand-off applies to these calls. ⛔ No new export on any package entry, and no new elevation API.
