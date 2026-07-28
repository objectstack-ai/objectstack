---
"@objectstack/service-storage": patch
---

fix(service-storage): stop handing out `_local/file/:key`, a URL nothing mounts (#3641)

Three call sites built `${basePath}/_local/file/<key>`. No registrar has ever
mounted it, so anyone who followed one got a 404. Found by the tranche-3
storage ledger (#3636), which recorded the URL as deliberately absent and filed
this; now nothing builds it either.

Each site is fixed according to what it could honestly do:

- **`LocalStorageAdapter.getPresignedUpload()`** simply omits `downloadUrl`
  (optional on the descriptor). It cannot construct the real capability URL —
  that is keyed by `sys_file.id`, and an adapter only ever sees the storage
  key. Nothing read the field anyway, which is how it survived: the
  presigned-upload route builds its own `downloadUrl`
  (`${basePath}/files/:fileId/url`) and ignores this one, while all three real
  readers of `desc.downloadUrl` take it from `getPresignedDownload`, whose URL
  *is* mounted (`_local/raw/<token>`).

- **`GET /files/:fileId/url` and `GET /files/:fileId`** answer **501
  `NOT_IMPLEMENTED`** when the adapter has neither `getPresignedDownload` nor
  `getSignedUrl`, instead of returning (or redirecting to) the unmounted URL.
  The caller now learns the adapter is the limitation rather than chasing a
  broken link.

Behaviour change is confined to adapters implementing neither capability —
`LocalStorageAdapter` and the S3 adapter both implement `getPresignedDownload`,
so no shipped path changes. A 200/302 pointing at a 404 becomes a 501 that says
why.

Two conformance cases added for the new branches, and mutation-checked:
restoring either dead URL fails them.
