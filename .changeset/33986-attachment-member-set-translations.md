---
'@objectstack/service-storage': patch
---

fix(service-storage): translate the built-in `storage_attachment_member` permission set

Clause-②: no
Metadata-protocol: none

The permission set this service contributes to every member's baseline ("Attachments: read and attach (every member)") now ships its label and description in every locale the platform's other built-in sets ship (zh-CN, ja-JP, es-ES, zh-Hant, ar, fr, pt-BR, ru, de, ko). Setup's permission-set lists in a translated Console no longer show it as the one English row. What the set grants, and when it is contributed, is unchanged.
