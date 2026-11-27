---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

**Shipped in 19.0.0-next.0**, whose CHANGELOG missed this entry; listed here one prerelease late.

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none (no page under `skills/**` names the own-door bridge or its `501` sentences)

The personal-view delete door and the attachment removal and rename doors now answer their own-door bridge `501 NOT_IMPLEMENTED` in the request's language, as the print door has since #37273. On a kernel with no `personal-views` or `file-attachments` service, or with one that lacks its door's member, a `zh-CN`, `ja-JP` or `es-ES` request read the sentence in English while the print door on the same kernel answered in the request's language.

The operation-message catalog (`BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) gains the two doors' nouns, `own_door_personal_view_delete` and `own_door_attachment_mutate`, in `en`, `zh-CN`, `ja-JP` and `es-ES`, and the two bridges (`@objectstack/runtime`) name them as `nounKey`. The English of each key is the bridge's `noun`, byte for byte, so an English request, or one with no `Accept-Language`, reads the sentence it read before. Code, status and the slot, member and package names do not change, and no `userMessage` is added.
