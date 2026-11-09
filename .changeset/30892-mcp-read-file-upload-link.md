---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/service-storage': patch
---

feat(mcp): an agent can read a record's files and attach a file to a record — `read_file` and `create_upload_link` over `/api/v1/mcp`, and the single-use upload link they hand out (#30892)

Clause-②: yes (widening) — two MCP tools join the HTTP surface where the storage service is installed (`read_file` under `data:read`, `create_upload_link` under `data:write`), and two signed-in routes join the storage family: `GET` and `PUT /api/v1/storage/upload-links/:token`. Nothing that answered before answers differently.
Metadata-protocol: none

- **`read_file`** takes `objectName`, `recordId` and a file field (with `fileId` when the field holds several files) or an `attachmentId`. With neither, it lists the record's files. It answers the file's facts (id, name, type, size, the read cap that applies), a short-lived download link, and the content: a PDF's or Word document's text (extracted on the server, capped in pages and characters), an image as an MCP image block, a text file as text. A file over the cap (10 MiB) answers its facts and the download link, without content. Access follows the record: a record the caller cannot read answers `404 RECORD_NOT_FOUND`, as `get_record` does, and a file the download door would refuse answers that door's `403`.
- **`create_upload_link`** takes a record the caller may edit plus a file field or `attachments: true`. It answers a link that accepts exactly one upload for ten minutes, bound to that record and that field (or the record's attachments), and usable only by the same user, signed in: a request without a session answers `401 AUTH_REQUIRED`, like every other storage door. The upload lands as the caller would land it: the file field is written through the record's own update door, so the field's `accept` and `maxSize`, the record's edit access and the upload size limit (`storage.max_upload_mb`, `413` before the link is spent) all apply. It writes the same `sys_file` row, size recorded, and the same `storage.upload` as any other upload, so whatever a host counts toward quota counts it. A used, expired or unknown link, or one made for another user, answers the same `404`.
- **`@objectstack/mcp`** loads `unpdf` (pinned 1.9.1) by dynamic import on the first PDF read, with pdf.js eval off; a Word document is read with `node:zlib` under a bounded inflate.
