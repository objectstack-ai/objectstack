---
'@object-ui/data-objectstack': patch
---

fix(data-objectstack): `uploadFile` and `uploadFiles` upload through the storage service's presigned flow

Clause-②: no
Metadata-protocol: none

The two methods posted the file to `/api/data/<resource>/upload`, a route the standard server does not serve, so every call failed with 404 `ENDPOINT_NOT_FOUND`. They now upload through the storage service, the way `createObjectStackUploadAdapter` does: `POST /api/v1/storage/upload/presigned`, the byte `PUT`, then `POST /api/v1/storage/upload/complete`. `uploadFiles` uploads its files one after another.

- `recordId` attaches the file to that record of `resource` in the completing call (scope `attachments`), and the result's `metadata.attachmentId` names the attachment. Without `recordId` the file is stored under the server's default scope.
- The result is the stored file: `id` is the `sys_file` id, `url` the stable download URL.
- `onProgress` still receives 0 to 100.
- `fieldName` and `metadata` are now refused with `UNSUPPORTED_OPERATION` before any request, because neither presigned request carries them. Before, they were sent to the missing route. To fill a file field, upload without them, then write the returned file onto the record with `update()`.
- A refused storage request rejects with `UPLOAD_ERROR`, the server's status, and its error code in `details.serverCode`. When a file in `uploadFiles` is refused, the batch stops there. The error's `details` carry `failedIndex` and, as `uploaded`, the files already stored.

The requests still go through the injected `fetch`, outside the connection-state tracking, and the adapter's `token` is sent on every request to this server. A presigned byte URL on another origin does not get it: the same-origin check compares resolved origins, so a protocol-relative or backslash-spelled URL that resolves to another host is not this server.
