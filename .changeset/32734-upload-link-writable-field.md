---
'@objectstack/service-storage': patch
'@objectstack/mcp': patch
'@objectstack/spec': patch
---

fix(storage): an upload link is not issued for a field a pending approval or a `readonly` declaration keeps the user from changing, and the upload page never says "attached" when the field did not take the file

Clause-②: no
Metadata-protocol: none

An agent's `create_upload_link` used to hand out a link to a file field the user could not change, and the upload through it then misreported what happened:

- **A record locked by a pending approval.** The link was issued, and the upload answered `500` "Upload failed": the record-lock hook's `409 RECORD_LOCKED` declares its status as `statusCode`, and the upload-link doors read `status` only. `create_upload_link` now refuses a file field of a locked record with `409 RECORD_LOCKED` (the approvals service's own `getRecordLock` answer), and an upload through a link minted before the lock answers the hook's `409 RECORD_LOCKED`, with its reason. The doors read a declared status over both spellings.
- **A field read-only in the record's current state (`readonlyWhen`).** The upload answered "Done. The file was attached" while the engine ignored the change, leaving the record as it was and the stored file behind. The field write is now strict (`strictReadonlyWrites`): the upload is refused with `403 FIELD_NOT_ACCESSIBLE` and a reason that starts "Nothing was attached", and the stored file is removed. A link is still issued for such a field; refusing it when the link is minted needs a judgement the engine does not offer without writing.
- **A `readonly` field.** `create_upload_link` refuses it with `403 FIELD_NOT_ACCESSIBLE`.

The upload page says the file was attached only on an answer naming the stored file; any other answer shows the refusal it carries. Links to the attachments list, and links to a field a draft record takes, work as before.

`@objectstack/spec`: the error-code ledger lists `RECORD_LOCKED` under `@objectstack/service-storage` as well, its second emitter after `@objectstack/plugin-approvals`. `@objectstack/mcp`: `create_upload_link`'s description says which records and fields get no link.
