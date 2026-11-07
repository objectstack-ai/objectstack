---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the cached `/meta` item read answers the item's own change time as `lastModified`, never the time of the read

Clause-②: no
Metadata-protocol: none

The cached by-name read (`getMetaItemCached`, the default `GET /api/v1/meta/:type/:name`) used to answer `lastModified` as the time of the read, so the `Last-Modified` header changed on every read of an unchanged item while its ETag stayed the same.

- **An item served from a stored `sys_metadata` row** answers that row's `updated_at`: the time of the save or publish that last wrote it. Two reads of the unchanged item answer the same `Last-Modified`; a save or a publish moves it.
- **An item no stored row serves** (a definition shipped in code or loaded from a file) has no known change time. It answers no `lastModified`, and the door sends no `Last-Modified` header.
- **Unchanged.** The ETag, `Cache-Control: private, no-cache` and the `304` on `If-None-Match`. `If-Modified-Since` still never answers a `304`. The by-name read's response envelope is byte-for-byte as before.
