---
'@objectstack/objectql': patch
'@objectstack/service-storage': patch
'@objectstack/mcp': patch
---

fix(service-storage)!: an upload link is refused at issue for a file field whose `readonlyWhen` holds now (#32768)

Clause-②: yes (narrowing) — `create_upload_link` (`createUploadLinkAs`) issues no link for a file field whose `readonlyWhen` holds on the record as it stands, where it issued one and the upload was refused when it arrived. The engine gains one write-free judgement, `ObjectQL#judgeFieldWriteLock` (widening).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored shape changes. The refusal is the existing FIELD_NOT_ACCESSIBLE 403 the link door already answers for a static readonly field, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that minted an upload link onto a file field while its `readonlyWhen` held.

FROM: `create_upload_link` answered a link, and the upload through it was refused when it arrived (`403 FIELD_NOT_ACCESSIBLE`, "Nothing was attached: …", since #32734), after the person had picked and sent the file.
TO: the call itself is refused, `403 FIELD_NOT_ACCESSIBLE`, `You cannot attach a file to OBJECT.FIELD: the field is read-only in the target record's current state (a TRUE \`readonlyWhen\` predicate).`, and no link is written. The fix for a caller: mint the link once the record's state unlocks the field, or use the record's attachments, which carry no field lock and are unchanged.

The verdict is the engine's own: `ObjectQL#judgeFieldWriteLock(object, id, field, { context })` runs the update's `readonlyWhen` strip over the update's stored-row read and master-detail header, without writing, and answers the reason the update reports the field under (`readonly_when`) with the words its strict refusal uses. A field with no `readonlyWhen` costs no read. A static `readonly` field and a record a pending approval locks are refused at issue as before.
