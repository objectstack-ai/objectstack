---
"@objectstack/objectql": minor
---

feat(objectql): resolve file-field id references on read — ADR-0104 D3 wave 2 (PR-2)

The engine read path now resolves a `file`/`image`/`avatar`/`video`/`audio`
value stored as an opaque `sys_file` id string into its expanded
`FileValueSchema` form — `{ id, name, size, mimeType, url }`, with `url` derived
from the stable `/api/v1/storage/files/:fileId` resolver (never stored). One
batched `sys_file` `id $in […]` read per query (no N+1), mirroring the
lookup-`$expand` batch pattern.

**Dual-mode safe.** An inline-blob value (an object) passes through unchanged,
and only an **opaque id token** (uuid/nanoid-shaped) is treated as a reference —
a URL-shaped value (`https://…`, `/api/…`, `data:…`, `blob:…`), which a file
field legitimately holds in the legacy world, is never looked up. The step
fires zero reads unless a file field actually holds an id token (the blob/URL
case is free), and it no-ops entirely when `sys_file` is not registered.

This makes a stored `fileId` (surfaced by PR-1) actually usable on read, ahead
of the v17 cutover that narrows the stored form to an id.
