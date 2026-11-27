---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none (no page under `skills/**` names these doors' `501` sentences)

The comment doors and the webhook redelivery door now answer their `501 NOT_IMPLEMENTED` in the request's language, as the print, personal-view and attachment doors do. On a kernel with no `comments` or `webhooks` service, or with one that lacks `handleCommentDoor` / `handleRedeliver`, a `zh-CN`, `ja-JP` or `es-ES` request read the sentence in English. The operation-message catalog (`BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) gains `comment_doors_service_unregistered`, `comment_doors_member_missing`, `webhook_redeliver_service_unregistered` and `webhook_redeliver_member_missing` in `en`, `zh-CN`, `ja-JP` and `es-ES`; their English is the sentence each door answered before, byte for byte. Code and status do not change, and no `userMessage` is added.

**The English moved for one door.** The attachment removal and rename doors' `501` now reads "The attachment removal and rename doors **are** not available: …" (it read "is"). The catalog gains `own_door_service_unregistered_plural` and `own_door_member_missing_plural` in the four locales, read by a bridge whose noun is plural; the `es-ES` noun of `own_door_attachment_mutate` becomes plural to match ("Los puntos de acceso para eliminar y renombrar adjuntos no están disponibles: …"). The `zh-CN` and `ja-JP` sentences do not change.

In `@objectstack/runtime` (internal), the own-door bridge's `nounKey` is required, so no bridge can ship a `501` that stays English under another language.
