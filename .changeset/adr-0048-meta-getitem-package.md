---
"@objectstack/runtime": minor
"@objectstack/spec": minor
---

feat(runtime): package-scoped single-item metadata resolution via `?package=` (ADR-0048)

The REST single-item GET `/meta/:type/:name` now threads its `?package=` query
into `getItem(type, name, currentPackageId)` (the package-scoped resolution
added in the namespace-gate work). Previously only the *list* and the protocol
path were package-aware; a single-item fetch was context-free.

This lets a caller resolve one item scoped to a package — notably the doc
viewer (`/apps/:packageId/docs/:name`), whose content lives only on the
single-item endpoint. As a result, `doc` names no longer need a namespace
prefix for uniqueness (the prefix becomes a recommended convention, like
`page`/`dashboard`/`report`); `doc.zod` doc-comments updated accordingly.
