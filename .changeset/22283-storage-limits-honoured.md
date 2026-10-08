---
'@objectstack/service-storage': minor
---

fix(service-storage)!: the storage settings' Limits group (`max_upload_mb`, `presigned_ttl`, `session_ttl`) is enforced at the upload doors

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime upload door: an upload larger than the resolved max_upload_mb, which used to be stored, is refused with 413 before anything is stored. The other categories are closed on facts: the one bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and nothing exported is removed or narrowed — the diff only adds an optional route option, two type exports and two methods — so it is neither runtime-interface-only nor type-surface-only. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Setup's File Storage page has always rendered a "Limits" group — "Max upload size (MB)", "Presigned URL TTL (seconds)" and "Upload session TTL (seconds)" — and saved it, but nothing read it. `StorageServicePlugin` now reads the group on every settings pass and its upload doors honour it, on the plugin's own mount and on a host's `mountStorageRoutes` mount alike.

**What stops being accepted.** Where the plugin is bound to the `storage` settings namespace (its default, `bindToSettings: true`, with a settings service present), an upload larger than the resolved `max_upload_mb` is refused with `413` and the standard code `VALIDATION_ERROR`, in the usual error envelope, with a message naming the limit and the setting. Nothing is stored: no `sys_file` or `sys_upload_session` row is written and no byte reaches the adapter. The doors that judge it:

- `POST /storage/upload/presigned` — the declared `size`;
- `POST /storage/upload/chunked` — the declared `totalSize`;
- `PUT /storage/_local/raw/:token` (the local adapter's presigned upload) — the body, by its `content-length` before it is read and by the bytes actually read;
- `PUT /storage/upload/chunked/:uploadId/chunk/:chunkIndex` — the bytes the session has received so far plus this chunk, the same two ways.

With nothing saved, the limit is the setting's declared default, **100 MB** (counted as MiB: 104,857,600 bytes). Uploads above it used to be stored and are now refused. The largest value the setting accepts is 10240 MB.

**What else changes.** A saved `presigned_ttl` is now the lifetime of every presigned upload URL and of every non-gated download URL; a saved `session_ttl` is the lifetime of every new chunked upload session. URLs and sessions issued before a save keep the lifetime they were issued with. With nothing saved both are unchanged — 3600 s and 86400 s, the declared defaults and the built-in ones being the same numbers. A save reaches the doors without a restart.

**Precedence, per key.** A saved value (an admin save or an env override) wins over the host's `presignedTtl` / `sessionTtl` option (the plugin constructor's, or `mountStorageRoutes`'), and the host's option wins over the namespace's declared default — the precedence the adapter keys already had.

**What stays accepted.**

- A mount with no settings namespace bound — no settings service, `bindToSettings: false`, or a `mountStorageRoutes` kernel whose `storage` service is not this plugin's — keeps no size limit and its option TTLs.
- On the S3 adapter, a presigned upload is judged by its declared size only: the bytes go straight to the bucket, so the platform never sees them.
- The gated download URL keeps its own short lifetime (`downloadTtl`, 300 s); `presigned_ttl` does not apply to it.

**What changes for you.** If your deployment accepts uploads larger than 100 MB, set "Max upload size (MB)" in the File Storage settings to the size you need before upgrading; a larger upload receives the `413` above.

**New API (additive).** `StorageRoutesOptions.limitsSnapshot`, the `StorageLimitsSnapshot` and `StorageLimitReading` types, and `SwappableStorageService.setLimitsSnapshot()` / `getLimitsSnapshot()` — the Limits group as the plugin last read it, which the route composition hands to the doors.
