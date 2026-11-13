---
'@objectstack/service-storage': patch
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(storage,mcp): an upload link for a file field of a record not yet created, so an agent can create a record whose file field is required

Clause-②: yes (widening)
Metadata-protocol: none

`create_upload_link` takes no `recordId` when it names a `field`: the link names the object and the file field only, and its answer carries `fileIds`, the id the upload is stored under. The user opens the link signed in and uploads; the agent then calls `create_record` with the field set to `fileIds[0]`. An expense line with a required e-invoice is created in two agent calls and one upload, and the field's `required` rule is unchanged.

Minting such a link asks the object's create permission for the user, and the field must be writable for them and not read-only; an attachments link still needs its record. The upload is checked against the field's `accept` and `maxSize` before the link is spent. The stored file is bound to the uploading user, the object and the field for one hour: until a record holds it, only that user's own write, into that field of that object, may use it, and within the hour no second record may take it while the first holds it. The uploader's write into another field or object, or after the hour, is refused at the field with the reason; another user's or a system write is refused as a file they cannot open. Once the hour has passed with a record holding it, or once a record lets it go, it is judged as any other record's file. Before the upload, the id takes no write but the uploader's, which is refused as an upload that never completed. Until a record has held the file, only its uploader may download it. The page the link opens says the file was received, and tells the user to go back to the assistant.

`fileIds` is an array so that a link for several files can answer several ids without a new key. Hosts whose storage service predates this keep `recordId` required on the tool, and the agent skill teaches the no-record form only where the host serves it.
