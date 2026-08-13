---
'@objectstack/rest': patch
---

`GET /api/v1/meta/:type/:name/published`: resolve from the published store, not the code/package snapshot

The REST transport carried the same defect the dispatcher fixed for
`/meta/:type/:name/published`: an item published at runtime — authored as an
ADR-0027 draft and promoted via `POST /packages/:id/publish-drafts` — answered
`404` here, while the ordinary read `GET /api/v1/meta/:type/:name` served it.
The route and the publish path shared no store:

- **the write** flips the artifact's `sys_metadata` row `state:'draft' →
  'active'` (`publishPackageDrafts` / `promoteDraft`);
- **the read** resolved only through `metadata.getPublished`, which reads the
  row-local `publishedDefinition` key that `MetadataManager.publishPackage`
  writes into its own in-memory registry — the ADR-0016-era package publish.

So the 404 was a false statement about an item that IS published, on the
transport that actually serves the cloud runtime. ADR-0027 (E)(5) defines
sealing a publish as exactly that `draft → active` flip;
`SysMetadataRepository` names `'active'` "the published, live overlay"; and
ADR-0033 §2 routes every runtime authoring write into that same ADR-0027 draft.
The `active` overlay row is therefore the authoritative answer to "what is
published", and both route arities — `/meta/:type/:name/published` and
`/meta/:type/:section/:name/published` — now consult it first.

The overlay is read through `getMetaItemLayered`, whose overlay layer is a
strict `state:'active'` lookup reported separately from the code layer. That
separation is what the fix rests on:

- a **runtime-published** item is served, and served the published body;
- a **draft-only** item is still `404` — the overlay lookup never reads a draft,
  so a pending edit is not served as published;
- a **code-published** item is untouched: a null overlay is positively "no
  runtime-published row" and falls through to the existing `getPublished` path,
  which answers byte-identical bytes.

Unchanged on purpose: `404` on this route continues to mean "no such item"
rather than "exists but unpublished" — an existing item that was never published
still answers `200` with its current definition, which is `getPublished`'s
documented fallback and a different fact from absence.

Two deliberate differences from the dispatcher twin:

- **No organization scoping.** `packages/rest` carries no
  `resolveActiveOrganizationId` and no org plumbing at all — the same seam
  `package-routes.ts` already names at its `deletePackage` call. The read
  resolves the env-wide (`organization_id: null`) overlay row, which is
  symmetric with what an org-less `publishPackageDrafts` writes.
- **A metadata-store outage stays a `503`.** `getMetaItemLayered` throws
  `SERVICE_UNAVAILABLE` when an overlay read that would decide a layer did not
  happen (the benign "table not provisioned yet" case returns normally with a
  null overlay). That throw is re-raised rather than swallowed, so an
  availability failure is never answered as `404 Not found`.
