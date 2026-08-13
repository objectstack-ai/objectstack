---
'@objectstack/runtime': patch
---

`GET /meta/:type/:name/published`: resolve from the published store, not the code/package snapshot

An item published at runtime — authored as an ADR-0027 draft and promoted via
`POST /packages/:id/publish-drafts` — answered `404` on this route, while the
ordinary read `GET /meta/:type/:name` served it. The route and the publish path
shared no store:

- **the write** flips the artifact's `sys_metadata` row `state:'draft' →
  'active'` (`publishPackageDrafts` / `promoteDraft`), and the dispatcher's own
  comment on that route notes it has "no metadata service dependency";
- **the read** resolved only through `metadataService.getPublished`, which reads
  the row-local `publishedDefinition` key that `MetadataManager.publishPackage`
  writes into its own in-memory registry — the ADR-0016-era package publish.

So the 404 was a false statement about an item that IS published. ADR-0027 (E)(5)
defines sealing a publish as exactly that `draft → active` flip;
`SysMetadataRepository` names `'active'` "the published, live overlay"; and
ADR-0033 §2 — the ADR this route cites — routes every authoring write into that
same ADR-0027 draft. The `active` overlay row is therefore the authoritative
answer to "what is published", and this route now consults it first.

The overlay is read through `getMetaItemLayered`, whose overlay layer is a
strict `state:'active'` lookup (org-scoped first, then env-wide, with the
ADR-0048 package preference) reported separately from the code layer. That
separation is what the fix rests on:

- a **runtime-published** item is served, and served the published body;
- a **draft-only** item is still `404` — the overlay lookup never reads a draft,
  so a pending edit is not served as published;
- a **code-published** item is untouched: a null overlay is positively "no
  runtime-published row" and falls through to the existing `getPublished` path,
  which answers the same bytes it always did. The broader `getMetaItem` would
  not do — it folds the code layer into its own answer, so the route could no
  longer tell the two stores apart, and a code-published item would be served
  its raw stored envelope instead of its `publishedDefinition`.

Unchanged on purpose: `404` on this route continues to mean "no such item"
rather than "exists but unpublished" — an existing item that was never published
still answers `200` with its current definition, which is `getPublished`'s
documented fallback and a different fact from absence.

The identical divergence on the `packages/rest` transport
(`GET /api/v1/meta/:type/:name/published`, which resolves the same optional
`getPublished` member) is NOT addressed here — that surface has a different
owner.
