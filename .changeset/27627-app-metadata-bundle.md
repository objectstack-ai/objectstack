---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/client': minor
---

feat(rest): `GET /api/v1/meta/app/{appId}/bundle` answers an app's metadata in one request, per caller, with an ETag (#27627)

Clause-②: yes (widening: a new route and its response shape; no existing route, key or answer changes)
Metadata-protocol: added

A console working inside one app used to read the app, then one `GET /meta/object/{name}` per object it opened, then the views, pages and dashboards those draw, each as its own request. The new route answers them together (`AppMetadataBundleResponseSchema`, `@objectstack/spec/api`):

- **What is in it**: the app with its navigation; every object its navigation reaches (top-level, area and nested entries) and every object with a lookup or master-detail field referencing one of those; the views the navigation names or that bind to a bundled object; the pages the navigation names or that bind to a bundled object; the dashboards the navigation names.
- **Every member is the item read it replaces, as the same caller**: the app is `GET /meta/app/{appId}`, and each entry is `GET /meta/{type}/{name}`, envelope included. Audience gates, list-view and dashboard permissions, the field-visibility mask, the translation to the request locale and `sortability` apply exactly as they apply to those reads. An item the caller may not read is absent from the bundle. An app the caller may not read refuses the whole request with the app read's own answer.
- **Cached per caller**: a strong `ETag` over the bytes served to this caller, `Cache-Control: private, no-cache`, `Vary: Accept-Language`, and `If-None-Match` answered `304`. Two callers share a validator only when they are served the same bytes. A member whose field visibility could not be determined serves the bundle `private, no-store` with no `ETag`.
- **Server-Timing**: the bundle's metadata reads are timed as a `meta` span beside `db` and `total`, under the existing gate (`OS_SERVER_TIMING=true`, or `X-OS-Debug-Timing: 1` from an admin).
- The query-parameter set is closed and empty.
- `@objectstack/client` gains `meta.getAppBundle(appId, { ifNoneMatch })`, conditional in `meta.getCached`'s spelling: it answers `{ notModified: false, data, etag }` on a `200` and `{ notModified: true, etag }` on a `304`, and a `304` is not thrown as a failed request.
