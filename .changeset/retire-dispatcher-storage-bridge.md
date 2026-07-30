---
"@objectstack/runtime": minor
"@objectstack/hono": minor
"@objectstack/plugin-dev": patch
---

fix(runtime,hono,plugin-dev): retire the dispatcher's `/storage` bridge — it never spoke the storage contract (#4087)

`POST /api/v1/storage/upload` and `GET /api/v1/storage/file/:id` were a
dispatcher-side bridge to the `file-storage` service slot, written against a
service shape that does not exist:

- **Upload** called the contract's `upload(key, data, options?)` as
  `upload(file, { request })` — the parsed file object landed in the `key`
  slot and `{ request }` in `data`. That is a `TypeError` against every
  implementation in the repo (`S3StorageAdapter`, `LocalStorageAdapter`,
  `SwappableStorageService`, plugin-dev's in-memory one), not a
  near-miss: `Buffer.from({}) → ERR_INVALID_ARG_TYPE`, or an object used as
  an S3 object key / `path.join` segment.
- **Download** branched on `result.url` / `result.redirect` / `result.stream`
  / `result.mimeType` while the contract's `download(key)` resolves a
  `Buffer`, so every branch fell through and the route answered a
  JSON-serialized Buffer.

Both routes are removed, along with `HttpDispatcher.handleStorage()`, the
`/storage` domain registration, the dispatcher-plugin mounts and the two route
ledger rows.

**Migration.** There is nothing to migrate off in practice — neither route
could complete a request. (They were reachable: `service-storage` mounts
`/storage/upload/presigned`, not `/storage/upload`, so nothing shadowed them.
They simply had no caller — no SDK method builds those URLs.)
`/api/v1/storage` is `@objectstack/service-storage`'s surface and always was
the working one:

- Upload — FROM `POST /api/v1/storage/upload` TO the presigned protocol
  (`POST /storage/upload/presigned` → direct `PUT` to the returned URL →
  `POST /storage/upload/complete`), or `client.storage.upload(file)`, which
  runs all three steps.
- Download — FROM `GET /api/v1/storage/file/:id` TO
  `GET /storage/files/:fileId/url` (`client.storage.getDownloadUrl(fileId)`)
  for a signed URL, or `GET /storage/files/:fileId` for a stable browser URL
  that 302s to it.

Install `@objectstack/service-storage` to get those routes; without it
`/api/v1/storage` now has no handler, which is the same answer every other
uninstalled capability gives.

Two follow-on corrections keep `declared === enforced`:

- `@objectstack/hono` no longer mounts `app.all('<prefix>/storage/*')`. That
  wildcard claimed the whole `/storage` subtree for the two dead routes, so
  every other path under it — service-storage's protocol above all — got the
  bridge's own 404 rather than falling through. Storage is ordinary catch-all
  traffic now.
- Discovery keeps gating `routes.storage` on `isServiceServeable` — the shared
  `handlerReady` predicate #4058 step 2 introduced — and plugin-dev's in-memory
  implementation now self-declares `handlerReady: false`. #4058 deliberately
  left that one serving because the `/storage` bridge was still there to serve
  it; with the bridge retired nothing routes HTTP to that slot, so `false` is
  the honest value — the position `realtime` has held since ADR-0076 D12. The
  implementation keeps working for in-process callers; it is simply no longer
  advertised as a reachable HTTP capability.
