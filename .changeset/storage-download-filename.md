---
"@objectstack/spec": patch
"@objectstack/service-storage": patch
---

fix(storage): downloads carry the real filename + content-type, not the URL token (#3504)

A presigned download served the bytes as `application/octet-stream` with no
`Content-Disposition`, so a browser saved the file under the opaque URL token
(e.g. `eyJrIjoiYXR0YWNo…`) instead of its real name — an approval's
`signed-contract.pdf` downloaded as a nameless blob.

- `IStorageService.getSignedUrl` / `getPresignedDownload` take an optional
  `PresignedDownloadOptions` (`filename`, `contentType`, `disposition`).
- The REST download routes (`GET /storage/files/:id/url` and `/:id`) pass the
  `sys_file` record's `name` + `mime_type`.
- The local adapter carries them in the signed token; the `_local/raw` route
  emits `Content-Type` + an RFC 5987 `Content-Disposition` (ASCII fallback +
  `filename*=UTF-8''…` for non-ASCII names). The S3 adapter bakes the same into
  the signed URL via `ResponseContentType` / `ResponseContentDisposition`.
- Default disposition is `inline`, so previewable types (PDF, images) still open
  in the browser — now with the correct name when saved.
