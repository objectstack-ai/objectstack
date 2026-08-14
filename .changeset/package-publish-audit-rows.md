---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': patch
---

fix(metadata-protocol): `publishPackageDrafts` now writes the audit rows a batch publish always owed

Studio's "publish whole app" (`POST /packages/:id/publish-drafts`) promoted every
draft in a package and wrote **no `sys_metadata_audit` rows at all** — neither the
allowed-outcome `publish` rows nor a `denied` row for a refusal. The route calls
`promoteDraftForPublish` directly rather than `publishMetaItem`, so the row added
for the single-item routes never ran for it: a batch that published twenty
artifacts left the compliance trail exactly as empty as a batch nobody ran.

Both outcomes are now recorded, and **where** they are recorded is the fix:

- **allowed** — one `publish` / `allowed` row per promoted item, written in Phase 2
  off `promoted[]`, with `source: 'protocol.publishPackageDrafts'` so the trail
  distinguishes "publish whole app" from a single-item publish. The row is keyed on
  the scope the draft was promoted in, not the request's active org, because
  env-wide drafts are promoted env-wide.
- **denied** — one `publish` / `denied` row with `code: 'batch_aborted'` when the
  batch rolls back, written from the rollback handler, **outside** the
  `engine.transaction()`. Written inside it, the refusal's own row would roll back
  with the batch it records — leaving nothing behind about a refused publish, which
  is the defect the single-item audit rows exist to close.

The causal reason rides in `note`, which is served by `GET /api/v1/meta/:type/:name/audit`
and therefore carries the client-facing text rather than raw driver output.
