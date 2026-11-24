---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
---

feat(metadata): the metadata list answers when each listed item last changed, as `changedAt` beside its items

Clause-②: yes
Metadata-protocol: added
Skills-docs: none — a read-only field of the list response that no author writes; no skill documents the list envelope's sibling fields (`registrations`, `disabledActions`)

`GET /api/v1/meta/:type` now answers `changedAt` beside `items` (`GetMetaItemsResponseSchema.changedAt`): for each listed item served from a stored row, the `updated_at` of that row, keyed by the item's `name`, as an ISO-8601 instant in UTC written with `Z`. A list can show a "changed" column without one read per item.

- Only an item served from a stored row has an entry. A code-shipped or file-loaded item has no recorded change time and no entry: never the read time or the boot time standing in. The field is absent when no listed item is served from a row.
- The time is the row whose content is listed. Of several stored rows in scope for one item (its package's own row, the package-less row, the package's declared override), on the list naming no package and on the list scoped to one, it is the row the list serves, the instant the by-name read serves as `Last-Modified` for it.
- On `?preview=draft`, an item whose pending draft is served (`_draft: true`) has the draft row's time.
- Several listed items of one name (a name two or more packages ship, the members of a bundle) answer the latest of their times.
- The `/meta` list chain (REST and the runtime dispatcher) keys only the names of which it still lists every item: where the per-caller gate withholds an item, or a query filter leaves one out, that name has no entry, so the time of an item the caller is not shown is never served, under its own name or a name another listed item shares.
- An `app` with navigation contributions keeps its entry (the contribution fold clones the app).
- The items themselves are unchanged. The execution face and the per-package layer answer no `changedAt`, and the MCP `list_metadata_items` summary is unchanged.
