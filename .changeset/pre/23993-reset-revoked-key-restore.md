---
'@objectstack/platform-objects': minor
'@objectstack/plugin-auth': minor
'@objectstack/core': minor
---

feat(plugin-auth,platform-objects,core)!: an API key an administrator's forced password reset revoked is restored by a platform administrator only; its owner creates a new key (#23993)

**BREAKING** (an accept-set narrowing at the `sys_api_key` write door), shipped as `minor` under the launch-window convention for breaking changes. For an operator: a key revoked by `POST /api/v1/auth/admin/set-user-password` (the forced reset, which revokes the user's keys by default) can no longer be restored by its owner; a platform administrator restores it with the Restore API Key action, or the owner creates a new key. For an integrator: `PATCH /api/v1/data/sys_api_key/{id}` with `{ revoked: false }` on such a key now answers `403 PERMISSION_DENIED` for its owner, where it answered `200`; and `sys_api_key` gains a readonly `revoked_reason` column.

Clause-②: yes (narrowing)

What widens: `sys_api_key` declares one more field, `revoked_reason`. What narrows: the owner's restore of a key whose `revoked_reason` is `admin_password_reset` is refused, where it was admitted.

<!-- adr-0087: not-required (no-migration-prescription) A write-door narrowing on one platform object plus one new readonly platform field, not a metadata change an author makes. No authorable spec key, stored shape or metadata surface is removed or renamed, so `objectstack migrate meta` has nothing to rewrite: the refused request is a runtime call whose remedy is a person (a platform administrator) or a new key, not a rewrite. No ADR-0087 id covers this and none is added. -->

#23287 ruling C′ makes the forced reset revoke the user's API keys by default, for a suspected compromise: a key that outlives the reset is the hole the reset was meant to close. Its changeset names who acts afterwards: a platform administrator restores such a key, or the owner mints a replacement. The owner could nevertheless restore it through the same door as any revoked key, because the row recorded no reason. Now it does.

- **`sys_api_key.revoked_reason` (`@objectstack/platform-objects`).** A readonly `select` whose one value is `admin_password_reset`, set when the forced reset revoked the key and cleared when the key is restored. Empty for a key revoked from the API Keys list. Translated in `zh-CN`, `ja-JP` and `es-ES`.
- **The stamp (`@objectstack/plugin-auth`).** The forced reset's revocation writes `revoked_reason: admin_password_reset` beside `revoked: true`, the one place the reason is set. A key already revoked before the reset is not written, so it keeps no reason.
- **The restore guard (`@objectstack/plugin-auth`).** One `beforeUpdate` hook on `sys_api_key`, registered after the ADR-0092 D2 identity write guard. A user-context restore of a key carrying the reason is refused `403 PERMISSION_DENIED` unless the caller has platform-administrator standing (the ADR-0068 D2 rung); the refusal names both roads. Every restore it admits, the administrator's included, clears the reason. Revoking an already-revoked key leaves the reason in place, and the column is not on the D2 whitelist, so no data-API write can clear it. On a multi-row update every row is judged by its own stored state. System-context writes (the mint, the last-used stamp, the forced reset) are never refused.
- **The key door's message (`@objectstack/core`).** `API_KEY_REVOKED` for a key the forced reset revoked now says only a platform administrator can restore it; any other revoked key keeps today's sentence. Code, status and every carried field are unchanged.

What changes for you:

- **Refused now:** the owner restoring a key the forced reset revoked: `403 PERMISSION_DENIED`, naming the platform administrator and the new-key road. The administrator's restore works as before and clears the reason.
- **Unchanged:** revoking and restoring a key from the API Keys list, by its owner or an administrator; a forced reset with `revokeSessionsAndKeys: false`, which revokes nothing.
- **Keys revoked by a forced reset before this release** carry no reason, so their owner can still restore them. Such keys exist only where `18.0.0-next.2` or a `main` build since 2026-10-14 ran a forced reset; nothing backfills them, because the reset's audit row records counts, not key ids.
