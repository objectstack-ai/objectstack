---
'@objectstack/service-storage': patch
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(storage,mcp): one upload link takes several files on a multi-file field

Clause-②: yes (widening)
Metadata-protocol: none

A link `create_upload_link` makes for a file field declared `multiple: true` now takes several files in its one use: the user picks up to 10 on the link's page and sends them together, and each file gets its own file id. "Here are my three invoices" is one link and one pick instead of three. A single-file field link and an attachments link take one file, as before.

On a multi-file field's link, one send spends the link once, and every file in it, however many the send carries, is checked before that: the workspace's maximum upload size, and the field's own `accept` and `maxSize`. One file the field cannot take, or more than 10 files (`400` `VALIDATION_ERROR`), refuses the whole send, stores nothing and leaves the link usable. After that the field gains all the files in one write, or none: a failure storing any of them, or the record's write refusing (a pending approval's lock, say), discards every file of the send, so the record shows what it held before and no file of the send is left.

For a record not yet created, `create_upload_link` takes `count` (how many files, up to 10) with a multi-file field, and answers that many `fileIds` at once; the user picks exactly that many, and the agent creates the record with the field set to `fileIds`. Each id keeps the rules a single upload's id has: only that user's own write, into that field of that object, in one record, within an hour of the upload. Before the upload, every write naming one of the ids is refused, the uploader's own included, and nothing serves it.

The link's page takes several files where the link does, in every language it is served in. The send is one form (`multipart/form-data`, marked by the header `x-upload-link-form: several`) carrying `count` and `file0` … `fileN-1`, and only a link that takes several files reads it. Any other body, on any link (a multipart one without that header included), is the file itself, whatever its content type, under the same limit and with the same checks as before. Every successful answer now also carries `fileIds`.
