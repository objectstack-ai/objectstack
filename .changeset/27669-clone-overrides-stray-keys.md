---
'@objectstack/rest': patch
---

fix(rest)!: the clone door refuses a body that carries `overrides` beside other top-level keys, instead of cloning with `overrides` alone (#27669)

Clause-②: no (narrowing) — `POST /data/:object/:id/clone` refuses a body that mixes the nested `{ "overrides": {...} }` shape with other top-level keys; it used to answer `201` with those keys ignored. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: one REST door now refuses a request shape whose extra keys it used to ignore. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at one REST data door (`@objectstack/rest`).

- **Before.** `{ "overrides": { "name": "Copy" }, "status": "draft" }` read `overrides` alone: the clone got the new name, `status` was dropped, and the door answered `201`.
- **Now.** A body that carries `overrides` beside any other top-level key answers `400` with `error.code: 'VALIDATION_ERROR'` before the clone runs, naming the stray keys and the two accepted shapes.
- **Unchanged.** `{ "overrides": {...} }` alone, a bare field map without an `overrides` key, `{}`, and no body at all clone exactly as before. The SDK's `data.clone` sends only the nested shape.
- **Who sees it.** An API caller or script that mixes the two body shapes. Such a request used to succeed while applying only part of what was sent.

**The remedy.** Send either `{ "overrides": {...} }` or a bare field map, not both. A record with a real field named `overrides` sets it through the nested shape: `{ "overrides": { "overrides": ... } }`.
