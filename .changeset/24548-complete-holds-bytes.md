---
'@objectstack/service-storage': patch
---

fix(service-storage): the single-shot upload commit refuses a file whose bytes the storage backend does not hold

Clause-②: no

**What was wrong.** `POST /api/v1/storage/upload/complete` set the `sys_file` row to `committed` without asking the storage backend. A presigned upload whose byte `PUT` failed, or was never sent, therefore committed with the size it declared. The download doors serve any `committed` file, so `GET /api/v1/storage/files/:fileId/url` handed out a signed URL, and fetching it failed with `500`.

**What the commit door does now.** Before it commits, it asks the backend through two members every adapter implements: `exists(key)`, and `getInfo(key).size` compared with the size the upload declared. When the backend holds no bytes for the file, or holds a different number of bytes, the door answers `409` with the standard code `RESOURCE_CONFLICT`. The row stays `pending`, so nothing is served for it. This is the answer the chunked completion already gives an upload that does not hold its declared bytes.

**What changes for you.** Nothing, if your client sends the bytes before it completes, as the SDK's `storage.upload` and the console's upload provider do. A client that completes first now receives the `409`: send the file to its upload URL (start a new upload if that URL has expired), then complete again. A backend fault while asking still answers `500`.

The `eTag` a completion may carry is still stored as sent and not compared: no adapter reports the stored object's ETag.

**The local adapter's download link.** `GET /api/v1/storage/_local/raw/:token` answers `404` `FILE_NOT_FOUND` when no file is stored under the link's key. Before, it answered `500` `INTERNAL` ("Download failed"). Every other read failure still answers `500`.
