---
'@objectstack/objectql': minor
'@objectstack/service-storage': minor
---

A reader refused `sys_file` read now sees the name, size and type of a file the record they are reading owns, whenever the download door would serve them its bytes

Clause-②: yes

The download door already judges a field-owned file by the record that owns it (ADR-0104 D3): a declared `fileAccessDelegate` decides where the owner object names one, otherwise the caller's read of that record. Record file-field hydration judged the same file by `sys_file` object read instead, which the default member grants do not include. So one reader could download a contract's signed PDF but saw the field as `{ id, metadataRefused: true }`: the bytes yes, the name no.

- **From.** A reader with read on `contract` and no `sys_file` read gets `{ "signed_pdf": { "id": "f_7cQx2Lm90a", "metadataRefused": true } }` for every file id the record holds.
- **To.** For a file whose `ref_object` / `ref_id` name the record being read, that reader gets the hydrated `{ "id": "f_7cQx2Lm90a", "name": "signed.pdf", "size": 2048, "mimeType": "application/pdf", "url": "/api/v1/storage/files/f_7cQx2Lm90a" }`, exactly as a `sys_file` reader does, when the door's field-owned verdict allows it. A delegate-governed object (for example `sys_approval_action`, delegate `approvals`) gets its delegate's answer, not the raw record read.
- **Unchanged.** Every other id keeps `{ id, metadataRefused: true }`: an id copied in from another record, an attachment-only or unclaimed file, a `public_read` file the record does not own, and an owned file the delegate or the record read refuses. `sys_file`'s own read rule is unchanged, so a direct `sys_file` query by the same reader is still refused. A reader with `sys_file` read is served by their own read, as before. The download door's verdict for every request is unchanged.

**One verdict, two callers.** `@objectstack/service-storage` moves the download door's field-owned arm into one module-private function (not exported) and hands it to the engine through a new seam, `ObjectQL.registerFieldOwnedFileReadAuthorizer` (type `FieldOwnedFileReadAuthorizer`, exported from `@objectstack/objectql`), the same handover `registerHeldFileResolver` already makes. The engine never re-derives it. An engine with nothing registered keeps the refused marker for every id. On a refused hydration the engine makes one more `sys_file` read under the caller's tenant (it reads only ids whose ownership pair names a record in the result) and asks the verdict once per read.

**For consumers.** Nothing to change. A refused reader may now receive the full file object where it used to receive the marker, and code that already handles all three `expanded` read forms handles this.
